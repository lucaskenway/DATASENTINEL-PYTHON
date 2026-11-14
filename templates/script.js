/* DataSentinel v2.0 — Cyber Defense System */
'use strict';

/* ────────────────── CONSTANTS ────────────────── */
const CHART_POINTS    = 40;
const MAX_ATTACK_ROWS = 50;
const POLL_INTERVAL   = 2500;
const LOG_INTERVAL    = 5000;
const MARKER_LIFETIME_MS = 5 * 60 * 1000; /* tempo que o marcador de ataque fica no mapa */

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
  /* Central de inteligencia: so eventos recebidos de verdade nesta sessao */
  alertLog:      [],          /* [{ at: ms de recebimento, p: payload }], mais recente no fim */
  ipSeen:        new Map(),   /* ip -> { first: ms, last: ms } */
  sources:       new Map(),   /* fonte de deteccao -> { count, last } */
  ipLastAlert:   new Map(),   /* ip -> ultimo payload recebido (pagina Firewall) */
  system:        null,        /* ultima resposta de /api/system */
  atkFilter: 'all',
  logLevel: 'ALL', logQuery: '', logSig: '', logSelected: null,
  logSourcesOff: new Set(),
};
const ALERT_LOG_MAX = 500;

/* ────────────────── CHART INSTANCES ────────────────── */
let networkChart      = null;
let socDonutChart     = null;
let miniTrendChart    = null;
let atkPageDonut      = null;
let netPageChart      = null;
let connsPageChart    = null;

/* ────────────────── HOLOGRAPHIC GLOBE ────────────────── */
/* Globo ortografico em Canvas 2D (d3-geo + topojson-client).
   Cores lidas das variaveis CSS existentes — nenhuma cor nova no tema. */
const GLOBE_LAND_URL   = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';
const GLOBE_LAND_SRI   = 'sha384-5oFOGoMd0tkagYW08lVco4uAi7XDEDBwBxOdeKx+SA1ihbsHiR/aFAJGretluTzG';
const GLOBE_HOME       = [0, -20];   /* rotacao inicial (lon 0, lat 20), igual ao centro do antigo mapa */
const GLOBE_SPIN_DEG_S = 4;          /* rotacao automatica, graus por segundo */
const GLOBE_IDLE_MS    = 2500;       /* volta a girar sozinho depois da interacao */
const GLOBE_ZOOM_MIN   = 0.8;
const GLOBE_ZOOM_MAX   = 3;
const GLOBE_FOCUS_ZOOM = 1.6;
const GLOBE_ARC_MS     = 6000;
const ATTACK_LEAD_MS   = 1000;       /* mostra a origem antes do ataque sair */
const ATTACK_TRAVEL_MS = 2400;       /* tempo do ataque viajando ate o alvo */
const ATTACK_HOLD_MS   = 2600;       /* tempo parado no alvo mostrando o impacto */
const GLOBE_PULSE_MS   = 2200;

const globe = {
  canvas: null, ctx: null, tooltip: null,
  width: 0, height: 0, dpr: 1,
  front: null, back: null, path: null, backPath: null,
  sphere: { type: 'Sphere' }, graticule: null, land: null,
  rotation: [...GLOBE_HOME], zoom: 1,
  dragging: false, lastPointer: null, lastInteraction: 0,
  tween: null, focusTimer: null, followTimers: [],
  hold: false, highlight: null, selected: null,
  markers: [], arcs: [],
  colors: null, lastFrame: 0,
};
let mapLabelTimer = null;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function withAlpha(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function initGlobe() {
  const container = document.getElementById('threat-map');
  if (!container || !window.d3 || !d3.geoOrthographic) {
    console.error('Globe init: d3-geo indisponivel');
    return;
  }

  globe.colors = {
    neon: cssVar('--neon'), neon2: cssVar('--neon2'),
    cyan: cssVar('--cyan'), cyan2: cssVar('--cyan2'), warn2: cssVar('--warn2'),
  };

  globe.canvas  = document.createElement('canvas');
  globe.canvas.className = 'globe-canvas';
  globe.ctx     = globe.canvas.getContext('2d');
  globe.tooltip = document.createElement('div');
  globe.tooltip.className = 'globe-tooltip mono';
  container.append(globe.canvas, globe.tooltip);

  globe.front = d3.geoOrthographic().clipAngle(90).precision(0.6);
  /* Hemisferio de tras visto "atraves" do globo (efeito holografico) */
  globe.back  = d3.geoOrthographic().clipAngle(90).precision(0.6).reflectX(true);
  globe.graticule = d3.geoGraticule10();

  resizeGlobe();
  new ResizeObserver(resizeGlobe).observe(container);
  bindGlobeInteraction();

  fetch(GLOBE_LAND_URL, { integrity: GLOBE_LAND_SRI })
    .then(r => r.json())
    .then(topo => { globe.land = topojson.feature(topo, topo.objects.land); buildLandDots(); })
    .catch(e => console.warn('Globe land data:', e));

  requestAnimationFrame(globeFrame);
}

function resizeGlobe() {
  const box = globe.canvas.parentElement.getBoundingClientRect();
  if (!box.width || !box.height) return;
  globe.dpr    = window.devicePixelRatio || 1;
  globe.width  = box.width;
  globe.height = box.height;
  globe.canvas.width  = Math.round(box.width * globe.dpr);
  globe.canvas.height = Math.round(box.height * globe.dpr);
  globe.ctx.setTransform(globe.dpr, 0, 0, globe.dpr, 0, 0);
}

/* Raio sem zoom: os aneis do HUD ficam fixos na tela, como um instrumento */
function globeBaseRadius() {
  return Math.min(globe.width, globe.height) * 0.39;
}

function globeRadius() {
  return globeBaseRadius() * globe.zoom;
}

/* Continentes em matriz de pontos: rasteriza a terra numa projecao
   equiretangular fora da tela e amostra os pixels. Roda uma vez so. */
const LAND_DOT_STEP = 1.5;   /* graus entre pontos */
function buildLandDots() {
  if (!globe.land) return;
  const W = 720, H = 360;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d', { willReadFrequently: true });
  const proj = d3.geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
  octx.fillStyle = '#fff';
  octx.beginPath(); d3.geoPath(proj, octx)(globe.land); octx.fill();
  const px = octx.getImageData(0, 0, W, H).data;

  const dots = [];
  for (let lat = -84; lat <= 84; lat += LAND_DOT_STEP) {
    /* Espacamento uniforme na esfera: mais graus de longitude perto dos polos */
    const lonStep = LAND_DOT_STEP / Math.max(0.25, Math.cos(lat * Math.PI / 180));
    for (let lon = -180; lon < 180; lon += lonStep) {
      const [x, y] = proj([lon, lat]);
      const ix = Math.min(W - 1, Math.max(0, Math.round(x)));
      const iy = Math.min(H - 1, Math.max(0, Math.round(y)));
      if (px[(iy * W + ix) * 4 + 3] > 128) dots.push(lon, lat);
    }
  }
  /* Trigonometria pre-calculada: por frame so falta seno/cosseno da longitude */
  const n = dots.length / 2;
  const lam = new Float32Array(n), sinPhi = new Float32Array(n), cosPhi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lam[i] = dots[2 * i] * Math.PI / 180;
    const phi = dots[2 * i + 1] * Math.PI / 180;
    sinPhi[i] = Math.sin(phi); cosPhi[i] = Math.cos(phi);
  }
  globe.landDots = { n, lam, sinPhi, cosPhi };
}

function syncProjections() {
  const r = globeRadius();
  const [lambda, phi] = globe.rotation;
  const center = [globe.width / 2, globe.height / 2];
  globe.front.scale(r).translate(center).rotate([lambda, phi, 0]);
  globe.back.scale(r).translate(center).rotate([lambda + 180, -phi, 0]);
  globe.path     = d3.geoPath(globe.front, globe.ctx);
  globe.backPath = d3.geoPath(globe.back, globe.ctx);
}

/* true se [lon, lat] esta no hemisferio voltado para a tela */
function globeVisible(lon, lat) {
  return d3.geoDistance([lon, lat], [-globe.rotation[0], -globe.rotation[1]]) < Math.PI / 2;
}

function bindGlobeInteraction() {
  const c = globe.canvas;
  const touch = () => { globe.lastInteraction = performance.now(); };

  c.addEventListener('pointerdown', e => {
    globe.dragging = true;
    globe.tween = null;
    globe.lastPointer = [e.clientX, e.clientY];
    globe.downPointer = [e.clientX, e.clientY];
    c.setPointerCapture(e.pointerId);
    globe.tooltip.style.opacity = '0';
    touch();
  });
  c.addEventListener('pointermove', e => {
    if (globe.dragging) {
      const k = 0.25 / globe.zoom;
      globe.rotation[0] += (e.clientX - globe.lastPointer[0]) * k;
      globe.rotation[1] = Math.max(-90, Math.min(90, globe.rotation[1] - (e.clientY - globe.lastPointer[1]) * k));
      globe.lastPointer = [e.clientX, e.clientY];
      touch();
    } else {
      updateGlobeTooltip(e);
    }
  });
  const release = () => { globe.dragging = false; touch(); };
  c.addEventListener('pointerup', e => {
    /* Clique (sem arrastar) em cima de um marcador abre os detalhes da origem */
    const [dx, dy] = globe.downPointer || [e.clientX, e.clientY];
    if (Math.hypot(e.clientX - dx, e.clientY - dy) < 5) {
      const hit = findGlobeMarkerAt(e, 14);
      if (hit && hit.m.alert) showAttackerCard(hit.m.alert);
    }
    release();
  });
  c.addEventListener('pointercancel', release);
  c.addEventListener('pointerleave', () => { globe.tooltip.style.opacity = '0'; });

  c.addEventListener('wheel', e => {
    e.preventDefault();
    globe.tween = null;
    globe.zoom = Math.max(GLOBE_ZOOM_MIN, Math.min(GLOBE_ZOOM_MAX, globe.zoom * Math.exp(-e.deltaY * 0.0012)));
    touch();
  }, { passive: false });

  c.addEventListener('dblclick', () => {
    animateGlobeTo([globe.rotation[0], GLOBE_HOME[1]], 1, 900);
    touch();
  });

  document.getElementById('ac-close')?.addEventListener('click', hideAttackerCard);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideAttackerCard(); });
}

function findGlobeMarkerAt(e, radius = 9) {
  const rect = globe.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let hit = null, best = radius;
  for (const m of globe.markers) {
    if (!m.ip || !globeVisible(m.lon, m.lat)) continue;
    const [x, y] = globe.front([m.lon, m.lat]);
    const d = Math.hypot(x - mx, y - my);
    if (d < best) { best = d; hit = { m, x, y }; }
  }
  return hit;
}

function updateGlobeTooltip(e) {
  const hit = findGlobeMarkerAt(e);
  globe.canvas.style.cursor = hit && hit.m.alert ? 'pointer' : '';
  if (!hit) { globe.tooltip.style.opacity = '0'; return; }
  const place = hit.m.alert ? placeName(hit.m.alert) : hit.m.location;
  globe.tooltip.textContent = `${hit.m.ip}${place ? ` · ${place}` : ''}`;
  globe.tooltip.style.left = `${hit.x}px`;
  globe.tooltip.style.top  = `${hit.y}px`;
  globe.tooltip.style.opacity = '1';
}

function addGlobeMarker(lat, lon, meta) {
  if (!globe.canvas) return;
  /* Ciano = evento real; amarelo = evento de teste (simulado), nunca confundidos */
  const c = globe.colors;
  const color = meta.alert && isSimulatedEvent(meta.alert) ? c.warn2 : c.cyan;
  const now = performance.now();
  globe.markers.push({ lat, lon, color, ip: meta.ip, location: meta.location, alert: meta.alert, born: now, expires: now + MARKER_LIFETIME_MS });
}

/* "Cidade, Regiao, Pais" com o que o alerta tiver */
function placeName(p) {
  const parts = [p.city, p.region, p.country].filter(Boolean);
  const unique = parts.filter((v, i) => parts.indexOf(v) === i);
  return unique.length ? unique.join(', ') : (p.location || 'Desconhecido');
}

/* Alvo do ataque: usa target_* do alerta; sem isso, cai no defensor padrao */
function attackTarget(p) {
  if (p.target_lat != null && p.target_lon != null) {
    return { lat: p.target_lat, lon: p.target_lon, ip: p.target_ip || '', name: p.target_city || p.target_location || '' };
  }
  return { lat: state.defender.lat, lon: state.defender.lon, ip: p.target_ip || '', name: '' };
}

function targetLabel(p) {
  const t = attackTarget(p);
  return [t.name, t.ip && `(${t.ip})`].filter(Boolean).join(' ');
}

/* Coordenadas do evento, ou null se faltarem / forem invalidas.
   Nunca inventa uma posicao: sem lat/lon validos, nao ha local no mapa. */
function eventCoords(p) {
  if (!p || p.lat == null || p.lon == null || p.lat === '' || p.lon === '') return null;
  const lat = Number(p.lat), lon = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/* Texto seguro para a interface: nada de "undefined", "null" ou "[object Object]" */
function displayText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return '';
}

/* Eventos de teste (POST /test_alert manda reason "test_endpoint" e mensagem
   "TESTE manual") nunca podem parecer ataques reais na interface. */
function isSimulatedEvent(p) {
  const msg = displayText(p.message);
  return /^(SIMULATED|TESTE)\b/i.test(msg)
    || p.reason === 'manual_test' || p.reason === 'test_endpoint' || p.type === 'test_event';
}

const UNAVAILABLE = 'Indisponível';

/* Cartao com a origem APROXIMADA do ataque (geolocalizacao por IP indica a
   cidade/provedor, nunca o endereco de quem esta atras do IP). */
