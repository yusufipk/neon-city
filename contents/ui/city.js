'use strict';
/*
 * Neon City: an animated skyline driven by system load.
 *
 *   CPU        flying and street traffic (density and speed), window flicker, sirens above 90%
 *   RAM        share of lit windows, "MEMORY FULL" on the billboard above 90%
 *   Disk       trains on the elevated line: reads run right (cyan), writes run left (magenta)
 *   Net down   neon rain
 *   Net up     data pulses rising from the antenna tower
 *   GPU        searchlight brightness and the billboard equalizer
 *   CPU temp   sky color, violet when cool, red when hot
 *
 * Random events: every 30-minute window gets 0 to 2 of them at random moments
 * (every 30 to 90 seconds with ?demo=1): police chase, meteor, fireworks,
 * lightning, blackout, blimp, UFO, glitch.
 *
 * Metrics arrive through window.cityMetrics({...}); rates are bytes per second,
 * percentages are 0..100, temp is in Celsius. If no metrics arrive within a few
 * seconds (or with ?demo=1) the city runs on synthetic values and the HUD says DEMO.
 * URL params: fps (default 30), hud=0 hides the readout, demo=1.
 * In a browser, keys 1 to 8 fire the events by hand.
 *
 * Cost: the scene redraws at a capped frame rate even when nothing is watching it,
 * so it uses some CPU/GPU all the time. Lower ?fps= if that matters.
 */

const params = new URLSearchParams(location.search);
const FPS = clamp(+params.get('fps') || 30, 10, 60);
const SHOW_HUD = params.get('hud') !== '0';
const FORCE_DEMO = params.get('demo') === '1';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { alpha: false });

let W = 0, H = 0, S = 1, DPR = 1, GROUND = 0, TRACK_Y = 0;
let skyCache, farCache, cityCache, frontCache, overlayCache;
let skyHeat = -1, cityLit = -1, cityRenderedAt = -1;
let buildings = [], stars = [], signs = [], lights = [];
let tower = null, board = null;
let flyers = [], cars = [], trains = [], drops = [], pulses = [], flickers = [], events = [];
let lanes = [], streetLanes = [];
let t = 0;
let nextEventAt = FORCE_DEMO ? 12 : rand(30, 60);
const EVENT_WINDOW = 1800;
let eventQueue = [], eventWindowEnd = 0;
let lightPhase = 0, lightLevel = 0;

// Everything that differs between looks lives here; the scene code only reads TH.
const THEMES = {
  neon: {
    neon: ['#ff2bd6', '#00e5ff', '#ffe600', '#7cff4f', '#ff6a00', '#b36bff', '#ff3860'],
    win: ['#ffd27a', '#ffc05c', '#fff0c0', '#8ff3ff', '#ff8ad8', '#ffd27a', '#ffe7a8'],
    signs: [['BAR', false], ['ラーメン', true], ['HOTEL', false], ['24H', false], ['sudo', false],
      ['KERNEL', false], ['ネオン', true], ['CACHE', false], ['OPEN', false], ['カラオケ', true], ['ARCH', false]],
    ads: ['NEON COLA', 'DOWNLOAD MORE RAM', 'sudo make me a sandwich', 'rm -rf /sadness', 'SPONSORED BY /dev/null', 'I USE ARCH BTW'],
    shades: [['#170b30', '#07030f'], ['#120a2a', '#06040d'], ['#1a0c26', '#080310'], ['#0f0f2a', '#05050e']],
    sky: { cool: ['#04010d', '#150533', '#4a1266', '#8a2a8a'], hot: ['#0f0008', '#33051a', '#9a1a2a', '#ff4a24'] },
    haze: ['rgba(255,60,200,0.28)', 'rgba(255,90,40,0.35)'],
    halo: ['rgba(255,170,240,0.3)', 'rgba(255,140,120,0.35)'],
    brokenMoon: false,
    far: [{ color: '#1d0a3a', dot: '#ff9ad5' }, { color: '#130726', dot: '#7fe8ff' }],
    farHaze: ['rgba(120,40,160,0)', 'rgba(160,50,170,0.35)'],
    unlit: '#1a1133', street: ['#12071f', '#040108'], streetLine: '#ff2bd6',
    read: '#00e5ff', write: '#ff2bd6',
    flyers: ['#00e5ff', '#ff2bd6', '#ffe600', '#b36bff', '#ffffff'],
    flicker: ['#ffffff', '#8ff3ff', '#ff8ad8', '#ffe600'],
    rain: 'rgba(160,225,255,0.32)',
    pulse: '124,255,79', pulseHex: '#7cff4f',
    beams: ['120,220,255', '180,120,255'],
    bar: (i) => `hsl(${(300 - i * 9 + t * 25) % 360},100%,60%)`,
    frame: '#ff2bd6', boardText: '#ffffff', boardGlow: '#ff2bd6',
    signFont: '700 {px}px "Noto Sans CJK JP", "Noto Sans JP", "DejaVu Sans", sans-serif',
    boardFont: '700 {px}px "JetBrains Mono", "DejaVu Sans Mono", monospace',
    mono: '"JetBrains Mono", "DejaVu Sans Mono", monospace',
    hud: 'rgba(180,245,255,0.75)', hudGlow: '#00e5ff',
    scanlines: true, grain: false,
  },
  // Homage to the Cowboy Bebop look: Mars dusk, amber and teal, jazz-poster serifs,
  // Hong Kong street signs and the shattered moon.
  bebop: {
    neon: ['#ff4a3d', '#ffb347', '#3fd0c9', '#f4e3c1', '#e8742f', '#ff6f61'],
    win: ['#ffcf7a', '#ffb45c', '#ffe2a8', '#f7a24b', '#ffd88f', '#ffc46b', '#bfe8dc'],
    signs: [['酒', true], ['麻雀', true], ['拉麵', true], ['飯店', true], ['當鋪', true], ['BAR', false],
      ['JAZZ', false], ['LOANS', false], ['BOUNTY', false], ['HOTEL', false], ['LIVE MUSIC', false]],
    ads: ['BIG SHOT', 'WANTED  ₩ 30,000,000', "3, 2, 1  LET'S JAM", 'SEE YOU SPACE COWBOY...', 'MARS CASINO', 'LOANS  NO QUESTIONS ASKED'],
    shades: [['#1e2428', '#0a0d0f'], ['#261d19', '#0c0908'], ['#17242a', '#070b0d'], ['#2a221c', '#0d0a08']],
    sky: { cool: ['#03090d', '#0d232b', '#6e3a22', '#d9803f'], hot: ['#0c0504', '#2e110c', '#a02f1a', '#ff6a2a'] },
    haze: ['rgba(255,150,70,0.28)', 'rgba(255,90,40,0.35)'],
    halo: ['rgba(255,220,170,0.22)', 'rgba(255,150,110,0.3)'],
    brokenMoon: true,
    far: [{ color: '#23302f', dot: '#ffb45c' }, { color: '#162022', dot: '#3fd0c9' }],
    farHaze: ['rgba(200,110,60,0)', 'rgba(210,120,60,0.35)'],
    unlit: '#1c1a18', street: ['#1a1410', '#060403'], streetLine: '#ffb347',
    read: '#3fd0c9', write: '#ffb347',
    flyers: ['#3fd0c9', '#ffb347', '#ff4a3d', '#f4e3c1'],
    flicker: ['#ffffff', '#ffe2a8', '#3fd0c9', '#ffb347'],
    rain: 'rgba(230,205,170,0.26)',
    pulse: '255,74,61', pulseHex: '#ff4a3d',
    beams: ['255,220,160', '160,230,220'],
    bar: (i) => `hsl(${24 + i * 1.6},95%,${46 + i}%)`,
    frame: '#ffb347', boardText: '#fff3dc', boardGlow: '#ff4a3d',
    signFont: '700 {px}px "C059", "Noto Serif CJK HK", "DejaVu Serif", serif',
    boardFont: 'italic 700 {px}px "C059", "DejaVu Serif", serif',
    mono: '"Nimbus Mono PS", "Liberation Mono", monospace',
    hud: 'rgba(255,228,190,0.8)', hudGlow: '#ff8a3d',
    scanlines: false, grain: true,
  },
};
const TH = Object.hasOwn(THEMES, params.get('theme') || '') ? THEMES[params.get('theme')] : THEMES.bebop;
const NEON = TH.neon, WIN = TH.win, SIGN_WORDS = TH.signs, ADS = TH.ads;
function font(tpl, px) { return tpl.replace('{px}', Math.round(px)); }
let moonShape = null, grainFrames = [];

