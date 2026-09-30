/* ============================================================
   NEON RUSH v2 — endless runner for PixelArena
   Mini-boss every 100m · weather system · anime hero
   Vanilla Canvas 2D · fixed timestep · pooled particles
   ============================================================ */
(() => {
'use strict';

/* ---------------- Config ---------------- */
const W = 480, H = 720;
const GROUND_Y = H - 96;
const GRAV = 2800;
const JUMP_V = 980;
const MAX_FALL = 1600;
const START_SPEED = 340, MAX_SPEED = 730;
const BOSS_EVERY_M = 100;   // mini-boss every 100 m
const METER_PX = 0.02;      // px travelled -> meters

/* ---------------- Weather ---------------- */
const WEATHERS = [
  { id: 'night', name: '🌙 NIGHT MODE',
    sky: ['#040110', '#150538', '#3a0a52', '#0a0424'],
    ground: '#070213', line: '#00f0ff',
    grid: 'rgba(0,240,255,.22)', grid2: 'rgba(255,43,214,.14)',
    far: '#150a33', mid: '#0e0626', near: '#090418',
    winFar: 'rgba(123,43,255,.5)', winMid: 'rgba(0,240,255,.4)', winNear: 'rgba(255,43,214,.35)',
    stars: true, moon: true, sun: false, precip: null },
  { id: 'summer', name: '☀ SUMMER DAY',
    sky: ['#2f9dff', '#6fc4ff', '#c9ecff', '#ffedb0'],
    ground: '#0a1c30', line: '#00e5ff',
    grid: 'rgba(0,140,220,.28)', grid2: 'rgba(255,255,255,.14)',
    far: '#2a4f7c', mid: '#1c3a5f', near: '#12294a',
    winFar: 'rgba(255,255,255,.55)', winMid: 'rgba(190,245,255,.5)', winNear: 'rgba(255,255,255,.42)',
    stars: false, moon: false, sun: true, precip: null },
  { id: 'rain', name: '🌧 RAINY STORM',
    sky: ['#0b1220', '#16233a', '#26364f', '#101827'],
    ground: '#090e17', line: '#4dd2ff',
    grid: 'rgba(77,210,255,.20)', grid2: 'rgba(150,180,220,.10)',
    far: '#1e2a3f', mid: '#16202f', near: '#0e1622',
    winFar: 'rgba(140,190,255,.35)', winMid: 'rgba(120,200,255,.30)', winNear: 'rgba(150,210,255,.25)',
    stars: false, moon: false, sun: false, precip: 'rain' },
  { id: 'snow', name: '❄ SNOWFALL',
    sky: ['#6f9cc8', '#a4c6e6', '#d9ecff', '#f5fbff'],
    ground: '#c9dcee', line: '#00c8ff',
    grid: 'rgba(0,150,220,.25)', grid2: 'rgba(255,255,255,.35)',
    far: '#8fb4d9', mid: '#6f9cc8', near: '#4f7cae',
    winFar: 'rgba(255,255,255,.6)', winMid: 'rgba(230,245,255,.55)', winNear: 'rgba(255,255,255,.5)',
    stars: false, moon: false, sun: false, precip: 'snow' },
];
const WEATHER_TIME = 24; // seconds per weather

/* ---------------- Canvas ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

/* ---------------- Utils ---------------- */
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
function circleRect(cx, cy, cr, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw), ny = clamp(cy, ry, ry + rh);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < cr * cr;
}

/* ---------------- Audio (procedural, no assets) ---------------- */
const AudioSys = {
  ctx: null, muted: false,
  init() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  beep(freq, dur, type, vol, slideTo) {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
      g.gain.setValueAtTime(vol || 0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  },
  jump()  { this.beep(280, 0.14, 'square', 0.08, 640); },
  coin()  { this.beep(950, 0.07, 'sine', 0.1, 1400); },
  die()   { this.beep(200, 0.4, 'sawtooth', 0.14, 40); },
  punch() { this.beep(170, 0.09, 'square', 0.12, 70); },
  kick()  { this.beep(120, 0.13, 'sawtooth', 0.13, 45); },
  hit()   { this.beep(320, 0.08, 'sawtooth', 0.1, 140); },
  hurt()  { this.beep(240, 0.2, 'sawtooth', 0.14, 70); },
  bossDie(){ this.beep(90, 0.7, 'sawtooth', 0.16, 30); },
  warn()  { this.beep(440, 0.12, 'square', 0.12); setTimeout(() => this.beep(440, 0.12, 'square', 0.12), 180); },
  toggle() { this.muted = !this.muted; return this.muted; }
};

/* ---------------- Storage ---------------- */
const store = {
  get best() {
    try { return parseInt(localStorage.getItem('neonRushBest') || '0', 10) || 0; }
    catch (e) { return 0; }
  },
  set best(v) {
    try { localStorage.setItem('neonRushBest', String(v)); } catch (e) {}
  }
};

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id);
const stage = $('stage'), scoreEl = $('score'), bestEl = $('best'), distEl = $('distLine');
const titleOverlay = $('titleOverlay'), overOverlay = $('overOverlay'), pauseOverlay = $('pauseOverlay');
const titleBest = $('titleBest'), finalScore = $('finalScore'), overBest = $('overBest');
const newBestBadge = $('newBest'), shareBtn = $('shareBtn');
const muteBtn = $('muteBtn'), pauseBtn = $('pauseBtn');
const bossControls = $('bossControls');

/* ---------------- Game state ---------------- */
const BOSS_NAMES = ['ONI', 'YOKAI', 'AKUMA', 'KAIJU'];
const G = {
  mode: 'title',          // title | playing | boss | dying | over
  paused: false,
  t: 0, timeScale: 1, dieT: 0, shake: 0, flash: 0,
  speed: START_SPEED, score: 0, coins: 0,
  dist: 0, nextBoss: BOSS_EVERY_M, bossNum: 0,
  newBest: false,
  player: null,
  obstacles: [], coinList: [], parts: [], precip: [],
  shots: [], bossShots: [], floaters: [],
  spawnT: 1, trailT: 0, precipT: 0,
  bgX: 0,
  weatherIdx: 0, weatherT: WEATHER_TIME,
  banner: null,
  boss: null, hearts: 3,
  punchCd: 0, kickCd: 0, invulnT: 0,
};
function resetGame() {
  G.t = 0; G.timeScale = 1; G.dieT = 0; G.shake = 0; G.flash = 0;
  G.speed = START_SPEED; G.score = 0; G.coins = 0;
  G.dist = 0; G.nextBoss = BOSS_EVERY_M; G.bossNum = 0; G.newBest = false;
  G.player = { x: 150, y: GROUND_Y, vy: 0, jumps: 0, onGround: true, runPhase: 0, pose: 'run', poseT: 0 };
  G.obstacles.length = 0; G.coinList.length = 0; G.parts.length = 0;
  G.precip.length = 0; G.shots.length = 0; G.bossShots.length = 0; G.floaters.length = 0;
  G.spawnT = 1.0; G.trailT = 0; G.precipT = 0; G.paused = false;
  G.weatherIdx = 0; G.weatherT = WEATHER_TIME;
  G.banner = null; G.boss = null; G.hearts = 3;
  G.punchCd = 0; G.kickCd = 0; G.invulnT = 0;
  pauseOverlay.classList.add('hidden');
  bossControls.classList.add('hidden');
}
resetGame();

/* ---------------- Banner ---------------- */
function showBanner(text, sub, dur) {
  G.banner = { text, sub: sub || '', t: dur || 2, dur: dur || 2 };
}

/* ---------------- Input ---------------- */
function startGame() {
  resetGame();
  G.mode = 'playing';
  titleOverlay.classList.add('hidden');
  overOverlay.classList.add('hidden');
  if (typeof gtag === 'function') gtag('event', 'game_start', { game_name: 'neon_rush' });
}
function doJump() {
  AudioSys.init();
  if (G.mode === 'title') { startGame(); return; }
  if ((G.mode !== 'playing' && G.mode !== 'boss') || G.paused) return;
  const p = G.player;
  if (p.onGround || p.jumps < 2) {
    p.vy = -JUMP_V; p.onGround = false; p.jumps++;
    spawnDust(p.x, p.y, 8, '#00f0ff');
    AudioSys.jump();
  }
}
function cutJump() {
  const p = G.player;
  if ((G.mode === 'playing' || G.mode === 'boss') && !p.onGround && p.vy < -JUMP_V * 0.45)
    p.vy = -JUMP_V * 0.45;
}
function setPose(pose, dur) {
  G.player.pose = pose;
  G.player.poseT = dur;
}
function doPunch() {
  AudioSys.init();
  if (G.mode !== 'boss' || G.paused || G.punchCd > 0 || !G.boss || G.boss.state === 'dying') return;
  G.punchCd = 0.32;
  setPose('punch', 0.22);
  const p = G.player;
  G.shots.push({ kind: 'punch', x: p.x + 26, y: p.y - 52, vx: 720, dmg: 1, r: 14 });
  AudioSys.punch();
}
function doKick() {
  AudioSys.init();
  if (G.mode !== 'boss' || G.paused || G.kickCd > 0 || !G.boss || G.boss.state === 'dying') return;
  G.kickCd = 0.65;
  setPose('kick', 0.3);
  const p = G.player;
  G.shots.push({ kind: 'kick', x: p.x + 26, y: p.y - 46, vx: 540, dmg: 2, r: 20 });
  AudioSys.kick();
}
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || e.target.closest('a')) return;
  e.preventDefault();
  doJump();
});
window.addEventListener('pointerup', cutJump);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!e.repeat) doJump();
  } else if (e.code === 'KeyJ') { if (!e.repeat) doPunch(); }
  else if (e.code === 'KeyK') { if (!e.repeat) doKick(); }
  else if (e.code === 'KeyP') togglePause();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') cutJump();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (G.mode === 'playing' || G.mode === 'boss') && !G.paused) togglePause();
});
// boss buttons (pointerdown = faster than click on mobile)
$('punchBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); doPunch(); });
$('kickBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); doKick(); });
$('jumpBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); doJump(); });

function togglePause() {
  if (G.mode !== 'playing' && G.mode !== 'boss') return;
  G.paused = !G.paused;
  pauseOverlay.classList.toggle('hidden', !G.paused);
  pauseBtn.textContent = G.paused ? '▶' : '⏸';
}
pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); AudioSys.init(); togglePause(); });
muteBtn.addEventListener('click', (e) => {
  e.stopPropagation(); AudioSys.init();
  muteBtn.textContent = AudioSys.toggle() ? '🔇' : '🔊';
});
$('resumeBtn').addEventListener('click', (e) => { e.stopPropagation(); togglePause(); });
$('retryBtn').addEventListener('click', (e) => { e.stopPropagation(); startGame(); });