function showAttackerCard(p) {
  const card = document.getElementById('attackerCard');
  if (!card || !p) return;
  globe.selected = p;
  const coords = eventCoords(p);

  const simulated = isSimulatedEvent(p);
  const ip = displayText(p.ip);
  document.getElementById('ac-city').textContent =
    displayText(p.city) || displayText(p.location) || 'Localização indisponível';
  document.getElementById('ac-kicker').textContent =
    simulated ? 'ORIGEM DO ATAQUE · SIMULADO' : 'ORIGEM DO ATAQUE';
  setText('ac-ip', ip || 'IP indisponível');

  const type = attackTypeFromPayload(p);
  const badges = document.getElementById('ac-badges');
  if (badges) {
    badges.replaceChildren();
    const chips = [
      [type, `chip-type ${badgeClass(type)}`],
      simulated ? ['SIMULADO', 'chip-sim'] : ['BLOQUEIO SOLICITADO', 'chip-fw'],
      [sourceLabel(p).short, 'chip-src'],
    ];
    for (const [text, cls] of chips) {
      const s = document.createElement('span');
      s.className = `ac-chip ${cls}`;
      s.textContent = text;
      badges.append(s);
    }
  }

  const when = Number.isFinite(Number(p.timestamp)) && p.timestamp != null
    ? new Date(Number(p.timestamp) * 1000).toLocaleString('pt-BR') : '';
  const place = [p.city, p.region, p.country].map(displayText).filter(Boolean);
  const seen = state.ipSeen.get(ip);
  const hhmm = ms => new Date(ms).toLocaleTimeString('pt-BR');
  /* [rotulo, valor, obrigatorio]: obrigatorios mostram "Indisponivel" quando faltam.
     Porta e severidade nao sao enviadas pelos monitores hoje: ficam
     "Indisponivel" em vez de um valor inventado. */
  const rows = [
    ['Local', place.filter((v, i) => place.indexOf(v) === i).join(', ') || displayText(p.location), true],
    ['Origem → Destino', `${displayText(p.city) || displayText(p.location) || ip || '?'} → ${targetLabel(p) || 'SENSOR'}`, true],
    ['Tipo', type, true],
    ['Portas', displayText(p.port ?? p.dest_port), true],
    ['Severidade', displayText(p.severity), true],
    ['Ocorrências', ip && state.ipHits.get(ip) ? `${state.ipHits.get(ip)} nesta sessão` : '', true],
    ['Primeira / Última', seen ? `${hhmm(seen.first)} / ${hhmm(seen.last)}` : '', true],
    ['Fonte', sourceLabel(p).long, true],
    ['Firewall', simulated ? 'Não aplicado (evento de teste)' : 'block_ip() acionado pelo monitor', true],
    ['Provedor', displayText(p.isp), false],
    ['Organização', displayText(p.org) !== displayText(p.isp) ? displayText(p.org) : '', false],
    ['Horário', when, true],
    ['Coordenadas', coords ? `${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)} (aprox.)` : '', true],
    ['Descrição', displayText(p.message), false],
  ];
  const dl = document.getElementById('ac-rows');
  dl.replaceChildren();
  for (const [k, v, required] of rows) {
    if (!v && !required) continue;
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v || UNAVAILABLE;
    if (!v) dd.classList.add('is-missing');
    dl.append(dt, dd);
  }

  /* Mapa menor e botao sempre refletem o evento selecionado */
  const frame = document.getElementById('ac-frame');
  const empty = document.getElementById('ac-map-empty');
  const btn = document.getElementById('ac-map');
  if (coords) {
    const d = 0.06;
    const bbox = [coords.lon - d, coords.lat - d, coords.lon + d, coords.lat + d].map(n => n.toFixed(4)).join(',');
    frame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${coords.lat},${coords.lon}`;
    frame.hidden = false;
    empty.hidden = true;
  } else {
    frame.src = 'about:blank';
    frame.hidden = true;
    empty.hidden = false;
  }
  btn.disabled = !coords;
  btn.title = coords ? 'Centraliza o globo nesta localização' : 'Este evento não tem coordenadas';
  btn.onclick = () => focusGlobeOnEvent(p);

  document.querySelectorAll('.attack-row.is-selected').forEach(r => r.classList.remove('is-selected'));
  document.querySelectorAll('.attack-row').forEach(r => { if (r._alert === p) r.classList.add('is-selected'); });

  const idle = document.getElementById('target-idle');
  if (idle) idle.hidden = true;
  card.hidden = false;
  /* Reinicia a animacao de "travar alvo" a cada nova selecao */
  card.classList.remove('is-locking');
  void card.offsetWidth;
  card.classList.add('is-locking');
  renderTargetHistory(ip);
  renderTimeline();
}

function hideAttackerCard() {
  const card = document.getElementById('attackerCard');
  if (!card) return;
  card.hidden = true;
  const idle = document.getElementById('target-idle');
  if (idle) idle.hidden = false;
  document.getElementById('ac-frame').src = 'about:blank';
  document.querySelectorAll('.attack-row.is-selected').forEach(r => r.classList.remove('is-selected'));
  globe.selected = null;
  renderTargetHistory(null);
  renderTimeline();
  /* Solta o globo preso na regiao e volta a girar */
  if (globe.hold) {
    globe.hold = false;
    globe.highlight = null;
    animateGlobeTo([globe.rotation[0], GLOBE_HOME[1]], 1, 1800);
  }
}

/* Botao "VER REGIAO NO MAPA": gira o globo existente ate o evento, sem sair
   da pagina. Fica preso na regiao enquanto o cartao estiver aberto. */
function focusGlobeOnEvent(p) {
  const coords = eventCoords(p);
  if (!coords) {
    showMapLabel('Coordenadas indisponíveis para este evento', 4000);
    return false;
  }
  if (!globe.canvas) return false;

  globe.followTimers.forEach(clearTimeout);
  globe.followTimers = [];
  if (globe.focusTimer) { clearTimeout(globe.focusTimer); globe.focusTimer = null; }
  globe.hold = true;

  /* Duracao proporcional ao giro: perto = rapido, outro lado do mundo = mais lento */
  const center = [-globe.rotation[0], -globe.rotation[1]];
  const dist = d3.geoDistance(center, [coords.lon, coords.lat]);
  animateGlobeTo([-coords.lon, -coords.lat], GLOBE_FOCUS_ZOOM, 700 + dist / Math.PI * 1100);

  /* Destaca o marcador do evento; se ja expirou, recoloca no lugar exato */
  let marker = globe.markers.find(m => m.alert === p)
    || globe.markers.find(m => m.ip === p.ip && m.lat === coords.lat && m.lon === coords.lon);
  if (!marker) {
    addGlobeMarker(coords.lat, coords.lon, { ip: p.ip, location: p.location, severity: 'high', alert: p });
    marker = globe.markers[globe.markers.length - 1];
  }
  globe.highlight = { marker, born: performance.now() };

  showMapLabel(`${placeName(p)} · ${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)}`, 6000);
  return true;
}

function addGlobeArc(fromLat, fromLon, toLat, toLon, severity, opts = {}) {
  if (!globe.canvas) return;
  const color = opts.simulated ? globe.colors.warn2 : globe.colors.neon;
  const now = performance.now();
  const delay  = opts.delay  ?? 0;
  const travel = opts.travel ?? 1000;
  const hold   = opts.hold   ?? GLOBE_ARC_MS - 1000;
  globe.arcs.push({
    from: [fromLon, fromLat], to: [toLon, toLat],
    interp: d3.geoInterpolate([fromLon, fromLat], [toLon, toLat]),
    dist: d3.geoDistance([fromLon, fromLat], [toLon, toLat]),
    fromName: opts.fromName || '', toName: opts.toName || '',
    color, born: now, start: now + delay, travel, life: delay + travel + hold,
  });
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* Mostra o ataque inteiro: foca na origem, a camera acompanha o ataque
   viajando ate o alvo, segura no impacto e depois volta a girar. */
function showAttackOnGlobe(payload) {
  if (!globe.canvas) return;
  const lat = payload.lat, lon = payload.lon;
  const target = attackTarget(payload);
  const sev = 'high';
  const fromName = `ORIGEM · ${payload.city || payload.location || payload.ip || ''}`;
  /* Sem alvo proprio o ataque vai ao sensor, que ja tem a sua etiqueta */
  const toLabel = [target.name, target.ip].filter(Boolean).join(' · ');
  const toName = toLabel ? `ALVO · ${toLabel}` : '';

  addGlobeMarker(lat, lon, { ip: payload.ip, location: payload.location, severity: sev, alert: payload });
  addGlobeArc(lat, lon, target.lat, target.lon, sev, {
    delay: ATTACK_LEAD_MS, travel: ATTACK_TRAVEL_MS, hold: ATTACK_HOLD_MS, fromName, toName,
    simulated: isSimulatedEvent(payload),
  });

  /* Com uma regiao fixada pelo usuario, o ataque e desenhado mas a camera fica onde esta */
  if (globe.hold) return;

  /* Ataques longos pedem menos zoom para caber origem e alvo na tela */
  const dist = d3.geoDistance([lon, lat], [target.lon, target.lat]);
  const zoom = Math.max(1, Math.min(GLOBE_FOCUS_ZOOM, GLOBE_FOCUS_ZOOM - dist * 0.25));

  globe.followTimers.forEach(clearTimeout);
  if (globe.focusTimer) clearTimeout(globe.focusTimer);
  animateGlobeTo([-lon, -lat], zoom, ATTACK_LEAD_MS);
  globe.followTimers = [
    setTimeout(() => animateGlobeTo([-target.lon, -target.lat], zoom, ATTACK_TRAVEL_MS), ATTACK_LEAD_MS),
  ];
  globe.focusTimer = setTimeout(() => {
    globe.focusTimer = null;
    animateGlobeTo([globe.rotation[0], GLOBE_HOME[1]], 1, 1800);
  }, ATTACK_LEAD_MS + ATTACK_TRAVEL_MS + ATTACK_HOLD_MS);
}

/* Interpola rotacao (caminho mais curto em longitude) e zoom */
function animateGlobeTo(rotation, zoom, ms) {
  const from = [...globe.rotation];
  let dLon = ((rotation[0] - from[0]) % 360 + 540) % 360 - 180;
  globe.tween = {
    from, fromZoom: globe.zoom,
    to: [from[0] + dLon, rotation[1]], toZoom: zoom,
    start: performance.now(), ms,
  };
}

function focusMapOn(lat, lon, holdMs = 4000) {
  if (!globe.canvas || globe.hold) return;
  globe.followTimers.forEach(clearTimeout);
  animateGlobeTo([-lon, -lat], GLOBE_FOCUS_ZOOM, 1200);
  if (globe.focusTimer) clearTimeout(globe.focusTimer);
  globe.focusTimer = setTimeout(() => {
    globe.focusTimer = null;
    animateGlobeTo([globe.rotation[0], GLOBE_HOME[1]], 1, 1800);
  }, holdMs);
}

function globeFrame(now) {
  requestAnimationFrame(globeFrame);
  const dt = globe.lastFrame ? Math.min(now - globe.lastFrame, 100) : 16;
  globe.lastFrame = now;
  /* Nao desenha com o dashboard oculto ou a aba em segundo plano */
  if (document.hidden || !globe.canvas.offsetParent) return;
  if (!globe.width) resizeGlobe();
  if (!globe.width) return;

  if (globe.tween) {
    const t = Math.min(1, (now - globe.tween.start) / globe.tween.ms);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const { from, to } = globe.tween;
    globe.rotation = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e];
    globe.zoom = globe.tween.fromZoom + (globe.tween.toZoom - globe.tween.fromZoom) * e;
    if (t >= 1) globe.tween = null;
  } else if (!globe.dragging && !globe.focusTimer && !globe.hold && now - globe.lastInteraction > GLOBE_IDLE_MS) {
    globe.rotation[0] += GLOBE_SPIN_DEG_S * dt / 1000;
  }

  globe.markers = globe.markers.filter(m => m.expires > now);
  globe.arcs    = globe.arcs.filter(a => now - a.born < a.life);

  syncProjections();
  drawGlobe(now);
}

function drawGlobe(now) {
  const { ctx, width: w, height: h, colors: c } = globe;
  const cx = w / 2, cy = h / 2, r = globeRadius();
  ctx.clearRect(0, 0, w, h);

  drawHudRings(now, cx, cy);

  /* Halo externo */
  const halo = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.22);
  halo.addColorStop(0, withAlpha(c.neon, 0.16));
  halo.addColorStop(1, withAlpha(c.neon, 0));
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.22, 0, Math.PI * 2); ctx.fill();

  /* Corpo da esfera: luz vinda de cima/esquerda, borda escura (profundidade) */
  const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
  body.addColorStop(0, withAlpha(c.cyan, 0.12));
  body.addColorStop(0.7, withAlpha(c.neon, 0.03));
  body.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = body;
  ctx.beginPath(); globe.path(globe.sphere); ctx.fill();

  /* Hemisferio de tras, translucido */
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = withAlpha(c.neon, 0.05);
  ctx.beginPath(); globe.backPath(globe.graticule); ctx.stroke();
  if (globe.land) {
    ctx.strokeStyle = withAlpha(c.neon, 0.08);
    ctx.beginPath(); globe.backPath(globe.land); ctx.stroke();
  }

  /* Grade de latitude/longitude */
  ctx.strokeStyle = withAlpha(c.neon, 0.13);
  ctx.lineWidth = 0.6;
  ctx.beginPath(); globe.path(globe.graticule); ctx.stroke();

  /* Continentes: preenchimento leve + matriz de pontos + litoral brilhante */
  if (globe.land) {
    /* Um so path para preenchimento e litoral: projetar a terra custa caro */
    ctx.fillStyle = withAlpha(c.neon, 0.06);
    ctx.beginPath(); globe.path(globe.land); ctx.fill();
    ctx.save();
    ctx.shadowColor = withAlpha(c.neon, 0.8);
    ctx.shadowBlur = 8;
    ctx.strokeStyle = withAlpha(c.neon2, 0.75);
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.restore();
    drawLandDots();
  }

  /* Radar + linhas de varredura + faixa de scan, recortados na esfera */
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  drawRadarSweep(now, cx, cy, r);
  ctx.fillStyle = withAlpha(c.neon, 0.03);
  for (let y = cy - r; y < cy + r; y += 3) ctx.fillRect(cx - r, y, r * 2, 1);
  const bandY = cy - r + ((now / 4000) % 1) * r * 2;
  const band = ctx.createLinearGradient(0, bandY - 24, 0, bandY + 24);
  band.addColorStop(0, withAlpha(c.neon, 0));
  band.addColorStop(0.5, withAlpha(c.neon, 0.08));
  band.addColorStop(1, withAlpha(c.neon, 0));
  ctx.fillStyle = band;
  ctx.fillRect(cx - r, bandY - 24, r * 2, 48);
  ctx.restore();

  /* Borda (efeito fresnel) */
  const rim = ctx.createRadialGradient(cx, cy, r * 0.78, cx, cy, r);
  rim.addColorStop(0, withAlpha(c.cyan, 0));
  rim.addColorStop(1, withAlpha(c.cyan, 0.18));
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = withAlpha(c.neon, 0.5);
  ctx.lineWidth = 1.2;
  ctx.stroke();

  drawGlobeRoutes(now, cx, cy, r);
  drawGlobeArcs(now, cx, cy, r);
  drawGlobeMarkers(now);
  drawSensor(now);
  drawGlobeCallouts();
}

/* Aneis de instrumento ao redor do globo: fixos na tela (nao seguem o zoom) */
function drawHudRings(now, cx, cy) {
  const { ctx, colors: c } = globe;
  const R = globeBaseRadius();
  const TAU = Math.PI * 2;
  ctx.save();

  ctx.lineWidth = 1;
  ctx.strokeStyle = withAlpha(c.neon, 0.2);
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, 0, TAU); ctx.stroke();

  /* Escala de graus: traco longo a cada 30, medio a cada 15, curto a cada 3 */
  const tr = R * 1.1;
  ctx.beginPath();
  for (let i = 0; i < 120; i++) {
    const a = i / 120 * TAU;
    const len = i % 10 === 0 ? 10 : i % 5 === 0 ? 6 : 2.5;
    ctx.moveTo(cx + Math.cos(a) * tr, cy + Math.sin(a) * tr);
    ctx.lineTo(cx + Math.cos(a) * (tr + len), cy + Math.sin(a) * (tr + len));
  }
  ctx.strokeStyle = withAlpha(c.neon, 0.32);
  ctx.stroke();

  /* Segmentos girando em sentidos opostos */
  const rot = now / 9000 * TAU;
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = withAlpha(c.cyan, 0.5);
  for (let k = 0; k < 4; k++) {
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.17, rot + k * Math.PI / 2, rot + k * Math.PI / 2 + 0.5); ctx.stroke();
  }
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 7]);
  ctx.strokeStyle = withAlpha(c.neon, 0.28);
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.21, -rot * 0.6, -rot * 0.6 + TAU * 0.78); ctx.stroke();
  ctx.setLineDash([]);

  /* Mira: tracos nos quatro pontos cardeais */
  ctx.strokeStyle = withAlpha(c.cyan, 0.3);
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(cx + dx * R * 1.23, cy + dy * R * 1.23);
    ctx.lineTo(cx + dx * R * 1.29, cy + dy * R * 1.29);
  }
  ctx.stroke();
  ctx.restore();
}

/* Varredura de radar: feixe girando com rastro (conic gradient) */
function drawRadarSweep(now, cx, cy, r) {
  const { ctx, colors: c } = globe;
  if (!ctx.createConicGradient) return;   /* navegador antigo: sem o feixe */
  const a = (now / 5200) % 1 * Math.PI * 2;
  const g = ctx.createConicGradient(a, cx, cy);
  g.addColorStop(0, withAlpha(c.neon, 0));
  g.addColorStop(0.86, withAlpha(c.neon, 0));
  g.addColorStop(0.985, withAlpha(c.neon, 0.13));
  g.addColorStop(1, withAlpha(c.neon, 0.22));
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.strokeStyle = withAlpha(c.neon, 0.4);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
}

/* Pontos dos continentes, mais fortes no centro do disco (profundidade) */
/* Projecao ortografica direta (mesma de d3.geoOrthographic com rotate
   [lambda, phi]): x = R cos(lat) sin(dLon); y = R (cos(lat0) sin(lat) - sin(lat0) cos(lat) cos(dLon)) */
function drawLandDots() {
  const dots = globe.landDots;
  if (!dots) return;
  const { ctx, colors: c } = globe;
  const R = globeRadius(), cx = globe.width / 2, cy = globe.height / 2;
  const lam0 = -globe.rotation[0] * Math.PI / 180, phi0 = -globe.rotation[1] * Math.PI / 180;
  const sin0 = Math.sin(phi0), cos0 = Math.cos(phi0);
  const size = Math.max(1.3, 1.5 * Math.sqrt(globe.zoom));
  const half = size / 2;
  const buckets = [[], [], []];
  const { n, lam, sinPhi, cosPhi } = dots;
  for (let i = 0; i < n; i++) {
    const dl = lam[i] - lam0;
    const cosDl = Math.cos(dl);
    /* cos da distancia angular ao centro do disco: <= 0 = lado de tras */
    const cosC = sin0 * sinPhi[i] + cos0 * cosPhi[i] * cosDl;
    if (cosC <= 0) continue;
    const x = cx + R * cosPhi[i] * Math.sin(dl);
    const y = cy - R * (cos0 * sinPhi[i] - sin0 * cosPhi[i] * cosDl);
    buckets[cosC > 0.73 ? 0 : cosC > 0.36 ? 1 : 2].push(x, y);
  }
  const alphas = [0.8, 0.5, 0.25];
  buckets.forEach((pts, b) => {
    ctx.fillStyle = withAlpha(c.neon, alphas[b]);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) ctx.rect(pts[i] - half, pts[i + 1] - half, size, size);
    ctx.fill();
  });
}

/* Pontos de um grande circulo elevado (origem -> alvo); null = escondido atras do globo */
function routePoints(interp, dist, cx, cy, r, upTo = 1, steps = 48) {
  const center = [-globe.rotation[0], -globe.rotation[1]];
  const lift = 0.05 + dist * 0.12;
  const pts = [];
  for (let i = 0; i <= Math.floor(steps * upTo); i++) {
    const t = i / steps;
    const p = interp(t);
    const k = 1 + lift * Math.sin(Math.PI * t);
    const [x, y] = globe.front(p);
    const px = cx + (x - cx) * k, py = cy + (y - cy) * k;
    const visible = d3.geoDistance(p, center) < Math.PI / 2 || Math.hypot(px - cx, py - cy) > r;
    pts.push(visible ? [px, py] : null);
  }
  return pts;
}

function strokeRoute(pts) {
  const { ctx } = globe;
  ctx.beginPath();
  let pen = false;
  for (const q of pts) {
    if (q) { pen ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); pen = true; }
    else pen = false;
  }
  ctx.stroke();
}

/* Rotas de rastreamento persistentes: cada origem ativa ligada ao seu alvo
   enquanto o marcador existir. A rota do alvo selecionado fica solida. */
const GLOBE_MAX_ROUTES = 40;
function drawGlobeRoutes(now, cx, cy, r) {
  const { ctx, colors: c } = globe;
  const byAlert = new Map();
  for (const m of globe.markers) if (m.alert && eventCoords(m.alert)) byAlert.set(m.alert, m);
  const live = [...byAlert.values()].slice(-GLOBE_MAX_ROUTES);
  globe.routeCount = live.length;
  ctx.save();
  for (const m of live) {
    if (!m.route) {
      const t = attackTarget(m.alert);
      const from = [m.lon, m.lat], to = [t.lon, t.lat];
      m.route = { interp: d3.geoInterpolate(from, to), dist: d3.geoDistance(from, to) };
    }
    if (m.route.dist < 1e-4) continue;   /* origem no proprio sensor: sem rota */
    const pts = routePoints(m.route.interp, m.route.dist, cx, cy, r);
    const selected = globe.selected === m.alert;
    if (selected) {
      ctx.setLineDash([]);
      ctx.shadowColor = c.neon;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = withAlpha(c.neon, 0.95);
      ctx.lineWidth = 1.8;
    } else {
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -now / 45;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = withAlpha(m.color, 0.45);
      ctx.lineWidth = 1;
    }
    strokeRoute(pts);
  }
  ctx.restore();
}

/* Sensor (defensor): onde os ataques chegam. Coordenadas de /api/metrics. */
function drawSensor(now) {
  const d = state.defender;
  if (!d || !globeVisible(d.lon, d.lat)) return;
  const { ctx, colors: c } = globe;
  const [x, y] = globe.front([d.lon, d.lat]);
  ctx.save();
  ctx.strokeStyle = c.neon;
  for (let k = 0; k < 3; k++) {
    const phase = ((now / 2600) + k / 3) % 1;
    ctx.globalAlpha = 0.55 * (1 - phase);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, 8 + phase * 36, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = c.neon;
  ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.arc(x, y, 14, now / 900, now / 900 + Math.PI * 1.5); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = c.neon;
  ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  drawGlobeLabel(x + 6, y + 10, 'SENSOR // DEFENSOR', c.neon, 0.95, true);
}

/* Etiquetas de rastreamento (IP + tipo) com linha guia, como num painel de
   inteligencia. Ate 7 alvos, o selecionado primeiro; sem sobreposicao. */
const GLOBE_MAX_CALLOUTS = 7;
function drawGlobeCallouts() {
  const { ctx, colors: c } = globe;
  const cx = globe.width / 2;
  const list = globe.markers.filter(m => m.alert && globeVisible(m.lon, m.lat)).reverse();
  const sel = list.findIndex(m => m.alert === globe.selected);
  if (sel > 0) list.unshift(...list.splice(sel, 1));
  const placed = [];
  const seenIps = new Set();
  ctx.save();
  for (const m of list) {
    if (placed.length >= GLOBE_MAX_CALLOUTS) break;
    if (seenIps.has(m.ip)) continue;
    const [x, y] = globe.front([m.lon, m.lat]);
    const ipText = m.ip || '';
    const sub = `${attackTypeFromPayload(m.alert)}${isSimulatedEvent(m.alert) ? ' · SIMULADO' : ''}`;
    ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
    const wIp = ctx.measureText(ipText).width;
    ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
    const wSub = ctx.measureText(sub).width;
    const tw = Math.max(wIp, wSub) + 6;
    const dir = x > cx ? 1 : -1;
    let box = null;
    for (const dy of [-30, 30, -56, 56]) {
      const lx = dir > 0 ? x + 22 : x - 22 - tw;
      const cand = { x: lx, y: y + dy - 12, w: tw, h: 28 };
      const off = cand.x < 4 || cand.x + cand.w > globe.width - 4 || cand.y < 4 || cand.y + cand.h > globe.height - 4;
      if (!off && !placed.some(b => !(cand.x > b.x + b.w || cand.x + cand.w < b.x || cand.y > b.y + b.h || cand.y + cand.h < b.y))) {
        box = cand; break;
      }
    }
    if (!box) continue;
    placed.push(box);
    seenIps.add(m.ip);
    const selected = m.alert === globe.selected;
    const col = selected ? c.neon : m.color;
    const lineY = box.y + 15;
    const elbowX = dir > 0 ? box.x : box.x + box.w;
    ctx.globalAlpha = selected ? 1 : 0.85;
    ctx.strokeStyle = withAlpha(col, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(elbowX, lineY);
    ctx.lineTo(dir > 0 ? box.x + box.w : box.x, lineY);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.strokeText(ipText, box.x + 3, lineY - 3);
    ctx.fillStyle = col;
    ctx.fillText(ipText, box.x + 3, lineY - 3);
    ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.strokeText(sub, box.x + 3, lineY + 3);
    ctx.fillStyle = withAlpha(col, 0.75);
    ctx.fillText(sub, box.x + 3, lineY + 3);
  }
  ctx.restore();
}

/* Nome da cidade escrito ao lado do ponto, com contorno escuro para ler */
function drawGlobeLabel(x, y, text, color, alpha, below = false) {
  if (!text) return;
  const { ctx } = globe;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  /* Origem acima do ponto, alvo abaixo: nao se sobrepoem quando sao vizinhos.
     Perto da borda direita o texto vai para a esquerda do ponto. */
  const w = ctx.measureText(text).width;
  const tx = x + 10 + w > globe.width - 6 ? Math.max(6, x - 10 - w) : x + 10;
  const ty = below ? y + 12 : y - 10;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, tx, ty);
  ctx.fillStyle = color;
  ctx.fillText(text, tx, ty);
  ctx.restore();
}

/* Arcos elevados de grande circulo, origem -> alvo */
function drawGlobeArcs(now, cx, cy, r) {
  const { ctx } = globe;
  const center = [-globe.rotation[0], -globe.rotation[1]];
  const targetColor = globe.colors.cyan || '#66d9ff';
  for (const a of globe.arcs) {
    const age = now - a.start;
    const grow = easeInOutCubic(Math.max(0, Math.min(1, age / a.travel)));
    /* Some aos poucos no ultimo segundo de vida */
    const alpha = 0.95 * Math.max(0, Math.min(1, (a.life - (now - a.born)) / 1000));
    const lift = 0.05 + a.dist * 0.12;
    const steps = 64;

    /* Origem: nome da cidade */
    if (globeVisible(a.from[0], a.from[1])) {
      const [ox, oy] = globe.front(a.from);
      drawGlobeLabel(ox, oy, a.fromName, a.color, alpha);
    }

    /* Alvo: mira girando + nome, desde o inicio, para ver para onde vai */
    if (globeVisible(a.to[0], a.to[1])) {
      const [tx, ty] = globe.front(a.to);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = targetColor;
      ctx.lineWidth = 1.4;
      ctx.translate(tx, ty);
      ctx.rotate(now / 600);
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (const s of [[0, -12, 0, -5], [0, 5, 0, 12], [-12, 0, -5, 0], [5, 0, 12, 0]]) {
        ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]);
      }
      ctx.stroke();
      ctx.restore();

      /* Impacto: ondas saindo do alvo quando o ataque chega */
      if (age >= a.travel) {
        const hit = age - a.travel;
        for (let k = 0; k < 3; k++) {
          const phase = ((hit + k * 300) % 900) / 900;
          ctx.globalAlpha = alpha * (1 - phase);
          ctx.strokeStyle = a.color;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(tx, ty, 6 + phase * 26, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = a.color;
        ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fill();
      }
      drawGlobeLabel(tx, ty, a.toName, targetColor, alpha, true);
    }

    if (age < 0) continue;

    /* Linha percorrida ate agora */
    const pts = [];
    for (let i = 0; i <= Math.floor(steps * grow); i++) {
      const t = i / steps;
      const p = a.interp(t);
      const k = 1 + lift * Math.sin(Math.PI * t);
      const [x, y] = globe.front(p);
      const px = cx + (x - cx) * k, py = cy + (y - cy) * k;
      /* Visivel se esta na frente ou "sobe" alem da silhueta */
      const visible = d3.geoDistance(p, center) < Math.PI / 2 || Math.hypot(px - cx, py - cy) > r;
      pts.push(visible ? [px, py] : null);
    }
    const strokePts = (list, width, a2) => {
      ctx.globalAlpha = a2;
      ctx.lineWidth = width;
      ctx.beginPath();
      let pen = false;
      for (const q of list) {
        if (q) { pen ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); pen = true; }
        else pen = false;
      }
      ctx.stroke();
    };
    ctx.strokeStyle = a.color;
    strokePts(pts, 1.4, alpha * 0.7);
    /* Rastro brilhante logo atras da cabeca */
    if (grow < 1) strokePts(pts.slice(-10), 3, alpha);

    const head = pts[pts.length - 1];
    if (head && grow < 1) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = a.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(head[0], head[1], 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

function drawGlobeMarkers(now) {
  const { ctx } = globe;
  for (const m of globe.markers) {
    if (!globeVisible(m.lon, m.lat)) continue;
    const [x, y] = globe.front([m.lon, m.lat]);
    const phase = ((now - m.born) % GLOBE_PULSE_MS) / GLOBE_PULSE_MS;
    ctx.strokeStyle = m.color;
    ctx.globalAlpha = 0.8 * (1 - phase);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 4 + phase * 14, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = m.color;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawGlobeHighlight(now);
}

/* Marcador escolhido em "VER REGIAO NO MAPA": pulso forte nos primeiros
   segundos e depois um anel fixo enquanto a regiao estiver selecionada. */
function drawGlobeHighlight(now) {
  const h = globe.highlight;
  if (!h || !globe.markers.includes(h.marker)) return;
  const m = h.marker;
  if (!globeVisible(m.lon, m.lat)) return;
  const { ctx } = globe;
  const [x, y] = globe.front([m.lon, m.lat]);
  const age = now - h.born;
  ctx.save();
  ctx.strokeStyle = m.color;
  ctx.shadowColor = m.color;
  ctx.shadowBlur = 10;
  if (age < 3600) {
    for (let k = 0; k < 2; k++) {
      const phase = ((age + k * 450) % 900) / 900;
      ctx.globalAlpha = (1 - phase) * (1 - age / 3600);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 6 + phase * 30, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, 9 + Math.sin(now / 300) * 1.5, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = m.color;
  ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* Selecionar um evento da tabela: abre o cartao e, havendo coordenadas,
   repete o ataque no globo. Sem coordenadas, mostra so o cartao. */
function selectAlert(payload) {
  if (eventCoords(payload)) { reshowAlertOnMap(payload); return; }
  showSection('dash');
  showAttackerCard(payload);
}

/* Redesenha no globo um alerta que ja tinha expirado (marcador removido apos MARKER_LIFETIME_MS) */
function reshowAlertOnMap(payload) {
  if (!eventCoords(payload)) return;

  showSection('dash');
  /* Nova selecao: solta a regiao fixada antes, para a camera seguir este ataque */
  globe.hold = false;
  globe.highlight = null;
  /* Cartao atualizado na hora: o botao nunca age sobre o evento anterior */
  showAttackerCard(payload);

  setTimeout(() => {
    if (globe.selected !== payload) return;   /* outro evento foi escolhido no meio */
    showAttackOnGlobe(payload);
    const type = attackTypeFromPayload(payload);
    const alvo = targetLabel(payload);
    showMapLabel(`${placeName(payload)}${alvo ? ' → ' + alvo : ''} · ${type}`, 5000);
  }, 120);
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
  if (name === 'dash' || name === 'ataques') placeGlobe(name);
  if (name === 'dash' && globe.canvas) {
    setTimeout(resizeGlobe, 50);
  }
  if (name === 'logs') refreshLogsPage();
  if (name === 'net') {
    setTimeout(() => {
      initNetPageCharts();
      if (netPageChart) netPageChart.update();
    }, 50);
  }
  renderCurrentPage();
}

function bindNavigation() {
  document.querySelectorAll('.menu li').forEach(li => {
    li.addEventListener('click', () => showSection(li.dataset.section));
    li.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showSection(li.dataset.section); }
    });
  });

  document.getElementById('btn-clear-alerts')?.addEventListener('click', () => {
    showSection('logs');
  });
  document.getElementById('btn-refresh-logs')?.addEventListener('click', fetchAndRenderFullLogs);

  document.getElementById('btnLogout')?.addEventListener('click', () => {
    const logoutForm = document.getElementById('logout-form');
    if (logoutForm) {
      logoutForm.submit();
    } else {
      fetch('/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken() } })
        .catch(() => {})
        .finally(() => { window.location.href = '/login'; });
    }
  });

  const logSearch = document.getElementById('log-search');
  logSearch?.addEventListener('input', () => filterFullLogs(logSearch.value));

  document.querySelector('.btn-save')?.addEventListener('click', () => {
    const btn = document.querySelector('.btn-save');
    btn.textContent = '✓ SALVO';
    setTimeout(() => { btn.textContent = '💾 SALVAR CONFIGURAÇÕES'; }, 2000);
  });
}

/* ────────────────── CLOCK ────────────────── */
function clockZone() {
  const off = -new Date().getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${abs % 60 ? ':' + String(abs % 60).padStart(2, '0') : ''}`;
}

