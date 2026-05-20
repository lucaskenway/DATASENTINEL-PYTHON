/* DataSentinel SOC — painel vivo (métricas reais + Socket.IO) */

const MAX_ALERTS = 40;
const CHART_POINTS = 28;
const HISTORY = 48;

const DONUT_COLORS = [
  "rgba(93,255,159,0.92)",
  "rgba(0,210,255,0.82)",
  "rgba(255,210,120,0.9)",
  "rgba(255,110,130,0.88)",
  "rgba(186,140,255,0.85)",
  "rgba(120,220,255,0.8)",
];

const state = {
  defender: { lat: -23.55, lon: -46.63 },
  ipHits: new Map(),
  countries: new Map(),
  uniqueIps: new Set(),
  lastAlertTs: null,
  baseline: null,
  lastMetrics: { connections: 0, threats: 0, unique: 0, countries: 0 },
  history: {
    conn: [],
    threats: [],
    unique: [],
    countries: [],
  },
  svgNs: "http://www.w3.org/2000/svg",
  socDonut: null,
  miniChart: null,
};

function $(id) {
  return document.getElementById(id);
}

function atualizarRelogio() {
  const el = $("clock");
  if (!el) return;
  const agora = new Date();
  el.textContent = `${agora.toLocaleDateString()} · ${agora.toLocaleTimeString()}`;
}

setInterval(atualizarRelogio, 1000);
atualizarRelogio();

const COUNTRY_CENTERS = [
  { keys: ["brasil", "brazil", "br"], lat: -14.235, lon: -51.9253, iso: "br" },
  {
    keys: ["estados unidos", "united states", "usa", "u.s"],
    lat: 37.0902,
    lon: -95.7129,
    iso: "us",
  },
  { keys: ["alemanha", "germany", "de"], lat: 51.1657, lon: 10.4515, iso: "de" },
  { keys: ["france", "frança", "fr"], lat: 46.2276, lon: 2.2137, iso: "fr" },
  { keys: ["japan", "japão", "jp"], lat: 36.2048, lon: 138.2529, iso: "jp" },
  { keys: ["china", "cn"], lat: 35.8617, lon: 104.1954, iso: "cn" },
  { keys: ["russia", "rus", "ru"], lat: 61.524, lon: 105.3188, iso: "ru" },
  { keys: ["canada", "ca"], lat: 56.1304, lon: -106.3468, iso: "ca" },
  { keys: ["mexico", "méxico", "mx"], lat: 23.6345, lon: -102.5528, iso: "mx" },
  { keys: ["portugal", "pt"], lat: 39.3999, lon: -8.2245, iso: "pt" },
  { keys: ["argentina", "ar"], lat: -38.4161, lon: -63.6167, iso: "ar" },
  {
    keys: ["united kingdom", "uk", "reino unido", "gb"],
    lat: 55.3781,
    lon: -3.436,
    iso: "gb",
  },
];

function fallbackCoordsForLocation(location) {
  if (!location) {
    return { lat: state.defender.lat, lon: state.defender.lon };
  }
  const l = String(location).toLowerCase();
  for (const c of COUNTRY_CENTERS) {
    if (c.keys.some((k) => l.includes(k))) {
      return { lat: c.lat, lon: c.lon };
    }
  }
  return { lat: state.defender.lat, lon: state.defender.lon };
}

function severityFromPayload(payload) {
  const t = String(payload.type || "").toLowerCase();
  const r = String(payload.reason || "").toLowerCase();
  if (t.includes("scan") || r.includes("threshold")) return "high";
  if (r.includes("ai")) return "medium";
  if (t.includes("test")) return "low";
  return "high";
}

function formatTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts * 1000).toLocaleTimeString();
  } catch {
    return "—";
  }
}

function formatTimeFull(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts * 1000);
    return `${d.toLocaleDateString()} · ${d.toLocaleTimeString()}`;
  } catch {
    return "—";
  }
}