/* ---------------- Particles (pooled) ---------------- */
function addPart(x, y, vx, vy, life, size, color, grav) {
  if (G.parts.length > 260) G.parts.shift();
  G.parts.push({ x, y, vx, vy, life, maxLife: life, size, color, grav: grav || 0 });
}
function spawnDust(x, y, n, color) {
  for (let i = 0; i < n; i++)
    addPart(x + rand(-10, 10), y - rand(0, 6), rand(-140, 60), rand(-160, -20), rand(0.25, 0.55), rand(2, 5), color, 500);
}
function spawnSparkle(x, y) {
  for (let i = 0; i < 10; i++) {
    const a = rand(0, Math.PI * 2), s = rand(60, 260);
    addPart(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.3, 0.6), rand(2, 4), '#ffd23f', 300);
  }
}
function explode(x, y) {
  for (let i = 0; i < 34; i++) {
    const a = rand(0, Math.PI * 2), s = rand(80, 520);
    addPart(x, y, Math.cos(a) * s, Math.sin(a) * s - 120, rand(0.4, 0.9), rand(2, 6),
      Math.random() < 0.5 ? '#00f0ff' : '#ff2bd6', 700);
  }
}
function bossExplode(x, y) {
  for (let i = 0; i < 70; i++) {
    const a = rand(0, Math.PI * 2), s = rand(60, 620);
    addPart(x + rand(-40, 40), y + rand(-50, 30), Math.cos(a) * s, Math.sin(a) * s - 160,
      rand(0.5, 1.1), rand(2, 7), pick(['#ff2bd6', '#ffd23f', '#ff6b35', '#ffffff']), 650);
  }
}
function updateParts(dt) {
  const ps = G.parts;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) { ps.splice(i, 1); continue; }
    p.vy += p.grav * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
}
function addFloater(x, y, txt, color) {
  if (G.floaters.length > 12) G.floaters.shift();
  G.floaters.push({ x, y, txt, color: color || '#ffffff', t: 0.9 });
}
function updateFloaters(dt) {
  for (let i = G.floaters.length - 1; i >= 0; i--) {
    const f = G.floaters[i];
    f.t -= dt; f.y -= 46 * dt;
    if (f.t <= 0) G.floaters.splice(i, 1);
  }
}

/* ---------------- Weather precipitation ---------------- */
function updatePrecip(dt) {
  const wth = WEATHERS[G.weatherIdx];
  G.precipT -= dt;
  if (wth.precip && G.precipT <= 0) {
    G.precipT = wth.precip === 'rain' ? 0.012 : 0.05;
    if (G.precip.length < 220) {
      if (wth.precip === 'rain')
        G.precip.push({ kind: 'rain', x: rand(-20, W + 40), y: -20, vx: -160, vy: rand(750, 1050), len: rand(12, 22) });
      else
        G.precip.push({ kind: 'snow', x: rand(0, W), y: -10, vx: rand(-30, 30), vy: rand(55, 130), r: rand(1.6, 3.6), ph: rand(0, 6.28) });
    }
  }
  for (let i = G.precip.length - 1; i >= 0; i--) {
    const q = G.precip[i];
    q.x += (q.vx + (q.kind === 'snow' ? Math.sin(G.t * 2 + q.ph) * 30 : 0)) * dt;
    q.y += q.vy * dt;
    if (q.y > H + 20 || q.x < -40) G.precip.splice(i, 1);
  }
  // occasional lightning in rain
  if (wth.id === 'rain' && Math.random() < dt * 0.35) {
    G.flash = 0.14;
    AudioSys.beep(90, 0.25, 'sawtooth', 0.06, 40);
  }
  G.flash = Math.max(0, G.flash - dt);
}
function cycleWeather(dt) {
  G.weatherT -= dt;
  if (G.weatherT <= 0) {
    G.weatherIdx = (G.weatherIdx + 1) % WEATHERS.length;
    G.weatherT = WEATHER_TIME;
    G.precip.length = 0;
    showBanner(WEATHERS[G.weatherIdx].name, WEATHERS[G.weatherIdx].id === 'summer' ? 'stay cool, runner' : '', 1.8);
  }
}