function atualizarRelogio() {
  setText('clock-zone', clockZone());
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
  if (t.includes('anomal') || m.includes('anomalia')) return 'ANOMALIA (IF)';
  return 'OUTROS';
}

function badgeClass(type) {
  const map = {
    'BRUTE FORCE':   'badge-brute',
    'SQL INJECTION': 'badge-sql',
    'PORT SCAN':     'badge-portscan',
    'XSS ATTEMPT':   'badge-xss',
    'DDoS':          'badge-ddos',
    'ANOMALIA (IF)': 'badge-portscan',
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
    'ANOMALIA (IF)': '#66e8ff',
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
  const alvo = targetLabel(payload);
  const desc = alvo
    ? `${payload.city || payload.location || ip} → ${alvo}`
    : (payload.message ? payload.message.slice(0, 60) : `${type} de ${ip}`);
  const flag = flagEmoji(country);

  function makeRow() {
    const row = document.createElement('div');
    row.className = 'attack-row mono';
    row.innerHTML = `
      <span class="row-time">${time}</span>
      <span><span class="badge ${badgeClass(type)}">${type}</span></span>
      <span class="row-desc">${escHtml(desc)}</span>
      <span class="row-ip">${escHtml(ip)}</span>
      <span class="row-flag">${flag}</span>
    `;
    /* Descricao completa no tooltip (a coluna corta com reticencias) e
       linha inteira selecionavel por mouse ou teclado */
    const full = [desc, displayText(payload.message)].filter((v, i, a) => v && a.indexOf(v) === i).join('\n');
    row.title = `${full}\nClique para ver os detalhes`;
    row._alert = payload;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.addEventListener('click', () => selectAlert(payload));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAlert(payload); }
    });
    return row;
  }

  /* Dashboard feed */
  const feed = document.getElementById('alerts-feed');
  if (feed) {
    feed.querySelector('.empty-state')?.remove();
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
      ${flagSrc ? `<img class="ip-flag" src="${flagSrc}" alt="${escHtml(country)}" loading="lazy">` : `<span style="font-size:14px">🌐</span>`}
      <span class="ip-addr">${escHtml(ip)}</span>
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
  refreshAtkPageDonut(labels, data, colors);

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
    if (res.status === 401) { window.location.href = '/login'; return; }
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

    /* KPI counters. "Tentativas detectadas" conta alertas (handleNewAlert);
       conexoes TCP ativas vao so para o rodape. */
    const conns = d.connections_active ?? 0;
    setText('metric-connections', state.connectionsToday);
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
    setText('atk-ips',      state.ipHits.size);
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
    /* Na pagina Logs carrega o maximo que a API permite */
    const res = await fetch(`/api/logs?n=${state.currentSection === 'logs' ? 500 : 200}`);
    if (res.status === 401) { window.location.href = '/login'; return; }
    const d   = await res.json();
    const lines = d.lines || [];
    state.allLogLines = lines;
    renderRecentLogs(lines.slice(-20));
    renderFullLogs();
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
      <span class="log-desc">${escHtml(text)}</span>
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

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function csrfToken() {
  return document.querySelector('meta[name="csrf-token"]')?.content || '';
}

/* ────────────────── CENTRAL DE INTELIGENCIA ────────────────── */
/* Todos os paineis abaixo leem so state.alertLog (alertas recebidos via
   Socket.IO nesta sessao) e /api/metrics. Nada e inventado para preencher a
   tela: sem eventos, o painel diz que nao ha eventos. */

const INTEL_SOURCES = [
  { key: 'monitor', name: 'monitor.py',          desc: 'limiar de conexões' },
  { key: 'ai',      name: 'ai_detector.py',      desc: 'IsolationForest' },
  { key: 'auth',    name: 'auth_log_monitor.py', desc: 'SSH / fail2ban' },
  { key: 'ids',     name: 'ids_log_monitor.py',  desc: 'Suricata / Snort' },
  { key: 'test',    name: '/test_alert',         desc: 'eventos simulados' },
  { key: 'other',   name: 'sem fonte',           desc: 'reason não informado' },
];
const ACTIVITY_MINUTES = 15;
const TIMELINE_WINDOW_MS = 30 * 60 * 1000;

/* Fonte de deteccao a partir do campo reason que cada monitor envia */
function sourceLabel(p) {
  const r = displayText(p && p.reason);
  if (p && isSimulatedEvent(p)) return { key: 'test', short: 'TESTE', long: '/test_alert (simulado)' };
  if (/^ids_signature/i.test(r)) return { key: 'ids', short: 'IDS', long: `ids_log_monitor · assinatura ${r.split(':')[1] || '?'}` };
  if (/tentativas falhas|jail=/i.test(r)) return { key: 'auth', short: 'AUTH.LOG', long: `auth_log_monitor · ${r}` };
  if (r.includes('ai_anomaly')) {
    return { key: 'ai', short: 'IA (IF)', long: r.includes('threshold') ? 'monitor.py · limiar + IsolationForest' : 'monitor.py · IsolationForest' };
  }
  if (r.includes('threshold')) return { key: 'monitor', short: 'LIMIAR', long: 'monitor.py · limiar de conexões' };
  return { key: 'other', short: 'FONTE N/D', long: r };
}

function agoText(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.floor(s / 60)}min`;
  return `há ${Math.floor(s / 3600)}h`;
}

function hms(ms) {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

function renderIntelSources() {
  const el = document.getElementById('intel-sources');
  if (!el) return;
  const row = (name, desc, value, cls) => `
    <div class="src-row ${cls}">
      <span class="src-name">${escHtml(name)}<small>${escHtml(desc)}</small></span>
      <span class="src-val"><i class="src-dot" aria-hidden="true"></i>${escHtml(value)}</span>
    </div>`;
  const parts = [row('Flask-SocketIO', 'canal em tempo real',
    state.socketUp ? 'CONECTADO' : 'DESCONECTADO', state.socketUp ? 'is-on' : 'is-off')];
  for (const s of INTEL_SOURCES) {
    const st = state.sources.get(s.key);
    if (s.key === 'other' && !st) continue;
    parts.push(st
      ? row(s.name, s.desc, `${st.count} · ${agoText(st.last)}`, s.key === 'test' ? 'is-sim' : 'is-on')
      : row(s.name, s.desc, 'SEM EVENTOS', 'is-idle'));
  }
  parts.push('<p class="src-note">Contagem de alertas recebidos nesta sessão. O painel não consulta os processos.</p>');
  el.innerHTML = parts.join('');
}

function renderIntelActivity() {
  const now = Date.now();
  const buckets = new Array(ACTIVITY_MINUTES).fill(0);
  let lastMinute = 0;
  for (const { at } of state.alertLog) {
    const age = now - at;
    const idx = Math.floor(age / 60000);
    if (idx < ACTIVITY_MINUTES) buckets[ACTIVITY_MINUTES - 1 - idx]++;
    if (age < 60000) lastMinute++;
  }
  const total = buckets.reduce((a, b) => a + b, 0);
  setText('intel-activity-value', total);
  setText('hud-epm', lastMinute);
  const level = total === 0 ? 'SEM ATIVIDADE' : total < 5 ? 'BAIXA' : total < 20 ? 'MODERADA' : 'ELEVADA';
  const levelEl = document.getElementById('intel-activity-level');
  if (levelEl) { levelEl.textContent = level; levelEl.dataset.level = level; }

  const bars = document.getElementById('intel-activity-bars');
  if (!bars) return;
  if (bars.children.length !== ACTIVITY_MINUTES) {
    bars.replaceChildren(...buckets.map(() => document.createElement('i')));
  }
  const max = Math.max(1, ...buckets);
  buckets.forEach((n, i) => {
    const bar = bars.children[i];
    bar.style.height = `${n ? 12 + n / max * 88 : 4}%`;
    bar.classList.toggle('is-now', i === ACTIVITY_MINUTES - 1);
    bar.title = `${n} alerta(s) · ${ACTIVITY_MINUTES - 1 - i === 0 ? 'último minuto' : `há ${ACTIVITY_MINUTES - 1 - i} min`}`;
  });
}

function renderIntelVectors() {
  const el = document.getElementById('intel-vectors');
  if (!el) return;
  const entries = [...state.attackTypes.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (!total) { el.innerHTML = '<div class="empty-state">Nenhum vetor observado ainda.</div>'; return; }
  el.innerHTML = entries.slice(0, 5).map(([type, n]) => {
    const pct = Math.round(n / total * 100);
    return `<div class="vec-row">
      <div class="vec-head"><span>${escHtml(type)}</span><span>${pct}% · ${n}</span></div>
      <div class="vec-bar"><div style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function renderTargetHistory(ip) {
  const el = document.getElementById('ac-history');
  if (!el) return;
  if (!ip) { el.innerHTML = '<div class="empty-state">Selecione um alvo.</div>'; return; }
  const items = state.alertLog.filter(e => e.p.ip === ip).slice(-12).reverse();
  if (!items.length) { el.innerHTML = '<div class="empty-state">Sem eventos deste IP nesta sessão.</div>'; return; }
  el.innerHTML = items.map(({ at, p }) => `
    <div class="hist-row${p === globe.selected ? ' is-current' : ''}">
      <span class="hist-time">${hms(at)}</span>
      <span class="hist-src">${escHtml(sourceLabel(p).short)}</span>
      <span class="hist-text">${escHtml(attackTypeFromPayload(p))} · ${escHtml(placeName(p))}</span>
    </div>`).join('');
}

function renderTimeline() {
  const track = document.getElementById('intel-timeline');
  if (!track) return;
  const now = Date.now();
  const recent = state.alertLog.filter(e => now - e.at < TIMELINE_WINDOW_MS).slice(-200);
  track.replaceChildren();
  let sim = 0;
  for (const { at, p } of recent) {
    const simulated = isSimulatedEvent(p);
    if (simulated) sim++;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tl-mark${simulated ? ' is-sim' : ''}${p === globe.selected ? ' is-selected' : ''}`;
    b.style.left = `${(1 - (now - at) / TIMELINE_WINDOW_MS) * 100}%`;
    b.title = `${hms(at)} · ${attackTypeFromPayload(p)} · ${displayText(p.ip) || 'IP ?'}${simulated ? ' · SIMULADO' : ''}`;
    b.setAttribute('aria-label', b.title);
    b.addEventListener('click', () => selectAlert(p));
    track.append(b);
  }
  setText('tl-count', recent.length);
  setText('tl-sim', sim);
  setText('tl-blocks', state.alertLog.filter(e => now - e.at < 86400000 && !isSimulatedEvent(e.p)).length);
  updateSimBanner();
  const banner = document.getElementById('sim-banner');
  if (banner) banner.hidden = sim === 0;
}

function renderIntelPanels() {
  renderIntelSources();
  renderIntelActivity();
  renderIntelVectors();
  renderTimeline();
}

/* Leituras do palco central: posicao da camera, zoom, alvos e rotas */
function updateStageHud() {
  if (!globe.canvas || state.currentSection !== 'dash') return;
  const lat = -globe.rotation[1];
  const lon = ((-globe.rotation[0] + 540) % 360) - 180;
  const f = v => `${v < 0 ? '-' : '+'}${Math.abs(v).toFixed(2).padStart(6, '0')}`;
  setText('hud-center', `LAT ${f(lat)} // LON ${f(lon)}`);
  setText('hud-zoom', `ZOOM ${globe.zoom.toFixed(2)}x · ORTHO`);
  const targets = new Set(globe.markers.filter(m => m.ip).map(m => m.ip)).size;
  setText('hud-scan', `VARREDURA 360° · ${targets} ${targets === 1 ? 'ALVO' : 'ALVOS'}`);
  setText('hud-routes', `ROTAS ATIVAS ${String(globe.routeCount || 0).padStart(2, '0')}`);
}

/* ══════════════════════════════════════════════════════════════
   PÁGINAS · MÓDULOS 02–06 + SOBRE
   Fontes de dados (todas reais):
   - state.alertLog: alertas recebidos via Socket.IO nesta sessão
   - state.allLogLines: ataques.log via /api/logs
   - state.system: /api/system (rede, MongoDB, modelo de IA, config)
   O que não existe no sistema aparece como "não implementado" ou vazio.
   ══════════════════════════════════════════════════════════════ */

const SYSTEM_POLL_MS = 5000;
const KNOWN_PORTS = {
  20: 'FTP-DATA', 21: 'FTP', 22: 'SSH', 23: 'TELNET', 25: 'SMTP', 53: 'DNS', 80: 'HTTP',
  110: 'POP3', 123: 'NTP', 143: 'IMAP', 443: 'HTTPS', 445: 'SMB', 993: 'IMAPS', 995: 'POP3S',
  1433: 'MSSQL', 3306: 'MYSQL', 3389: 'RDP', 5000: 'FLASK', 5432: 'POSTGRES', 5900: 'VNC',
  6379: 'REDIS', 8080: 'HTTP-ALT', 8443: 'HTTPS-ALT', 27017: 'MONGODB',
};
const MODULES = [
  { key: 'monitor', name: 'monitor.py',          desc: 'coleta de conexões (psutil)' },
  { key: 'detector', name: 'detector.py',        desc: 'detecção baseada em regras' },
  { key: 'ai',      name: 'ai_detector.py',      desc: 'anomalias com IsolationForest' },
  { key: 'firewall', name: 'firewall.py',        desc: 'bloqueio via iptables / netsh' },
  { key: 'alerting', name: 'alerting.py',        desc: 'dedup, geolocalização, envio' },
  { key: 'auth',    name: 'auth_log_monitor.py', desc: 'leitura do auth.log / fail2ban' },
  { key: 'ids',     name: 'ids_log_monitor.py',  desc: 'leitura de alertas do IDS' },
  { key: 'mongo',   name: 'MongoDB',             desc: 'persistência dos alertas' },
];

function portLabel(port) { return KNOWN_PORTS[port] || null; }
function fmtAgo(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
function isLoopback(ip) { return !ip || ip.startsWith('127.') || ip === '::1' || ip === '0.0.0.0' || ip === '::'; }
/* Código ISO do país; sem código conhecido, o nome inteiro (nunca 2 letras inventadas) */
function countryCode(p) {
  return displayText(p.countryCode).toUpperCase() || (countryToISO(p.country) || '').toUpperCase() || displayText(p.country) || '—';
}
function sysColors() {
  return globe.colors || { neon: cssVar('--neon'), neon2: cssVar('--neon2'), cyan: cssVar('--cyan'), cyan2: cssVar('--cyan2'), warn2: cssVar('--warn2') };
}

/* Histograma de colunas: conta timestamps (ms) em `count` faixas de `span` ms até agora */
function renderBuckets(id, times, count, span, titleFn) {
  const el = document.getElementById(id);
  const now = Date.now();
  const buckets = new Array(count).fill(0);
  for (const t of times) {
    const idx = Math.floor((now - t) / span);
    if (idx >= 0 && idx < count) buckets[count - 1 - idx]++;
  }
  if (!el) return buckets;
  if (el.children.length !== count) el.replaceChildren(...buckets.map(() => document.createElement('i')));
  const max = Math.max(1, ...buckets);
  buckets.forEach((n, i) => {
    const bar = el.children[i];
    bar.style.height = `${n ? 12 + n / max * 88 : 3}%`;
    bar.classList.toggle('is-now', i === count - 1);
    bar.title = titleFn(n, count - 1 - i);
  });
  return buckets;
}

/* Barras horizontais: [rótulo, valor, destaque] */
function renderBarList(id, rows, emptyText, pct = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!rows.length) { el.innerHTML = `<div class="empty-state">${escHtml(emptyText)}</div>`; return; }
  const total = rows.reduce((a, r) => a + r[1], 0) || 1;
  const max = Math.max(...rows.map(r => r[1]));
  el.innerHTML = rows.map(([label, n, mark]) => `
    <div class="bar-row${mark ? ' is-sim' : ''}">
      <div class="bar-head"><span>${escHtml(label)}</span><b>${pct ? `${Math.round(n / total * 100)}%` : n}</b></div>
      <div class="vec-bar"><div style="width:${Math.round(n / max * 100)}%"></div></div>
    </div>`).join('');
}

/* ────────────────── ataques.log (parse com cache) ────────────────── */
const LOG_LEVELS = ['BLOCK', 'ALERT', 'WARN', 'INFO'];
const LOG_SOURCES = [
  { key: 'server', name: 'server.py',   desc: 'alertas recebidos (BLOCK)' },
  { key: 'logger', name: 'logger.py',   desc: 'monitores: monitor / auth / ids' },
  { key: 'test',   name: '/test_alert', desc: 'eventos de teste' },
  { key: 'other',  name: 'outros',      desc: 'linhas sem formato conhecido' },
];
let logCache = { src: null, rows: [] };

function logLineTime(line) {
  const m = line.match(/\[(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})\]/);
  if (!m) return null;
  const t = new Date(`${m[1]}T${m[2]}`).getTime();
  return Number.isFinite(t) ? t : null;
}
function isTestLogLine(line) { return /\|\s*TESTE\b|\bSIMULATED\b/i.test(line); }

function parsedLogs() {
  if (logCache.src === state.allLogLines) return logCache.rows;
  const rows = state.allLogLines.map((line, i) => {
    const { time, tag, tagClass } = parseLogLine(line);
    const test = isTestLogLine(line);
    const src = test ? 'test'
      : /^\[[^\]]+\]\s*BLOCK \|/.test(line) ? 'server'
      : /ATAQUE detectado|Forca Bruta|IDS:/i.test(line) ? 'logger' : 'other';
    const msg = line.replace(/^\[[^\]]+\]\s*/, '').replace(/^BLOCK \|\s*/, '');
    const ip = (line.match(/\bIP\s+([0-9a-fA-F:.]{3,})/) || line.match(/\bde\s+([0-9]{1,3}(?:\.[0-9]{1,3}){3})/) || [])[1] || '';
    const loc = (line.match(/Localiza[cç][aã]o:\s*([^|]+)/i) || [])[1]?.trim() || '';
    const kind = (line.match(/ATAQUE detectado \(([^)]+)\)/) || [])[1] || (test ? 'TESTE' : '');
    return { n: i + 1, line, t: logLineTime(line), time, tag, tagClass, src, test, msg, ip, loc, kind };
  });
  logCache = { src: state.allLogLines, rows };
  return rows;
}