function countryIsoFromLocation(location) {
  if (!location) return null;
  const l = String(location).toLowerCase();
  for (const c of COUNTRY_CENTERS) {
    if (c.keys.some((k) => l.includes(k))) return c.iso;
  }
  return null;
}

function resolveAlertIso(payload, location) {
  const raw = payload.country;
  if (raw && String(raw).trim().length === 2) {
    return String(raw).trim().toLowerCase();
  }
  return countryIsoFromLocation(location);
}

function riskCopy(sev) {
  if (sev === "high") return "Risco elevado";
  if (sev === "medium") return "Correlação média";
  return "Baixa prioridade";
}

function initTechBg() {
  const el = document.querySelector(".tech-binary");
  if (!el) return;
  const cols = 52;
  const rows = 22;
  let s = "";
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      s += Math.random() > 0.5 ? "1" : "0";
    }
    s += "\n";
  }
  el.textContent = s;
}

function formatDeltaPct(current, baseline) {
  if (baseline == null) return { text: "—", cls: "flat" };
  const cur = Number(current) || 0;
  const base = Number(baseline) || 0;
  if (base === 0 && cur === 0) return { text: "0%", cls: "flat" };
  if (base === 0) return { text: `+${cur === 0 ? 0 : 100}%`, cls: "up" };
  const pct = Math.round(((cur - base) / base) * 100);
  const cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const sign = pct > 0 ? "+" : "";
  return { text: `${sign}${pct}%`, cls };
}

function setTrendRow(id, current, baselineKey) {
  const host = $(id);
  if (!host || !state.baseline) return;
  const tv = host.querySelector(".trend-val");
  if (!tv) return;
  const { text, cls } = formatDeltaPct(current, state.baseline[baselineKey]);
  tv.textContent = text;
  tv.classList.remove("up", "down", "flat");
  tv.classList.add(cls);
}

function latLonToPercent(lat, lon) {
  const x = ((Number(lon) + 180) / 360) * 100;
  const y = ((90 - Number(lat)) / 180) * 100;
  return {
    x: Math.min(100, Math.max(0, x)),
    y: Math.min(100, Math.max(0, y)),
  };
}

function updateSpark(containerId, key) {
  const box = $(containerId);
  if (!box) return;
  const series = state.history[key];
  if (!series.length) {
    box.innerHTML = "";
    return;
  }
  const slice = series.slice(-HISTORY);
  const mx = Math.max(...slice, 1);
  box.innerHTML = slice
    .map((v) => {
      const h = Math.max(8, Math.round((v / mx) * 100));
      return `<span style="height:${h}%"></span>`;
    })
    .join("");
}