/* ---------------- Spawners ---------------- */
// Obstacles: chomper (monster), crate (box), wisp (flying ghost)
function spawnObstacle() {
  const r = Math.random(), x = W + 50;
  if (r < 0.42) {
    // chomper monster — single or pair, jump over it
    const n = Math.random() < 0.35 ? 2 : 1;
    for (let i = 0; i < n; i++)
      G.obstacles.push({ type: 'chomp', x: x + i * 54, w: 42, h: 50, ph: rand(0, 6.28),
        body: pick(['#7CFC00', '#b366ff', '#ff6b6b', '#4dd2ff']) });
  } else if (r < 0.70) {
    // wooden/metal crate — tall, needs a full jump
    const tall = Math.random() < 0.4;
    G.obstacles.push({ type: 'crate', x, w: tall ? 46 : 66, h: tall ? 80 : 54 });
  } else if (r < 0.90) {
    // wisp — flying ghost, punishes mistimed jumps
    G.obstacles.push({ type: 'wisp', x, w: 46, h: 36, baseY: GROUND_Y - rand(150, 215), ph: rand(0, 6.28) });
  } else {
    // wide chomper
    G.obstacles.push({ type: 'chomp', x, w: 66, h: 54, ph: rand(0, 6.28), body: pick(['#7CFC00', '#b366ff', '#ff6b6b']) });
  }
}
function spawnCoins() {
  const n = 5, y = GROUND_Y - rand(100, 230), x0 = W + 60;
  for (let i = 0; i < n; i++)
    G.coinList.push({ x: x0 + i * 38, y: y - Math.sin((i / (n - 1)) * Math.PI) * 46, r: 11, ph: rand(0, 6.28) });
}

/* ---------------- Boss fight ---------------- */
function startBoss() {
  G.bossNum++;
  G.mode = 'boss';
  // clear the field for a fair fight
  for (const o of G.obstacles) spawnDust(o.x, GROUND_Y - 20, 4, '#ff2bd6');
  G.obstacles.length = 0; G.coinList.length = 0; G.bossShots.length = 0;
  const n = G.bossNum;
  const maxHp = 12 + 6 * (n - 1);
  G.boss = {
    name: BOSS_NAMES[(n - 1) % BOSS_NAMES.length] + ' · LV' + n,
    x: W + 90, tx: 348,
    hp: maxHp, maxHp,
    state: 'enter', t: 0, atkT: 1.6, flash: 0,
    atkKind: 'fire',
  };
  G.hearts = 3;
  G.invulnT = 0;
  bossControls.classList.remove('hidden');
  showBanner('⚠ MINI-BOSS ⚠', G.boss.name + ' approaches!', 2.2);
  AudioSys.warn();
  G.nextBoss += BOSS_EVERY_M;
}
function bossAttackInterval() {
  const b = G.boss;
  const enraged = b.hp < b.maxHp * 0.3;
  return Math.max(0.85, (2.0 - 0.14 * (G.bossNum - 1)) * (enraged ? 0.62 : 1));
}
function bossStrike() {
  const b = G.boss, n = G.bossNum;
  const spd = 300 + 45 * n;
  if (b.atkKind === 'fire') {
    G.bossShots.push({ kind: 'fire', x: b.x - 52, y: GROUND_Y - 74, vx: -spd, r: 14 });
    AudioSys.beep(200, 0.18, 'sawtooth', 0.1, 90);
  } else if (b.atkKind === 'shock') {
    G.bossShots.push({ kind: 'shock', x: b.x - 60, y: GROUND_Y, vx: -(spd * 0.85), w: 30, h: 32 });
    AudioSys.beep(140, 0.2, 'sawtooth', 0.12, 60);
  } else { // slam — double trouble
    G.bossShots.push({ kind: 'fire', x: b.x - 52, y: GROUND_Y - 74, vx: -spd, r: 14 });
    G.bossShots.push({ kind: 'shock', x: b.x - 60, y: GROUND_Y, vx: -(spd * 0.8), w: 30, h: 32, delay: 0.35 });
    AudioSys.beep(110, 0.3, 'sawtooth', 0.14, 40);
  }
}
function hurtPlayer() {
  if (G.invulnT > 0 || G.mode !== 'boss') return;
  G.hearts--;
  G.invulnT = 1.2;
  setPose('hurt', 0.4);
  G.shake = 10;
  const p = G.player;
  explode(p.x, p.y - 40);
  AudioSys.hurt();
  addFloater(p.x, p.y - 90, '-1 ❤', '#ff5b5b');
  if (G.hearts <= 0) die();
}
function damageBoss(dmg, x, y) {
  const b = G.boss;
  if (!b || b.state === 'dying') return;
  b.hp -= dmg;
  b.flash = 0.16;
  G.shake = Math.max(G.shake, 5);
  addFloater(x, y - 20, '-' + dmg, dmg > 1 ? '#ffd23f' : '#ffffff');
  for (let i = 0; i < 8; i++)
    addPart(x, y, rand(-220, 120), rand(-260, 40), rand(0.25, 0.5), rand(2, 5), pick(['#00f0ff', '#ff2bd6', '#ffffff']), 400);
  AudioSys.hit();
  G.score += dmg > 1 ? 10 : 5;
  if (b.hp <= 0) {
    b.hp = 0;
    b.state = 'dying';
    b.t = 1.15;
    G.bossShots.length = 0;
    bossExplode(b.x, GROUND_Y - 70);
    AudioSys.bossDie();
    G.shake = 16;
  }
}
function bossReward() {
  const bonus = 200, coins = 8 + 2 * G.bossNum;
  G.score += bonus;
  G.coins += coins;
  for (let i = 0; i < coins; i++)
    G.coinList.push({ x: rand(60, W - 60), y: rand(120, 320), r: 11, ph: rand(0, 6.28), still: true });
  showBanner('👹 BOSS DOWN!', '+' + bonus + ' pts · +' + coins + ' coins', 2.4);
  G.boss = null;
  G.mode = 'playing';
  G.invulnT = 2; // breather after the fight
  bossControls.classList.add('hidden');
}
function updateBoss(dt) {
  const b = G.boss;
  if (!b) return;
  b.flash = Math.max(0, b.flash - dt);
  const p = G.player;
  // player drifts back to fight stance
  p.x += (120 - p.x) * Math.min(1, dt * 4);

  if (b.state === 'enter') {
    b.x -= 300 * dt;
    if (b.x <= b.tx) { b.x = b.tx; b.state = 'idle'; b.t = 0; }
    return;
  }
  if (b.state === 'dying') {
    b.t -= dt;
    if (Math.random() < dt * 22)
      addPart(b.x + rand(-46, 46), GROUND_Y - rand(20, 120), rand(-160, 160), rand(-320, -40),
        rand(0.3, 0.7), rand(3, 7), pick(['#ff2bd6', '#ffd23f', '#ffffff']), 500);
    if (b.t <= 0) bossReward();
    return;
  }
  if (b.state === 'windup') {
    b.t -= dt;
    if (b.t <= 0) { b.state = 'strike'; b.t = 0.28; bossStrike(); }
    return;
  }
  if (b.state === 'strike') {
    b.t -= dt;
    if (b.t <= 0) { b.state = 'idle'; b.atkT = rand(0.85, 1.2) * bossAttackInterval(); }
    return;
  }
  // idle — stomp toward next attack
  b.atkT -= dt;
  if (b.atkT <= 0) {
    b.state = 'windup';
    b.t = 0.55;
    b.atkKind = pick(['fire', 'fire', 'shock', 'slam']);
    addFloater(b.x, GROUND_Y - 170, '!', '#ffdd33');
    AudioSys.beep(660, 0.1, 'square', 0.09);
  }
  // contact damage (shouldn't normally happen)
  if (Math.abs(p.x - b.x) < 70 && p.y > GROUND_Y - 90) hurtPlayer();
}
function updateBossShots(dt) {
  const p = G.player, px = p.x, py = p.y - 26, pr = 19;
  for (let i = G.bossShots.length - 1; i >= 0; i--) {
    const s = G.bossShots[i];
    if (s.delay && s.delay > 0) { s.delay -= dt; continue; }
    s.x += s.vx * dt;
    if (s.kind === 'fire' && Math.random() < 0.6)
      addPart(s.x + 10, s.y + rand(-6, 6), rand(20, 90), rand(-40, 40), 0.3, rand(2, 4), '#ff9a3c', 0);
    if (s.x < -50) { G.bossShots.splice(i, 1); continue; }
    let hit = false;
    if (s.kind === 'fire')
      hit = (px - s.x) * (px - s.x) + (py - s.y) * (py - s.y) < (pr + s.r) * (pr + s.r);
    else
      hit = circleRect(px, py, pr, s.x - s.w / 2, GROUND_Y - s.h, s.w, s.h);
    if (hit) { G.bossShots.splice(i, 1); hurtPlayer(); }
  }
}
function updateShots(dt) {
  const b = G.boss;
  for (let i = G.shots.length - 1; i >= 0; i--) {
    const s = G.shots[i];
    s.x += s.vx * dt;
    addPart(s.x - 14, s.y + rand(-8, 8), rand(-60, 0), rand(-30, 30), 0.25, rand(2, 4),
      s.kind === 'punch' ? '#00f0ff' : '#ff2bd6', 0);
    if (s.x > W + 40) { G.shots.splice(i, 1); continue; }
    if (b && b.state !== 'enter' && b.state !== 'dying' && s.x + s.r >= b.x - 48) {
      G.shots.splice(i, 1);
      damageBoss(s.dmg, b.x - 48, s.y);
    }
  }
}

