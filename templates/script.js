/* DataSentinel v2.0 — Cyber Defense System */
'use strict';

/* ────────────────── CONSTANTS ────────────────── */
const CHART_POINTS    = 40;
const MAX_ATTACK_ROWS = 50;
const POLL_INTERVAL   = 2500;
const LOG_INTERVAL    = 5000;

const DEFENDER_DEFAULT = { lat: -23.55, lon: -46.63 };

/* ────────────────── STATE ────────────────── */
const state = {
  startTime:     Date.now(),
  threatsTotal:  0,
  connectionsToday: 0,
  ipsBlocked:    new Set(),
  ipHits:        new Map(),
  ipCountry:     new Map(),
  attackTypes:   new Map(),
  countries:     new Set(),
  lastAlertTs:   null,
  defender:      { ...DEFENDER_DEFAULT },
  currentSection:'dash',
  allLogLines:   [],
  netHistory:    { rx: [], tx: [] },
  connsHistory:  [],
};

/* ────────────────── CHART INSTANCES ────────────────── */
let networkChart      = null;
let socDonutChart     = null;
let miniTrendChart    = null;
let atkPageDonut      = null;
let netPageChart      = null;
let connsPageChart    = null;

/* ────────────────── LEAFLET MAP ────────────────── */
let leafletMap        = null;
let mapZoomTimer      = null;
let mapLabelTimer     = null;

function initLeafletMap() {
  const container = document.getElementById('threat-map');
  if (!container || !window.L) return;

  try {
    leafletMap = L.map('threat-map', {
      center: [20, 0],
      zoom: 3,
      zoomControl: false,
      minZoom: 2,
      maxZoom: 18,
      worldCopyJump: true,
      tap: false,
    });

    /* OpenStreetMap — filtro dark aplicado via CSS no .leaflet-tile-pane */
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(leafletMap);

    L.control.zoom({ position: 'bottomleft' }).addTo(leafletMap);
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(leafletMap);

    /* Fix obrigatório para layout flex/grid: recalcula tamanho várias vezes */
    [80, 250, 500, 900].forEach(ms =>
      setTimeout(() => {
        if (!leafletMap) return;
        leafletMap.invalidateSize({ animate: false, pan: false });
        leafletMap.eachLayer(l => { if (l.redraw) l.redraw(); });
      }, ms)
    );
    window.addEventListener('resize', () => leafletMap && leafletMap.invalidateSize());

    setTimeout(() => drawDefenderMarker(state.defender.lat, state.defender.lon), 700);

  } catch (e) { console.error('Leaflet init:', e); }
}