function bumpCounter(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function renderTopCountries() {
  const host = $("country-list");
  if (!host) return;
  const arr = [...state.countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!arr.length) {
    host.innerHTML =
      '<span class="empty-hint">Aguardando correlação geográfica…</span>';
    return;
  }
  const max = arr[0][1] || 1;
  host.innerHTML = arr
    .map(([name, count]) => {
      const pct = Math.round((count / max) * 100);
      const slicePct = Math.round(
        (count / arr.reduce((s, [, v]) => s + v, 0)) * 100
      );
      return `<div class="country-row mono">
  <div class="country-meta">
    <span class="country-label">${escapeHtml(name)}</span>
    <span class="meta-strong">${slicePct}% · ${count} evt</span>
  </div>
  <div class="country-track"><div class="country-fill" style="width:${pct}%"></div></div>
</div>`;
    })
    .join("");
  refreshSocDonut();
}

function renderTopIps() {
  const host = $("ips-list");
  if (!host) return;
  const arr = [...state.ipHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!arr.length) {
    host.innerHTML =
      '<div class="empty-hint">Sem IPs correlacionados ainda.</div>';
    return;
  }
  const max = arr[0][1] || 1;
  host.innerHTML = arr
    .map(([ip, n], idx) => {
      const w = Math.round((n / max) * 100);
      let rankClass = "rank-high";
      if (n < max * 0.5) rankClass = "rank-low";
      else if (n < max * 0.82) rankClass = "rank-mid";
      const tag = String(idx + 1).padStart(2, "0");
      return `<div class="ip-row ${rankClass} mono">
  <div class="ip-row-top">
    <strong>#${tag} · ${escapeHtml(ip)}</strong>
    <small>${n} alertas</small>
  </div>
  <div class="ip-track"><div class="ip-fill" style="width:${w}%"></div></div>
</div>`;
    })
    .join("");
}

function pushTelemetryLine(line) {
  const stream = $("telemetry-stream");
  if (!stream) return;
  const p = document.createElement("p");
  p.textContent = line;
  stream.prepend(p);
  while (stream.children.length > 24) {
    stream.removeChild(stream.lastChild);
  }
}

function setTerminalBurst(lines) {
  const l1 = $("terminal-line-1");
  const l2 = $("terminal-line-2");
  const l3 = $("terminal-line-3");
  if (l1 && lines[0]) l1.textContent = lines[0];
  if (l2 && lines[1]) l2.textContent = lines[1] || "";
  if (l3 && lines[2]) l3.textContent = lines[2] || "";
}

function addAttackLine(fromLat, fromLon, toLat, toLon, severity) {
  const svg = $("attackOverlay");
  if (!svg) return;

  const a = latLonToPercent(Number(fromLat), Number(fromLon));
  const b = latLonToPercent(Number(toLat), Number(toLon));

  const g = document.createElementNS(state.svgNs, "g");
  g.setAttribute("class", `strike-group sev-${severity}`);

  const core = document.createElementNS(state.svgNs, "line");
  core.setAttribute("x1", String(a.x));
  core.setAttribute("y1", String(a.y));
  core.setAttribute("x2", String(b.x));
  core.setAttribute("y2", String(b.y));
  core.setAttribute("pathLength", "100");
  core.setAttribute("class", "strike-core");

  const glow = document.createElementNS(state.svgNs, "line");
  glow.setAttribute("x1", String(a.x));
  glow.setAttribute("y1", String(a.y));
  glow.setAttribute("x2", String(b.x));
  glow.setAttribute("y2", String(b.y));
  glow.setAttribute("pathLength", "100");
  glow.setAttribute("class", "strike-glow");

  g.appendChild(glow);
  g.appendChild(core);

  const pulse = document.createElementNS(state.svgNs, "circle");
  pulse.setAttribute("cx", String(b.x));
  pulse.setAttribute("cy", String(b.y));
  pulse.setAttribute("r", "1.25");
  pulse.setAttribute("class", "strike-pulse");
  g.appendChild(pulse);

  svg.appendChild(g);

  requestAnimationFrame(() => g.classList.add("armed"));

  setTimeout(() => {
    g.classList.add("fadeout");
  }, 5200);

  setTimeout(() => {
    if (g.parentNode) g.parentNode.removeChild(g);
  }, 6400);
}

function spawnImpactParticles(lat, lon) {
  const mapEl = document.getElementById("threat-map");
  if (!mapEl) return;
  const p = latLonToPercent(lat, lon);
  for (let i = 0; i < 6; i += 1) {
    const dot = document.createElement("span");
    dot.className = "micro-burst";
    dot.style.left = `${p.x}%`;
    dot.style.top = `${p.y}%`;
    const dx = (Math.random() - 0.5) * 36;
    const dy = (Math.random() - 0.5) * 36;
    dot.style.setProperty("--dx", `${dx}px`);
    dot.style.setProperty("--dy", `${dy}px`);
    mapEl.appendChild(dot);
    setTimeout(() => {
      if (dot.parentNode) dot.parentNode.removeChild(dot);
    }, 1100);
  }
}

function addMapMarker(lat, lon, meta) {
  const mapEl = document.getElementById("threat-map");
  if (!mapEl) return;

  const marker = document.createElement("div");
  const sev = meta.severity || "high";
  marker.className = `map-marker sev-${sev}`;
  marker.setAttribute("data-ip", meta.ip || "unknown");
  marker.setAttribute(
    "title",
    `${meta.ip || "Desconhecido"}${meta.location ? " · " + meta.location : ""}`
  );

  const pos = latLonToPercent(lat, lon);
  marker.style.left = `${pos.x}%`;
  marker.style.top = `${pos.y}%`;

  mapEl.appendChild(marker);

  setTimeout(() => {
    if (marker && marker.parentNode) marker.parentNode.removeChild(marker);
  }, 12000);
}

function prependAlertCard(payload) {
  const host = $("alerts-feed");
  if (!host) return;

  const sev = severityFromPayload(payload);
  const ip = payload.ip || "—";
  const loc = payload.location || payload.region || "—";
  const title =
    (payload.type && String(payload.type).replace(/_/g, " ")) || "Evento de segurança";
  const iso = resolveAlertIso(payload, loc);
  const flagHtml = iso
    ? `<img class="alert-flag" src="https://flagcdn.com/h24/${iso}.png" alt="" width="30" height="22" loading="lazy" decoding="async"/>`
    : '<span class="alert-flag alert-flag-fallback mono" title="País não correlacionado">◌</span>';

  const el = document.createElement("article");
  el.className = `alert-card sev-${sev}`;
  el.innerHTML = `
    <div class="alert-rail" aria-hidden="true"></div>
    <div class="alert-icon" aria-hidden="true"></div>
    ${flagHtml}
    <div class="alert-body">
      <header>
        <div class="alert-head-left">
          <span class="alert-risk-label mono">${riskCopy(sev)}</span>
          <h4>${escapeHtml(title)}</h4>
        </div>
        <div class="alert-head-right">
          <span class="badge sev-${sev} mono">${sev.toUpperCase()}</span>
          <span class="alert-time mono">${formatTimeFull(
            payload.timestamp || Date.now() / 1000
          )}</span>
        </div>
      </header>
      <div class="alert-grid mono">
        <span class="label">IP</span><span class="value">${escapeHtml(String(ip))}</span>
        <span class="label">LOC</span><span class="value">${escapeHtml(String(loc))}</span>
        <span class="label">HORA</span><span class="value">${formatTime(
          payload.timestamp || Date.now() / 1000
        )}</span>
      </div>
      ${
        payload.message
          ? `<p class="alert-msg mono">${escapeHtml(payload.message)}</p>`
          : ""
      }
    </div>
  `;

  host.prepend(el);
  while (host.children.length > MAX_ALERTS) {
    host.removeChild(host.lastChild);
  }

  if (sev === "high") {
    el.classList.add("alert-critical-pulse");
    el.addEventListener(
      "animationend",
      () => el.classList.remove("alert-critical-pulse"),
      { once: true }
    );
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ingestAlert(payload) {
  if (!payload || typeof payload !== "object") return;

  let ip = payload.ip || null;
  let lat = payload.lat != null ? Number(payload.lat) : null;
  let lon = payload.lon != null ? Number(payload.lon) : null;
  let location = payload.location || payload.region || null;

  if (!ip && payload.message) {
    const ipMatch = payload.message.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    if (ipMatch) ip = ipMatch[0];
    const locMatch = payload.message.match(/Localizacao:\s*(.*)/i);
    if (locMatch) location = locMatch[1].trim();
  }

  if (lat == null || lon == null) {
    const coords = fallbackCoordsForLocation(location);
    lat = coords.lat;
    lon = coords.lon;
  }

  const sev = severityFromPayload(payload);

  if (ip) {
    state.uniqueIps.add(ip);
    bumpCounter(state.ipHits, ip);
  }
  const countryLabel = payload.country || guessCountryFromLocation(location);
  if (countryLabel) {
    bumpCounter(state.countries, countryLabel);
  }

  state.lastAlertTs = payload.timestamp || Date.now() / 1000;

  prependAlertCard({
    ...payload,
    ip: ip || payload.ip,
    location,
    lat,
    lon,
    type: payload.type || "alert",
  });

  addMapMarker(lat, lon, { ip, location, severity: sev });

  spawnImpactParticles(lat, lon);

  addAttackLine(state.defender.lat, state.defender.lon, lat, lon, sev);

  pushTelemetryLine(
    `[+] ${formatTime(state.lastAlertTs)} · ${ip || "?"} · ${location || "?"} · ${sev}`
  );

  setTerminalBurst([
    `correlate:${ip || "?"}`,
    `geo:${Number(lat).toFixed(2)}, ${Number(lon).toFixed(2)}`,
    payload.message ? String(payload.message).slice(0, 96) : "event ingested",
  ]);

  $("metric-unique-ips").textContent = String(state.uniqueIps.size);
  $("metric-countries").textContent = String(state.countries.size);

  renderTopCountries();
  renderTopIps();

  $("sum-last-ts").textContent = formatTime(state.lastAlertTs);
}

function guessCountryFromLocation(location) {
  if (!location) return null;
  const l = String(location).toLowerCase();
  for (const c of COUNTRY_CENTERS) {
    if (c.keys.some((k) => l.includes(k))) {
      return c.keys[0].toUpperCase();
    }
  }
  const parts = String(location).split("-");
  return parts[0] ? parts[0].trim() : null;
}

let networkChart;

function ensureSocDonut() {
  const ctx = $("socDonut");
  if (!ctx || state.socDonut) return;

  state.socDonut = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: [],
      datasets: [
        {
          data: [],
          backgroundColor: [],
          borderColor: "rgba(3,10,14,0.95)",
          borderWidth: 2,
          hoverOffset: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      animation: { duration: 520 },
      plugins: {
        legend: {
          display: false,
          position: "bottom",
          labels: {
            color: "#8aaf9c",
            boxWidth: 8,
            padding: 6,
            font: { size: 8, family: "'Fira Code', monospace" },
          },
        },
        tooltip: {
          callbacks: {
            label(ctx2) {
              const val = ctx2.parsed;
              const sum =
                ctx2.dataset.data.reduce((a, b) => a + Number(b), 0) || 1;
              const p = Math.round((val / sum) * 100);
              return ` ${ctx2.label}: ${val} evt (${p}%)`;
            },
          },
        },
      },
    },
  });

  refreshSocDonut();
}

function refreshSocDonut() {
  if (!state.socDonut) return;
  const arr = [...state.countries.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const ds = state.socDonut.data.datasets[0];
  if (!arr.length) {
    state.socDonut.data.labels = ["Sem correlação geo"];
    ds.data = [1];
    ds.backgroundColor = ["rgba(138,175,156,0.14)"];
    state.socDonut.options.plugins.legend.display = false;
  } else {
    state.socDonut.data.labels = arr.map(([name]) => name);
    ds.data = arr.map(([, v]) => v);
    ds.backgroundColor = arr.map(
      (_, i) => DONUT_COLORS[i % DONUT_COLORS.length]
    );
    state.socDonut.options.plugins.legend.display = true;
  }
  state.socDonut.update("none");
}

function refreshDonutCenterStats() {
  const te = $("donut-threats-center");
  const ce = $("donut-conn-center");
  const { threats, connections } = state.lastMetrics;
  if (te) te.textContent = threats != null ? String(threats) : "—";
  if (ce) ce.textContent = connections != null ? String(connections) : "—";
}

function ensureChart(ctx) {
  const labels = Array.from({ length: CHART_POINTS }, (_, i) => {
    const d = new Date(Date.now() - (CHART_POINTS - i) * 2000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  });

  networkChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Conexões estabelecidas",
          data: Array(CHART_POINTS).fill(0),
          borderColor: "#5dff9f",
          backgroundColor: "rgba(93,255,159,0.08)",
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      animation: { duration: 420 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#9ef5c9", boxWidth: 12, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              return ` ${ctx.dataset.label}: ${ctx.parsed.y}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#7bc49a", maxTicksLimit: 8, font: { size: 10 } },
          grid: { color: "rgba(0,255,140,0.05)" },
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#7bc49a", font: { size: 10 } },
          grid: { color: "rgba(0,255,140,0.05)" },
        },
      },
    },
  });

  const miniCtx = document.getElementById("miniTrend");
  if (miniCtx) {
    state.miniChart = new Chart(miniCtx, {
      type: "line",
      data: {
        labels: Array(14).fill(""),
        datasets: [
          {
            label: "conn",
            data: Array(14).fill(0),
            borderColor: "#54f39a",
            backgroundColor: "rgba(84,243,154,0.12)",
            borderWidth: 1.5,
            tension: 0.45,
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false, beginAtZero: true },
        },
      },
    });
  }

  ensureSocDonut();
}