/* ---------------- Death / game over ---------------- */
function die() {
  if (G.mode !== 'playing' && G.mode !== 'boss') return;
  G.mode = 'dying';
  G.dieT = 0.75; G.timeScale = 0.22; G.shake = 15;
  const p = G.player;
  explode(p.x, p.y - 26);
  AudioSys.die();
  bossControls.classList.add('hidden');
  const s = Math.floor(G.score);
  if (s > store.best) { store.best = s; G.newBest = true; }
}
function showOver() {
  G.mode = 'over'; G.timeScale = 1; G.shake = 0;
  G.boss = null;
  const s = Math.floor(G.score);
  finalScore.textContent = s;
  overBest.textContent = store.best;
  titleBest.textContent = store.best;
  bestEl.textContent = store.best;
  newBestBadge.classList.toggle('show', G.newBest);
  shareBtn.href = 'https://wa.me/?text=' + encodeURIComponent(
    'I scored ' + s + ' in Neon Rush on PixelArena — beat me if you can! ' + location.href);
  overOverlay.classList.remove('hidden');
}

/* ---------------- Update ---------------- */
function updateBg(dt, speedMul) {
  G.bgX += G.speed * speedMul * dt;
}
function updatePlayerPhysics(dt) {
  const p = G.player;
  p.vy = Math.min(MAX_FALL, p.vy + GRAV * dt);
  p.y += p.vy * dt;
  if (p.y >= GROUND_Y) {
    if (!p.onGround) spawnDust(p.x, GROUND_Y, 9, '#7b2bff');
    p.y = GROUND_Y; p.vy = 0; p.onGround = true; p.jumps = 0;
  } else p.onGround = false;
  p.runPhase += dt * (p.onGround ? G.speed / 30 : 7);
  if (p.poseT > 0) {
    p.poseT -= dt;
    if (p.poseT <= 0) p.pose = 'run';
  }
}
function update(dt, rdt) {
  G.t += dt;
  updateBg(dt, G.mode === 'playing' ? 1 : (G.mode === 'boss' ? 0.08 : 0.22));
  updateParts(dt);
  updateFloaters(dt);
  updatePrecip(dt);
  G.shake = Math.max(0, G.shake - 46 * rdt);
  G.punchCd = Math.max(0, G.punchCd - dt);
  G.kickCd = Math.max(0, G.kickCd - dt);
  G.invulnT = Math.max(0, G.invulnT - dt);
  if (G.banner) {
    G.banner.t -= dt;
    if (G.banner.t <= 0) G.banner = null;
  }

  if (G.mode === 'dying') {
    G.dieT -= rdt;
    if (G.dieT <= 0) showOver();
    return;
  }
  if (G.mode === 'boss') {
    const p = G.player;
    updatePlayerPhysics(dt);
    updateBoss(dt);
    updateShots(dt);
    updateBossShots(dt);
    // run trail
    G.trailT -= dt;
    if (G.trailT <= 0) {
      G.trailT = 0.05;
      addPart(p.x - 14, p.y - rand(8, 40), rand(-60, -10), rand(-30, 30), rand(0.2, 0.4), rand(2, 5), '#00f0ff', 0);
    }
    return;
  }
  if (G.mode !== 'playing') return;

  // difficulty ramp
  G.speed = Math.min(MAX_SPEED, G.speed + 7.5 * dt);
  G.score += G.speed * dt * 0.06;
  G.dist += G.speed * dt * METER_PX;

  // weather cycle
  cycleWeather(dt);

  // boss trigger — every 100 m
  if (G.dist >= G.nextBoss) { startBoss(); return; }

  // spawner
  G.spawnT -= dt;
  if (G.spawnT <= 0) {
    spawnObstacle();
    if (Math.random() < 0.55) spawnCoins();
    G.spawnT = rand(0.7, 1.25) * (430 / G.speed) + 0.38;
  }

  // player physics
  updatePlayerPhysics(dt);
  const p = G.player;

  // run trail
  G.trailT -= dt;
  if (G.trailT <= 0) {
    G.trailT = 0.035;
    addPart(p.x - 14, p.y - rand(8, 40), rand(-60, -10), rand(-30, 30), rand(0.2, 0.4), rand(2, 5), '#00f0ff', 0);
  }

  // obstacles (invulnerable briefly after boss fights)
  const px = p.x, py = p.y - 26, pr = 19;
  for (let i = G.obstacles.length - 1; i >= 0; i--) {
    const o = G.obstacles[i];
    o.x -= G.speed * dt;
    if (o.type === 'wisp') o.y = o.baseY + Math.sin(G.t * 5 + o.ph) * 22;
    if (o.x + o.w < -60) { G.obstacles.splice(i, 1); continue; }
    if (G.invulnT > 0) continue;
    let hit = false;
    if (o.type === 'wisp')
      hit = circleRect(px, py, pr, o.x + 6, o.y - o.h / 2 + 5, o.w - 12, o.h - 10);
    else
      hit = circleRect(px, py, pr, o.x + 7, GROUND_Y - o.h + 8, o.w - 14, o.h - 8);
    if (hit) { die(); return; }
  }

  // coins
  for (let i = G.coinList.length - 1; i >= 0; i--) {
    const c = G.coinList[i];
    if (!c.still) c.x -= G.speed * dt;
    if (c.x < -30) { G.coinList.splice(i, 1); continue; }
    const dx = c.x - px, dy = c.y - py;
    if (dx * dx + dy * dy < 34 * 34) {
      G.coinList.splice(i, 1);
      G.coins++; G.score += 25;
      spawnSparkle(c.x, c.y);
      AudioSys.coin();
    }
  }
}