// ---------------------------------------------------------------- utils

function rand(a, b) { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, k) {
  const A = hexRgb(a), B = hexRgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`;
}

function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w * DPR));
  cv.height = Math.max(1, Math.ceil(h * DPR));
  const c = cv.getContext('2d');
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  return { cv, c, w, h };
}

const glowSprites = {};
function glowSprite(color) {
  if (!glowSprites[color]) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color + 'ff');
    g.addColorStop(0.2, color + '99');
    g.addColorStop(0.5, color + '26');
    g.addColorStop(1, color + '00');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    glowSprites[color] = cv;
  }
  return glowSprites[color];
}
// Expects globalCompositeOperation 'lighter' for a neon look.
function glow(x, y, r, color, a) {
  ctx.globalAlpha = clamp(a, 0, 1);
  ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

function fmtRate(b) {
  if (b < 1024) return `${Math.round(b)} B/s`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB/s`;
  return `${(b / 1048576).toFixed(1)} MB/s`;
}

// ---------------------------------------------------------------- metrics

const raw = { cpu: 0, ram: 0, gpu: 0, temp: 45, diskRead: 0, diskWrite: 0, netDown: 0, netUp: 0 };
const sm = { ...raw };
const L = { cpu: 0, ram: 0, gpu: 0, heat: 0, read: 0, write: 0, down: 0, up: 0 };
let gotMetrics = false;

window.cityMetrics = (o) => {
  if (!o) return;
  // A missing sensor arrives as null; keep the previous value instead of reading it as 0.
  for (const k in o) if (k in raw && typeof o[k] === 'number' && Number.isFinite(o[k])) raw[k] = o[k];
  gotMetrics = true;
};

function isDemo() { return FORCE_DEMO || (!gotMetrics && t > 3); }

function demoMetrics() {
  const w = (period, phase) => 0.5 + 0.5 * Math.sin(t / period * Math.PI * 2 + phase);
  raw.cpu = 100 * Math.pow(w(23, 0), 1.6);
  raw.ram = 25 + 72 * w(41, 1);
  raw.gpu = 100 * Math.pow(w(17, 2), 2);
  raw.temp = 38 + 52 * w(53, 3);
  raw.diskRead = Math.pow(10, 3 + 5.6 * Math.pow(w(13, 4), 2));
  raw.diskWrite = Math.pow(10, 3 + 5.6 * Math.pow(w(19, 5), 2));
  raw.netDown = Math.pow(10, 3 + 5 * Math.pow(w(29, 6), 1.5));
  raw.netUp = Math.pow(10, 3 + 5 * Math.pow(w(11, 0.5), 2));
}

// Log scale so an idle trickle stays near zero and a saturated link reaches 1.
function rateLevel(bps, base, full) {
  return clamp(Math.log1p(Math.max(0, bps) / base) / Math.log1p(full / base), 0, 1);
}

function updateLevels(dt) {
  if (isDemo()) demoMetrics();
  const k = 1 - Math.exp(-dt * 2.5);
  for (const key in raw) sm[key] += (raw[key] - sm[key]) * k;
  L.cpu = clamp(sm.cpu / 100, 0, 1);
  L.ram = clamp(sm.ram / 100, 0, 1);
  L.gpu = clamp(sm.gpu / 100, 0, 1);
  L.heat = clamp((sm.temp - 40) / 45, 0, 1);
  L.read = rateLevel(sm.diskRead, 262144, 400e6);
  L.write = rateLevel(sm.diskWrite, 262144, 400e6);
  L.down = rateLevel(sm.netDown, 65536, 100e6);
  L.up = rateLevel(sm.netUp, 65536, 50e6);
}

// ---------------------------------------------------------------- city layout

function makeBuilding(x, w, h, opts = {}) {
  const top = GROUND - h;
  const style = opts.style || (Math.random() < 0.22 ? 'bands' : 'grid');
  const b = {
    x, w, h, top, style,
    roof: opts.roof || pick(['flat', 'flat', 'step', 'spire', 'antenna']),
    shade: pick(TH.shades),
    rim: pick(NEON),
    dark: false, restore: 1,
  };
  if (style === 'grid') {
    b.cx = 13 * S; b.cy = 17 * S; b.ww = 7 * S; b.wh = 9 * S;
  } else {
    b.cx = w; b.cy = 11 * S; b.ww = w - 16 * S; b.wh = 3 * S;
  }
  b.cols = Math.max(1, Math.floor((w - 10 * S) / b.cx));
  b.rows = Math.max(0, Math.floor((h - 24 * S) / b.cy));
  b.px = (w - (b.cols - 1) * b.cx - b.ww) / 2;
  b.py = 16 * S;
  const n = b.cols * b.rows;
  b.th = new Float32Array(n);
  b.wc = new Uint8Array(n);
  // Neighbouring windows share a bias so lights come on in clusters, like floors of offices.
  for (let r = 0; r < b.rows; r++) {
    const floorBias = rand(-0.25, 0.25);
    for (let c = 0; c < b.cols; c++) {
      const i = r * b.cols + c;
      b.th[i] = clamp(Math.random() * 0.8 + 0.1 + floorBias, 0, 0.999);
      b.wc[i] = Math.floor(Math.random() * WIN.length);
    }
  }
  if (b.roof === 'antenna') b.tip = { x: x + w / 2, y: top - 60 * S };
  if (b.roof === 'spire') b.tip = { x: x + w / 2, y: top - w * 0.9 };
  if (b.roof === 'mast') b.tip = { x: x + w / 2, y: top - 150 * S };
  return b;
}

function windowRect(b, i) {
  const r = Math.floor(i / b.cols), c = i % b.cols;
  return [b.x + b.px + c * b.cx, b.top + b.py + r * b.cy, b.ww, b.wh];
}

