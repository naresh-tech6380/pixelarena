/* ============================================================
   STACK TOWER — precision stacking for PixelArena
   Tap to drop the sliding block · trim the overhang ·
   chain perfect drops for combos · one miss ends the run
   Vanilla Canvas 2D · fixed timestep · procedural audio
   ============================================================ */
(() => {
'use strict';

/* ---------------- Config ---------------- */
const W = 480, H = 720;
const BASE_W = 210, BASE_H = 26;
const DROP_Y = H * 0.30;      // moving block's resting screen Y
const PERFECT_TOL = 8;        // px tolerance for a perfect drop
const GRAV = 1500;            // debris gravity px/s^2
const LOCK_T = 0.12;          // input lockout after a drop (s)

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
const TAU = Math.PI * 2;
const hsl = (h, s, l) => 'hsl(' + ((h % 360 + 360) % 360) + ',' + s + '%,' + l + '%)';

/* ---------------- Difficulty tuning (pure — unit tested) ---------------- */
function blockSpeed(level) { return Math.min(430, 150 + level * 8); }
function blockHeight(level) { return Math.max(13, BASE_H - Math.floor(level / 10) * 2); }
function blockHue(level) { return (190 + level * 6) % 360; }

/* ---------------- Audio (procedural) ---------------- */
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
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
      g.gain.setValueAtTime(vol || 0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  },
  drop() { this.beep(170, 0.12, 'sine', 0.16, 70); },
  perfect(combo) {
    const base = 523 * Math.pow(2, Math.min(combo, 12) / 12);
    this.beep(base, 0.12, 'triangle', 0.14);
    this.beep(base * 1.5, 0.18, 'triangle', 0.10);
  },
  miss() { this.beep(200, 0.5, 'sawtooth', 0.15, 45); },
  toggle() { this.muted = !this.muted; return this.muted; }
};

/* ---------------- Storage ---------------- */
const store = {
  get best() {
    try { return parseInt(localStorage.getItem('pixelarena-stacktower-best') || '0', 10) || 0; }
    catch (e) { return 0; }
  },
  set best(v) {
    try { localStorage.setItem('pixelarena-stacktower-best', String(v)); } catch (e) {}
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
  t: 0, dieT: 0, lockT: 0,
  shake: 0, flash: 0,
  score: 0, combo: 0, newBest: false,
  blocks: [],             // placed blocks, world coords (y grows downward)
  moving: null,           // the sliding block
  debris: [], parts: [], floaters: [],
  stars: [],
  camY: 0,                // world->screen: screenY = worldY - camY
  spawnDir: 1,
};
function towerTop() { return G.blocks[G.blocks.length - 1]; }
function camTarget() { return G.moving ? G.moving.y - DROP_Y : -DROP_Y; }

function spawnMoving() {
  const prev = towerTop();
  const level = G.score;
  const w = prev.w, h = blockHeight(level), hue = blockHue(level);
  const dir = G.spawnDir;
  G.spawnDir *= -1;
  G.moving = {
    x: dir > 0 ? -w - 8 : W + 8,
    y: prev.y - h,        // world Y — lands with zero vertical jump
    w, h, hue, dir,
    speed: blockSpeed(level),
  };
}
function resetGame() {
  G.t = 0; G.dieT = 0; G.lockT = 0;
  G.shake = 0; G.flash = 0;
  G.score = 0; G.combo = 0; G.newBest = false;
  G.blocks = [{ x: (W - BASE_W) / 2, w: BASE_W, y: 0, h: BASE_H, hue: blockHue(0) }];
  G.debris.length = 0; G.parts.length = 0; G.floaters.length = 0;
  G.paused = false; G.spawnDir = 1;
  spawnMoving();
  G.camY = -(H - 170);    // base starts near the bottom; camera eases up
  pauseOverlay.classList.add('hidden');
  updateHUD();
}
function startGame() {
  resetGame();
  G.mode = 'playing';
  titleOverlay.classList.add('hidden');
  overOverlay.classList.add('hidden');
}
// background stars (screen space, init once)
for (let i = 0; i < 70; i++)
  G.stars.push({ x: rand(0, W), y: rand(0, H), r: rand(1, 2.4), ph: rand(0, TAU), spd: rand(8, 30) });
resetGame();

/* ---------------- Input ---------------- */
function tap() {
  AudioSys.init();
  if (G.mode === 'title') { startGame(); return; }
  if (G.mode !== 'playing' || G.paused) return;
  dropBlock();
}
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || e.target.closest('a')) return;
  tap();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    tap();
  } else if (e.code === 'KeyP') togglePause();
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