/* ---------------- Background (weather-driven) ---------------- */
const stars = Array.from({ length: 80 }, () => ({
  x: Math.random() * W, y: Math.random() * H * 0.55, r: rand(0.6, 1.8), ph: rand(0, 6.28)
}));
function makeLayer(count, minW, maxW, minH, maxH) {
  const arr = [];
  let x = 0;
  for (let i = 0; i < count; i++) {
    const w = rand(minW, maxW), h = rand(minH, maxH);
    arr.push({ x, w, h, seed: Math.random() * 1000 });
    x += w + rand(6, 26);
  }
  return { arr, total: x };
}
const layerFar  = makeLayer(14, 50, 90, 60, 150);
const layerMid  = makeLayer(12, 60, 110, 100, 230);
const layerNear = makeLayer(10, 70, 130, 150, 320);
function drawLayer(L, color, winColor, factor, baseY) {
  const off = (G.bgX * factor) % L.total;
  ctx.fillStyle = color;
  for (const b of L.arr) {
    let x = b.x - off;
    if (x + b.w < -10) x += L.total;
    if (x > W + 10) continue;
    ctx.fillRect(x, baseY - b.h, b.w, b.h);
    // neon windows (deterministic)
    ctx.fillStyle = winColor;
    for (let wy = baseY - b.h + 10; wy < baseY - 12; wy += 18) {
      for (let wx = x + 7; wx < x + b.w - 6; wx += 14) {
        const hsh = Math.sin(b.seed + wx * 12.9 + wy * 78.2) * 43758.5;
        if ((hsh - Math.floor(hsh)) > 0.55) ctx.fillRect(wx, wy, 5, 7);
      }
    }
    ctx.fillStyle = color;
  }
}
function drawBackground() {
  const P = WEATHERS[G.weatherIdx];
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, P.sky[0]);
  sky.addColorStop(0.55, P.sky[1]);
  sky.addColorStop(0.85, P.sky[2]);
  sky.addColorStop(1, P.sky[3]);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  if (P.stars) {
    for (const s of stars) {
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(G.t * 2 + s.ph);
      ctx.fillStyle = '#cfe9ff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }
  if (P.moon) {
    ctx.save();
    ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 60;
    ctx.fillStyle = '#ffd7f4';
    ctx.beginPath(); ctx.arc(W - 92, 108, 34, 0, 7); ctx.fill();
    ctx.restore();
  }
  if (P.sun) {
    ctx.save();
    ctx.shadowColor = '#ffdd55'; ctx.shadowBlur = 80;
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath(); ctx.arc(W - 92, 108, 40, 0, 7); ctx.fill();
    ctx.restore();
  }
  // skyline parallax
  drawLayer(layerFar, P.far, P.winFar, 0.12, GROUND_Y);
  drawLayer(layerMid, P.mid, P.winMid, 0.28, GROUND_Y);
  drawLayer(layerNear, P.near, P.winNear, 0.55, GROUND_Y);
  // ground
  ctx.fillStyle = P.ground; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.save();
  ctx.shadowColor = P.line; ctx.shadowBlur = 14;
  ctx.strokeStyle = P.line; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, GROUND_Y); ctx.lineTo(W, GROUND_Y); ctx.stroke();
  ctx.restore();
  // scrolling ground grid
  ctx.strokeStyle = P.grid; ctx.lineWidth = 1.5;
  const step = 46, off = G.bgX % step;
  for (let gx = -off; gx < W; gx += step) {
    ctx.beginPath(); ctx.moveTo(gx, GROUND_Y + 4); ctx.lineTo(gx - 26, H); ctx.stroke();
  }
  ctx.strokeStyle = P.grid2;
  for (let gy = GROUND_Y + 22; gy < H; gy += 26) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }
  // precipitation
  for (const q of G.precip) {
    if (q.kind === 'rain') {
      ctx.strokeStyle = 'rgba(150,210,255,.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.len * 0.18, q.y - q.len); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill();
    }
  }
  // lightning flash
  if (G.flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + (G.flash * 4).toFixed(2) + ')';
    ctx.fillRect(0, 0, W, H);
  }
}