/* ────────────────── /api/system ────────────────── */
async function pollSystem() {
  try {
    const res = await fetch('/api/system');
    if (res.status === 401) { window.location.href = '/login'; return; }
    const d = await res.json();
    /* Taxa por interface: diferença de bytes entre duas leituras */
    const prev = state.system;
    const dt = prev ? d.ts - prev.ts : 0;
    for (const nic of d.network.interfaces) {
      const old = prev && prev.network.interfaces.find(x => x.name === nic.name);
      if (old && dt > 0 && nic.bytes_recv != null && old.bytes_recv != null) {
        nic.in_mbps = Math.max(0, (nic.bytes_recv - old.bytes_recv) * 8 / dt / 1e6);
        nic.out_mbps = Math.max(0, (nic.bytes_sent - old.bytes_sent) * 8 / dt / 1e6);
      }
    }
    state.system = d;
    const m = d.mongodb;
    const mongoEl = document.getElementById('hud-mongo');
    if (mongoEl) {
      mongoEl.textContent = !m.configured ? 'DESATIVADO' : m.online ? 'ONLINE' : 'OFFLINE';
      mongoEl.className = `hud-v ${!m.configured ? 'muted' : m.online ? '' : 'danger'}`;
    }
    renderCurrentPage();
  } catch (e) { /* silencioso: tenta de novo no próximo ciclo */ }
}