/* ---------------- Particles & floaters ---------------- */
function burst(x, y, hue, n, spd) {
  for (let i = 0; i < n; i++) {
    if (G.parts.length > 240) break;
    const a = rand(0, TAU), s = rand(spd * 0.3, spd);
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      t: 0, life: rand(0.35, 0.8), color: hsl(hue + rand(-14, 14), 100, 62), r: rand(2, 4.5) });
  }
}
function floater(x, y, text, color) {
  G.floaters.push({ x, y, text, color: color || '#fff', t: 0, life: 1.1 });
}
function addDebris(x, w, m, vx) {
  if (w <= 0) return;
  G.debris.push({ x, y: m.y, w, h: m.h, hue: m.hue,
    vx: vx * rand(120, 220), vy: rand(-90, -30),
    rot: 0, vr: rand(-4, 4) * (vx > 0 ? 1 : -1), t: 0, life: rand(0.8, 1.1) });
}

/* ---------------- Core mechanic ---------------- */
function dropBlock() {
  if (G.mode !== 'playing' || G.paused || G.lockT > 0) return;
  const m = G.moving, prev = towerTop();
  const dx = m.x - prev.x;
  const cx = m.x + m.w / 2;      // screen-space center for effects
  const cy = DROP_Y + m.h / 2;
  if (Math.abs(dx) <= PERFECT_TOL) {
    // ---- perfect: full width kept, snapped into place ----
    G.blocks.push({ x: prev.x, w: prev.w, y: prev.y - m.h, h: m.h, hue: m.hue });
    G.combo++; G.score++;
    G.flash = 0.6;
    AudioSys.perfect(G.combo);
    burst(cx, cy, m.hue, 26, 260);
    floater(cx, cy - 34, 'PERFECT' + (G.combo > 1 ? ' ×' + G.combo : ''), '#ffffff');
  } else {
    const nl = Math.max(m.x, prev.x);
    const nr = Math.min(m.x + m.w, prev.x + prev.w);
    if (nr <= nl) { miss(m); return; }   // complete miss
    // ---- trim: overhang breaks off and falls ----
    if (m.x < nl) addDebris(m.x, nl - m.x, m, -1);
    if (m.x + m.w > nr) addDebris(nr, m.x + m.w - nr, m, 1);
    G.blocks.push({ x: nl, w: nr - nl, y: prev.y - m.h, h: m.h, hue: m.hue });
    G.combo = 0; G.score++;
    G.shake = 4;
    AudioSys.drop();
    burst(nl + (nr - nl) / 2, cy, m.hue, 8, 120);
  }
  G.lockT = LOCK_T;
  spawnMoving();
  updateHUD();
}
function miss(m) {
  // the whole block tumbles off the tower
  addDebris(m.x, m.w, m, m.dir);
  G.moving = null;
  G.mode = 'dying'; G.dieT = 0;
  G.shake = 10;
  AudioSys.miss();
}