function drawDefenderMarker(lat, lon) {
  if (!leafletMap) return;
  const icon = L.divIcon({
    className: '',
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:rgba(77,255,154,0.25);
      border:2px solid #4dff9a;
      box-shadow:0 0 12px #4dff9a, 0 0 24px rgba(77,255,154,0.4);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  const m = L.marker([lat, lon], { icon, interactive: false }).addTo(leafletMap);
  m.bindTooltip('DEFENSOR · DataSentinel', { permanent: false, className: 'leaflet-dark-tooltip' });
}

function addLeafletMarker(lat, lon, meta) {
  if (!leafletMap) return;
  const sev = meta.severity || 'high';
  const color = sev === 'high' ? '#ff4d6d' : sev === 'medium' ? '#ffcc66' : '#66d9ff';

  /* Inner filled dot */
  const dot = L.circleMarker([lat, lon], {
    radius: 5,
    color: color,
    fillColor: color,
    fillOpacity: 0.8,
    weight: 1.5,
    interactive: true,
  }).addTo(leafletMap);

  if (meta.ip) {
    const loc = meta.location ? ` · ${meta.location}` : '';
    dot.bindTooltip(`${meta.ip}${loc}`, { permanent: false, className: 'leaflet-dark-tooltip' });
  }

  /* Expanding ring animation */
  const ring = L.circleMarker([lat, lon], {
    radius: 5, color, fillColor: 'transparent',
    fillOpacity: 0, weight: 1.5, opacity: 0.8,
    interactive: false,
  }).addTo(leafletMap);

  let radius = 5, opacity = 0.8;
  const expand = () => {
    radius += 0.8; opacity -= 0.025;
    if (!leafletMap || !leafletMap.hasLayer(ring)) return;
    ring.setRadius(radius);
    ring.setStyle({ opacity });
    if (opacity > 0 && radius < 28) requestAnimationFrame(expand);
    else if (leafletMap && leafletMap.hasLayer(ring)) leafletMap.removeLayer(ring);
  };
  requestAnimationFrame(expand);

  /* Auto-remove dot */
  setTimeout(() => {
    if (leafletMap && leafletMap.hasLayer(dot)) leafletMap.removeLayer(dot);
  }, 14000);
}

function addLeafletLine(fromLat, fromLon, toLat, toLon, severity) {
  if (!leafletMap) return;
  const color = severity === 'high' ? '#ff5577' : severity === 'medium' ? '#ffd27a' : '#8ee7ff';

  const line = L.polyline([[fromLat, fromLon], [toLat, toLon]], {
    color, weight: 1.4, opacity: 0.7, interactive: false,
  }).addTo(leafletMap);

  let startTs = null;
  const fade = (ts) => {
    if (!startTs) startTs = ts;
    const elapsed = ts - startTs;
    const op = Math.max(0, 0.7 * (1 - elapsed / 6000));
    if (!leafletMap || !leafletMap.hasLayer(line)) return;
    line.setStyle({ opacity: op });
    if (elapsed < 6000) requestAnimationFrame(fade);
    else if (leafletMap && leafletMap.hasLayer(line)) leafletMap.removeLayer(line);
  };
  requestAnimationFrame(fade);
}

function focusMapOn(lat, lon, holdMs = 4000) {
  if (!leafletMap) return;
  leafletMap.flyTo([lat, lon], 10, { duration: 1.2, easeLinearity: 0.4 });
  if (mapZoomTimer) clearTimeout(mapZoomTimer);
  mapZoomTimer = setTimeout(() => {
    if (leafletMap) leafletMap.flyTo([20, 0], 2, { duration: 1.8, easeLinearity: 0.4 });
  }, holdMs);
}

function showMapLabel(text, ms = 5000) {
  const el = document.getElementById('mapLabel');
  if (!el) return;
  el.textContent = text;
  if (mapLabelTimer) clearTimeout(mapLabelTimer);
  mapLabelTimer = setTimeout(() => { el.textContent = 'Aguardando ataques…'; }, ms);
}

/* ────────────────── SECTION NAVIGATION ────────────────── */
function showSection(name) {
  if (state.currentSection === name) return;
  state.currentSection = name;

  document.querySelectorAll('.section-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.menu li').forEach(li => li.classList.remove('active'));

  const section = document.querySelector(`.section-content[data-section="${name}"]`);
  if (section) section.classList.add('active');

  const menuItem = document.querySelector(`.menu li[data-section="${name}"]`);
  if (menuItem) menuItem.classList.add('active');

  /* Post-switch actions */
  if (name === 'dash' && leafletMap) {
    setTimeout(() => leafletMap.invalidateSize(), 50);
  }
  if (name === 'ataques') refreshAttacksPage();
  if (name === 'firewall') refreshFirewallPage();
  if (name === 'logs') refreshLogsPage();
  if (name === 'net') {
    setTimeout(() => {
      initNetPageCharts();
      if (netPageChart) netPageChart.update();
      if (connsPageChart) connsPageChart.update();
    }, 50);
  }
  if (name === 'sobre') {
    const el = document.getElementById('about-uptime');
    if (el) el.textContent = uptimeString();
  }
}

function bindNavigation() {
  document.querySelectorAll('.menu li').forEach(li => {
    li.addEventListener('click', () => showSection(li.dataset.section));
  });

  document.getElementById('btn-clear-alerts')?.addEventListener('click', () => {
    showSection('logs');
  });
  document.getElementById('btn-refresh-logs')?.addEventListener('click', fetchAndRenderFullLogs);

  const logSearch = document.getElementById('log-search');
  logSearch?.addEventListener('input', () => filterFullLogs(logSearch.value));

  document.querySelector('.btn-save')?.addEventListener('click', () => {
    const btn = document.querySelector('.btn-save');
    btn.textContent = '✓ SALVO';
    setTimeout(() => { btn.textContent = '💾 SALVAR CONFIGURAÇÕES'; }, 2000);
  });
}

/* ────────────────── CLOCK ────────────────── */
function atualizarRelogio() {
  const now = new Date();
  const t = el => document.getElementById(el);
  const pad = n => String(n).padStart(2, '0');
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const date = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;
  if (t('clock-time')) t('clock-time').textContent = time;
  if (t('clock-date')) t('clock-date').textContent = date;
}

/* ────────────────── UPTIME ────────────────── */
function uptimeString() {
  const secs = Math.floor((Date.now() - state.startTime) / 1000);
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return `${h}h ${m}m ${s}s`;
}
function updateUptime() {
  const el = document.getElementById('uptime-display');
  if (el) el.textContent = uptimeString();
}

/* ────────────────── ATTACK TYPE DETECTION ────────────────── */
function attackTypeFromPayload(p) {
  const t = (p.type || '').toLowerCase();
  const m = (p.message || '').toLowerCase();
  if (t.includes('brute') || m.includes('brute')) return 'BRUTE FORCE';
  if (t.includes('sql') || m.includes('sql inj')) return 'SQL INJECTION';
  if (t.includes('port') || m.includes('port scan')) return 'PORT SCAN';
  if (t.includes('xss') || m.includes('xss')) return 'XSS ATTEMPT';
  if (t.includes('ddos') || m.includes('ddos')) return 'DDoS';
  if (t.includes('ssh') || m.includes('ssh')) return 'BRUTE FORCE';
  return 'OUTROS';
}

function badgeClass(type) {
  const map = {
    'BRUTE FORCE':   'badge-brute',
    'SQL INJECTION': 'badge-sql',
    'PORT SCAN':     'badge-portscan',
    'XSS ATTEMPT':   'badge-xss',
    'DDoS':          'badge-ddos',
  };
  return map[type] || 'badge-outros';
}

function typeColor(type) {
  const map = {
    'BRUTE FORCE':   '#ff4d6d',
    'SQL INJECTION': '#ff9800',
    'PORT SCAN':     '#00d2ff',
    'XSS ATTEMPT':   '#4dff9a',
    'DDoS':          '#cc4dff',
    'OUTROS':        '#666',
  };
  return map[type] || '#666';
}

/* ────────────────── COUNTRY FLAG ────────────────── */
function countryToISO(country) {
  const map = {
    'brasil': 'br', 'brazil': 'br',
    'china': 'cn', 'russia': 'ru', 'rússia': 'ru',
    'estados unidos': 'us', 'united states': 'us', 'usa': 'us',
    'alemanha': 'de', 'germany': 'de',
    'frança': 'fr', 'france': 'fr',
    'reino unido': 'gb', 'united kingdom': 'gb',
    'índia': 'in', 'india': 'in',
    'japão': 'jp', 'japan': 'jp',
    'coreia do sul': 'kr', 'south korea': 'kr',
    'holanda': 'nl', 'netherlands': 'nl',
    'canada': 'ca', 'canadá': 'ca',
    'austrália': 'au', 'australia': 'au',
    'ucrânia': 'ua', 'ukraine': 'ua',
    'iran': 'ir', 'irã': 'ir',
    'turquia': 'tr', 'turkey': 'tr',
    'indonesia': 'id', 'indonésia': 'id',
    'romênia': 'ro', 'romania': 'ro',
    'suécia': 'se', 'sweden': 'se',
    'singapura': 'sg', 'singapore': 'sg',
    'hong kong': 'hk',
    'polônia': 'pl', 'poland': 'pl',
    'itália': 'it', 'italy': 'it',
    'espanha': 'es', 'spain': 'es',
    'argentina': 'ar',
    'méxico': 'mx', 'mexico': 'mx',
    'nigéria': 'ng', 'nigeria': 'ng',
  };
  return map[(country || '').toLowerCase().trim()] || null;
}

function flagEmoji(country) {
  const iso = countryToISO(country);
  if (!iso) return '🌐';
  const offset = 127397;
  return String.fromCodePoint(...iso.toUpperCase().split('').map(c => c.charCodeAt(0) + offset));
}

/* ────────────────── ALERT CARD ────────────────── */
function prependAlertCard(payload) {
  const type = attackTypeFromPayload(payload);
  const ip   = payload.ip || '—';
  const country = payload.country || '';
  const now  = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const desc = payload.message ? payload.message.slice(0, 60) : `${type} de ${ip}`;
  const flag = flagEmoji(country);

  function makeRow() {
    const row = document.createElement('div');
    row.className = 'attack-row mono';
    row.innerHTML = `
      <span class="row-time">${time}</span>
      <span><span class="badge ${badgeClass(type)}">${type}</span></span>
      <span class="row-desc">${desc}</span>
      <span class="row-ip">${ip}</span>
      <span class="row-flag">${flag}</span>
    `;
    return row;
  }

  /* Dashboard feed */
  const feed = document.getElementById('alerts-feed');
  if (feed) {
    feed.prepend(makeRow());
    while (feed.children.length > MAX_ATTACK_ROWS) feed.removeChild(feed.lastChild);
  }

  /* Ataques page feed */
  const pageFeed = document.getElementById('attacks-page-feed');
  if (pageFeed) {
    pageFeed.prepend(makeRow());
    while (pageFeed.children.length > MAX_ATTACK_ROWS * 2) pageFeed.removeChild(pageFeed.lastChild);
  }
}

/* ────────────────── TOP IPs ────────────────── */
function renderTopIps() {
  const el = document.getElementById('ips-list');
  if (!el) return;
  const sorted = [...state.ipHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxHits = sorted[0]?.[1] || 1;
  el.innerHTML = '';
  if (sorted.length === 0) { el.innerHTML = '<div class="empty-state">Aguardando eventos…</div>'; return; }
  sorted.forEach(([ip, count]) => {
    const country = state.ipCountry.get(ip) || '';
    const iso = countryToISO(country);
    const flagSrc = iso ? `https://flagcdn.com/h20/${iso}.png` : null;
    const item = document.createElement('div');
    item.className = 'ip-item';
    item.innerHTML = `
      ${flagSrc ? `<img class="ip-flag" src="${flagSrc}" alt="${country}" loading="lazy">` : `<span style="font-size:14px">🌐</span>`}
      <span class="ip-addr">${ip}</span>
      <div class="ip-bar-wrap"><div class="ip-bar-inner" style="width:${Math.round(count/maxHits*100)}%"></div></div>
      <span class="ip-count">${count}x</span>
    `;
    el.appendChild(item);
  });
}

/* ────────────────── DONUT CHART ────────────────── */
function getDonutData() {
  const entries = [...state.attackTypes.entries()];
  const labels = entries.map(e => e[0]);
  const data   = entries.map(e => e[1]);
  const colors = labels.map(typeColor);
  return { labels, data, colors };
}

function refreshSocDonut() {
  const { labels, data, colors } = getDonutData();
  if (labels.length === 0) return;

  const canvas = document.getElementById('socDonut');
  if (!canvas) return;

  if (!socDonutChart) {
    socDonutChart = new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }] },
      options: {
        cutout: '68%', animation: { duration: 400 },
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` }
        }},
      },
    });
  } else {
    socDonutChart.data.labels = labels;
    socDonutChart.data.datasets[0].data   = data;
    socDonutChart.data.datasets[0].backgroundColor = colors;
    socDonutChart.update('none');
  }
  renderDonutLegend(labels, data, colors, 'donut-legend');
  refreshAtkPageDonut(labels, data, colors);
}

function renderDonutLegend(labels, data, colors, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const total = data.reduce((a, b) => a + b, 0) || 1;
  el.innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i]}"></div>
      <span class="legend-name">${l}</span>
      <span class="legend-pct">${Math.round(data[i]/total*100)}%</span>
    </div>
  `).join('');
}

function refreshAtkPageDonut(labels, data, colors) {
  const canvas = document.getElementById('attacks-page-donut');
  if (!canvas) return;
  if (!atkPageDonut) {
    atkPageDonut = new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        cutout: '60%', animation: { duration: 300 },
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` }
        }},
      },
    });
  } else {
    atkPageDonut.data.labels = labels;
    atkPageDonut.data.datasets[0].data   = data;
    atkPageDonut.data.datasets[0].backgroundColor = colors;
    atkPageDonut.update('none');
  }
}

/* ────────────────── NETWORK CHART (dashboard) ────────────────── */
function ensureChart() {
  const canvas = document.getElementById('networkChart');
  if (!canvas || networkChart) return;
  networkChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: Array(CHART_POINTS).fill(''),
      datasets: [
        {
          label: 'RX (MB/s)',
          data: Array(CHART_POINTS).fill(0),
          borderColor: '#4dff9a', backgroundColor: 'rgba(77,255,154,0.07)',
          borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true,
        },
        {
          label: 'TX (MB/s)',
          data: Array(CHART_POINTS).fill(0),
          borderColor: '#00d2ff', backgroundColor: 'rgba(0,210,255,0.05)',
          borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true,
        },
      ],
    },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      scales: {
        x: { display: false },
        y: { display: true, min: 0, grid: { color: 'rgba(77,255,154,0.05)' }, ticks: { color: '#4a7060', font: { size: 9 } } },
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
}

function appendChartPoint(rx, tx) {
  ensureChart();
  if (!networkChart) return;
  networkChart.data.datasets[0].data.push(rx);
  networkChart.data.datasets[0].data.shift();
  networkChart.data.datasets[1].data.push(tx);
  networkChart.data.datasets[1].data.shift();
  networkChart.update('none');

  /* Also buffer history for rede page */
  state.netHistory.rx.push(rx);
  state.netHistory.tx.push(tx);
  if (state.netHistory.rx.length > CHART_POINTS) { state.netHistory.rx.shift(); state.netHistory.tx.shift(); }
}

/* ────────────────── MINI TREND (sidebar) ────────────────── */
let miniTrendData = [];
function appendMiniTrend(val) {
  miniTrendData.push(val);
  if (miniTrendData.length > 20) miniTrendData.shift();
  const canvas = document.getElementById('miniTrend');
  if (!canvas) return;
  if (!miniTrendChart) {
    miniTrendChart = new Chart(canvas, {
      type: 'line',
      data: { labels: Array(20).fill(''), datasets: [{ data: Array(20).fill(0), borderColor: '#4dff9a', backgroundColor: 'rgba(77,255,154,0.08)', borderWidth: 1, pointRadius: 0, tension: 0.4, fill: true }] },
      options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { x: { display: false }, y: { display: false } }, plugins: { legend: { display: false }, tooltip: { enabled: false } } },
    });
  }
  miniTrendChart.data.datasets[0].data = [...miniTrendData];
  miniTrendChart.update('none');
}

/* ────────────────── REDE PAGE CHARTS ────────────────── */
function initNetPageCharts() {
  const nc = document.getElementById('netPageChart');
  if (nc && !netPageChart) {
    netPageChart = new Chart(nc, {
      type: 'line',
      data: {
        labels: Array(CHART_POINTS).fill(''),
        datasets: [
          { label: 'RX', data: [...state.netHistory.rx], borderColor: '#4dff9a', backgroundColor: 'rgba(77,255,154,0.08)', borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true },
          { label: 'TX', data: [...state.netHistory.tx], borderColor: '#00d2ff', backgroundColor: 'rgba(0,210,255,0.05)', borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true },
        ],
      },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        scales: {
          x: { display: false },
          y: { min: 0, grid: { color: 'rgba(77,255,154,0.05)' }, ticks: { color: '#4a7060', font: { size: 9 } } },
        },
        plugins: { legend: { display: true, labels: { color: '#9dffc6', font: { size: 9 } } }, tooltip: { enabled: true } },
      },
    });
  } else if (netPageChart) {
    netPageChart.data.datasets[0].data = [...state.netHistory.rx];
    netPageChart.data.datasets[1].data = [...state.netHistory.tx];
    netPageChart.update('none');
  }

  const cc = document.getElementById('connsPageChart');
  if (cc && !connsPageChart) {
    connsPageChart = new Chart(cc, {
      type: 'line',
      data: {
        labels: Array(CHART_POINTS).fill(''),
        datasets: [{ label: 'Conexões', data: [...state.connsHistory], borderColor: '#ffcc66', backgroundColor: 'rgba(255,204,102,0.06)', borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true }],
      },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        scales: {
          x: { display: false },
          y: { min: 0, grid: { color: 'rgba(77,255,154,0.05)' }, ticks: { color: '#4a7060', font: { size: 9 } } },
        },
        plugins: { legend: { display: true, labels: { color: '#9dffc6', font: { size: 9 } } }, tooltip: { enabled: true } },
      },
    });
  } else if (connsPageChart) {
    connsPageChart.data.datasets[0].data = [...state.connsHistory];
    connsPageChart.update('none');
  }
}

/* ────────────────── METRICS POLLING ────────────────── */
async function pollMetrics() {
  try {
    const t0 = Date.now();
    const res = await fetch('/api/metrics');
    const d   = await res.json();
    const latency = Date.now() - t0;

    /* Defender coords */
    if (d.defender) state.defender = d.defender;

    /* Sidebar bars */
    const cpu = d.cpu ?? 0, mem = d.memory ?? 0, disk = d.disk ?? 0;
    setBar('bar-cpu', 'readout-cpu', cpu);
    setBar('bar-mem', 'readout-mem', mem);
    setBar('bar-disk', 'readout-disk', disk);

    const rx = d.net_rx_mbps ?? 0, tx = d.net_tx_mbps ?? 0;
    const netEl = el => document.getElementById(el);
    if (netEl('net-rx')) netEl('net-rx').textContent = `↓${rx} MB/s`;
    if (netEl('net-tx')) netEl('net-tx').textContent = `↑${tx} MB/s`;

    appendChartPoint(rx, tx);
    appendMiniTrend(d.network_activity ?? 0);

    /* KPI counters */
    const conns = d.connections_active ?? 0;
    setText('metric-connections', conns);
    setText('metric-threats', state.threatsTotal);
    setText('metric-unique-ips', state.ipsBlocked.size);
    setText('footer-conns', conns);

    /* latency */
    const latEl = document.getElementById('metric-latency');
    if (latEl) latEl.textContent = `${latency}ms`;

    /* Rede page KPIs */
    setText('net-rx-kpi', `↓${rx} MB/s`);
    setText('net-tx-kpi', `↑${tx} MB/s`);
    setText('net-conns-kpi', conns);
    setText('net-cpu-kpi', `${cpu}%`);
    setText('cfg-latency', `${latency}ms`);

    /* Connection history */
    state.connsHistory.push(conns);
    if (state.connsHistory.length > CHART_POINTS) state.connsHistory.shift();

    /* Atualiza gráficos da rede sempre que existirem (seção pode estar fechada) */
    if (netPageChart) {
      netPageChart.data.datasets[0].data = [...state.netHistory.rx];
      netPageChart.data.datasets[1].data = [...state.netHistory.tx];
      netPageChart.update('none');
    }
    if (connsPageChart) {
      connsPageChart.data.datasets[0].data = [...state.connsHistory];
      connsPageChart.update('none');
    }

    /* KPIs das páginas – sempre atualizados */
    setText('fw-threats',   state.threatsTotal);
    setText('fw-blocked',   state.ipsBlocked.size);
    setText('fw-ip-count',  state.ipsBlocked.size);
    setText('atk-total',    state.threatsTotal);
    setText('atk-ips',      state.ipsBlocked.size);
    setText('atk-countries',state.countries.size);

  } catch (e) { /* silent */ }
}

function setBar(barId, readoutId, pct) {
  const b = document.getElementById(barId);
  const r = document.getElementById(readoutId);
  if (b) b.style.width = `${Math.min(100, pct)}%`;
  if (r) r.textContent = `${pct}%`;
}
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

/* ────────────────── LOGS POLLING ────────────────── */
async function pollLogs() {
  try {
    const res = await fetch('/api/logs?n=200');
    const d   = await res.json();
    const lines = d.lines || [];
    state.allLogLines = lines;
    renderRecentLogs(lines.slice(-20));
    renderFullLogs(lines);
    streamLogsToTerminal(lines);   /* stream para o terminal aberto */
  } catch (e) { /* silent */ }
}

function renderRecentLogs(lines) {
  const el = document.getElementById('logs-container');
  if (!el) return;
  el.innerHTML = '';
  lines.slice().reverse().forEach(line => {
    const row = document.createElement('div');
    row.className = 'log-row mono';
    const { time, text, tag, tagClass } = parseLogLine(line);
    row.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-desc">${text}</span>
      <span class="log-tag ${tagClass}">${tag}</span>
    `;
    el.appendChild(row);
  });
}