function renderCurrentPage() {
  const s = state.currentSection;
  if (s === 'ataques') refreshAttacksPage();
  if (s === 'firewall') refreshFirewallPage();
  if (s === 'net') renderNetPage();
  if (s === 'config') renderConfigPage();
  if (s === 'sobre') renderAboutPage();
  updateSimBanner();
}

function updateSimBanner() {
  const any = state.alertLog.some(e => isSimulatedEvent(e.p));
  const el = document.getElementById('page-sim-banner');
  if (el) el.hidden = !any || state.currentSection === 'dash';
}

/* ════════════ MÓDULO 02 · ATAQUES ════════════ */
function refreshAttacksPage() {
  const now = Date.now();
  setText('atk-24h', state.alertLog.filter(e => now - e.at < 86400000).length);
  setText('atk-blocked', state.ipsBlocked.size);
  setText('atk-ips', state.ipHits.size);
  const origins = new Set(globe.markers.filter(m => m.ip).map(m => m.ip)).size;
  setText('atk-globe-caption', `VARREDURA GLOBAL · ${origins} ${origins === 1 ? 'ORIGEM ATIVA' : 'ORIGENS ATIVAS'}`);

  /* Tabela */
  const body = document.getElementById('atk-table');
  if (body) {
    const rows = state.alertLog.slice().reverse()
      .filter(e => state.atkFilter === 'all' || sourceLabel(e.p).key === state.atkFilter)
      .slice(0, 120);
    body.replaceChildren();
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" class="empty-state">${state.alertLog.length ? 'Nenhum ataque desta fonte.' : 'Aguardando ataques…'}</td></tr>`;
    }
    for (const { at, p } of rows) {
      const tr = document.createElement('tr');
      const sim = isSimulatedEvent(p);
      tr.className = `${p === globe.selected ? 'is-selected' : ''}${sim ? ' is-sim' : ''}`;
      tr.tabIndex = 0;
      tr.innerHTML = `
        <td>${hms(at)}</td>
        <td class="c-ip">${escHtml(displayText(p.ip) || '—')}</td>
        <td>${escHtml(countryCode(p))}</td>
        <td>${escHtml(attackTypeFromPayload(p))}</td>
        <td>${escHtml(displayText(p.port ?? p.dest_port) || '—')}</td>
        <td><span class="sev ${p.severity ? '' : 'sev-na'}">${escHtml(displayText(p.severity) || 'N/D')}</span></td>
        <td>${escHtml(sourceLabel(p).short)}</td>`;
      tr.title = sim ? 'Evento de teste (simulado)' : 'Clique para rastrear no globo';
      const pick = () => trackOnAttacksPage(p);
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') pick(); });
      body.append(tr);
    }
  }

  /* Mapa de calor e países: histórico real do ataques.log (sem linhas de teste) */
  const real = parsedLogs().filter(r => r.src === 'server' && r.t != null);
  renderHeatmap(real.map(r => r.t));
  const byCountry = new Map();
  for (const r of real) {
    const c = r.loc.split(' - ')[0].trim();
    if (c) byCountry.set(c, (byCountry.get(c) || 0) + 1);
  }
  renderBarList('atk-countries-list', [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, n]) => [c, n, false]), 'Sem bloqueios reais no ataques.log.', true);
}