function nearest(target) {
  let best = 0, bd = Infinity;
  buildings.forEach((b, i) => {
    const d = Math.abs(b.x + b.w / 2 - target);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function genCity() {
  buildings = [];
  let x = -30 * S;
  while (x < W + 30 * S) {
    const w = rand(70, 165) * S;
    const tall = Math.random() < 0.2;
    const h = (tall ? rand(0.52, 0.74) : rand(0.22, 0.5)) * GROUND;
    buildings.push(makeBuilding(x, w, h));
    x += w + rand(2, 22) * S;
  }

  const ti = nearest(W * 0.27);
  const tb = buildings[ti];
  buildings[ti] = makeBuilding(tb.x, Math.max(tb.w, 90 * S), GROUND * 0.68, { roof: 'mast', style: 'grid' });
  tower = buildings[ti];

  let bi = nearest(W * 0.64);
  if (bi === ti) bi = Math.min(buildings.length - 1, ti + 1);
  const bb = buildings[bi];
  buildings[bi] = makeBuilding(bb.x - 20 * S, 210 * S, GROUND * 0.5, { roof: 'flat', style: 'grid' });
  const hb = buildings[bi];
  board = { x: hb.x + 14 * S, y: hb.top + 26 * S, w: hb.w - 28 * S, h: 84 * S };

  // Neon signs on a handful of facades, never on the tower or the billboard building.
  signs = [];
  const candidates = buildings.filter(b => b !== tower && b !== hb && b.h > 180 * S && b.w > 80 * S);
  candidates.sort(() => Math.random() - 0.5);
  for (const b of candidates.slice(0, 7)) {
    const [word, vertical] = pick(SIGN_WORDS);
    const color = pick(NEON);
    const sp = makeSign(word, color, vertical);
    const sx = vertical ? b.x + b.w - sp.w * 0.55 : b.x + (b.w - sp.w) / 2;
    const sy = vertical ? b.top + rand(20, 60) * S : b.top + rand(24, 70) * S;
    signs.push({ sp, x: sx, y: sy, color, flickUntil: 0, nextFlick: rand(2, 20) });
  }

  // Blinking aviation lights on every tip.
  lights = buildings.filter(b => b.tip).map(b => ({ x: b.tip.x, y: b.tip.y, phase: rand(0, 2) }));

  stars = [];
  for (let i = 0; i < 160; i++) {
    const sx = rand(0, W), sy = rand(0, GROUND * 0.65);
    // Keep stars off the shattered moon and its debris trail, which sit in the sky cache below them.
    if (TH.brokenMoon && Math.hypot(sx - (W * 0.78 - 110 * S), sy - (H * 0.17 + 70 * S)) < 230 * S) continue;
    stars.push({ x: sx, y: sy, r: rand(0.5, 1.6) * S, p: rand(0, 6.28), s: rand(0.5, 2.5) });
  }

  lanes = [
    { y: H * 0.36, dir: 1, sc: 0.55, back: true, acc: 0 },
    { y: H * 0.45, dir: -1, sc: 0.6, back: true, acc: 0 },
    { y: H * 0.22, dir: -1, sc: 0.8, back: false, acc: 0 },
    { y: H * 0.56, dir: 1, sc: 1, back: false, acc: 0 },
  ];
  streetLanes = [
    { y: GROUND + (H - GROUND) * 0.3, dir: 1, acc: 0 },
    { y: GROUND + (H - GROUND) * 0.55, dir: -1, acc: 0 },
  ];
}

function makeSign(text, color, vertical) {
  const fs = Math.round(22 * S);
  const signFont = font(TH.signFont, fs);
  const pad = 12 * S;
  ctx.font = signFont;
  const chars = [...text];
  const w = vertical ? fs + pad * 2 : ctx.measureText(text).width + pad * 2;
  const h = vertical ? chars.length * fs * 1.1 + pad * 2 : fs + pad * 2;
  const s = makeCanvas(w + 20 * S, h + 20 * S);
  const c = s.c;
  c.translate(10 * S, 10 * S);
  c.fillStyle = 'rgba(8,3,18,0.9)';
  c.beginPath(); c.roundRect(2 * S, 2 * S, w - 4 * S, h - 4 * S, 4 * S); c.fill();
  c.strokeStyle = color; c.lineWidth = 1.5 * S; c.shadowColor = color; c.shadowBlur = 10 * S;
  c.stroke();
  c.font = signFont; c.textAlign = 'center'; c.textBaseline = 'middle';
  const put = (fill, blur) => {
    c.fillStyle = fill; c.shadowBlur = blur;
    if (vertical) chars.forEach((ch, i) => c.fillText(ch, w / 2, pad + fs * 1.1 * (i + 0.5)));
    else c.fillText(text, w / 2, h / 2 + 1);
  };
  put(color, 18 * S); put(color, 8 * S); put('rgba(255,255,255,0.6)', 0);
  return { cv: s.cv, w: w + 20 * S, h: h + 20 * S, off: 10 * S };
}

// ---------------------------------------------------------------- static layers

function renderSky() {
  const c = skyCache.c, heat = L.heat;
  const g = c.createLinearGradient(0, 0, 0, GROUND);
  [0, 0.5, 0.85, 1].forEach((stop, i) => g.addColorStop(stop, mix(TH.sky.cool[i], TH.sky.hot[i], heat)));
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  const haze = c.createRadialGradient(W * 0.5, GROUND, 0, W * 0.5, GROUND, W * 0.6);
  haze.addColorStop(0, TH.haze[heat > 0.5 ? 1 : 0]);
  haze.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = haze;
  c.fillRect(0, 0, W, H);

  if (TH.brokenMoon) { drawBrokenMoon(c, W * 0.78, H * 0.17, 64 * S, heat); skyHeat = heat; return; }
  const mx = W * 0.82, my = H * 0.13, mr = 36 * S;
  const halo = c.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 5);
  halo.addColorStop(0, TH.halo[heat > 0.6 ? 1 : 0]);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = halo;
  c.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
  const disk = c.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, 0, mx, my, mr);
  disk.addColorStop(0, '#fff6fb');
  disk.addColorStop(1, heat > 0.6 ? '#ffb0a0' : '#f3c6ff');
  c.fillStyle = disk;
  c.beginPath(); c.arc(mx, my, mr, 0, Math.PI * 2); c.fill();
  skyHeat = heat;
}

function renderFar() {
  const c = farCache.c;
  c.clearRect(0, 0, W, H);
  const layers = [
    { ...TH.far[0], hMin: 0.18, hMax: 0.46, wMin: 40, wMax: 110 },
    { ...TH.far[1], hMin: 0.12, hMax: 0.36, wMin: 50, wMax: 130 },
  ];
  for (const l of layers) {
    let x = -20 * S;
    while (x < W) {
      const w = rand(l.wMin, l.wMax) * S, h = rand(l.hMin, l.hMax) * GROUND;
      c.fillStyle = l.color;
      c.fillRect(x, GROUND - h, w, h);
      if (Math.random() < 0.25) c.fillRect(x + w / 2 - 1 * S, GROUND - h - 30 * S, 2 * S, 30 * S);
      c.fillStyle = l.dot;
      for (let i = 0; i < w * h / (900 * S * S); i++) {
        if (Math.random() < 0.5) continue;
        c.globalAlpha = rand(0.15, 0.5);
        c.fillRect(x + rand(4 * S, w - 6 * S), GROUND - h + rand(8 * S, h), 2 * S, 2 * S);
      }
      c.globalAlpha = 1;
      x += w + rand(-10, 8) * S;
    }
  }
  // Atmospheric haze toward the horizon.
  c.globalCompositeOperation = 'source-atop';
  const g = c.createLinearGradient(0, GROUND * 0.4, 0, GROUND);
  g.addColorStop(0, TH.farHaze[0]);
  g.addColorStop(1, TH.farHaze[1]);
  c.fillStyle = g;
  c.fillRect(0, 0, W, GROUND);
  c.globalCompositeOperation = 'source-over';
}

function drawBuilding(c, b, lit) {
  const g = c.createLinearGradient(0, b.top, 0, GROUND);
  g.addColorStop(0, b.shade[0]);
  g.addColorStop(1, b.shade[1]);
  c.fillStyle = g;
  c.fillRect(b.x, b.top, b.w, GROUND - b.top);

  c.fillStyle = b.shade[0];
  if (b.roof === 'step') {
    c.fillRect(b.x + b.w * 0.18, b.top - b.w * 0.16, b.w * 0.64, b.w * 0.16);
    c.fillRect(b.x + b.w * 0.36, b.top - b.w * 0.28, b.w * 0.28, b.w * 0.12);
  } else if (b.roof === 'spire') {
    c.beginPath();
    c.moveTo(b.x + b.w * 0.3, b.top); c.lineTo(b.x + b.w / 2, b.tip.y); c.lineTo(b.x + b.w * 0.7, b.top);
    c.fill();
  } else if (b.roof === 'antenna' || b.roof === 'mast') {
    // Masts are lighter than the facade so they read against the night sky.
    c.fillStyle = '#34264f';
    c.fillRect(b.tip.x - 1.5 * S, b.tip.y, 3 * S, b.top - b.tip.y);
    if (b.roof === 'mast') {
      c.fillRect(b.x + b.w * 0.25, b.top - 18 * S, b.w * 0.5, 18 * S);
      c.fillStyle = TH.pulseHex;
      c.globalAlpha = 0.5;
      for (let k = 1; k < 5; k++) c.fillRect(b.tip.x - (5 - k) * 3 * S, b.tip.y + k * 26 * S, (5 - k) * 6 * S, 1.5 * S);
      c.globalAlpha = 1;
    }
  } else {
    c.fillRect(b.x + b.w * 0.15, b.top - 8 * S, 16 * S, 8 * S);
    c.fillRect(b.x + b.w * 0.6, b.top - 12 * S, 22 * S, 12 * S);
  }

  c.fillStyle = b.rim;
  c.globalAlpha = 0.45;
  c.fillRect(b.x, b.top, b.w, 1.5 * S);
  c.fillRect(b.x + b.w - 1.5 * S, b.top, 1.5 * S, GROUND - b.top);
  c.globalAlpha = 1;

  const restore = b.dark ? b.restore : 1;
  for (let i = 0; i < b.th.length; i++) {
    const [x, y, w, h] = windowRect(b, i);
    const on = b.th[i] < lit && b.th[i] < restore;
    if (on) {
      c.fillStyle = WIN[b.wc[i]];
      c.globalAlpha = 0.18;
      c.fillRect(x - 2 * S, y - 2 * S, w + 4 * S, h + 4 * S);
      c.globalAlpha = 0.95;
      c.fillRect(x, y, w, h);
      c.globalAlpha = 1;
    } else {
      c.fillStyle = TH.unlit;
      c.fillRect(x, y, w, h);
    }
  }
}

function renderCity() {
  const c = cityCache.c;
  c.clearRect(0, 0, W, H);
  const lit = 0.05 + 0.92 * L.ram;
  for (const b of buildings) drawBuilding(c, b, lit);
  cityLit = lit;
  cityRenderedAt = t;
}

function renderFront() {
  const c = frontCache.c;
  c.clearRect(0, 0, W, H);

  // Street with wet reflections of the skyline's neon.
  const g = c.createLinearGradient(0, GROUND, 0, H);
  g.addColorStop(0, TH.street[0]);
  g.addColorStop(1, TH.street[1]);
  c.fillStyle = g;
  c.fillRect(0, GROUND, W, H - GROUND);
  for (const b of buildings) {
    if (Math.random() < 0.5) continue;
    const rg = c.createLinearGradient(0, GROUND, 0, H);
    rg.addColorStop(0, b.rim + '40');
    rg.addColorStop(1, b.rim + '00');
    c.fillStyle = rg;
    c.fillRect(b.x + b.w * 0.3, GROUND, b.w * 0.25, H - GROUND);
  }
  c.fillStyle = TH.streetLine;
  c.globalAlpha = 0.5;
  c.fillRect(0, GROUND, W, 1.5 * S);
  c.globalAlpha = 0.25;
  c.fillStyle = '#ffe9a0';
  const my = GROUND + (H - GROUND) * 0.43;
  for (let x = 0; x < W; x += 60 * S) c.fillRect(x, my, 30 * S, 2 * S);
  c.globalAlpha = 1;

  // Elevated track: back deck carries writes, front deck carries reads.
  c.fillStyle = '#0a0616';
  for (let x = 40 * S; x < W; x += 180 * S) c.fillRect(x, TRACK_Y, 10 * S, GROUND - TRACK_Y);
  c.fillRect(0, TRACK_Y, W, 6 * S);
  c.fillRect(0, TRACK_Y + 22 * S, W, 8 * S);
  c.globalAlpha = 0.6;
  c.fillStyle = TH.write; c.fillRect(0, TRACK_Y + 6 * S, W, 1 * S);
  c.fillStyle = TH.read; c.fillRect(0, TRACK_Y + 30 * S, W, 1 * S);
  c.globalAlpha = 1;
}

function renderOverlay() {
  const c = overlayCache.c;
  c.clearRect(0, 0, W, H);
  const v = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
  if (TH.scanlines) {
    c.fillStyle = 'rgba(0,0,0,0.07)';
    for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
  }
  if (TH.grain) {
    // A few frames of film grain at half resolution, cycled at draw time.
    grainFrames = [];
    const gw = Math.ceil(W / 2), gh = Math.ceil(H / 2);
    for (let f = 0; f < 3; f++) {
      const cv = document.createElement('canvas');
      cv.width = gw; cv.height = gh;
      const g = cv.getContext('2d');
      const img = g.createImageData(gw, gh);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = v; img.data[i + 1] = v * 0.92; img.data[i + 2] = v * 0.8; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      grainFrames.push(cv);
    }
    c.fillStyle = 'rgba(255,160,80,0.035)';
    c.fillRect(0, 0, W, H);
  }
}

function genMoon() {
  const rocks = [], dust = [], craters = [], bite = [];
  const ba = Math.PI * 0.8;
  for (let i = 0; i < 18; i++) {
    const a = ba + (i / 18) * Math.PI * 2;
    bite.push([Math.cos(ba) + Math.cos(a) * 0.55 * rand(0.8, 1.15), Math.sin(ba) + Math.sin(a) * 0.55 * rand(0.8, 1.15)]);
  }
  for (let i = 0; i < 24; i++) {
    const k = i / 24;
    rocks.push({ d: 1.1 + k * 2.8 + rand(-0.15, 0.15), a: ba + rand(-0.22, 0.22) + k * 0.12, r: rand(0.04, 0.17) * (1 - k * 0.6), sides: randi(5, 8), rot: rand(0, 6.28) });
  }
  for (let i = 0; i < 320; i++) dust.push({ th: rand(0, Math.PI * 2), rr: rand(1.5, 3.4), s: rand(0.6, 1.8), a: rand(0.15, 0.6) });
  for (let i = 0; i < 7; i++) craters.push({ x: rand(-0.5, 0.6), y: rand(-0.6, 0.3), r: rand(0.06, 0.18) });
  return { rocks, dust, craters, bite };
}

function drawRock(c, x, y, r, sides, rot) {
  c.beginPath();
  for (let k = 0; k < sides; k++) {
    const a = rot + (k / sides) * Math.PI * 2, rr = r * (0.7 + 0.3 * Math.abs(Math.sin(k * 2.3 + rot)));
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    k ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.closePath();
  c.fill();
}

function drawBrokenMoon(c, mx, my, mr, heat) {
  const ms = moonShape;
  const halo = c.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 4.5);
  halo.addColorStop(0, TH.halo[heat > 0.6 ? 1 : 0]);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = halo;
  c.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);

  // Dust ring behind and around the moon, tilted like a belt of debris.
  const tilt = -0.32, ct = Math.cos(tilt), st = Math.sin(tilt);
  for (const d of ms.dust) {
    const ex = Math.cos(d.th) * d.rr * mr, ey = Math.sin(d.th) * d.rr * mr * 0.2;
    c.fillStyle = `rgba(240,220,190,${d.a})`;
    c.fillRect(mx + ex * ct - ey * st, my + ex * st + ey * ct, d.s * S, d.s * S);
  }

  const o = mr * 1.3, m = makeCanvas(o * 2, o * 2), mc = m.c;
  const disk = mc.createRadialGradient(o - mr * 0.35, o - mr * 0.35, 0, o, o, mr);
  disk.addColorStop(0, '#fbf0da');
  disk.addColorStop(1, heat > 0.6 ? '#d49a78' : '#bfa582');
  mc.fillStyle = disk;
  mc.beginPath(); mc.arc(o, o, mr, 0, Math.PI * 2); mc.fill();
  mc.fillStyle = 'rgba(120,95,70,0.22)';
  for (const cr of ms.craters) { mc.beginPath(); mc.arc(o + cr.x * mr, o + cr.y * mr, cr.r * mr, 0, Math.PI * 2); mc.fill(); }
  mc.globalCompositeOperation = 'destination-out';
  mc.beginPath();
  ms.bite.forEach(([bx, by], i) => (i ? mc.lineTo(o + bx * mr, o + by * mr) : mc.moveTo(o + bx * mr, o + by * mr)));
  mc.closePath(); mc.fill();
  mc.globalCompositeOperation = 'source-over';
  c.drawImage(m.cv, mx - o, my - o, o * 2, o * 2);

  // The broken-off chunks trail away from the bite.
  for (const r of ms.rocks) {
    const x = mx + Math.cos(r.a) * r.d * mr, y = my + Math.sin(r.a) * r.d * mr;
    c.fillStyle = '#b39c7c';
    drawRock(c, x, y, r.r * mr, r.sides, r.rot);
    c.fillStyle = 'rgba(255,240,215,0.35)';
    drawRock(c, x - r.r * mr * 0.15, y - r.r * mr * 0.15, r.r * mr * 0.6, r.sides, r.rot);
  }
}

