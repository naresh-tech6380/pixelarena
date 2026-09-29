/* ============================================================
   NEON RUSH — endless runner for PixelArena
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
  jump() { this.beep(280, 0.14, 'square', 0.08, 640); },
  coin() { this.beep(950, 0.07, 'sine', 0.1, 1400); },
  die()  { this.beep(200, 0.4, 'sawtooth', 0.14, 40); },
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
const stage = $('stage'), scoreEl = $('score'), bestEl = $('best');
const titleOverlay = $('titleOverlay'), overOverlay = $('overOverlay'), pauseOverlay = $('pauseOverlay');
const titleBest = $('titleBest'), finalScore = $('finalScore'), overBest = $('overBest');
const newBestBadge = $('newBest'), shareBtn = $('shareBtn');
const muteBtn = $('muteBtn'), pauseBtn = $('pauseBtn');

/* ---------------- Game state ---------------- */
const G = {
  mode: 'title',          // title | playing | dying | over
  paused: false,
  t: 0, timeScale: 1, dieT: 0, shake: 0,
  speed: START_SPEED, score: 0, coins: 0,
  newBest: false,
  player: null,
  obstacles: [], coinList: [], parts: [],
  spawnT: 1, trailT: 0,
  bgX: 0,
};
function resetGame() {
  G.t = 0; G.timeScale = 1; G.dieT = 0; G.shake = 0;
  G.speed = START_SPEED; G.score = 0; G.coins = 0; G.newBest = false;
  G.player = { x: 150, y: GROUND_Y, vy: 0, jumps: 0, onGround: true, runPhase: 0 };
  G.obstacles.length = 0; G.coinList.length = 0; G.parts.length = 0;
  G.spawnT = 1.0; G.trailT = 0; G.paused = false;
  pauseOverlay.classList.add('hidden');
}
resetGame();

/* ---------------- Input ---------------- */
function startGame() {
  resetGame();
  G.mode = 'playing';
  titleOverlay.classList.add('hidden');
  overOverlay.classList.add('hidden');
}
function doJump() {
  AudioSys.init();
  if (G.mode === 'title') { startGame(); return; }
  if (G.mode !== 'playing' || G.paused) return;
  const p = G.player;
  if (p.onGround || p.jumps < 2) {
    p.vy = -JUMP_V; p.onGround = false; p.jumps++;
    spawnDust(p.x, p.y, 8, '#00f0ff');
    AudioSys.jump();
  }
}
function cutJump() {
  const p = G.player;
  if (G.mode === 'playing' && !p.onGround && p.vy < -JUMP_V * 0.45) p.vy = -JUMP_V * 0.45;
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
  } else if (e.code === 'KeyP') togglePause();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') cutJump();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.mode === 'playing' && !G.paused) togglePause();
});