/* Na própria página Ataques: mostra a rota no globo sem trocar de seção */
function trackOnAttacksPage(p) {
  globe.selected = p;
  globe.hold = false;
  globe.highlight = null;
  if (eventCoords(p)) showAttackOnGlobe(p);
  else showMapLabel('Evento sem coordenadas', 3000);
  refreshAttacksPage();
}

function renderHeatmap(times) {
  const el = document.getElementById('atk-heatmap');
  if (!el) return;
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const t of times) {
    const d = new Date(t);
    const day = Math.floor((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (day >= 0 && day < 7) grid[6 - day][d.getHours()]++;
  }
  const max = Math.max(1, ...grid.flat());
  const names = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  const rows = grid.map((row, i) => {
    const date = new Date(today.getTime() - (6 - i) * 86400000);
    const cells = row.map((n, h) => {
      const lvl = n ? Math.min(4, 1 + Math.floor(n / max * 3.999)) : 0;
      return `<i class="hm-${lvl}" title="${names[date.getDay()]} ${String(h).padStart(2, '0')}h · ${n} bloqueio(s)"></i>`;
    }).join('');
    return `<span class="hm-day">${names[date.getDay()]}</span>${cells}`;
  }).join('');
  const axis = [0, 3, 6, 9, 12, 15, 18, 21].map(h => `<span style="grid-column:${h + 2}">${String(h).padStart(2, '0')}</span>`).join('');
  el.innerHTML = `<div class="hm-grid">${rows}</div><div class="hm-axis">${axis}</div>
    ${times.length ? '' : '<p class="hm-empty">Sem bloqueios reais nos últimos 7 dias.</p>'}`;
}

/* ════════════ MÓDULO 03 · FIREWALL ════════════ */
function realBlocks() {
  /* Um item por IP realmente bloqueado, na ordem do primeiro bloqueio */
  return [...state.ipsBlocked].map(ip => ({
    ip, hits: state.ipHits.get(ip) || 0, seen: state.ipSeen.get(ip), last: state.ipLastAlert.get(ip),
  })).sort((a, b) => (a.seen?.first || 0) - (b.seen?.first || 0));
}

function fwCommand(ip) {
  const plat = state.system?.platform || '';
  if (plat.startsWith('win')) return `netsh advfirewall firewall add rule name="Block ${ip}" dir=in action=block remoteip=${ip}`;
  if (plat.startsWith('linux')) return `iptables -I INPUT -s ${ip} -j DROP`;
  return null;
}

function refreshFirewallPage() {
  const blocks = realBlocks();
  const plat = state.system?.platform || '';
  const chain = plat.startsWith('win') ? 'IN' : 'INPUT';
  const action = plat.startsWith('win') ? 'BLOCK' : 'DROP';
  setText('fw-blocked', blocks.length);
  setText('fw-rules-count', blocks.length);
  setText('fw-allowed', state.system ? state.system.network.connections_total : '—');

  const rules = document.getElementById('fw-rules');
  if (rules) {
    rules.innerHTML = blocks.length ? blocks.map((b, i) => `
      <tr${i === blocks.length - 1 ? ' class="is-selected"' : ''}>
        <td>${String(i + 1).padStart(2, '0')}</td><td>${chain}</td>
        <td><span class="act act-drop">${action}</span></td>
        <td class="c-ip">${escHtml(b.ip)}</td><td>*</td><td>${b.hits}</td>
      </tr>`).join('')
      : '<tr><td colspan="6" class="empty-state">Nenhuma regra criada nesta sessão.</td></tr>';
  }
  const ips = document.getElementById('fw-ips-table');
  if (ips) {
    ips.innerHTML = blocks.length ? blocks.slice().reverse().map(b => `
      <tr><td class="c-ip">${escHtml(b.ip)}</td><td>${escHtml(b.last ? countryCode(b.last) : '—')}</td>
      <td>${escHtml(b.last ? attackTypeFromPayload(b.last) : '—')}</td><td class="c-warn">PERMANENTE</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty-state">Nenhum IP bloqueado nesta sessão.</td></tr>';
  }

  const lastReal = [...state.alertLog].reverse().find(e => !isSimulatedEvent(e.p));
  const la = document.getElementById('fw-last-action');
  const sh = document.getElementById('fw-shell');
  if (lastReal && la && sh) {
    const p = lastReal.p, ip = displayText(p.ip);
    const idx = blocks.findIndex(b => b.ip === ip) + 1;
    const notify = `ataques.log${state.system?.config?.email ? ' · e-mail' : ''}`;
    la.innerHTML = `
      <div class="la-big">${action} ${escHtml(ip)}</div>
      <div class="stat-row"><span>REGRA</span><strong>#${String(idx).padStart(2, '0')} ${chain} · todas as portas</strong></div>
      <div class="stat-row"><span>GATILHO</span><strong>${escHtml(attackTypeFromPayload(p))}</strong></div>
      <div class="stat-row"><span>ORIGEM DO ALERTA</span><strong>${escHtml(sourceLabel(p).long || '—')}</strong></div>
      <div class="stat-row"><span>NOTIFICADO</span><strong>${escHtml(notify)}</strong></div>`;
    const cmd = fwCommand(ip);
    sh.innerHTML = cmd
      ? `<div><span class="sh-p">$</span> ${escHtml(cmd)}</div>
         <div class="sh-c">→ executado pelo monitor às ${hms(lastReal.at)}</div>
         <div class="sh-c">→ o resultado do comando não é enviado ao painel</div>`
      : '<div class="sh-c">Servidor sem backend de firewall suportado (só Windows e Linux).</div>';
  }

  const times = parsedLogs().filter(r => r.src === 'server' && r.t != null).map(r => r.t);
  renderBuckets('fw-hours', times, 24, 3600000, (n, ago) => `${n} bloqueio(s) · ${ago === 0 ? 'última hora' : `há ${ago}–${ago + 1} h`}`);
}

/* ════════════ MÓDULO 04 · LOGS ════════════ */
let logDonutChart = null;

function renderFullLogs() {
  const el = document.getElementById('logs-full-container');
  if (!el) return;
  const rows = parsedLogs();

  /* Fontes: liga/desliga por fonte (filtra o stream) */
  const srcEl = document.getElementById('log-sources');
  if (srcEl) {
    srcEl.innerHTML = LOG_SOURCES.map(s => {
      const n = rows.filter(r => r.src === s.key).length;
      const on = !state.logSourcesOff.has(s.key);
      return `<button type="button" class="opt opt-btn" data-src="${s.key}" aria-pressed="${on}">
        <span>${escHtml(s.name)}<small>${n} linhas · ${escHtml(s.desc)}</small></span>
        <i class="toggle${on ? ' is-on' : ''}"></i></button>`;
    }).join('');
  }

  /* Níveis + donut */
  const counts = Object.fromEntries(LOG_LEVELS.map(l => [l, 0]));
  for (const r of rows) counts[r.tag]++;
  setText('log-total', rows.length);
  const levelColors = { BLOCK: cssVar('--danger'), ALERT: cssVar('--cyan'), WARN: cssVar('--warn2'), INFO: cssVar('--neon') };
  const lv = document.getElementById('log-levels');
  if (lv) {
    lv.innerHTML = ['ALL', ...LOG_LEVELS].map(l => `
      <button type="button" class="level-row lvl-${l.toLowerCase()}${state.logLevel === l ? ' is-on' : ''}" data-level="${l}">
        <span><i class="lvl-dot" aria-hidden="true"></i>${l === 'ALL' ? 'TODOS' : l}</span><b>${l === 'ALL' ? rows.length : counts[l]}</b>
      </button>`).join('');
  }
  const dc = document.getElementById('log-donut');
  if (dc && window.Chart && dc.offsetParent) {
    const data = LOG_LEVELS.map(l => counts[l]);
    const colors = LOG_LEVELS.map(l => levelColors[l]);
    if (!logDonutChart) {
      logDonutChart = new Chart(dc, {
        type: 'doughnut',
        data: { labels: LOG_LEVELS, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
        options: { cutout: '78%', animation: { duration: 300 }, plugins: { legend: { display: false } } },
      });
    } else {
      logDonutChart.data.datasets[0].data = data;
      logDonutChart.update('none');
    }
  }

  /* Ritmo por hora */
  const buckets = renderBuckets('log-hours', rows.filter(r => r.t != null).map(r => r.t), 24, 3600000,
    (n, ago) => `${n} linha(s) · ${ago === 0 ? 'última hora' : `há ${ago}–${ago + 1} h`}`);
  const total24 = buckets.reduce((a, b) => a + b, 0);
  setText('log-avg', `${(total24 / 24).toFixed(1)} / h`);
  const peak = Math.max(...buckets);
  const peakAgo = 23 - buckets.indexOf(peak);
  setText('log-peak', peak ? `${peak} / h · ${peakAgo === 0 ? 'última hora' : `há ${peakAgo} h`}` : '—');
  setText('log-count', rows.length);

  /* Stream: só redesenha se algo mudou (preserva a rolagem) */
  const q = state.logQuery.toLowerCase();
  const sig = `${rows.length}|${state.allLogLines.at(-1) || ''}|${state.logLevel}|${q}|${[...state.logSourcesOff].join()}|${state.logSelected}`;
  if (sig === state.logSig && el.children.length) return;
  state.logSig = sig;
  const shown = filteredLogRows();
  setText('log-shown', shown.length);
  if (!shown.length) {
    el.innerHTML = `<div class="empty-state">${rows.length ? 'Nenhuma linha com esse filtro.' : 'Nenhum log encontrado.'}</div>`;
    return;
  }
  el.replaceChildren(...shown.slice().reverse().map(r => {
    const div = document.createElement('div');
    div.className = `stream-row lvl-${r.tag.toLowerCase()}${r.test ? ' is-test' : ''}${r.n === state.logSelected ? ' is-selected' : ''}`;
    div.dataset.n = r.n;
    div.innerHTML = `
      <span class="sr-ts">${escHtml(r.line.match(/\[([^\]]+)\]/)?.[1] || r.time)}</span>
      <span class="sr-lvl">${r.tag}</span>
      <span class="sr-src">${escHtml(LOG_SOURCES.find(s => s.key === r.src).name)}</span>
      <span class="sr-msg">${escHtml(r.msg)}</span>`;
    return div;
  }));
}

function filteredLogRows() {
  const q = state.logQuery.toLowerCase();
  return parsedLogs().filter(r =>
    (state.logLevel === 'ALL' || r.tag === state.logLevel)
    && !state.logSourcesOff.has(r.src)
    && (!q || r.line.toLowerCase().includes(q)));
}

function showLogDetail(n) {
  const r = parsedLogs().find(x => x.n === n);
  const el = document.getElementById('log-detail');
  if (!r || !el) return;
  state.logSelected = n;
  document.querySelectorAll('.stream-row.is-selected').forEach(x => x.classList.remove('is-selected'));
  document.querySelector(`.stream-row[data-n="${n}"]`)?.classList.add('is-selected');
  const rowsHtml = [
    ['TIMESTAMP', r.line.match(/\[([^\]]+)\]/)?.[1] || '—'],
    ['FONTE', LOG_SOURCES.find(s => s.key === r.src).name],
    ['NÍVEL', r.tag],
    ['IP', r.ip || '—'],
    ['TIPO', r.kind || '—'],
    ['LOCAL', r.loc || '—'],
    ['LINHA', `#${r.n} de ${state.allLogLines.length} carregadas`],
  ].map(([k, v]) => `<div class="stat-row"><span>${k}</span><strong>${escHtml(v)}</strong></div>`).join('');
  el.innerHTML = `${rowsHtml}<pre class="raw-line">${escHtml(r.line)}</pre>`;
}

function exportLogs(fmt) {
  const rows = filteredLogRows();
  const pick = r => ({ linha: r.n, timestamp: r.line.match(/\[([^\]]+)\]/)?.[1] || '', nivel: r.tag,
    fonte: LOG_SOURCES.find(s => s.key === r.src).name, texto: r.line });
  let data, type;
  if (fmt === 'json') { data = JSON.stringify(rows.map(pick), null, 2); type = 'application/json'; }
  else if (fmt === 'csv') {
    const esc = v => `"${String(v).replace(/"/g, '""')}"`;
    data = ['linha,timestamp,nivel,fonte,texto', ...rows.map(r => Object.values(pick(r)).map(esc).join(','))].join('\n');
    type = 'text/csv';
  } else { data = rows.map(r => r.line).join('\n'); type = 'text/plain'; }
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `ataques-log.${fmt}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filterFullLogs(query) { state.logQuery = query || ''; renderFullLogs(); }
function fetchAndRenderFullLogs() {
  fetch('/api/logs?n=500').then(r => r.json()).then(d => {
    state.allLogLines = d.lines || [];
    renderFullLogs();
  }).catch(() => {});
}
function refreshLogsPage() { fetchAndRenderFullLogs(); }

/* ════════════ MÓDULO 05 · REDE ════════════ */
function renderNetPage() {
  const sys = state.system;
  if (!sys) return;
  const net = sys.network;

  const ifEl = document.getElementById('net-ifaces');
  if (ifEl) {
    const list = net.interfaces.slice().sort((a, b) => (b.up - a.up) || a.name.localeCompare(b.name)).slice(0, 8);
    const rate = n => n.in_mbps == null ? '—' : `${n.in_mbps.toFixed(1)} / ${n.out_mbps.toFixed(1)} Mbps`;
    ifEl.innerHTML = list.map(n => `<tr><td>${escHtml(n.name)}</td><td>${escHtml(n.ip || '—')}</td>
      <td><span class="act ${n.up ? 'act-up' : 'act-down'}">${n.up ? 'UP' : 'DOWN'}</span></td><td>${rate(n)}</td></tr>`).join('')
      || '<tr><td colspan="4" class="empty-state">Nenhuma interface.</td></tr>';
  }

  /* Protocolos: porta conhecida da conexão (remota, senão local) */
  const byProto = new Map();
  for (const c of net.connections) {
    const name = portLabel(c.raddr?.port) || portLabel(c.laddr?.port) || 'OUTROS';
    const key = name === 'OUTROS' ? name : `${name} ${KNOWN_PORTS[c.raddr?.port] ? c.raddr.port : c.laddr.port}`;
    byProto.set(key, (byProto.get(key) || 0) + 1);
  }
  const protos = [...byProto.entries()].sort((a, b) => (a[0] === 'OUTROS') - (b[0] === 'OUTROS') || b[1] - a[1]).slice(0, 5);
  renderBarList('net-protocols', protos.map(([k, n]) => [k, n, false]), 'Nenhuma conexão ativa.', true);

  const blocked = state.ipsBlocked;
  const cEl = document.getElementById('net-conns');
  if (cEl) {
    const fmt = a => a ? `${a.ip.includes(':') ? `[${a.ip}]` : a.ip}:${a.port}` : '—';
    /* Conexões externas primeiro; loopback (o próprio painel) por último */
    const ordered = net.connections.slice().sort((a, b) => isLoopback(a.raddr?.ip) - isLoopback(b.raddr?.ip));
    cEl.innerHTML = ordered.slice(0, 40).map(c => {
      const isBlocked = c.raddr && blocked.has(c.raddr.ip);
      const st = c.status === 'ESTABLISHED' ? 'ESTAB' : c.status.replace('_', ' ');
      return `<tr${isBlocked ? ' class="is-selected"' : ''}><td>${escHtml(fmt(c.laddr))}</td><td>${escHtml(fmt(c.raddr))}</td>
        <td><span class="act ${isBlocked ? 'act-drop' : c.status === 'ESTABLISHED' ? 'act-up' : 'act-down'}">${escHtml(isBlocked ? 'BLOQUEADO' : st)}</span></td></tr>`;
    }).join('') || '<tr><td colspan="3" class="empty-state">Nenhuma conexão ativa.</td></tr>';
  }
  setText('net-conn-total', net.connections_total);

  const ports = uniquePorts(net.listening);
  const pEl = document.getElementById('net-ports');
  if (pEl) {
    pEl.innerHTML = ports.slice(0, 8).map(p => {
      const local = p.ips.every(isLoopbackBind);
      return `<div class="stat-row"><span>${p.port}/tcp ${escHtml((portLabel(p.port) || '').toLowerCase())}</span>
        <strong class="${local ? 'c-cyan' : 'c-warn'}">${local ? 'LOCAL' : 'ABERTA'}</strong></div>`;
    }).join('') || '<div class="empty-state">Nenhuma porta em escuta.</div>';
  }
  setText('net-services', ports.length);
  setText('net-alerts', state.alertLog.length);
}

function isLoopbackBind(ip) { return ip.startsWith('127.') || ip === '::1'; }
function uniquePorts(listening) {
  const map = new Map();
  for (const l of listening) {
    if (!map.has(l.port)) map.set(l.port, { port: l.port, ips: [] });
    map.get(l.port).ips.push(l.ip);
  }
  return [...map.values()].sort((a, b) => a.port - b.port);
}

/* ════════════ MÓDULO 06 · CONFIGURAÇÕES ════════════ */
function setToggle(id, on) { document.getElementById(id)?.classList.toggle('is-on', !!on); }

function renderConfigPage() {
  const sys = state.system;
  if (!sys) return;
  const cfg = sys.config, m = sys.mongodb, ai = sys.ai;
  setToggle('cfg-auth', cfg.auth_log || cfg.fail2ban_log);
  setToggle('cfg-eve', cfg.eve_log);
  setToggle('cfg-email', cfg.email);
  setToggle('cfg-ai', ai.trained);
  setText('cfg-ai-sub', ai.trained
    ? `treinado há ${fmtAgo(Date.now() / 1000 - ai.trained_at)} · ${ai.samples} amostras`
    : `sem modelo ainda · ${ai.samples} amostras`);
  setText('cfg-db-uri', m.configured ? `mongodb://••••@${m.host}` : 'não configurado');
  setText('cfg-db-status', !m.configured ? 'DESATIVADO' : m.online ? `ONLINE · ${m.docs} docs` : 'OFFLINE');
  setText('cfg-dedup', `${cfg.dedup_window_s} s`);
  const plat = sys.platform;
  setText('cfg-fw-backend', plat.startsWith('win') ? 'netsh advfirewall' : plat.startsWith('linux') ? 'iptables / ufw' : 'indisponível');
  setText('cfg-user', cfg.admin_user);
  setText('cfg-ratelimit', `${cfg.login_max_attempts} tentativas / ${cfg.login_window_s} s`);
}