function pushMetricSample(m) {
  const c = m.connections_active || 0;
  const threats = m.threats_total || 0;
  const uniq = state.uniqueIps.size;
  const countries = state.countries.size;

  if (!state.baseline) {
    state.baseline = { conn: c, threats, unique: uniq, countries };
  }
  state.lastMetrics = { connections: c, threats, unique: uniq, countries };

  $("metric-connections").textContent = String(c);
  $("metric-threats").textContent = String(threats);

  state.history.conn.push(c);
  state.history.threats.push(threats);
  state.history.unique.push(state.uniqueIps.size);
  state.history.countries.push(state.countries.size);

  ["conn", "threats", "unique", "countries"].forEach((k) => {
    while (state.history[k].length > HISTORY) state.history[k].shift();
  });

  updateSpark("spark-connections", "conn");
  updateSpark("spark-threats", "threats");
  updateSpark("spark-sources", "unique");
  updateSpark("spark-countries", "countries");

  setTrendRow("trend-connections", c, "conn");
  setTrendRow("trend-threats", threats, "threats");
  setTrendRow("trend-unique", uniq, "unique");
  setTrendRow("trend-countries", countries, "countries");

  refreshDonutCenterStats();
  refreshSocDonut();

  if (m.defender && typeof m.defender.lat === "number") {
    state.defender.lat = m.defender.lat;
    state.defender.lon = m.defender.lon;
  }

  $("sum-threats").textContent = String(threats);
}