// ---------------------------------------------------------------- moving things

function drawFlyer(x, y, dir, sc, color, v) {
  const len = Math.min(260 * S, v * 0.35) * sc;
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(x, 0, x - dir * len, 0);
  g.addColorStop(0, 'rgba(255,60,100,0.55)');
  g.addColorStop(1, 'rgba(255,60,100,0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 2 * S * sc;
  ctx.beginPath(); ctx.moveTo(x - dir * 10 * S * sc, y); ctx.lineTo(x - dir * len, y); ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';

  ctx.fillStyle = '#0b0718';
  ctx.beginPath(); ctx.roundRect(x - 12 * S * sc, y - 5 * S * sc, 24 * S * sc, 8 * S * sc, 3 * S * sc); ctx.fill();
  ctx.fillStyle = 'rgba(140,220,255,0.7)';
  ctx.fillRect(x + dir * 2 * S * sc - 4 * S * sc, y - 8 * S * sc, 8 * S * sc, 3 * S * sc);
  ctx.fillStyle = color;
  ctx.fillRect(x - 10 * S * sc, y + 3 * S * sc, 20 * S * sc, 1.5 * S * sc);

  ctx.globalCompositeOperation = 'lighter';
  glow(x + dir * 12 * S * sc, y - 1 * S * sc, 14 * S * sc, '#fff6d0', 0.9);
  glow(x - dir * 12 * S * sc, y - 1 * S * sc, 9 * S * sc, '#ff2040', 0.9);
  glow(x, y + 5 * S * sc, 18 * S * sc, color, 0.45);
  ctx.globalCompositeOperation = 'source-over';
}

function stepTraffic(dt) {
  for (const lane of lanes) {
    lane.acc += dt * (0.08 + L.cpu * 2.4) * (lane.back ? 0.8 : 1);
    while (lane.acc >= 1) {
      lane.acc -= 1;
      const v = (110 + L.cpu * 480) * S * lane.sc * rand(0.8, 1.25);
      flyers.push({
        lane, x: lane.dir > 0 ? -40 * S : W + 40 * S, y: lane.y + rand(-10, 10) * S,
        dir: lane.dir, v, color: pick(TH.flyers), bob: rand(0, 6),
      });
    }
  }
  for (const f of flyers) f.x += f.dir * f.v * dt;
  flyers = flyers.filter(f => f.x > -300 * S && f.x < W + 300 * S);

  for (const lane of streetLanes) {
    lane.acc += dt * (0.15 + L.cpu * 2.8);
    while (lane.acc >= 1) {
      lane.acc -= 1;
      cars.push({ lane, x: lane.dir > 0 ? -60 * S : W + 60 * S, dir: lane.dir, v: (160 + L.cpu * 520) * S * rand(0.85, 1.2), color: pick(NEON) });
    }
  }
  for (const c of cars) c.x += c.dir * c.v * dt;
  cars = cars.filter(c => c.x > -200 * S && c.x < W + 200 * S);
}

function drawFlyers(back) {
  for (const f of flyers) {
    if (f.lane.back !== back) continue;
    drawFlyer(f.x, f.y + Math.sin(t * 2 + f.bob) * 3 * S, f.dir, f.lane.sc, f.color, f.v);
  }
}

function drawCars() {
  for (const c of cars) {
    const y = c.lane.y, d = c.dir;
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(c.x + d * 16 * S, 0, c.x + d * 120 * S, 0);
    beam.addColorStop(0, 'rgba(255,240,190,0.28)');
    beam.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(c.x + d * 16 * S, y - 3 * S);
    ctx.lineTo(c.x + d * 120 * S, y - 14 * S);
    ctx.lineTo(c.x + d * 120 * S, y + 8 * S);
    ctx.lineTo(c.x + d * 16 * S, y + 1 * S);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0c0818';
    ctx.fillRect(c.x - 18 * S, y - 6 * S, 36 * S, 9 * S);
    ctx.fillRect(c.x - 9 * S, y - 11 * S, 18 * S, 5 * S);
    ctx.fillStyle = c.color;
    ctx.fillRect(c.x - 18 * S, y + 3 * S, 36 * S, 1.2 * S);
    ctx.globalCompositeOperation = 'lighter';
    glow(c.x + d * 17 * S, y - 2 * S, 10 * S, '#fff2c0', 0.9);
    glow(c.x - d * 17 * S, y - 2 * S, 8 * S, '#ff2040', 0.8);
    ctx.globalCompositeOperation = 'source-over';
  }
}

const TRAIN_CAR = 80, TRAIN_GAP = 5;

function stepTrains(dt) {
  const decks = [
    { lvl: L.read, dir: 1, y: TRACK_Y + 22 * S, color: TH.read, key: 'read' },
    { lvl: L.write, dir: -1, y: TRACK_Y, color: TH.write, key: 'write' },
  ];
  stepTrains.acc = stepTrains.acc || { read: 0, write: 0 };
  for (const d of decks) {
    if (d.lvl < 0.12) { stepTrains.acc[d.key] = Math.min(stepTrains.acc[d.key], 0.5); continue; }
    stepTrains.acc[d.key] += dt * d.lvl * 1.1;
    // Wait until the previous train on this deck has fully entered the screen.
    const clear = !trains.some(tr => tr.dir === d.dir && (d.dir > 0 ? trainRear(tr) < 120 * S : trainRear(tr) > W - 120 * S));
    if (stepTrains.acc[d.key] >= 1 && clear) {
      stepTrains.acc[d.key] = 0;
      const nCars = 2 + Math.round(d.lvl * 6);
      trains.push({ x: d.dir > 0 ? -10 * S : W + 10 * S, y: d.y, dir: d.dir, v: (380 + d.lvl * 900) * S, cars: nCars, color: d.color });
    }
  }
  for (const tr of trains) tr.x += tr.dir * tr.v * dt;
  trains = trains.filter(tr => (tr.dir > 0 ? trainRear(tr) < W + 50 * S : trainRear(tr) > -50 * S));
}

function trainRear(tr) { return tr.x - tr.dir * tr.cars * (TRAIN_CAR + TRAIN_GAP) * S; }

function drawTrains() {
  const cl = TRAIN_CAR * S, ch = 16 * S, gap = TRAIN_GAP * S;
  for (const tr of trains) {
    for (let i = 0; i < tr.cars; i++) {
      const front = tr.x - tr.dir * i * (cl + gap);
      const left = tr.dir > 0 ? front - cl : front;
      ctx.fillStyle = '#0d0a1d';
      ctx.beginPath(); ctx.roundRect(left, tr.y - ch, cl, ch, i === 0 ? 5 * S : 1 * S); ctx.fill();
      ctx.fillStyle = tr.color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(left + 4 * S, tr.y - ch * 0.66, cl - 8 * S, ch * 0.3);
      ctx.globalAlpha = 1;
      ctx.fillRect(left, tr.y - 1.5 * S, cl, 1.5 * S);
    }
    ctx.globalCompositeOperation = 'lighter';
    glow(tr.x, tr.y - 8 * S, 26 * S, '#ffffff', 0.8);
    const len = tr.cars * (cl + gap);
    const g = ctx.createLinearGradient(tr.x, 0, tr.x - tr.dir * len, 0);
    g.addColorStop(0, tr.color + '55');
    g.addColorStop(1, tr.color + '00');
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(tr.x, tr.x - tr.dir * len), tr.y, len, 12 * S);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function stepRain(dt) {
  const target = Math.round(Math.pow(L.down, 1.3) * 900 * (W * H) / (1920 * 1080));
  // Ramp up gradually so a download spike turns into a shower, not a wall.
  for (let i = Math.min(target - drops.length, 40); i > 0; i--) {
    drops.push({ x: rand(-100 * S, W + 100 * S), y: rand(-H * 0.4, 0), v: rand(900, 1400) * S, len: rand(10, 26) * S });
  }
  for (const d of drops) { d.y += d.v * dt; d.x -= d.v * 0.12 * dt; }
  const keep = [];
  for (const d of drops) {
    if (d.y < H) keep.push(d);
    else if (keep.length + 1 <= target) { d.y = rand(-60 * S, 0); d.x = rand(-100 * S, W + 100 * S); keep.push(d); }
  }
  drops = keep;
}

function drawRain() {
  if (!drops.length) return;
  ctx.strokeStyle = TH.rain;
  ctx.lineWidth = 1 * S;
  ctx.beginPath();
  for (const d of drops) { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.len * 0.12, d.y - d.len); }
  ctx.stroke();
  if (L.down > 0.4) {
    ctx.fillStyle = `rgba(120,160,220,${(L.down - 0.4) * 0.12})`;
    ctx.fillRect(0, GROUND - 80 * S, W, H - GROUND + 80 * S);
  }
}

function stepPulses(dt) {
  if (!tower) return;
  stepPulses.acc = (stepPulses.acc || 0) + dt * (L.up > 0.06 ? L.up * 7 : 0);
  while (stepPulses.acc >= 1) {
    stepPulses.acc -= 1;
    pulses.push({ y: tower.tip.y, r: 3 * S, a: 1 });
  }
  for (const p of pulses) { p.y -= (180 + L.up * 300) * S * dt; p.r += 26 * S * dt; p.a = clamp(p.y / tower.tip.y, 0, 1); }
  pulses = pulses.filter(p => p.y > -20 * S && p.a > 0.02);
}

function drawPulses() {
  if (!tower) return;
  const x = tower.tip.x;
  ctx.globalCompositeOperation = 'lighter';
  if (L.up > 0.35) {
    const g = ctx.createLinearGradient(0, tower.tip.y, 0, 0);
    g.addColorStop(0, `rgba(${TH.pulse},${(L.up - 0.35) * 0.8})`);
    g.addColorStop(1, `rgba(${TH.pulse},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - 2 * S, 0, 4 * S, tower.tip.y);
  }
  for (const p of pulses) {
    ctx.strokeStyle = `rgba(${TH.pulse},${p.a * 0.8})`;
    ctx.lineWidth = 1.5 * S;
    ctx.beginPath(); ctx.ellipse(x, p.y, p.r, p.r * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
    glow(x, p.y, 8 * S, TH.pulseHex, p.a);
  }
  glow(x, tower.tip.y, 16 * S + L.up * 20 * S, TH.pulseHex, 0.4 + L.up * 0.6);
  ctx.globalCompositeOperation = 'source-over';
}

function drawSearchlights() {
  const srcs = buildings.filter(b => b.h > GROUND * 0.5 && b !== tower).slice(0, 3);
  // GPU load only changes brightness; the sweep stays slow and steady so it never pulls the eye.
  const alpha = 0.03 + lightLevel * 0.12;
  ctx.globalCompositeOperation = 'lighter';
  srcs.forEach((b, i) => {
    const sx = b.x + b.w / 2, sy = b.top - 4 * S;
    const ang = -Math.PI / 2 + Math.sin(lightPhase + i * 2.1) * 0.4;
    const len = H * 1.1, spread = 0.07;
    const ex1 = sx + Math.cos(ang - spread) * len, ey1 = sy + Math.sin(ang - spread) * len;
    const ex2 = sx + Math.cos(ang + spread) * len, ey2 = sy + Math.sin(ang + spread) * len;
    const g = ctx.createLinearGradient(sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
    const col = TH.beams[i % 2];
    g.addColorStop(0, `rgba(${col},${alpha})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex1, ey1); ctx.lineTo(ex2, ey2); ctx.fill();
  });
  ctx.globalCompositeOperation = 'source-over';
}