function parseLogLine(line) {
  const timeMatch = line.match(/\[?(\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
  const time = timeMatch ? timeMatch[1].slice(-8) : '--:--:--';
  const text = line.slice(0, 80);
  const upper = line.toUpperCase();
  if (upper.includes('[BLOCK]') || upper.includes('BLOCK')) return { time, text, tag: 'BLOCK', tagClass: 'log-tag-block' };
  if (upper.includes('[WARNING]') || upper.includes('WARN'))  return { time, text, tag: 'WARN',  tagClass: 'log-tag-warn'  };
  if (upper.includes('[ALERT]')  || upper.includes('ALERT'))  return { time, text, tag: 'ALERT', tagClass: 'log-tag-alert' };
  return { time, text, tag: 'INFO', tagClass: 'log-tag-info' };
}

function renderFullLogs(lines) {
  const el = document.getElementById('logs-full-container');
  if (!el) return;
  el.innerHTML = '';
  lines.slice().reverse().forEach(line => {
    const div = document.createElement('div');
    div.className = 'full-log-line mono';
    const { time, tagClass } = parseLogLine(line);
    div.innerHTML = `<span class="fl-time">${time}</span><span class="fl-text ${tagClass.replace('log-tag-','fl-')}">${escHtml(line)}</span>`;
    el.appendChild(div);
  });
  const countEl = document.getElementById('log-count');
  if (countEl) countEl.textContent = `${lines.length} linhas`;
}

function filterFullLogs(query) {
  if (!query) { renderFullLogs(state.allLogLines); return; }
  const q = query.toLowerCase();
  renderFullLogs(state.allLogLines.filter(l => l.toLowerCase().includes(q)));
}

function fetchAndRenderFullLogs() {
  fetch('/api/logs?n=500').then(r => r.json()).then(d => {
    state.allLogLines = d.lines || [];
    renderFullLogs(state.allLogLines);
  }).catch(() => {});
}

function refreshLogsPage() {
  renderFullLogs(state.allLogLines);
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ────────────────── ATAQUES PAGE ────────────────── */
function refreshAttacksPage() {
  /* Stats */
  setText('atk-total', state.threatsTotal);
  setText('atk-ips', state.ipsBlocked.size);
  setText('atk-countries', state.countries.size);
  if (state.lastAlertTs) {
    const d = new Date(state.lastAlertTs);
    const t = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    setText('atk-last', t);
  }

  /* Type list */
  const el = document.getElementById('attack-type-list');
  if (el) {
    const entries = [...state.attackTypes.entries()].sort((a,b) => b[1] - a[1]);
    const max = entries[0]?.[1] || 1;
    el.innerHTML = entries.map(([type, count]) => `
      <div class="type-row">
        <span class="badge ${badgeClass(type)}">${type}</span>
        <div class="type-bar-wrap"><div class="type-bar-fill" style="width:${Math.round(count/max*100)}%;background:${typeColor(type)}"></div></div>
        <span class="type-count">${count}</span>
      </div>
    `).join('') || '<div class="empty-state">Aguardando…</div>';
  }
}

/* ────────────────── FIREWALL PAGE ────────────────── */
function refreshFirewallPage() {
  setText('fw-blocked', state.ipsBlocked.size);
  setText('fw-threats', state.threatsTotal);
  setText('fw-ip-count', state.ipsBlocked.size);

  const el = document.getElementById('fw-ips-list');
  if (!el) return;
  const sorted = [...state.ipHits.entries()].sort((a,b) => b[1] - a[1]);
  if (sorted.length === 0) { el.innerHTML = '<div class="empty-state">Nenhum IP bloqueado ainda…</div>'; return; }
  el.innerHTML = sorted.slice(0, 40).map(([ip, count]) => {
    const country = state.ipCountry.get(ip) || '—';
    const flag = flagEmoji(country);
    const time = new Date().toLocaleTimeString('pt-BR');
    return `<div class="fw-ip-row">
      <span style="font-size:14px">${flag}</span>
      <span class="fw-ip-addr">${ip}</span>
      <span class="fw-ip-count">${count}x</span>
      <span class="fw-ip-time">${time}</span>
    </div>`;
  }).join('');
}

/* ────────────────── SOCKET.IO ────────────────── */
function bindSocket() {
  if (!window.io) return;
  const socket = io();

  socket.on('connect', () => {
    setText('socket-status', 'REAL-TIME MONITORING');
    const statusEl = document.querySelector('#socket-status');
    if (statusEl) statusEl.className = 'tstat-value cyan';
    setText('cfg-socket-status', 'CONECTADO');
  });

  socket.on('disconnect', () => {
    setText('socket-status', 'OFFLINE');
    const statusEl = document.querySelector('#socket-status');
    if (statusEl) statusEl.className = 'tstat-value danger';
    setText('cfg-socket-status', 'DESCONECTADO');
  });

  socket.on('session_init', d => {
    state.threatsTotal = d.threats_total || 0;
    setText('metric-threats', state.threatsTotal);
  });

  socket.on('new_alert', payload => {
    handleNewAlert(payload);
  });
}

function handleNewAlert(payload) {
  state.threatsTotal = payload.threats_total || state.threatsTotal + 1;
  state.lastAlertTs = Date.now();
  state.connectionsToday++;

  const ip = payload.ip;
  if (ip) {
    state.ipsBlocked.add(ip);
    state.ipHits.set(ip, (state.ipHits.get(ip) || 0) + 1);
    if (payload.country) {
      state.ipCountry.set(ip, payload.country);
      state.countries.add(payload.country);
    }
  }

  const type = attackTypeFromPayload(payload);
  state.attackTypes.set(type, (state.attackTypes.get(type) || 0) + 1);

  /* Update counters */
  setText('metric-threats',    state.threatsTotal);
  setText('metric-unique-ips', state.ipsBlocked.size);
  setText('metric-connections', state.connectionsToday);

  /* Prepend to feeds */
  prependAlertCard(payload);

  /* Map: add marker + line */
  const lat = payload.lat, lon = payload.lon;
  if (lat != null && lon != null) {
    const defLat = state.defender.lat, defLon = state.defender.lon;
    const sev = lat != null ? 'high' : 'medium';
    addLeafletMarker(lat, lon, { ip, location: payload.location, severity: sev });
    addLeafletLine(lat, lon, defLat, defLon, sev);
    focusMapOn(lat, lon, 4000);
    const label = `${payload.location || payload.country || 'Desconhecido'} · ${type}`;
    showMapLabel(label, 5000);
  }

  /* Atualiza donut e top IPs no dashboard */
  refreshSocDonut();
  renderTopIps();

  /* Atualiza TODAS as páginas em tempo real */
  refreshAttacksPage();
  refreshFirewallPage();

  /* Imprime no terminal */
  termLogAlert(payload);

  /* Terminal footer */
  const terminal = document.getElementById('terminal-line-1');
  if (terminal) terminal.textContent = `[${new Date().toLocaleTimeString()}] ${type} · ${ip} bloqueado`;
}

/* ────────────────── HACKER BINARY RAIN ────────────────── */
function initHackerBinary() {
  const container = document.getElementById('hackerBinary');
  if (!container) return;

  function generate() {
    const cols = 14, rows = 5;
    const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノ';
    container.innerHTML = '';
    for (let i = 0; i < cols * rows; i++) {
      const span = document.createElement('span');
      span.textContent = chars[Math.floor(Math.random() * chars.length)];
      if (Math.random() < 0.12) span.classList.add('hot');
      container.appendChild(span);
    }
  }
  generate();
  setInterval(generate, 300);
}

/* ────────────────── ECG CANVAS ────────────────── */
function initEcg() {
  const canvas = document.getElementById('ecgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let offset = 0;
  const W = canvas.width, H = canvas.height;
  const MID = H / 2;
  const ECG = [0,0,0,0,-4,28,-14,1,1,0,0,6,-4,0,0,0,0];

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#4dff9a';
    ctx.lineWidth = 1.2;
    ctx.shadowColor = '#4dff9a';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    let x = 0;
    for (let i = 0; i < W; i++) {
      const idx = (i + offset) % ECG.length;
      const y = MID - ECG[idx];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x++;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    offset = (offset + 1) % ECG.length;
  }

  setInterval(draw, 40);
}

/* ────────────────── TERMINAL ────────────────── */
const term = {
  overlay:   null,
  body:      null,
  input:     null,
  history:   [],
  histIdx:   -1,
  lastCount: 0,
  maxLines:  500,
};

function initTerminal() {
  term.overlay = document.getElementById('termOverlay');
  term.body    = document.getElementById('termBody');
  term.input   = document.getElementById('termInput');
  if (!term.overlay || !term.body || !term.input) return;

  /* Toggle via footer */
  document.getElementById('termToggle')?.addEventListener('click', () => termToggle());

  /* Fechar / minimizar */
  document.getElementById('termClose')?.addEventListener('click', () => termClose());
  document.getElementById('termMin')?.addEventListener('click',   () => termClose());
  document.getElementById('termMax')?.addEventListener('click',   () => {
    term.overlay.style.height = term.overlay.style.height === '90vh' ? '360px' : '90vh';
  });

  /* Input: Enter executa, Up/Down navega histórico */
  term.input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const cmd = term.input.value.trim();
      term.input.value = '';
      if (!cmd) return;
      term.history.unshift(cmd);
      term.histIdx = -1;
      termExec(cmd);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      term.histIdx = Math.min(term.histIdx + 1, term.history.length - 1);
      term.input.value = term.history[term.histIdx] || '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      term.histIdx = Math.max(term.histIdx - 1, -1);
      term.input.value = term.histIdx === -1 ? '' : term.history[term.histIdx];
    } else if (e.key === 'Tab') {
      e.preventDefault();
      termAutocomplete();
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      termClear();
    }
  });

  /* Boot message */
  termPrint('DataSentinel Terminal v2.0', 't-ok');
  termPrint('Digite "help" para ver os comandos disponíveis.', 't-sys');
  termPrint('─'.repeat(60), 't-sys');
}

const TERM_COMMANDS = ['help','clear','status','test','dash','ataques',
  'firewall','logs','rede','config','sobre','exit','alerts','ips'];

function termAutocomplete() {
  const val = term.input.value;
  const match = TERM_COMMANDS.find(c => c.startsWith(val));
  if (match) term.input.value = match;
}

function termToggle() {
  if (!term.overlay) return;
  const isOpen = term.overlay.classList.toggle('open');
  if (isOpen) setTimeout(() => term.input?.focus(), 320);
}
function termClose() { term.overlay?.classList.remove('open'); }

function termPrint(text, type = 't-out') {
  if (!term.body) return;
  const now = new Date();
  const ts  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const line = document.createElement('div');
  line.className = `term-line ${type}`;
  line.innerHTML = `<span class="tl-time">${ts}</span><span class="tl-text">${escHtml(text)}</span>`;
  term.body.appendChild(line);
  /* Limite de linhas */
  while (term.body.children.length > term.maxLines) term.body.removeChild(term.body.firstChild);
  term.body.scrollTop = term.body.scrollHeight;
}

function termExec(raw) {
  termPrint(`$ ${raw}`, 't-cmd');
  const [cmd, ...args] = raw.trim().toLowerCase().split(/\s+/);

  switch (cmd) {
    case 'help':
      termPrint('── NAVEGAÇÃO ─────────────────────────────────────', 't-sys');
      termPrint('  dash       → Ir para o Dashboard', 't-out');
      termPrint('  ataques    → Ir para Ataques em tempo real', 't-out');
      termPrint('  firewall   → Ir para Firewall / IPs bloqueados', 't-out');
      termPrint('  logs       → Ir para o Visualizador de Logs', 't-out');
      termPrint('  rede       → Ir para Monitoramento de Rede', 't-out');
      termPrint('  config     → Ir para Configurações', 't-out');
      termPrint('  sobre      → Ir para Sobre', 't-out');
      termPrint('── SISTEMA ───────────────────────────────────────', 't-sys');
      termPrint('  status     → Ver status do sistema', 't-out');
      termPrint('  alerts     → Ver últimos alertas', 't-out');
      termPrint('  ips        → Ver top IPs bloqueados', 't-out');
      termPrint('  test [ip]  → Disparar alerta de teste', 't-out');
      termPrint('  clear      → Limpar o terminal', 't-out');
      termPrint('  exit       → Fechar o terminal', 't-out');
      break;

    case 'status':
      termPrint(`Ameaças totais   : ${state.threatsTotal}`, 't-ok');
      termPrint(`IPs bloqueados   : ${state.ipsBlocked.size}`, 't-ok');
      termPrint(`Países detectados: ${state.countries.size}`, 't-ok');
      termPrint(`Uptime           : ${uptimeString()}`, 't-ok');
      termPrint(`Seção atual      : ${state.currentSection}`, 't-info');
      break;

    case 'alerts': {
      const feed = [...(document.getElementById('alerts-feed')?.querySelectorAll('.attack-row') || [])];
      if (feed.length === 0) { termPrint('Nenhum alerta registrado ainda.', 't-warn'); break; }
      termPrint(`Últimos ${Math.min(feed.length, 10)} alertas:`, 't-sys');
      feed.slice(0, 10).forEach(row => {
        const time = row.querySelector('.row-time')?.textContent || '';
        const ip   = row.querySelector('.row-ip')?.textContent || '';
        const badge = row.querySelector('.badge')?.textContent || '';
        termPrint(`  [${time}] ${badge.padEnd(14)} ${ip}`, 't-out');
      });
      break;
    }

    case 'ips': {
      const sorted = [...state.ipHits.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
      if (sorted.length === 0) { termPrint('Nenhum IP registrado ainda.', 't-warn'); break; }
      termPrint('Top IPs maliciosos:', 't-sys');
      sorted.forEach(([ip, count]) => {
        const country = state.ipCountry.get(ip) || '—';
        termPrint(`  ${ip.padEnd(18)} ${String(count).padStart(4)}x  ${country}`, 't-out');
      });
      break;
    }

    case 'test': {
      const ip = args[0] || '';
      const url = ip ? `/test_alert/${ip}` : '/test_alert';
      fetch(url).then(r=>r.json()).then(d => {
        termPrint(`Alerta disparado: ${d.payload?.ip} · ${d.payload?.type}`, 't-ok');
      }).catch(() => termPrint('Erro ao disparar alerta.', 't-err'));
      break;
    }

    case 'clear': termClear(); break;
    case 'exit':  termClose(); break;

    case 'dash':      showSection('dash');     termPrint('→ Dashboard', 't-nav');     break;
    case 'ataques':   showSection('ataques');  termPrint('→ Ataques', 't-nav');       break;
    case 'firewall':  showSection('firewall'); termPrint('→ Firewall', 't-nav');      break;
    case 'logs':      showSection('logs');     termPrint('→ Logs', 't-nav');          break;
    case 'rede':      showSection('net');      termPrint('→ Rede', 't-nav');          break;
    case 'config':    showSection('config');   termPrint('→ Configurações', 't-nav'); break;
    case 'sobre':     showSection('sobre');    termPrint('→ Sobre', 't-nav');         break;

    default:
      termPrint(`Comando não reconhecido: "${cmd}". Digite "help" para ajuda.`, 't-err');
  }
}

function termClear() {
  if (term.body) term.body.innerHTML = '';
  termPrint('Terminal limpo.', 't-sys');
}

/* Stream de logs em tempo real para o terminal */
function streamLogsToTerminal(lines) {
  if (!term.overlay?.classList.contains('open')) {
    term.lastCount = lines.length;
    return;
  }
  const newLines = lines.slice(term.lastCount);
  term.lastCount = lines.length;
  newLines.forEach(line => {
    if (!line.trim()) return;
    const { tagClass } = parseLogLine(line);
    const type = tagClass.includes('block') ? 't-block'
               : tagClass.includes('warn')  ? 't-warn'
               : tagClass.includes('alert') ? 't-alert'
               : 't-out';
    termPrint(line.slice(0, 120), type);
  });
}

/* Alerta novo → imprime no terminal */
function termLogAlert(payload) {
  const type  = attackTypeFromPayload(payload);
  const ip    = payload.ip || '—';
  const loc   = payload.location || payload.country || '';
  termPrint(`[BLOCK] ${type.padEnd(14)} ${ip}  ${loc}`, 't-block');
  /* Atualiza a linha do footer também */
  setText('terminal-line-1', `[BLOCK] ${type} · ${ip} bloqueado`);
}

/* ────────────────── INIT ────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindNavigation();

  atualizarRelogio();
  setInterval(atualizarRelogio, 1000);

  updateUptime();
  setInterval(updateUptime, 1000);

  initLeafletMap();
  ensureChart();
  initHackerBinary();
  initEcg();
  initTerminal();

  bindSocket();

  setTimeout(initNetPageCharts, 800);

  pollMetrics();
  setInterval(pollMetrics, POLL_INTERVAL);

  pollLogs();
  setInterval(pollLogs, LOG_INTERVAL);
});