/* ---------------- Entities ---------------- */
// Anime-style hero: spiky hair, headband, flowing scarf, jacket
function drawPlayer() {
  const p = G.player;
  ctx.save();
  ctx.translate(p.x, p.y);
  const air = !p.onGround;
  const pose = p.poseT > 0 ? p.pose : (air ? 'air' : 'run');
  const run = Math.sin(p.runPhase);
  const t = G.t;
  ctx.rotate(clamp(p.vy / 3200, -0.25, 0.3) * (air ? 1 : 0));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // hurt blink
  if (G.invulnT > 0 && G.mode === 'boss') ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 30);
  ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 14;

  // ---- scarf flowing behind
  const wave = Math.sin(t * 11) * 5;
  ctx.strokeStyle = '#ff3b5c'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(-4, -46);
  ctx.quadraticCurveTo(-24, -52 + wave, -44, -44 - wave); ctx.stroke();
  ctx.strokeStyle = '#ff8fa3'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(-4, -46);
  ctx.quadraticCurveTo(-24, -52 + wave, -44, -44 - wave); ctx.stroke();

  // ---- legs (pants #2b2b4d, sneakers)
  const hipY = -30;
  let fKnee, fFoot, bKnee, bFoot;
  if (pose === 'air') {
    fKnee = [11, -15]; fFoot = [17, -5]; bKnee = [-5, -13]; bFoot = [-11, -7];
  } else if (pose === 'kick') {
    fKnee = [14, -28]; fFoot = [40, -32]; bKnee = [-6, -14]; bFoot = [-12, 0];
  } else {
    const s = air ? 0.35 : run;
    fKnee = [9 * s, -14]; fFoot = [14 * s, 0]; bKnee = [-9 * s, -14]; bFoot = [-14 * s, 0];
  }
  ctx.strokeStyle = '#2b2b4d'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(bKnee[0], bKnee[1]); ctx.lineTo(bFoot[0], bFoot[1]); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(fKnee[0], fKnee[1]); ctx.lineTo(fFoot[0], fFoot[1]); ctx.stroke();
  // sneakers
  ctx.fillStyle = '#eaf7ff';
  const shoe = (x, y, a) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-4, -5, 17, 9, 4); else ctx.rect(-4, -5, 17, 9);
    ctx.fill(); ctx.restore();
  };
  shoe(bFoot[0], bFoot[1], -0.12);
  shoe(fFoot[0], fFoot[1], pose === 'kick' ? -0.1 : 0.12);
  ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(fFoot[0] - 4, fFoot[1] + 4); ctx.lineTo(fFoot[0] + 10, fFoot[1] + 4); ctx.stroke();

  // ---- torso: open jacket
  ctx.fillStyle = '#23234d';
  ctx.beginPath();
  ctx.moveTo(-7, hipY); ctx.lineTo(-9, -48); ctx.lineTo(9, -50); ctx.lineTo(7, hipY + 2);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(1, -47); ctx.lineTo(-1, hipY); ctx.stroke();
  // jacket tail flapping
  const flap = Math.sin(t * 13) * 4;
  ctx.fillStyle = '#1b1b3a';
  ctx.beginPath();
  ctx.moveTo(-7, -34); ctx.lineTo(-18 - flap, -22); ctx.lineTo(-8, -18); ctx.closePath(); ctx.fill();

  // ---- arms
  const shX = 2, shY = -44;
  let handF, handB, elbowF, elbowB;
  if (pose === 'punch') {
    elbowF = [20, -50]; handF = [38, -52];
    elbowB = [-8, -36]; handB = [-14, -26];
  } else if (pose === 'kick') {
    elbowF = [-6, -52]; handF = [-12, -58];
    elbowB = [10, -38]; handB = [16, -30];
  } else if (pose === 'air') {
    elbowF = [12, -56]; handF = [18, -62];
    elbowB = [-10, -50]; handB = [-16, -42];
  } else {
    const s = run;
    elbowF = [10 * s + 4, -36]; handF = [14 * s + 6, -28];
    elbowB = [-10 * s + 0, -36]; handB = [-14 * s - 2, -28];
  }
  ctx.strokeStyle = '#2f2f5c'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(elbowB[0], elbowB[1]); ctx.lineTo(handB[0], handB[1]); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(elbowF[0], elbowF[1]); ctx.lineTo(handF[0], handF[1]); ctx.stroke();
  // fists
  ctx.fillStyle = '#ffd9b3';
  ctx.beginPath(); ctx.arc(handF[0], handF[1], 4.6, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(handB[0], handB[1], 4.6, 0, 7); ctx.fill();
  // punch / kick impact star
  if (pose === 'punch' || pose === 'kick') {
    const ix = pose === 'punch' ? handF[0] + 8 : fFoot[0] + 8;
    const iy = pose === 'punch' ? handF[1] : fFoot[1];
    ctx.save();
    ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 20;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + t * 6;
      const r1 = i % 2 === 0 ? 13 : 6;
      ctx.lineTo(ix + Math.cos(a) * r1, iy + Math.sin(a) * r1);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ---- head
  const hx = 8, hy = -58;
  ctx.fillStyle = '#ffd9b3';
  ctx.beginPath(); ctx.arc(hx, hy, 9.5, 0, 7); ctx.fill();
  // spiky anime hair
  ctx.fillStyle = '#151532';
  ctx.beginPath();
  ctx.moveTo(hx - 10, hy - 1);
  ctx.lineTo(hx - 17, hy - 12); ctx.lineTo(hx - 9, hy - 9);
  ctx.lineTo(hx - 8, hy - 22);  ctx.lineTo(hx - 1, hy - 11);
  ctx.lineTo(hx + 4, hy - 24);  ctx.lineTo(hx + 8, hy - 11);
  ctx.lineTo(hx + 15, hy - 21); ctx.lineTo(hx + 14, hy - 9);
  ctx.lineTo(hx + 19, hy - 12); ctx.lineTo(hx + 12, hy - 2);
  ctx.lineTo(hx + 10, hy + 1);  ctx.lineTo(hx - 8, hy + 1);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(hx - 8, hy - 22); ctx.lineTo(hx - 1, hy - 11); ctx.lineTo(hx + 4, hy - 24);
  ctx.stroke();
  // headband + tails
  ctx.fillStyle = '#00f0ff';
  ctx.fillRect(hx - 10, hy - 7, 21, 4.5);
  const bw = Math.sin(t * 12) * 4;
  ctx.beginPath();
  ctx.moveTo(hx - 10, hy - 5);
  ctx.quadraticCurveTo(hx - 24, hy - 8 + bw, hx - 36, hy - 2 - bw);
  ctx.lineTo(hx - 33, hy + 2 - bw);
  ctx.quadraticCurveTo(hx - 22, hy - 3 + bw, hx - 10, hy - 1);
  ctx.closePath(); ctx.fill();
  // determined anime eye
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(hx + 4.5, hy + 0.5, 3.2, 4, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#182038';
  ctx.beginPath(); ctx.arc(hx + 5.8, hy + 0.8, 1.9, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(hx + 6.4, hy + 0.1, 0.7, 0, 7); ctx.fill();
  // brow
  ctx.strokeStyle = '#151532'; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(hx + 0.5, hy - 5.5); ctx.lineTo(hx + 8.5, hy - 3.5); ctx.stroke();
  // mouth
  ctx.strokeStyle = '#8a5a3b'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(hx + 5, hy + 6); ctx.lineTo(hx + 9, hy + 6); ctx.stroke();
  ctx.restore();
}
// Chomper monster obstacle
function drawChomp(o) {
  const hop = Math.abs(Math.sin(G.t * 9 + o.ph)) * 7;
  const y = GROUND_Y - hop;
  ctx.save();
  ctx.translate(o.x + o.w / 2, y);
  ctx.shadowColor = o.body; ctx.shadowBlur = 16;
  // body blob
  const grad = ctx.createLinearGradient(0, -o.h, 0, 0);
  grad.addColorStop(0, o.body); grad.addColorStop(1, '#1a1a2e');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.ellipse(0, -o.h / 2, o.w / 2, o.h / 2, 0, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  // spikes on head
  ctx.fillStyle = '#1a1a2e';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * o.w / 4 - 6, -o.h + 6);
    ctx.lineTo(i * o.w / 4, -o.h - 10);
    ctx.lineTo(i * o.w / 4 + 6, -o.h + 6);
    ctx.closePath(); ctx.fill();
  }
  // angry eyes
  const blink = (Math.sin(G.t * 3 + o.ph) > 0.97) ? 0.15 : 1;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(-o.w / 5, -o.h * 0.68, 7, 8 * blink, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(o.w / 5, -o.h * 0.68, 7, 8 * blink, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#ff3b3b';
  ctx.beginPath(); ctx.arc(-o.w / 5 + 2, -o.h * 0.66, 3.2 * blink, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(o.w / 5 + 2, -o.h * 0.66, 3.2 * blink, 0, 7); ctx.fill();
  // big toothy mouth
  ctx.fillStyle = '#40060f';
  ctx.beginPath(); ctx.ellipse(0, -o.h * 0.32, o.w * 0.32, 10, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffffff';
  const teeth = Math.max(3, Math.round(o.w / 16));
  for (let i = 0; i < teeth; i++) {
    const tx = -o.w * 0.28 + (i / (teeth - 1)) * o.w * 0.56;
    ctx.beginPath();
    ctx.moveTo(tx - 4, -o.h * 0.32 - 8); ctx.lineTo(tx + 4, -o.h * 0.32 - 8); ctx.lineTo(tx, -o.h * 0.32 - 1);
    ctx.closePath(); ctx.fill();
  }
  // little feet
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath(); ctx.ellipse(-o.w / 4, -4, 9, 5, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(o.w / 4, -4, 9, 5, 0, 0, 7); ctx.fill();
  ctx.restore();
}
// Crate obstacle
function drawCrate(o) {
  ctx.save();
  ctx.shadowColor = '#ffb35c'; ctx.shadowBlur = 10;
  const grad = ctx.createLinearGradient(o.x, 0, o.x + o.w, 0);
  grad.addColorStop(0, '#9a6530'); grad.addColorStop(0.5, '#b57a3e'); grad.addColorStop(1, '#8a5a2b');
  ctx.fillStyle = grad;
  ctx.fillRect(o.x, GROUND_Y - o.h, o.w, o.h);
  ctx.shadowBlur = 0;
  // planks
  ctx.strokeStyle = 'rgba(60,35,10,.6)'; ctx.lineWidth = 2.5;
  const rows = Math.max(2, Math.round(o.h / 26));
  for (let i = 1; i < rows; i++) {
    const py = GROUND_Y - (o.h / rows) * i;
    ctx.beginPath(); ctx.moveTo(o.x, py); ctx.lineTo(o.x + o.w, py); ctx.stroke();
  }
  // cross brace
  ctx.strokeStyle = 'rgba(60,35,10,.55)'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(o.x + 3, GROUND_Y - 3); ctx.lineTo(o.x + o.w - 3, GROUND_Y - o.h + 3); ctx.stroke();
  // metal corners
  ctx.fillStyle = '#5a6472';
  const c = 10;
  ctx.fillRect(o.x, GROUND_Y - o.h, c, c);
  ctx.fillRect(o.x + o.w - c, GROUND_Y - o.h, c, c);
  ctx.fillRect(o.x, GROUND_Y - c, c, c);
  ctx.fillRect(o.x + o.w - c, GROUND_Y - c, c, c);
  // neon edge
  ctx.strokeStyle = 'rgba(0,240,255,.5)'; ctx.lineWidth = 2;
  ctx.strokeRect(o.x + 1, GROUND_Y - o.h + 1, o.w - 2, o.h - 2);
  ctx.restore();
}
// Wisp — flying ghost obstacle
function drawWisp(o) {
  const y = o.y;
  ctx.save();
  ctx.translate(o.x + o.w / 2, y);
  ctx.shadowColor = '#7df9ff'; ctx.shadowBlur = 18;
  const sway = Math.sin(G.t * 6 + o.ph) * 3;
  // ghost body
  const grad = ctx.createLinearGradient(0, -o.h / 2, 0, o.h / 2);
  grad.addColorStop(0, 'rgba(220,250,255,.95)'); grad.addColorStop(1, 'rgba(125,249,255,.55)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, -4, o.w / 2 - 4, Math.PI, 0);
  ctx.lineTo(o.w / 2 - 4, o.h / 2 - 8);
  for (let i = 0; i < 3; i++) {
    const wx = o.w / 2 - 4 - ((i + 0.5) / 3) * (o.w - 8);
    ctx.quadraticCurveTo(wx + 6, o.h / 2 + sway, wx - 6, o.h / 2 - 8);
  }
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  // spooky eyes
  ctx.fillStyle = '#123';
  ctx.beginPath(); ctx.ellipse(-8, -8, 4.5, 7, -0.2, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(8, -8, 4.5, 7, 0.2, 0, 7); ctx.fill();
  ctx.fillStyle = '#ff3b5c';
  ctx.beginPath(); ctx.arc(-8, -8, 1.8, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(8, -8, 1.8, 0, 7); ctx.fill();
  // mouth
  ctx.fillStyle = '#123';
  ctx.beginPath(); ctx.ellipse(0, 6, 4, 6, 0, 0, 7); ctx.fill();
  ctx.restore();
}
function drawCoin(c) {
  const sx = Math.abs(Math.cos(G.t * 5 + c.ph));
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 14;
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath(); ctx.ellipse(0, 0, 4 + 8 * sx, 11, 0, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#b8860b';
  ctx.beginPath(); ctx.ellipse(0, 0, 2 + 3.5 * sx, 6, 0, 0, 7); ctx.fill();
  ctx.restore();
}
function drawParts() {
  for (const p of G.parts) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawFloaters() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '800 20px Orbitron, sans-serif';
  for (const f of G.floaters) {
    ctx.globalAlpha = Math.min(1, f.t * 2);
    ctx.fillStyle = f.color;
    ctx.shadowColor = f.color; ctx.shadowBlur = 8;
    ctx.fillText(f.txt, f.x, f.y);
  }
  ctx.restore();
}
// Player energy shots (punch = cyan wave, kick = magenta wave)
function drawShots() {
  for (const s of G.shots) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.shadowBlur = 18;
    if (s.kind === 'punch') {
      ctx.shadowColor = '#00f0ff'; ctx.strokeStyle = '#aef7ff'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(0, 0, s.r, -1.1, 1.1); ctx.stroke();
      ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, s.r + 6, -1.1, 1.1); ctx.stroke();
    } else {
      ctx.shadowColor = '#ff2bd6'; ctx.strokeStyle = '#ffc2ec'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(0, 0, s.r, -1.2, 1.2); ctx.stroke();
      ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, s.r + 8, -1.2, 1.2); ctx.stroke();
    }
    ctx.restore();
  }
}
// Boss projectiles
function drawBossShots() {
  for (const s of G.bossShots) {
    if (s.delay && s.delay > 0) continue;
    ctx.save();
    if (s.kind === 'fire') {
      ctx.shadowColor = '#ff6b35'; ctx.shadowBlur = 22;
      const grad = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, s.r);
      grad.addColorStop(0, '#fff3b0'); grad.addColorStop(0.5, '#ff9a3c'); grad.addColorStop(1, '#ff3b1f');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
    } else {
      ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(255,43,214,.85)';
      ctx.beginPath();
      ctx.ellipse(s.x, GROUND_Y - s.h / 2, s.w / 2, s.h / 2, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(s.x, GROUND_Y - s.h / 2, s.w / 4, s.h / 4, 0, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }
}
// Mini-boss: horned oni demon
function drawBoss() {
  const b = G.boss;
  if (!b) return;
  const x = b.x, gy = GROUND_Y;
  const bob = b.state === 'idle' ? Math.sin(G.t * 3) * 4 : 0;
  const cy = gy - 72 + bob;
  const windup = b.state === 'windup';
  ctx.save();
  if (b.flash > 0) { ctx.shadowColor = '#ffffff'; ctx.globalAlpha = 0.75 + 0.25 * Math.sin(G.t * 60); }
  else ctx.shadowColor = '#ff2bd6';
  ctx.shadowBlur = 26;
  // legs
  ctx.fillStyle = '#3a1148';
  ctx.fillRect(x - 34, gy - 36, 26, 36);
  ctx.fillRect(x + 8, gy - 36, 26, 36);
  // body
  const grad = ctx.createLinearGradient(0, cy - 60, 0, cy + 42);
  grad.addColorStop(0, '#571b6e'); grad.addColorStop(1, '#230a33');
  ctx.fillStyle = grad;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - 46, cy - 58, 92, 100, 26); else ctx.rect(x - 46, cy - 58, 92, 100);
  ctx.fill();
  ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 3; ctx.stroke();
  ctx.shadowBlur = 0;
  // belly plates
  ctx.strokeStyle = 'rgba(255,43,214,.35)'; ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(x - 34, cy - 10 + i * 16); ctx.lineTo(x + 34, cy - 10 + i * 16); ctx.stroke();
  }
  // shoulder spikes
  ctx.fillStyle = '#e8dcc0';
  for (const sx of [-46, 46]) {
    ctx.beginPath();
    ctx.moveTo(x + sx - 10, cy - 44); ctx.lineTo(x + sx - 16, cy - 66); ctx.lineTo(x + sx + 2, cy - 50);
    ctx.closePath(); ctx.fill();
  }
  // horns
  ctx.beginPath();
  ctx.moveTo(x - 34, cy - 52); ctx.quadraticCurveTo(x - 52, cy - 84, x - 40, cy - 100);
  ctx.lineTo(x - 28, cy - 82); ctx.quadraticCurveTo(x - 32, cy - 66, x - 24, cy - 56);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 34, cy - 52); ctx.quadraticCurveTo(x + 52, cy - 84, x + 40, cy - 100);
  ctx.lineTo(x + 28, cy - 82); ctx.quadraticCurveTo(x + 32, cy - 66, x + 24, cy - 56);
  ctx.closePath(); ctx.fill();
  // angry glowing eyes
  const eg = windup ? '#ffffff' : '#ffdd33';
  ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 16;
  ctx.fillStyle = eg;
  ctx.beginPath(); ctx.ellipse(x - 18, cy - 34, 9, 6, -0.25, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + 18, cy - 34, 9, 6, 0.25, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#a00';
  ctx.beginPath(); ctx.arc(x - 18, cy - 34, 3, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 18, cy - 34, 3, 0, 7); ctx.fill();
  // heavy brows
  ctx.strokeStyle = '#1a0a22'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 30, cy - 48); ctx.lineTo(x - 8, cy - 40); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 30, cy - 48); ctx.lineTo(x + 8, cy - 40); ctx.stroke();
  // jagged mouth
  ctx.fillStyle = '#3d0512';
  ctx.beginPath(); ctx.ellipse(x, cy - 8, 24, 12, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i++) {
    const tx = x - 18 + i * 9;
    ctx.beginPath();
    ctx.moveTo(tx - 4, cy - 16); ctx.lineTo(tx + 4, cy - 16); ctx.lineTo(tx, cy - 8);
    ctx.closePath(); ctx.fill();
  }
  // arms — right arm raises during windup, slams on strike
  ctx.strokeStyle = '#571b6e'; ctx.lineWidth = 20;
  // left arm (down)
  ctx.beginPath(); ctx.moveTo(x - 46, cy - 30); ctx.lineTo(x - 58, cy + 6); ctx.stroke();
  ctx.fillStyle = '#3a1148';
  ctx.beginPath(); ctx.arc(x - 58, cy + 10, 14, 0, 7); ctx.fill();
  // right arm
  let rHx = x + 58, rHy = cy + 10;
  if (windup) { rHx = x + 52; rHy = cy - 78; }
  else if (b.state === 'strike') { rHx = x + 40; rHy = cy + 34; }
  ctx.strokeStyle = '#571b6e';
  ctx.beginPath(); ctx.moveTo(x + 46, cy - 30); ctx.lineTo(rHx, rHy); ctx.stroke();
  ctx.fillStyle = windup ? '#ff6b35' : '#3a1148';
  if (windup) { ctx.shadowColor = '#ff6b35'; ctx.shadowBlur = 20; }
  ctx.beginPath(); ctx.arc(rHx, rHy, 15, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
  // HP bar + name
  ctx.save();
  ctx.textAlign = 'center';
  const bw = 300, bx = W / 2 - bw / 2, by = 64;
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx - 4, by - 4, bw + 8, 26, 8); ctx.fill(); }
  else ctx.fillRect(bx - 4, by - 4, bw + 8, 26);
  const hgrad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  hgrad.addColorStop(0, '#ff3b5c'); hgrad.addColorStop(1, '#ff9a3c');
  ctx.fillStyle = hgrad;
  const hw = bw * clamp(b.hp / b.maxHp, 0, 1);
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, hw, 18, 6); ctx.fill(); }
  else ctx.fillRect(bx, by, hw, 18);
  ctx.font = '800 15px Orbitron, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 8;
  ctx.fillText('👹 ' + b.name, W / 2, by - 10);
  ctx.restore();
}
function drawHearts() {
  if (G.mode !== 'boss') return;
  ctx.save();
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'left';
  let s = '';
  for (let i = 0; i < 3; i++) s += i < G.hearts ? '❤️' : '🖤';
  ctx.fillText(s, 14, 40);
  ctx.restore();
}
function drawBanner() {
  const bn = G.banner;
  if (!bn) return;
  const a = clamp(bn.t / 0.4, 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.font = '900 34px Orbitron, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 24;
  ctx.fillText(bn.text, W / 2, H * 0.32);
  if (bn.sub) {
    ctx.font = '700 17px Orbitron, sans-serif';
    ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 12;
    ctx.fillText(bn.sub, W / 2, H * 0.32 + 34);
  }
  ctx.restore();
}

/* ---------------- Render ---------------- */
function render() {
  ctx.save();
  if (G.shake > 0.3) ctx.translate(rand(-1, 1) * G.shake, rand(-1, 1) * G.shake);
  drawBackground();
  for (const c of G.coinList) drawCoin(c);
  for (const o of G.obstacles) {
    if (o.type === 'chomp') drawChomp(o);
    else if (o.type === 'crate') drawCrate(o);
    else drawWisp(o);
  }
  drawBossShots();
  drawShots();
  if (G.boss) drawBoss();
  if (G.mode !== 'dying') drawPlayer();
  drawParts();
  drawFloaters();
  drawHearts();
  drawBanner();
  ctx.restore();
}

/* ---------------- HUD ---------------- */
let lastShown = -1, lastDist = -1;
function updateHUD() {
  const s = Math.floor(G.score);
  if (s !== lastShown) { scoreEl.textContent = s; lastShown = s; }
  const m = Math.floor(G.dist);
  if (m !== lastDist) {
    lastDist = m;
    if (G.mode === 'boss') distEl.textContent = '👹 BOSS FIGHT — ' + G.bossNum;
    else distEl.textContent = '📏 ' + m + 'm · 👹 in ' + Math.max(0, Math.ceil(G.nextBoss - G.dist)) + 'm';
  }
}

/* ---------------- Main loop (fixed timestep) ---------------- */
const STEP = 1 / 60;
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (G.paused) return;
  acc += rdt * G.timeScale;
  let n = 0;
  while (acc >= STEP && n < 5) { update(STEP, rdt); acc -= STEP; n++; }
  if (n === 5) acc = 0;
  updateHUD();
  render();
}
bestEl.textContent = store.best;
titleBest.textContent = store.best;
requestAnimationFrame(frame);

/* ---------------- Debug/test API ---------------- */
window.PixelArenaNeonRush = {
  G, store, WEATHERS,
  start: startGame, jump: doJump, punch: doPunch, kick: doKick,
  update: (dt) => update(dt, dt),
  spawnObstacle, spawnCoins, reset: resetGame,
  startBoss, hurtPlayer, damageBoss, render,
};

})();