function togglePause() {
  if (G.mode !== 'playing') return;
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
  if (G.parts.length > 240) G.parts.shift();
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

/* ---------------- Spawners ---------------- */
function spawnObstacle() {
  const r = Math.random(), x = W + 50;
  if (r < 0.5) {
    // ground spikes (single or pair)
    const n = Math.random() < 0.4 ? 2 : 1;
    for (let i = 0; i < n; i++)
      G.obstacles.push({ type: 'spike', x: x + i * 46, w: 36, h: 56 });
  } else if (r < 0.78) {
    // hovering drone — forces jump timing
    G.obstacles.push({ type: 'drone', x, w: 48, h: 30, baseY: GROUND_Y - rand(150, 215), ph: rand(0, 6.28) });
  } else {
    // wide spike bed
    G.obstacles.push({ type: 'spike', x, w: 76, h: 56 });
  }
}
function spawnCoins() {
  const n = 5, y = GROUND_Y - rand(100, 230), x0 = W + 60;
  for (let i = 0; i < n; i++)
    G.coinList.push({ x: x0 + i * 38, y: y - Math.sin((i / (n - 1)) * Math.PI) * 46, r: 11, ph: rand(0, 6.28) });
}

/* ---------------- Death / game over ---------------- */
function die() {
  if (G.mode !== 'playing') return;
  G.mode = 'dying';
  G.dieT = 0.75; G.timeScale = 0.22; G.shake = 15;
  const p = G.player;
  explode(p.x, p.y - 26);
  AudioSys.die();
  const s = Math.floor(G.score);
  if (s > store.best) { store.best = s; G.newBest = true; }
}
function showOver() {
  G.mode = 'over'; G.timeScale = 1; G.shake = 0;
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
function update(dt, rdt) {
  G.t += dt;
  updateBg(dt, G.mode === 'playing' ? 1 : 0.22);
  updateParts(dt);
  G.shake = Math.max(0, G.shake - 46 * rdt);

  if (G.mode === 'dying') {
    G.dieT -= rdt;
    if (G.dieT <= 0) showOver();
    return;
  }
  if (G.mode !== 'playing') return;

  // difficulty ramp
  G.speed = Math.min(MAX_SPEED, G.speed + 7.5 * dt);
  G.score += G.speed * dt * 0.06;

  // spawner
  G.spawnT -= dt;
  if (G.spawnT <= 0) {
    spawnObstacle();
    if (Math.random() < 0.55) spawnCoins();
    G.spawnT = rand(0.7, 1.25) * (430 / G.speed) + 0.38;
  }

  // player physics
  const p = G.player;
  p.vy = Math.min(MAX_FALL, p.vy + GRAV * dt);
  p.y += p.vy * dt;
  if (p.y >= GROUND_Y) {
    if (!p.onGround) spawnDust(p.x, GROUND_Y, 9, '#7b2bff');
    p.y = GROUND_Y; p.vy = 0; p.onGround = true; p.jumps = 0;
  } else p.onGround = false;
  p.runPhase += dt * (p.onGround ? G.speed / 30 : 7);

  // run trail
  G.trailT -= dt;
  if (G.trailT <= 0) {
    G.trailT = 0.035;
    addPart(p.x - 14, p.y - rand(8, 40), rand(-60, -10), rand(-30, 30), rand(0.2, 0.4), rand(2, 5), '#00f0ff', 0);
  }

  // obstacles
  const px = p.x, py = p.y - 26, pr = 19;
  for (let i = G.obstacles.length - 1; i >= 0; i--) {
    const o = G.obstacles[i];
    o.x -= G.speed * dt;
    if (o.type === 'drone') o.y = o.baseY + Math.sin(G.t * 5 + o.ph) * 22;
    if (o.x + o.w < -60) { G.obstacles.splice(i, 1); continue; }
    let hit = false;
    if (o.type === 'spike')
      hit = circleRect(px, py, pr, o.x + 7, GROUND_Y - o.h + 8, o.w - 14, o.h - 8);
    else
      hit = circleRect(px, py, pr, o.x + 6, o.y - o.h / 2 + 5, o.w - 12, o.h - 10);
    if (hit) { die(); return; }
  }

  // coins
  for (let i = G.coinList.length - 1; i >= 0; i--) {
    const c = G.coinList[i];
    c.x -= G.speed * dt;
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

/* ---------------- Background ---------------- */
const stars = Array.from({ length: 80 }, () => ({
  x: Math.random() * W, y: Math.random() * H * 0.55, r: rand(0.6, 1.8), ph: rand(0, 6.28)
}));
function makeLayer(count, minW, maxW, minH, maxH, color) {
  const arr = [];
  let x = 0;
  for (let i = 0; i < count; i++) {
    const w = rand(minW, maxW), h = rand(minH, maxH);
    arr.push({ x, w, h, seed: Math.random() * 1000 });
    x += w + rand(6, 26);
  }
  return { arr, color, total: x };
}
const layerFar  = makeLayer(14, 50, 90, 60, 150, '#150a33');
const layerMid  = makeLayer(12, 60, 110, 100, 230, '#0e0626');
const layerNear = makeLayer(10, 70, 130, 150, 320, '#090418');
function drawLayer(L, factor, baseY, winColor) {
  const off = (G.bgX * factor) % L.total;
  ctx.fillStyle = L.color;
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
    ctx.fillStyle = L.color;
  }
}
function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#040110');
  sky.addColorStop(0.55, '#150538');
  sky.addColorStop(0.85, '#3a0a52');
  sky.addColorStop(1, '#0a0424');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  // stars
  for (const s of stars) {
    ctx.globalAlpha = 0.35 + 0.35 * Math.sin(G.t * 2 + s.ph);
    ctx.fillStyle = '#cfe9ff';
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;
  // moon
  ctx.save();
  ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 60;
  ctx.fillStyle = '#ffd7f4';
  ctx.beginPath(); ctx.arc(W - 92, 108, 34, 0, 7); ctx.fill();
  ctx.restore();
  // skyline parallax
  drawLayer(layerFar, 0.12, GROUND_Y, 'rgba(123,43,255,.5)');
  drawLayer(layerMid, 0.28, GROUND_Y, 'rgba(0,240,255,.4)');
  drawLayer(layerNear, 0.55, GROUND_Y, 'rgba(255,43,214,.35)');
  // ground
  ctx.fillStyle = '#070213'; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.save();
  ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 14;
  ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, GROUND_Y); ctx.lineTo(W, GROUND_Y); ctx.stroke();
  ctx.restore();
  // scrolling ground grid
  ctx.strokeStyle = 'rgba(0,240,255,.22)'; ctx.lineWidth = 1.5;
  const step = 46, off = G.bgX % step;
  for (let gx = -off; gx < W; gx += step) {
    ctx.beginPath(); ctx.moveTo(gx, GROUND_Y + 4); ctx.lineTo(gx - 26, H); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,43,214,.14)';
  for (let gy = GROUND_Y + 22; gy < H; gy += 26) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }
}

/* ---------------- Entities ---------------- */
function drawPlayer() {
  const p = G.player;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(clamp(p.vy / 3200, -0.28, 0.32));
  ctx.lineCap = 'round';
  ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 18;
  ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 5;
  const run = Math.sin(p.runPhase) * (p.onGround ? 1 : 0.35);
  const tuck = p.onGround ? 1 : 0.55;
  // legs
  ctx.beginPath();
  ctx.moveTo(0, -24); ctx.lineTo(run * 9 * tuck, -12); ctx.lineTo(run * 15 * tuck, 0);
  ctx.moveTo(0, -24); ctx.lineTo(-run * 9 * tuck, -12); ctx.lineTo(-run * 15 * tuck, 0);
  ctx.stroke();
  // torso
  ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(7, -44); ctx.stroke();
  // head + visor
  ctx.beginPath(); ctx.arc(11, -54, 10, 0, 7); ctx.stroke();
  ctx.shadowColor = '#ff2bd6'; ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(11, -56); ctx.lineTo(21, -53); ctx.stroke();
  ctx.restore();
}
function drawSpike(o) {
  ctx.save();
  const grad = ctx.createLinearGradient(0, GROUND_Y - o.h, 0, GROUND_Y);
  grad.addColorStop(0, '#ff2bd6'); grad.addColorStop(1, '#6d0f3c');
  ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 16;
  ctx.fillStyle = grad;
  const teeth = Math.max(1, Math.round(o.w / 36));
  const tw = o.w / teeth;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const x0 = o.x + i * tw;
    ctx.moveTo(x0, GROUND_Y);
    ctx.lineTo(x0 + tw / 2, GROUND_Y - o.h);
    ctx.lineTo(x0 + tw, GROUND_Y);
  }
  ctx.fill();
  ctx.restore();
}
function drawDrone(o) {
  const y = o.y;
  ctx.save();
  ctx.translate(o.x + o.w / 2, y);
  ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 16;
  // rotor
  ctx.strokeStyle = 'rgba(255,43,214,.7)'; ctx.lineWidth = 3;
  const rw = 20 + Math.sin(G.t * 40) * 6;
  ctx.beginPath(); ctx.moveTo(-rw, -16); ctx.lineTo(rw, -16); ctx.stroke();
  // body
  const grad = ctx.createLinearGradient(0, -12, 0, 12);
  grad.addColorStop(0, '#3a3f66'); grad.addColorStop(1, '#141632');
  ctx.fillStyle = grad;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-o.w / 2, -11, o.w, 22, 10); else ctx.rect(-o.w / 2, -11, o.w, 22);
  ctx.fill();
  ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 2; ctx.stroke();
  // eye
  ctx.shadowColor = '#ff3b3b'; ctx.fillStyle = '#ff3b3b';
  ctx.beginPath(); ctx.arc(8, 0, 5 + Math.sin(G.t * 8) * 1.5, 0, 7); ctx.fill();
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

/* ---------------- Render ---------------- */
function render() {
  ctx.save();
  if (G.shake > 0.3) ctx.translate(rand(-1, 1) * G.shake, rand(-1, 1) * G.shake);
  drawBackground();
  for (const c of G.coinList) drawCoin(c);
  for (const o of G.obstacles) (o.type === 'spike' ? drawSpike : drawDrone)(o);
  if (G.mode !== 'dying') drawPlayer();
  drawParts();
  ctx.restore();
}

/* ---------------- HUD ---------------- */
let lastShown = -1;
function updateHUD() {
  const s = Math.floor(G.score);
  if (s !== lastShown) { scoreEl.textContent = s; lastShown = s; }
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
  G, store,
  start: startGame, jump: doJump,
  update: (dt) => update(dt, dt),
  spawnObstacle, spawnCoins, reset: resetGame,
};

})();