/* Estado de cada módulo para o diagrama do Config e a lista do Sobre */
function moduleStatus(key) {
  const sys = state.system;
  const seen = k => state.sources.has(k);
  switch (key) {
    case 'monitor': case 'detector': return seen('monitor') || seen('ai') ? 'on' : 'idle';
    case 'ai': return sys?.ai?.trained ? 'on' : 'idle';
    case 'firewall': return state.ipsBlocked.size ? 'on' : 'idle';
    case 'alerting': return state.alertLog.some(e => !isSimulatedEvent(e.p)) ? 'on' : 'idle';
    case 'auth': return seen('auth') ? 'on' : sys?.config && !(sys.config.auth_log || sys.config.fail2ban_log) ? 'off' : 'idle';
    case 'ids': return seen('ids') ? 'on' : sys?.config && !sys.config.eve_log ? 'off' : 'idle';
    case 'mongo': return !sys ? 'idle' : !sys.mongodb.configured ? 'off' : sys.mongodb.online ? 'on' : 'warn';
    default: return 'idle';
  }
}
const MODULE_STATUS_TEXT = { on: 'ativo nesta sessão', idle: 'sem eventos', off: 'não configurado', warn: 'offline' };

/* ════════════ SOBRE ════════════ */
function renderAboutPage() {
  const sys = state.system;
  if (sys) {
    setText('about-uptime', fmtAgo(sys.server_uptime));
    setText('about-flask', 'ONLINE');
    setText('about-socket', `${sys.socket_clients} cliente(s)`);
    const m = sys.mongodb;
    setText('about-mongo', !m.configured ? 'DESATIVADO' : m.online ? `ONLINE · ${m.docs} docs` : 'OFFLINE');
    document.getElementById('about-mongo')?.classList.toggle('dot-off', !m.online);
    setText('about-ai', sys.ai.trained ? `treinado há ${fmtAgo(Date.now() / 1000 - sys.ai.trained_at)}` : 'não treinado');
    document.getElementById('about-ai')?.classList.toggle('dot-off', !sys.ai.trained);
  }
  const list = document.getElementById('about-modules');
  if (list) {
    list.innerHTML = MODULES.map(mod => {
      const st = moduleStatus(mod.key);
      return `<div class="mod-row st-${st}" title="${MODULE_STATUS_TEXT[st]}">
        <span>${escHtml(mod.name)}<small>${escHtml(mod.desc)}</small></span><i class="src-dot" aria-label="${MODULE_STATUS_TEXT[st]}"></i></div>`;
    }).join('');
  }
}

/* ════════════ PALCOS EM CANVAS (Firewall, Rede, Config) ════════════ */
const stages = {};
function stageFor(id) {
  if (stages[id]) return stages[id];
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  const st = { canvas, ctx: canvas.getContext('2d'), w: 0, h: 0, hits: [] };
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    st.w = r.width; st.h = r.height;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    st.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  new ResizeObserver(fit).observe(canvas);
  fit();
  stages[id] = st;
  return st;
}

let stageLast = 0;
function stagesFrame(now) {
  requestAnimationFrame(stagesFrame);
  if (document.hidden || now - stageLast < 33) return;   /* ~30 fps basta para os palcos */
  stageLast = now;
  const s = state.currentSection;
  if (s === 'firewall') drawFirewallStage(now);
  if (s === 'net') drawNetStage(now);
  if (s === 'config') drawConfigStage(now);
}

function hashAngle(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
}

function hexPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * Math.PI / 3;
    i ? ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)) : ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
}