/* ---------------- Per-frame update ---------------- */
function slideMoving(dt) {
  const m = G.moving;
  if (!m) return;
  m.x += m.dir * m.speed * dt;
  if (m.dir > 0 && m.x + m.w > W) { m.x = W - m.w; m.dir = -1; }
  else if (m.dir < 0 && m.x < 0) { m.x = 0; m.dir = 1; }
}
function update(dt) {
  G.t += dt;
  if (G.lockT > 0) G.lockT -= dt;
  // camera eases so the drop zone stays put (all modes)
  const ct = camTarget();
  G.camY += (ct - G.camY) * Math.min(1, dt * 3.4);
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 26);
  if (G.flash > 0) G.flash = Math.max(0, G.flash - dt * 1.8);
  for (const s of G.stars) {
    s.y += s.spd * dt;
    if (s.y > H + 4) { s.y = -4; s.x = rand(0, W); }
  }
  if (G.mode === 'playing' && !G.paused) slideMoving(dt);
  else if (G.mode === 'title') slideMoving(dt);   // attract mode
  else if (G.mode === 'dying') {
    G.dieT += dt;
    if (G.dieT > 1.05) showOver();
  }
  for (let i = G.debris.length - 1; i >= 0; i--) {
    const d = G.debris[i];
    d.vy += GRAV * dt;
    d.x += d.vx * dt; d.y += d.vy * dt;
    d.rot += d.vr * dt; d.t += dt;
    if (d.t > d.life || d.y - G.camY > H + 90) G.debris.splice(i, 1);
  }
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.t += dt;
    if (p.t >= p.life) { G.parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.98; p.vy *= 0.985;
  }
  for (let i = G.floaters.length - 1; i >= 0; i--) {
    const f = G.floaters[i];
    f.t += dt; f.y -= 36 * dt;
    if (f.t >= f.life) G.floaters.splice(i, 1);
  }
}

