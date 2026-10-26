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
};

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

  globe.colors = { neon: cssVar('--neon'), neon2: cssVar('--neon2'), cyan: cssVar('--cyan') };

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
    .then(topo => { globe.land = topojson.feature(topo, topo.objects.land); })
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

function globeRadius() {
  return Math.min(globe.width, globe.height) * 0.44 * globe.zoom;
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
  const sev = meta.severity || 'high';
  const color = sev === 'high' ? '#ff4d6d' : sev === 'medium' ? '#ffcc66' : '#66d9ff';
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

function isSimulatedEvent(p) {
  return /^SIMULATED\b/i.test(displayText(p.message)) || p.reason === 'manual_test' || p.type === 'test_event';
}

const UNAVAILABLE = 'Indisponível';

/* Cartao com a origem APROXIMADA do ataque (geolocalizacao por IP indica a
   cidade/provedor, nunca o endereco de quem esta atras do IP). */
function showAttackerCard(p) {
  const card = document.getElementById('attackerCard');
  if (!card || !p) return;
  globe.selected = p;
  const coords = eventCoords(p);

  document.getElementById('ac-city').textContent =
    displayText(p.city) || displayText(p.location) || 'Localização indisponível';
  document.getElementById('ac-kicker').textContent =
    isSimulatedEvent(p) ? 'ORIGEM DO ATAQUE · SIMULADO' : 'ORIGEM DO ATAQUE';

  const when = Number.isFinite(Number(p.timestamp)) && p.timestamp != null
    ? new Date(Number(p.timestamp) * 1000).toLocaleString('pt-BR') : '';
  const place = [p.city, p.region, p.country].map(displayText).filter(Boolean);
  /* [rotulo, valor, obrigatorio]: obrigatorios mostram "Indisponivel" quando faltam */
  const rows = [
    ['IP', displayText(p.ip), true],
    ['Local', place.filter((v, i) => place.indexOf(v) === i).join(', ') || displayText(p.location), true],
    ['Alvo', p.target_lat != null || p.target_ip ? targetLabel(p) : '', false],
    ['Provedor', displayText(p.isp), false],
    ['Organização', displayText(p.org) !== displayText(p.isp) ? displayText(p.org) : '', false],
    ['Ataque', attackTypeFromPayload(p), true],
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

  card.hidden = false;
}

function hideAttackerCard() {
  const card = document.getElementById('attackerCard');
  if (!card) return;
  card.hidden = true;
  document.getElementById('ac-frame').src = 'about:blank';
  document.querySelectorAll('.attack-row.is-selected').forEach(r => r.classList.remove('is-selected'));
  globe.selected = null;
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
  const color = severity === 'high' ? '#ff5577' : severity === 'medium' ? '#ffd27a' : '#8ee7ff';
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
  const toName = `ALVO · ${[target.name, target.ip].filter(Boolean).join(' · ') || 'DEFENSOR'}`;

  addGlobeMarker(lat, lon, { ip: payload.ip, location: payload.location, severity: sev, alert: payload });
  addGlobeArc(lat, lon, target.lat, target.lon, sev, {
    delay: ATTACK_LEAD_MS, travel: ATTACK_TRAVEL_MS, hold: ATTACK_HOLD_MS, fromName, toName,
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

  /* Halo externo */
  const halo = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.22);
  halo.addColorStop(0, withAlpha(c.neon, 0.16));
  halo.addColorStop(1, withAlpha(c.neon, 0));
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.22, 0, Math.PI * 2); ctx.fill();

  /* Corpo da esfera */
  const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
  body.addColorStop(0, withAlpha(c.cyan, 0.10));
  body.addColorStop(1, withAlpha(c.neon, 0.02));
  ctx.fillStyle = body;
  ctx.beginPath(); globe.path(globe.sphere); ctx.fill();

  /* Hemisferio de tras, translucido */
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = withAlpha(c.neon, 0.05);
  ctx.beginPath(); globe.backPath(globe.graticule); ctx.stroke();
  if (globe.land) {
    ctx.strokeStyle = withAlpha(c.neon, 0.10);
    ctx.beginPath(); globe.backPath(globe.land); ctx.stroke();
  }

  /* Grade de latitude/longitude */
  ctx.strokeStyle = withAlpha(c.neon, 0.16);
  ctx.lineWidth = 0.6;
  ctx.beginPath(); globe.path(globe.graticule); ctx.stroke();

  /* Continentes */
  if (globe.land) {
    ctx.fillStyle = withAlpha(c.neon, 0.13);
    ctx.beginPath(); globe.path(globe.land); ctx.fill();
    ctx.save();
    ctx.shadowColor = withAlpha(c.neon, 0.7);
    ctx.shadowBlur = 6;
    ctx.strokeStyle = withAlpha(c.neon2, 0.6);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  /* Linhas de varredura + faixa de scan, recortadas na esfera */
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = withAlpha(c.neon, 0.035);
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
  rim.addColorStop(1, withAlpha(c.cyan, 0.16));
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = withAlpha(c.neon, 0.45);
  ctx.lineWidth = 1.2;
  ctx.stroke();

  drawGlobeArcs(now, cx, cy, r);
  drawGlobeMarkers(now);
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
  if (name === 'dash' && globe.canvas) {
    setTimeout(resizeGlobe, 50);
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
    if (res.status === 401) { window.location.href = '/login'; return; }
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

function renderFullLogs(lines) {
  const el = document.getElementById('logs-full-container');
  if (!el) return;
  const countEl = document.getElementById('log-count');

  if (!lines.length) {
    el.innerHTML = '<div class="empty-state">Nenhum log encontrado.</div>';
    if (countEl) countEl.textContent = '0 linhas';
    return;
  }

  el.innerHTML = '';
  lines.slice().reverse().forEach(line => {
    const div = document.createElement('div');
    const { time, tag, tagClass } = parseLogLine(line);
    div.className = `full-log-line mono fl-${tagClass.replace('log-tag-','')}`;
    div.innerHTML = `
      <span class="fl-time">${time}</span>
      <span class="log-tag ${tagClass}">${tag}</span>
      <span class="fl-text">${escHtml(line)}</span>
    `;
    el.appendChild(div);
  });
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
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function csrfToken() {
  return document.querySelector('meta[name="csrf-token"]')?.content || '';
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
      <span class="fw-ip-addr">${escHtml(ip)}</span>
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
  termPrint(`[BLOCK] ${type.padEnd(14)} ${ip}  ${loc}${alvo ? '  → ' + alvo : ''}`, 't-block');
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

  initGlobe();
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