function stepFlicker(dt) {
  stepFlicker.acc = (stepFlicker.acc || 0) + dt * (1 + L.cpu * L.cpu * 60);
  while (stepFlicker.acc >= 1) {
    stepFlicker.acc -= 1;
    const b = pick(buildings);
    if (!b.th.length || b.dark) continue;
    const i = Math.floor(Math.random() * b.th.length);
    flickers.push({ rect: windowRect(b, i), until: t + rand(0.06, 0.35), color: pick(TH.flicker) });
  }
  flickers = flickers.filter(f => f.until > t);
}

function drawFlicker() {
  for (const f of flickers) {
    ctx.fillStyle = f.color;
    ctx.fillRect(...f.rect);
  }
}

function drawSigns() {
  // Normal blending so the dark plate hides the windows behind it and the lettering reads cleanly.
  for (const s of signs) {
    if (t > s.nextFlick) {
      s.flickUntil = t + rand(0.05, 0.6);
      s.nextFlick = t + rand(2, 20) * (1 - 0.85 * L.cpu);
    }
    const a = t < s.flickUntil ? (Math.random() < 0.5 ? 0.08 : 0.5) : 0.92 + Math.sin(t * 7 + s.x) * 0.05;
    ctx.globalAlpha = a;
    ctx.drawImage(s.sp.cv, s.x - s.sp.off, s.y - s.sp.off, s.sp.w, s.sp.h);
  }
  ctx.globalAlpha = 1;
}