/* ---------------- Rendering ---------------- */
function roundRectPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a0620'); g.addColorStop(0.55, '#060213'); g.addColorStop(1, '#0d0426');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (const s of G.stars) {
    ctx.globalAlpha = 0.3 + 0.35 * Math.sin(G.t * 2 + s.ph);
    ctx.fillStyle = '#cfe9ff';
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;
  // faint grid — verticals fixed, horizontals parallax with camera
  ctx.strokeStyle = 'rgba(0,240,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  const off = (((-G.camY * 0.18) % 48) + 48) % 48;
  for (let y = off; y <= H; y += 48) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
}
function drawBlockShape(x, y, w, h, hue, alpha) {
  if (w <= 1) return;
  ctx.save();
  if (alpha !== undefined) ctx.globalAlpha = alpha;
  ctx.shadowColor = hsl(hue, 100, 60);
  ctx.shadowBlur = 16;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, hsl(hue, 92, 64));
  g.addColorStop(1, hsl(hue, 88, 40));
  ctx.fillStyle = g;
  roundRectPath(x, y, w, h, 6);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  roundRectPath(x + 3, y + 2, Math.max(0, w - 6), 4, 2);
  ctx.fill();
  ctx.restore();
}
function drawTower() {
  for (let i = 0; i < G.blocks.length; i++) {
    const b = G.blocks[i];
    const sy = b.y - G.camY;
    if (sy > H + 40 || sy + b.h < -60) continue;
    drawBlockShape(b.x, sy, b.w, b.h, b.hue);
  }
  // neon platform under the base block
  const base = G.blocks[0];
  const py = base.y + base.h - G.camY;
  if (py > -20 && py < H + 20) {
    ctx.save();
    ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 22;
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(20, py, W - 40, 4);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,240,255,0.18)';
    ctx.fillRect(20, py + 4, W - 40, 26);
  }
}
function drawMoving() {
  const m = G.moving;
  if (!m || G.mode === 'over') return;
  const sy = m.y - G.camY;
  ctx.save();
  ctx.shadowColor = hsl(m.hue, 100, 65);
  ctx.shadowBlur = 16 + 7 * Math.sin(G.t * 6);
  const g = ctx.createLinearGradient(0, sy, 0, sy + m.h);
  g.addColorStop(0, hsl(m.hue, 95, 70));
  g.addColorStop(1, hsl(m.hue, 90, 46));
  ctx.fillStyle = g;
  roundRectPath(m.x, sy, m.w, m.h, 6);
  ctx.fill();
  ctx.restore();
  // guide ticks under the moving block
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(m.x + 4, sy + m.h + 6, 2, 8);
  ctx.fillRect(m.x + m.w - 6, sy + m.h + 6, 2, 8);
}
function drawDebris() {
  for (const d of G.debris) {
    const sy = d.y - G.camY;
    if (sy > H + 60 || sy < -80) continue;
    ctx.save();
    ctx.translate(d.x + d.w / 2, sy + d.h / 2);
    ctx.rotate(d.rot);
    drawBlockShape(-d.w / 2, -d.h / 2, d.w, d.h, d.hue, clamp(1 - d.t / d.life, 0, 1));
    ctx.restore();
  }
}
function drawParts() {
  for (const p of G.parts) {
    ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawFloaters() {
  ctx.font = '900 20px Orbitron, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of G.floaters) {
    const a = clamp(1 - f.t / f.life, 0, 1);
    const scale = 1 + 0.25 * Math.max(0, 1 - f.t * 5);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = a;
    ctx.fillStyle = f.color;
    ctx.shadowColor = f.color; ctx.shadowBlur = 12;
    ctx.fillText(f.text, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
function drawFlash() {
  if (G.flash <= 0) return;
  const g = ctx.createRadialGradient(W / 2, DROP_Y, 10, W / 2, DROP_Y, 280);
  g.addColorStop(0, 'rgba(255,255,255,' + (G.flash * 0.5).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
function drawVignette() {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.36, W / 2, H / 2, H * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(2,0,10,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
function render() {
  ctx.save();
  if (G.shake > 0) ctx.translate(rand(-G.shake, G.shake) * 0.5, rand(-G.shake, G.shake) * 0.5);
  drawBackground();
  drawTower();
  drawMoving();
  drawDebris();
  drawParts();
  drawFloaters();
  ctx.restore();
  drawFlash();
  drawVignette();
}

/* ---------------- HUD ---------------- */
function updateHUD() {
  scoreEl.textContent = G.score;
  bestEl.textContent = Math.max(store.best, G.score);
}

/* ---------------- Game over ---------------- */
function showOver() {
  G.mode = 'over';
  const prevBest = store.best;
  if (G.score > prevBest) { store.best = G.score; G.newBest = true; }
  titleBest.textContent = store.best;
  finalScore.textContent = G.score;
  overBest.textContent = store.best;
  newBestBadge.classList.toggle('hidden', !G.newBest);
  const msg = '🧱 I stacked ' + G.score + ' blocks in Stack Tower on PixelArena! Can you beat it?';
  shareBtn.href = 'https://wa.me/?text=' + encodeURIComponent(msg + ' https://naresh-tech6380.github.io/pixelarena/games/stack-tower/');
  overOverlay.classList.remove('hidden');
}

/* ---------------- Main loop (fixed timestep) ---------------- */
let last = performance.now(), acc = 0;
const STEP = 1 / 60;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  if (!G.paused && G.mode !== 'title' && G.mode !== 'over') {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) { update(STEP); acc -= STEP; n++; }
    if (n === 5) acc = 0;
  } else if (G.mode === 'title') {
    // keep the attract-mode background alive
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) { update(STEP); acc -= STEP; n++; }
    if (n === 5) acc = 0;
  }
  render();
}
titleBest.textContent = store.best;
requestAnimationFrame(frame);

/* ---------------- Debug / test API ---------------- */
window.__stackTower = {
  G, store, W, H, DROP_Y, PERFECT_TOL,
  startGame, resetGame, dropBlock, spawnMoving, slideMoving,
  blockSpeed, blockHeight, blockHue, camTarget,
  update, render, showOver, togglePause, tap,
};
})();