function stageText(ctx, text, x, y, color, size = 11, align = 'center', weight = 600) {
  ctx.font = `${weight} ${size}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/* Firewall: anel de perímetro; vermelho = IP bloqueado (para no anel),
   ciano = conexão ativa permitida (atravessa até o sensor) */
function drawFirewallStage(now) {
  const st = stageFor('fw-canvas');
  if (!st || !st.w) return;
  const { ctx, w, h } = st;
  const c = sysColors(), red = cssVar('--danger');
  const cx = w / 2, cy = h / 2 - 10, R = Math.min(w, h * 0.92) * 0.34;
  ctx.clearRect(0, 0, w, h);

  ctx.lineWidth = 1;
  ctx.setLineDash([2, 6]);
  ctx.strokeStyle = withAlpha(c.cyan, 0.25);
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.45, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = withAlpha(c.cyan, 0.18);
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.25, 0, Math.PI * 2); ctx.stroke();

  /* Perímetro com brilho e segmentos girando */
  ctx.save();
  ctx.shadowColor = c.neon; ctx.shadowBlur = 18;
  ctx.strokeStyle = c.neon; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = withAlpha(c.neon, 0.5); ctx.lineWidth = 1.5;
  ctx.setLineDash([22, 14]); ctx.lineDashOffset = -now / 60;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.93, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([4, 6]); ctx.strokeStyle = withAlpha(c.cyan, 0.4); ctx.lineDashOffset = 0;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  /* Sensor */
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.45);
  glow.addColorStop(0, withAlpha(c.neon, 0.18)); glow.addColorStop(1, withAlpha(c.neon, 0));
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R * 0.45, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = withAlpha(c.neon, 0.35); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.34, 0, Math.PI * 2); ctx.stroke();
  hexPath(ctx, cx, cy, R * 0.26);
  ctx.fillStyle = withAlpha(c.neon, 0.08); ctx.fill();
  ctx.save(); ctx.shadowColor = c.neon; ctx.shadowBlur = 12;
  ctx.strokeStyle = c.neon; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  stageText(ctx, 'SENSOR', cx, cy - 6, c.neon, 14, 'center', 700);
  stageText(ctx, 'PROTEGIDO', cx, cy + 14, withAlpha(c.neon, 0.75), 9.5, 'center', 500);

  const plat = state.system?.platform || '';
  stageText(ctx, 'INTERNET', cx, cy - R * 1.45 - 14, withAlpha(c.cyan, 0.8), 10.5, 'center', 500);
  stageText(ctx, `PERÍMETRO // ${plat.startsWith('win') ? 'netsh' : 'iptables'}`, cx, cy - R - 16, withAlpha(c.neon, 0.85), 10.5, 'center', 500);
  stageText(ctx, 'REDE INTERNA', cx, cy - R * 0.62 - 12, withAlpha(c.cyan, 0.7), 10, 'center', 500);

  /* IPs bloqueados: ponto fora, linha até o anel, X no ponto de bloqueio */
  for (const b of realBlocks()) {
    const a = hashAngle(b.ip);
    const ox = cx + Math.cos(a) * R * 1.38, oy = cy + Math.sin(a) * R * 1.38;
    const ix = cx + Math.cos(a) * R, iy = cy + Math.sin(a) * R;
    ctx.strokeStyle = withAlpha(red, 0.6); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ix, iy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = red; ctx.beginPath(); ctx.arc(ox, oy, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = red; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(ix, iy, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ix - 3.5, iy - 3.5); ctx.lineTo(ix + 3.5, iy + 3.5); ctx.moveTo(ix + 3.5, iy - 3.5); ctx.lineTo(ix - 3.5, iy + 3.5); ctx.stroke();
    stageText(ctx, b.ip, ox + (Math.cos(a) >= 0 ? 8 : -8), oy - 10, withAlpha(red, 0.9), 9.5, Math.cos(a) >= 0 ? 'left' : 'right', 500);
  }

  /* Conexões permitidas (reais, de /api/system), atravessando o perímetro */
  const peers = [...new Set((state.system?.network.connections || [])
    .filter(x => x.raddr && !isLoopback(x.raddr.ip) && !state.ipsBlocked.has(x.raddr.ip)).map(x => x.raddr.ip))].slice(0, 18);
  peers.forEach((ip, i) => {
    const a = hashAngle(ip);
    const ox = cx + Math.cos(a) * R * 1.52, oy = cy + Math.sin(a) * R * 1.52;
    const ix = cx + Math.cos(a) * R * 0.62, iy = cy + Math.sin(a) * R * 0.62;
    ctx.strokeStyle = withAlpha(c.cyan, 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ix, iy); ctx.stroke();
    const t = ((now / 2600) + i / peers.length) % 1;
    ctx.fillStyle = c.cyan;
    ctx.beginPath(); ctx.arc(ox + (ix - ox) * t, oy + (iy - oy) * t, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ox, oy, 2.6, 0, Math.PI * 2); ctx.fill();
  });

  if (!state.ipsBlocked.size) {
    stageText(ctx, 'Nenhum IP bloqueado nesta sessão', cx, cy + R * 1.52 + 26, withAlpha(c.cyan, 0.6), 10, 'center', 400);
  }
}

/* Rede: internet (pares remotos reais) → firewall → sensor → serviços em escuta */
function drawNetStage(now) {
  const st = stageFor('net-canvas');
  if (!st || !st.w) return;
  const { ctx, w, h } = st;
  const c = sysColors(), red = cssVar('--danger'), warn = c.warn2;
  ctx.clearRect(0, 0, w, h);
  st.hits = [];
  const sys = state.system;
  if (!sys) { stageText(ctx, 'Carregando topologia…', w / 2, h / 2, withAlpha(c.cyan, 0.6), 11, 'center', 400); return; }

  const cx = w / 2;
  const yNet = h * 0.2, yFw = h * 0.42, ySen = h * 0.6, ySvc = h * 0.84;
  const hexR = Math.min(34, w * 0.05);
  const node = (x, y, r, color, label, sub, info, big = false) => {
    if (big) {
      ctx.strokeStyle = withAlpha(color, 0.25); ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    hexPath(ctx, x, y, r);
    ctx.fillStyle = withAlpha(color, 0.08); ctx.fill();
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = big ? 14 : 6;
    ctx.strokeStyle = color; ctx.lineWidth = big ? 2 : 1.4; ctx.stroke(); ctx.restore();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, big ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    stageText(ctx, label, x + r + 10, y - 7, color, 11, 'left', 700);
    if (sub) stageText(ctx, sub, x + r + 10, y + 8, withAlpha(color, 0.7), 9.5, 'left', 400);
    st.hits.push({ x, y, r: r + 6, info });
  };
  const link = (x1, y1, x2, y2, color, dashed) => {
    ctx.strokeStyle = withAlpha(color, dashed ? 0.55 : 0.8); ctx.lineWidth = dashed ? 1 : 1.6;
    ctx.setLineDash(dashed ? [4, 5] : []); ctx.lineDashOffset = dashed ? -now / 50 : 0;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
  };

  /* Pares remotos em leque acima da internet */
  const peers = [];
  for (const conn of sys.network.connections) {
    if (!conn.raddr || isLoopback(conn.raddr.ip) || peers.some(p => p.ip === conn.raddr.ip)) continue;
    peers.push({ ip: conn.raddr.ip, port: conn.raddr.port, status: conn.status });
  }
  const fan = peers.slice(0, 14);
  fan.forEach((p, i) => {
    const t = fan.length === 1 ? 0.5 : i / (fan.length - 1);
    const x = cx + (t - 0.5) * Math.min(w * 0.8, 640), y = yNet - 40 - Math.sin(t * Math.PI) * 50;
    const bad = state.ipsBlocked.has(p.ip);
    const col = bad ? red : c.cyan;
    ctx.strokeStyle = withAlpha(col, 0.45); ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx, yNet); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
    st.hits.push({ x, y, r: 9, info: { kind: 'PAR REMOTO', rows: [['IP', p.ip], ['PORTA REMOTA', `${p.port}${portLabel(p.port) ? ` (${portLabel(p.port)})` : ''}`], ['ESTADO', p.status], ['BLOQUEADO', bad ? 'sim (sessão)' : 'não']] } });
  });

  link(cx, yNet, cx, yFw, c.neon, false);
  link(cx, yFw, cx, ySen, c.neon, false);
  const plat = sys.platform;
  node(cx, yNet, hexR * 0.9, c.cyan, 'INTERNET', `${peers.length} pares remotos`,
    { kind: 'INTERNET', rows: [['PARES REMOTOS', String(peers.length)], ['CONEXÕES', String(sys.network.connections_total)]] });
  node(cx, yFw, hexR * 1.15, c.neon, 'FIREWALL', plat.startsWith('win') ? 'netsh' : 'iptables',
    { kind: 'FIREWALL', rows: [['BACKEND', plat.startsWith('win') ? 'netsh advfirewall' : plat.startsWith('linux') ? 'iptables / ufw' : 'indisponível'], ['IPs BLOQUEADOS', String(state.ipsBlocked.size)]] }, true);

  /* Serviços em escuta abaixo do sensor */
  const ports = uniquePorts(sys.network.listening).slice(0, 6);
  ports.forEach((p, i) => {
    const t = ports.length === 1 ? 0.5 : i / (ports.length - 1);
    const x = cx + (t - 0.5) * Math.min(w * 0.6, 560), y = ySvc + (i % 2 ? 26 : 0);
    const local = p.ips.every(isLoopbackBind);
    const col = local ? c.cyan : warn;
    link(cx, ySen, x, y, col, true);
    node(x, y, hexR * 0.75, col, portLabel(p.port) || `PORTA ${p.port}`, `:${p.port} · ${local ? 'local' : 'aberta'}`,
      { kind: 'SERVIÇO', rows: [['PORTA', `${p.port}/tcp`], ['SERVIÇO', portLabel(p.port) || 'desconhecido'], ['ESCUTA EM', p.ips.join(', ')],
        ['CONEXÕES', String(sys.network.connections.filter(x => x.laddr?.port === p.port).length)], ['EXPOSIÇÃO', local ? 'só local' : 'aceita conexões externas']] });
  });
  node(cx, ySen, hexR * 1.25, c.neon, 'SENSOR', 'DataSentinel',
    { kind: 'SENSOR', rows: [['PLATAFORMA', plat], ['SERVIÇOS', String(uniquePorts(sys.network.listening).length)], ['UPTIME', fmtAgo(sys.server_uptime)]] }, true);
}

/* Config: núcleo com os 8 módulos em órbita, cor = estado real */
function drawConfigStage(now) {
  const st = stageFor('cfg-canvas');
  if (!st || !st.w) return;
  const { ctx, w, h } = st;
  const c = sysColors();
  const colorOf = { on: c.neon, idle: c.cyan, off: cssVar('--muted'), warn: c.warn2 };
  ctx.clearRect(0, 0, w, h);
  /* Raio limitado pela largura: os nomes dos módulos ficam fora do anel */
  const cx = w / 2, cy = h / 2 - 10, R = Math.min(w * 0.26, h * 0.34);

  ctx.setLineDash([2, 6]); ctx.strokeStyle = withAlpha(c.neon, 0.22); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]); ctx.strokeStyle = withAlpha(c.neon, 0.3);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([16, 10]); ctx.lineDashOffset = now / 80; ctx.strokeStyle = withAlpha(c.neon, 0.45);
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);

  MODULES.forEach((mod, i) => {
    const a = -Math.PI / 2 + i / MODULES.length * Math.PI * 2;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    const stt = moduleStatus(mod.key);
    const col = colorOf[stt];
    ctx.strokeStyle = withAlpha(col, 0.4); ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.42, cy + Math.sin(a) * R * 0.42); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    if (stt === 'on') {
      const ph = ((now / 1800) + i / 8) % 1;
      ctx.strokeStyle = withAlpha(col, 0.5 * (1 - ph));
      ctx.beginPath(); ctx.arc(x, y, 8 + ph * 14, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    const right = Math.cos(a) > 0.2, left = Math.cos(a) < -0.2;
    stageText(ctx, mod.name, x + (right ? 14 : left ? -14 : 0), y + (right || left ? 0 : Math.sin(a) < 0 ? -18 : 20),
      col, 11, right ? 'left' : left ? 'right' : 'center', 500);
  });

  ctx.save(); ctx.shadowColor = c.neon; ctx.shadowBlur = 20;
  ctx.strokeStyle = c.neon; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.4, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  ctx.fillStyle = withAlpha(c.neon, 0.06); ctx.beginPath(); ctx.arc(cx, cy, R * 0.4, 0, Math.PI * 2); ctx.fill();
  const active = MODULES.filter(m => moduleStatus(m.key) === 'on').length;
  stageText(ctx, 'CORE', cx, cy - 8, c.neon, 15, 'center', 700);
  stageText(ctx, `${active} / ${MODULES.length} ativos`, cx, cy + 12, withAlpha(c.neon, 0.75), 10, 'center', 400);

  const legend = [['ativo', colorOf.on], ['sem eventos', colorOf.idle], ['não configurado', colorOf.off], ['offline', colorOf.warn]];
  legend.forEach(([t, col], i) => {
    const lx = cx - 210 + i * 110, ly = cy + R * 1.12 + 26;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, Math.PI * 2); ctx.fill();
    stageText(ctx, t, lx + 8, ly, withAlpha(col, 0.9), 9.5, 'left', 400);
  });
}

/* ════════════ CONTROLES ════════════ */
function bindPageControls() {
  document.getElementById('atk-filter')?.addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    state.atkFilter = b.dataset.filter;
    b.parentElement.querySelectorAll('.chip').forEach(x => x.classList.toggle('is-on', x === b));
    refreshAttacksPage();
  });
  document.getElementById('log-levels')?.addEventListener('click', e => {
    const b = e.target.closest('[data-level]');
    if (!b) return;
    state.logLevel = b.dataset.level;
    renderFullLogs();
  });
  document.getElementById('log-sources')?.addEventListener('click', e => {
    const b = e.target.closest('[data-src]');
    if (!b) return;
    const k = b.dataset.src;
    state.logSourcesOff.has(k) ? state.logSourcesOff.delete(k) : state.logSourcesOff.add(k);
    renderFullLogs();
  });
  document.getElementById('logs-full-container')?.addEventListener('click', e => {
    const row = e.target.closest('.stream-row');
    if (row) showLogDetail(Number(row.dataset.n));
  });
  document.querySelector('.export-row')?.addEventListener('click', e => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    b.parentElement.querySelectorAll('[data-export]').forEach(x => x.classList.toggle('is-on', x === b));
    exportLogs(b.dataset.export);
  });
  const netCanvas = document.getElementById('net-canvas');
  netCanvas?.addEventListener('click', e => {
    const st = stages['net-canvas'];
    if (!st) return;
    const r = netCanvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const hit = st.hits.find(n => Math.hypot(n.x - mx, n.y - my) < n.r);
    if (!hit) return;
    setText('net-node-kind', hit.info.kind);
    const el = document.getElementById('net-node');
    if (el) el.innerHTML = hit.info.rows.map(([k, v]) => `<div class="stat-row"><span>${escHtml(k)}</span><strong>${escHtml(v)}</strong></div>`).join('');
  });
  netCanvas?.addEventListener('mousemove', e => {
    const st = stages['net-canvas'];
    if (!st) return;
    const r = netCanvas.getBoundingClientRect();
    const over = st.hits.some(n => Math.hypot(n.x - (e.clientX - r.left), n.y - (e.clientY - r.top)) < n.r);
    netCanvas.style.cursor = over ? 'pointer' : '';
  });
}

/* O mesmo globo do dashboard é usado na página Ataques (move o elemento) */
function placeGlobe(section) {
  const map = document.getElementById('threat-map');
  if (!map) return;
  const target = section === 'ataques'
    ? document.getElementById('atk-globe-slot')
    : document.querySelector('.intel-stage .map-leaflet-wrap');
  if (target && map.parentElement !== target) {
    target.prepend(map);
    setTimeout(resizeGlobe, 30);
  }
}

/* ────────────────── SOCKET.IO ────────────────── */
function bindSocket() {
  if (!window.io) return;
  const socket = io();

  socket.on('connect', () => {
    setText('socket-status', '● LIVE');
    const statusEl = document.querySelector('#socket-status');
    if (statusEl) statusEl.className = 'hud-v is-live';
    state.socketUp = true;
    renderIntelSources();
    setText('cfg-socket-status', 'CONECTADO');
  });

  socket.on('disconnect', () => {
    setText('socket-status', '○ OFFLINE');
    const statusEl = document.querySelector('#socket-status');
    if (statusEl) statusEl.className = 'hud-v danger';
    state.socketUp = false;
    renderIntelSources();
    setText('cfg-socket-status', 'DESCONECTADO');
  });

  socket.on('connect_error', () => {
    /* Conexao recusada tipicamente por sessao expirada/nao autenticada */
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
    /* Evento de teste nao passa pelo firewall: nao conta como IP bloqueado */
    if (!isSimulatedEvent(payload)) state.ipsBlocked.add(ip);
    state.ipHits.set(ip, (state.ipHits.get(ip) || 0) + 1);
    if (payload.country) {
      state.ipCountry.set(ip, payload.country);
      state.countries.add(payload.country);
    }
  }

  const type = attackTypeFromPayload(payload);
  state.attackTypes.set(type, (state.attackTypes.get(type) || 0) + 1);

  /* Central de inteligencia: registra o evento recebido (nunca inventado) */
  const at = Date.now();
  state.alertLog.push({ at, p: payload });
  if (state.alertLog.length > ALERT_LOG_MAX) state.alertLog.shift();
  if (ip) {
    const seen = state.ipSeen.get(ip);
    state.ipSeen.set(ip, { first: seen ? seen.first : at, last: at });
    state.ipLastAlert.set(ip, payload);
  }
  const src = sourceLabel(payload).key;
  const srcState = state.sources.get(src) || { count: 0, last: 0 };
  state.sources.set(src, { count: srcState.count + 1, last: at });

  /* Update counters */
  setText('metric-threats',    state.threatsTotal);
  setText('metric-unique-ips', state.ipsBlocked.size);
  setText('metric-connections', state.connectionsToday);

  /* Prepend to feeds */
  prependAlertCard(payload);

  /* Globo: marcador + arco */
  if (eventCoords(payload)) {
    showAttackOnGlobe(payload);
    const alvo = targetLabel(payload);
    if (!globe.hold) {
      showMapLabel(`${placeName(payload)}${alvo ? ' → ' + alvo : ''} · ${type}`, ATTACK_LEAD_MS + ATTACK_TRAVEL_MS + ATTACK_HOLD_MS);
    }
  }

  /* Atualiza donut e top IPs no dashboard */
  refreshSocDonut();
  renderTopIps();
  renderIntelPanels();
  /* O historico do alvo aberto cresce se o mesmo IP voltar a atacar */
  if (globe.selected && globe.selected.ip === ip) renderTargetHistory(ip);

  /* Atualiza TODAS as páginas em tempo real */
  refreshAttacksPage();
  refreshFirewallPage();

  /* Imprime no terminal */
  termLogAlert(payload);

  /* Terminal footer */
  const terminal = document.getElementById('terminal-line-1');
  if (terminal) terminal.textContent = `[${new Date().toLocaleTimeString()}] ${type} · ${ip} ${isSimulatedEvent(payload) ? 'SIMULADO (sem bloqueio)' : 'bloqueio solicitado'}`;
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
      const url = ip ? `/test_alert/${encodeURIComponent(ip)}` : '/test_alert';
      fetch(url, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken() } })
        .then(r => { if (r.status === 401) { window.location.href = '/login'; return null; } return r.json(); })
        .then(d => { if (d) termPrint(`Alerta disparado: ${d.payload?.ip} · ${d.payload?.type}`, 't-ok'); })
        .catch(() => termPrint('Erro ao disparar alerta.', 't-err'));
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
  const alvo  = targetLabel(payload);
  const tag = isSimulatedEvent(payload) ? '[TESTE]' : '[BLOCK]';
  termPrint(`${tag} ${type.padEnd(14)} ${ip}  ${loc}${alvo ? '  → ' + alvo : ''}`, isSimulatedEvent(payload) ? 't-warn' : 't-block');
}

/* ────────────────── INIT ────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindNavigation();

  atualizarRelogio();
  setInterval(atualizarRelogio, 1000);

  updateUptime();
  setInterval(updateUptime, 1000);

  initGlobe();
  ensureChart();
  renderIntelPanels();
  setInterval(renderIntelPanels, 5000);
  bindPageControls();
  pollSystem();
  setInterval(pollSystem, SYSTEM_POLL_MS);
  requestAnimationFrame(stagesFrame);
  setInterval(updateStageHud, 250);
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