function drawLights() {
  const siren = L.cpu > 0.9;
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const on = ((t + l.phase) % 1.6) < 0.25;
    if (siren) glow(l.x, l.y, 26 * S, Math.floor(t * 4 + l.phase * 3) % 2 ? '#2a6bff' : '#ff2030', 0.95);
    else if (on) glow(l.x, l.y, 14 * S, '#ff2030', 0.95);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawStars() {
  ctx.fillStyle = '#ffffff';
  for (const s of stars) {
    ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;
}

function drawBoard() {
  if (!board) return;
  const { x, y, w, h } = board;
  ctx.fillStyle = '#06020e';
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const n = 18, bw = w / n;
  for (let i = 0; i < n; i++) {
    const lvl = clamp(L.gpu * (0.55 + 0.45 * Math.sin(t * (2.5 + i * 0.6) + i * 1.7)) + Math.random() * 0.04, 0.03, 1);
    const bh = lvl * h * 0.55;
    ctx.fillStyle = TH.bar(i);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x + i * bw + 1 * S, y + h - bh, bw - 2 * S, bh);
  }
  ctx.globalAlpha = 1;

  let text = ADS[Math.floor(t / 9) % ADS.length], color = TH.boardText, shadow = TH.boardGlow;
  if (L.cpu > 0.9) { text = 'CPU OVERLOAD'; color = '#ffdddd'; shadow = '#ff2030'; }
  else if (sm.temp > 85) { text = 'HEAT WARNING'; color = '#ffe0c0'; shadow = '#ff6a00'; }
  else if (L.ram > 0.9) { text = 'MEMORY FULL'; color = '#e8fbff'; shadow = '#00e5ff'; }
  const alarm = text !== ADS[Math.floor(t / 9) % ADS.length];
  if (!alarm || Math.floor(t * 3) % 2) {
    // Shrink long lines to fit the screen; if even the smallest size overflows, scroll it.
    const room = w - 16 * S;
    let px = 17 * S;
    ctx.font = font(TH.boardFont, px);
    let tw = ctx.measureText(text).width;
    if (tw > room) { px = Math.max(11 * S, px * room / tw); ctx.font = font(TH.boardFont, px); tw = ctx.measureText(text).width; }
    ctx.textBaseline = 'middle';
    ctx.shadowColor = shadow; ctx.shadowBlur = 14 * S;
    ctx.fillStyle = color;
    if (tw <= room) {
      ctx.textAlign = 'center';
      ctx.fillText(text, x + w / 2, y + h * 0.28);
    } else {
      const loop = tw + 60 * S, off = (t * 60 * S) % loop;
      ctx.textAlign = 'left';
      ctx.fillText(text, x + 8 * S - off, y + h * 0.28);
      ctx.fillText(text, x + 8 * S - off + loop, y + h * 0.28);
    }
    ctx.shadowBlur = 0;
  }
  ctx.restore();
  ctx.strokeStyle = TH.frame;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2 * S;
  ctx.strokeRect(x, y, w, h);
  ctx.globalAlpha = 1;
}

function drawSirenWash() {
  if (L.cpu <= 0.9) return;
  const k = (L.cpu - 0.9) * 10;
  ctx.fillStyle = Math.floor(t * 4) % 2 ? `rgba(40,80,255,${0.07 * k})` : `rgba(255,30,50,${0.07 * k})`;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- random events

const EVENTS = {
  1: startChase, 2: startMeteor, 3: startFireworks, 4: startLightning,
  5: startBlackout, 6: startBlimp, 7: startUfo, 8: startGlitch,
};

function fireEvent(fn) {
  const e = fn();
  if (e.skip) return;
  events.push(e);
}

// Event windows run on a monotonic clock, not on animation time, so a throttled page keeps
// its 30-minute windows. The clock does not advance during system suspend.
function clock() { return performance.now() / 1000; }

function planEventWindow() {
  const start = Math.max(clock(), eventWindowEnd);
  eventWindowEnd = start + EVENT_WINDOW;
  eventQueue = Array.from({ length: randi(0, 2) }, () => rand(start, eventWindowEnd)).sort((a, b) => a - b);
}

function stepEvents(dt) {
  // Each branch dequeues before firing so a failing event cannot retry on every frame.
  if (FORCE_DEMO) {
    if (t >= nextEventAt) {
      nextEventAt = t + rand(30, 90);
      fireEvent(pick(Object.values(EVENTS)));
    }
  } else {
    // Drain before replanning so an event due right at the window edge is not dropped.
    while (eventQueue.length && clock() >= eventQueue[0]) {
      eventQueue.shift();
      fireEvent(pick(Object.values(EVENTS)));
    }
    if (clock() >= eventWindowEnd) planEventWindow();
  }
  events = events.filter(e => e.update(dt));
}

function drawEvents(layer) {
  for (const e of events) if (e.layer === layer) e.draw();
}

function startChase() {
  const dir = Math.random() < 0.5 ? 1 : -1;
  const y = H * 0.3, v = 950 * S;
  let x = dir > 0 ? -80 * S : W + 80 * S;
  const units = [{ off: 0, cop: false }, { off: 170 * S, cop: true }, { off: 320 * S, cop: true }];
  return {
    label: 'POLICE CHASE', layer: 'front',
    update(dt) { x += dir * v * dt; return dir > 0 ? x - 400 * S < W + 100 * S : x + 400 * S > -100 * S; },
    draw() {
      for (const u of units) {
        const ux = x - dir * u.off, uy = y + Math.sin(t * 5 + u.off) * 8 * S;
        drawFlyer(ux, uy, dir, 1, u.cop ? '#ffffff' : '#ffe600', v);
        if (u.cop) {
          ctx.globalCompositeOperation = 'lighter';
          const blue = Math.floor(t * 9) % 2;
          glow(ux - dir * 3 * S, uy - 9 * S, 34 * S, blue ? '#2a6bff' : '#ff2030', 0.95);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    },
  };
}

function startMeteor() {
  let x = rand(0.35, 1.05) * W, y = -30 * S, age = 0;
  const vx = -rand(700, 1000) * S, vy = rand(260, 420) * S;
  return {
    label: 'METEOR', layer: 'sky',
    update(dt) { age += dt; x += vx * dt; y += vy * dt; return x > -300 * S && y < GROUND * 0.7; },
    draw() {
      ctx.globalCompositeOperation = 'lighter';
      const tx = x - vx * 0.35, ty = y - vy * 0.35;
      const g = ctx.createLinearGradient(x, y, tx, ty);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.3, 'rgba(255,160,80,0.6)');
      g.addColorStop(1, 'rgba(255,60,140,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 3 * S;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
      glow(x, y, 26 * S, '#ffd0a0', 1);
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

function startFireworks() {
  const shells = [], parts = [];
  let time = 0;
  for (let i = randi(6, 10); i > 0; i--) {
    shells.push({ at: rand(0, 5), x: rand(0.1, 0.9) * W, ty: rand(0.08, 0.32) * H, y: GROUND, state: 0, color: pick(NEON) });
  }
  return {
    label: 'FIREWORKS', layer: 'sky',
    update(dt) {
      time += dt;
      for (const s of shells) {
        if (s.state === 0 && time >= s.at) s.state = 1;
        if (s.state === 1) {
          s.y -= 950 * S * dt;
          if (s.y <= s.ty) {
            s.state = 2;
            for (let k = 0; k < 80; k++) {
              const a = rand(0, Math.PI * 2), sp = rand(40, 260) * S;
              parts.push({ x: s.x, y: s.ty, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(1.2, 2.2), age: 0, color: s.color });
            }
          }
        }
      }
      for (const p of parts) {
        p.age += dt; p.vy += 80 * S * dt; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].age > parts[i].life) parts.splice(i, 1);
      return time < 5.5 || parts.length > 0 || shells.some(s => s.state < 2);
    },
    draw() {
      ctx.globalCompositeOperation = 'lighter';
      for (const s of shells) if (s.state === 1) glow(s.x, s.y, 8 * S, '#ffe9b0', 0.9);
      for (const p of parts) {
        const a = 1 - p.age / p.life;
        glow(p.x, p.y, 6 * S, p.color, a);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = a * 0.8;
        ctx.fillRect(p.x, p.y, 1.5 * S, 1.5 * S);
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

function startLightning() {
  const tall = [...buildings].sort((a, b) => a.top - b.top).slice(0, 5);
  const tb = pick(tall);
  const ex = tb.tip ? tb.tip.x : tb.x + tb.w / 2, ey = tb.tip ? tb.tip.y : tb.top;
  const pts = [];
  const sx = ex + rand(-220, 220) * S, n = 16;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const jitter = i === 0 || i === n ? 0 : rand(-40, 40) * S * (1 - k * 0.6);
    pts.push([sx + (ex - sx) * k + jitter, ey * k]);
  }
  let time = 0;
  return {
    label: 'LIGHTNING', layer: 'front',
    update(dt) { time += dt; return time < 0.9; },
    draw() {
      const flash = time < 0.08 || (time > 0.18 && time < 0.27);
      const a = flash ? 1 : Math.max(0, 0.5 - time);
      if (a <= 0) return;
      ctx.globalCompositeOperation = 'lighter';
      if (flash) { ctx.fillStyle = 'rgba(190,180,255,0.22)'; ctx.fillRect(0, 0, W, H); }
      ctx.lineJoin = 'round';
      for (const [lw, col] of [[10 * S, `rgba(160,120,255,${a * 0.35})`], [3 * S, `rgba(255,255,255,${a})`]]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw;
        ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
      }
      glow(ex, ey, 60 * S, '#d8c8ff', a);
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

function startBlackout() {
  const pool = buildings.filter(b => b.th.length > 40 && !b.dark);
  if (!pool.length) return { skip: true };
  const victims = [pick(pool)];
  const i = buildings.indexOf(victims[0]);
  if (buildings[i + 1] && Math.random() < 0.6) victims.push(buildings[i + 1]);
  let time = 0;
  for (const b of victims) { b.dark = true; b.restore = 0; }
  cityLit = -1;
  return {
    label: 'BLACKOUT', layer: 'none',
    update(dt) {
      time += dt;
      const r = clamp((time - 3) / 7, 0, 1);
      for (const b of victims) b.restore = r;
      if (r >= 1) { for (const b of victims) b.dark = false; cityLit = -1; return false; }
      return true;
    },
    draw() {},
  };
}

function startBlimp() {
  const dir = Math.random() < 0.5 ? 1 : -1;
  const rx = 120 * S, ry = 32 * S, y = H * 0.1;
  let x = dir > 0 ? -rx * 1.5 : W + rx * 1.5;
  const text = '  ' + pick(ADS) + '  ·  ' + pick(ADS) + '  ·  ';
  return {
    label: 'BLIMP', layer: 'sky',
    update(dt) { x += dir * 55 * S * dt; return dir > 0 ? x < W + rx * 1.6 : x > -rx * 1.6; },
    draw() {
      const g = ctx.createLinearGradient(0, y - ry, 0, y + ry);
      g.addColorStop(0, '#3a2d52'); g.addColorStop(1, '#120b1f');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#120b1f';
      ctx.beginPath();
      ctx.moveTo(x - dir * rx * 0.85, y); ctx.lineTo(x - dir * rx * 1.15, y - ry * 0.9); ctx.lineTo(x - dir * rx * 1.15, y + ry * 0.9);
      ctx.fill();
      ctx.fillRect(x - 22 * S, y + ry - 4 * S, 44 * S, 12 * S);
      const sw = rx * 1.2, sh = 20 * S, sx = x - sw / 2, sy = y - sh / 2;
      ctx.fillStyle = '#050208';
      ctx.fillRect(sx, sy, sw, sh);
      ctx.save();
      ctx.beginPath(); ctx.rect(sx, sy, sw, sh); ctx.clip();
      ctx.font = `700 ${Math.round(14 * S)}px ${TH.mono}`;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const tw = ctx.measureText(text).width;
      const off = (t * 70 * S) % tw;
      ctx.fillStyle = '#ffe600'; ctx.shadowColor = '#ff9900'; ctx.shadowBlur = 8 * S;
      ctx.fillText(text + text, sx - off, y + 1);
      ctx.restore();
      ctx.globalCompositeOperation = 'lighter';
      if (Math.floor(t * 1.5) % 2) glow(x - dir * rx * 1.1, y - ry * 0.8, 12 * S, '#ff2030', 0.9);
      glow(x + dir * rx, y, 10 * S, '#7cff4f', 0.7);
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

function startUfo() {
  const target = pick(buildings.filter(b => b.top < GROUND * 0.65 && b.x > 0 && b.x < W - 100 * S)) || pick(buildings);
  const hx = target.x + target.w / 2, hy = Math.max(60 * S, target.top - 140 * S);
  let x = Math.random() < 0.5 ? -100 * S : W + 100 * S, y = hy - 80 * S, phase = 0, time = 0;
  return {
    label: 'UFO', layer: 'front',
    update(dt) {
      time += dt;
      if (phase === 0) {
        const k = Math.min(1, dt * 1.6);
        x += (hx - x) * k; y += (hy - y) * k;
        if (Math.abs(hx - x) < 4 * S) { phase = 1; time = 0; }
      } else if (phase === 1) {
        if (time > 6) { phase = 2; time = 0; }
      } else {
        y -= 1100 * S * dt; x += 250 * S * dt;
        if (y < -120 * S) return false;
      }
      return true;
    },
    draw() {
      const yy = y + Math.sin(t * 2) * 5 * S;
      ctx.globalCompositeOperation = 'lighter';
      if (phase === 1) {
        const a = Math.min(1, time * 2) * (0.55 + 0.15 * Math.sin(t * 20));
        const g = ctx.createLinearGradient(0, yy, 0, target.top);
        g.addColorStop(0, `rgba(124,255,79,${a * 0.5})`);
        g.addColorStop(1, `rgba(124,255,79,${a * 0.08})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - 18 * S, yy + 6 * S); ctx.lineTo(x + 18 * S, yy + 6 * S);
        ctx.lineTo(x + target.w * 0.45, target.top); ctx.lineTo(x - target.w * 0.45, target.top);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(150,240,255,0.5)';
      ctx.beginPath(); ctx.ellipse(x, yy - 8 * S, 16 * S, 12 * S, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#2a2440';
      ctx.beginPath(); ctx.ellipse(x, yy, 46 * S, 11 * S, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 7; k++) {
        const a = t * 3 + k * 0.9;
        const lx = x + Math.cos(a) * 38 * S;
        if (Math.sin(a) < 0) continue;
        glow(lx, yy + 2 * S, 7 * S, NEON[k % NEON.length], 0.95);
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

function startGlitch() {
  let time = 0;
  return {
    label: 'GLITCH', layer: 'post',
    update(dt) { time += dt; return time < 0.5; },
    draw() {
      for (let i = 0; i < 8; i++) {
        const sy = rand(0, H), sh = rand(4, 46) * S, dx = rand(-50, 50) * S;
        ctx.drawImage(canvas, 0, sy * DPR, canvas.width, sh * DPR, dx, sy, W, sh);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18;
      ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, rand(4, 10) * S, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

// ---------------------------------------------------------------- HUD

function drawHud() {
  if (!SHOW_HUD) return;
  const fs = Math.round(13 * S);
  ctx.font = `600 ${fs}px ${TH.mono}`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  const x = W - 26 * S;
  let y = 24 * S;
  const lines = [
    `CPU ${Math.round(sm.cpu)}%  RAM ${Math.round(sm.ram)}%  GPU ${Math.round(sm.gpu)}%  ${Math.round(sm.temp)}°C`,
    `DISK  R ${fmtRate(sm.diskRead)}  W ${fmtRate(sm.diskWrite)}`,
    `NET  ↓ ${fmtRate(sm.netDown)}  ↑ ${fmtRate(sm.netUp)}`,
  ];
  if (isDemo()) lines.unshift('DEMO DATA');
  ctx.shadowColor = TH.hudGlow; ctx.shadowBlur = 8 * S;
  ctx.fillStyle = TH.hud;
  for (const l of lines) { ctx.fillText(l, x, y); y += fs * 1.5; }
  ctx.shadowBlur = 0;
}

// ---------------------------------------------------------------- main loop

let built = false;

function build() {
  W = window.innerWidth; H = window.innerHeight;
  // The view can be zero-sized before Plasma lays it out; wait for the resize.
  built = W >= 2 && H >= 2;
  if (!built) return;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  S = H / 1080;
  GROUND = H * 0.86;
  TRACK_Y = H * 0.69;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  skyCache = makeCanvas(W, H);
  farCache = makeCanvas(W, H);
  cityCache = makeCanvas(W, H);
  frontCache = makeCanvas(W, H);
  overlayCache = makeCanvas(W, H);
  flyers = []; cars = []; trains = []; drops = []; pulses = []; flickers = []; events = [];
  if (TH.brokenMoon) moonShape = genMoon();
  genCity();
  renderSky(); renderFar(); renderCity(); renderFront(); renderOverlay();
}

function step(dt) {
  t += dt;
  updateLevels(dt);
  stepTraffic(dt);
  stepTrains(dt);
  stepRain(dt);
  stepPulses(dt);
  stepFlicker(dt);
  stepEvents(dt);
  // Integrate the sweep phase instead of computing sin(t * speed): with a large t,
  // any change in speed would make the beams jump.
  lightPhase += dt * 0.08;
  lightLevel += (L.gpu - lightLevel) * (1 - Math.exp(-dt * 0.4));
  if (Math.abs(L.heat - skyHeat) > 0.03) renderSky();
  const lit = 0.05 + 0.92 * L.ram;
  const blackout = buildings.some(b => b.dark);
  if ((Math.abs(lit - cityLit) > 0.006 || blackout) && t - cityRenderedAt > 0.25) renderCity();
}

function draw() {
  ctx.drawImage(skyCache.cv, 0, 0, W, H);
  drawStars();
  drawSearchlights();
  drawEvents('sky');
  ctx.drawImage(farCache.cv, 0, 0, W, H);
  drawFlyers(true);
  ctx.drawImage(cityCache.cv, 0, 0, W, H);
  drawFlicker();
  drawSigns();
  drawBoard();
  drawLights();
  drawPulses();
  ctx.drawImage(frontCache.cv, 0, 0, W, H);
  drawTrains();
  drawCars();
  drawFlyers(false);
  drawEvents('front');
  drawRain();
  drawSirenWash();
  drawEvents('post');
  ctx.drawImage(overlayCache.cv, 0, 0, W, H);
  if (grainFrames.length) {
    // Overlay blending keeps mid-grey noise neutral, so grain adds texture without fogging the blacks.
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.16;
    ctx.drawImage(grainFrames[Math.floor(t * 12) % grainFrames.length], 0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  drawHud();
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = now - last;
  if (elapsed < 1000 / FPS - 2) return;
  last = now;
  if (!built) return;
  // One bad frame must not stop a wallpaper that runs for days.
  try {
    step(Math.min(0.1, elapsed / 1000));
    draw();
  } catch (err) {
    console.error(err);
  }
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(build, 200);
});
window.addEventListener('keydown', (e) => { if (EVENTS[e.key]) fireEvent(EVENTS[e.key]); });

requestAnimationFrame(frame);
build();