function appendChartPoint(activeConnections) {
  if (!networkChart) return;
  const labs = networkChart.data.labels.slice(1);
  labs.push(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  networkChart.data.labels = labs;

  const ds = networkChart.data.datasets[0].data.slice(1);
  ds.push(activeConnections);
  networkChart.data.datasets[0].data = ds;

  networkChart.update("none");

  if (state.miniChart) {
    const md = state.miniChart.data.datasets[0].data.slice(1);
    md.push(activeConnections);
    state.miniChart.data.datasets[0].data = md;
    state.miniChart.update("none");
  }
}

async function pollMetrics() {
  const latencyEl = $("metric-latency");
  const t0 = performance.now();
  try {
    const res = await fetch("/api/metrics", { cache: "no-store" });
    const m = await res.json();

    $("bar-cpu").style.width = `${Math.min(100, m.cpu)}%`;
    $("bar-mem").style.width = `${Math.min(100, m.memory)}%`;
    $("bar-net").style.width = `${Math.min(100, m.network_activity)}%`;
    $("readout-cpu").textContent = `${m.cpu}%`;
    $("readout-mem").textContent = `${m.memory}%`;
    $("readout-net").textContent = `${m.network_activity}%`;

    pushMetricSample(m);
    appendChartPoint(m.connections_active || 0);

    const ms = Math.round(performance.now() - t0);
    if (latencyEl) latencyEl.textContent = `API /metrics · ${ms}ms`;

    $("sum-api").textContent = `${ms}ms · OK`;
  } catch (e) {
    if (latencyEl) latencyEl.textContent = "API offline";
    $("sum-api").textContent = "erro";
  }
}

async function pollLogs() {
  try {
    const res = await fetch("/api/logs?n=48", { cache: "no-store" });
    const data = await res.json();
    const box = $("logs-container");
    if (!box || !Array.isArray(data.lines)) return;
    box.innerHTML = "";
    data.lines.reverse().forEach((ln) => {
      const p = document.createElement("p");
      p.textContent = ln;
      box.appendChild(p);
    });

    renderSummaryFromLogs(data.lines.length);
    const lu = $("logs-updated");
    if (lu) lu.textContent = `atualizado · ${new Date().toLocaleTimeString()}`;
  } catch {
    /* silencioso */
  }
}

function renderSummaryFromLogs(count) {
  const grid = $("summary-grid");
  if (!grid) return;
  if (!count) {
    grid.innerHTML =
      '<div class="empty-hint">Nenhuma linha no ataques.log ainda.</div>';
    return;
  }
  grid.innerHTML = `
    <div class="info-card"><span>LINHAS VISÍVEIS</span><strong class="mono">${count}</strong></div>
    <div class="info-card"><span>IPS ÚNICOS (sessão)</span><strong class="mono">${state.uniqueIps.size}</strong></div>
    <div class="info-card"><span>FUSO</span><strong class="mono">${Intl.DateTimeFormat().resolvedOptions().timeZone}</strong></div>
    <div class="info-card"><span>GEO TAGS</span><strong class="mono">${state.countries.size}</strong></div>
  `;
}

function bindSocket() {
  const status = $("socket-status");
  const sessionLine = $("session-line");

  try {
    const socket = io();

    socket.on("connect", () => {
      if (status) {
        status.textContent = "socket · conectado";
        status.classList.add("ok");
      }
      $("sum-socket").textContent = "online";

      const id = socket.id || "sessão";
      if (sessionLine) sessionLine.textContent = `sid · ${String(id).slice(0, 10)}`;
    });

    socket.on("disconnect", () => {
      if (status) {
        status.textContent = "socket · offline";
        status.classList.remove("ok");
      }
      $("sum-socket").textContent = "offline";
    });

    socket.on("session_init", (data) => {
      if (data && typeof data.threats_total === "number") {
        $("metric-threats").textContent = String(data.threats_total);
        state.lastMetrics.threats = data.threats_total;
        refreshDonutCenterStats();
      }
    });

    socket.on("new_alert", (data) => {
      ingestAlert(data);
      if (typeof data?.threats_total === "number") {
        $("metric-threats").textContent = String(data.threats_total);
        state.lastMetrics.threats = data.threats_total;
        refreshDonutCenterStats();
      }
      pollMetrics();
    });
  } catch (e) {
    if (status) status.textContent = "socket indisponível";
    console.warn(e);
  }
}

function observeMapResize() {
  /* Overlay usa viewBox 0 0 100 100; escala junto ao mapa sem recalcular trajetórias */
}

const clearBtn = $("btn-clear-alerts");
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    const host = $("alerts-feed");
    if (host) host.innerHTML = "";
  });
}

const navMenu = document.querySelector(".menu");
if (navMenu) navMenu.addEventListener("click", (ev) => {
  const li = ev.target.closest("li");
  if (!li) return;
  document.querySelectorAll(".menu li").forEach((n) => n.classList.remove("active"));
  li.classList.add("active");
});

const ctx = $("networkChart");
if (ctx) ensureChart(ctx);

initTechBg();

const mapWorldImg = document.querySelector(".map-world-img");
if (mapWorldImg) {
  mapWorldImg.addEventListener("error", () => {
    mapWorldImg.style.display = "none";
  });
}

bindSocket();
observeMapResize();
pollMetrics();
pollLogs();
setInterval(pollMetrics, 2000);
setInterval(pollLogs, 6000);
