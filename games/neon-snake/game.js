/* ============================================================
   NEON SNAKE — modern arcade snake for PixelArena
   Player + 4 bot snakes · big arena · camera · power orbs
   Vanilla Canvas 2D · fixed timestep · pooled particles
   ============================================================ */
(() => {
'use strict';

/* ---------------- Config ---------------- */
const W = 480, H = 720;
const AW = 960, AH = 1440;          // arena (2x screen)
const SEG_R = 10, SEG_GAP = 15;
const PLAYER_SPEED = 172, BOT_SPEED = 158;
const PLAYER_TURN = 4.6, BOT_TURN = 3.6;
const ORB_R = 9;

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
const TAU = Math.PI * 2;
function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
function turnToward(a, target, maxStep) {
  const d = angDiff(a, target);
  return a + clamp(d, -maxStep, maxStep);
}
function hexRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function mixRgb(a, b, t) {
  return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
    Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
}

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
  eat(combo) { this.beep(420 + Math.min(combo, 12) * 45, 0.09, 'sine', 0.1, 700 + Math.min(combo, 12) * 45); },
  gold() { this.beep(660, 0.1, 'triangle', 0.12, 990); setTimeout(() => this.beep(990, 0.14, 'triangle', 0.12, 1320), 90); },
  power() { this.beep(300, 0.16, 'square', 0.09, 600); },
  die() { this.beep(220, 0.45, 'sawtooth', 0.14, 40); },
  shieldBreak() { this.beep(500, 0.2, 'square', 0.12, 150); },
  toggle() { this.muted = !this.muted; return this.muted; }
};

/* ---------------- Storage ---------------- */
const store = {
  get best() {
    try { return parseInt(localStorage.getItem('neonSnakeBest') || '0', 10) || 0; }
    catch (e) { return 0; }
  },
  set best(v) {
    try { localStorage.setItem('neonSnakeBest', String(v)); } catch (e) {}
  }
};

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id);
const stage = $('stage'), scoreEl = $('score'), bestEl = $('best');
const comboBadge = $('comboBadge'), fxBar = $('fxBar');
const titleOverlay = $('titleOverlay'), overOverlay = $('overOverlay'), pauseOverlay = $('pauseOverlay');
const titleBest = $('titleBest'), finalScore = $('finalScore'), overBest = $('overBest');
const newBestBadge = $('newBest'), shareBtn = $('shareBtn');
const muteBtn = $('muteBtn'), pauseBtn = $('pauseBtn');

/* ---------------- Game state ---------------- */
const BOT_DEFS = [
  { name: 'VOLT',  head: '#ff2bd6', tail: '#7b2bff' },
  { name: 'GHOST', head: '#7df9ff', tail: '#2b9fff' },
  { name: 'BLAZE', head: '#ffb35c', tail: '#ff5b3b' },
  { name: 'VENOM', head: '#7CFC00', tail: '#0fae5e' },
];
const G = {
  mode: 'title',          // title | playing | dying | over
  paused: false,
  t: 0, timeScale: 1, dieT: 0, shake: 0,
  score: 0, newBest: false,
  combo: 0, comboT: 0,
  player: null, bots: [],
  orbs: [], barriers: [], parts: [], floaters: [],
  cam: { x: 0, y: 0 },
  magnetT: 0, slowmoT: 0, x2T: 0, shield: false, invulnT: 0,
  fxT: 0, barrierScore: 0,
};
function makeSnake(name, isPlayer, head, tail, x, y, speed, turn) {
  const segs = [];
  for (let i = 0; i < 8; i++) segs.push({ x: x - i * SEG_GAP, y });
  return {
    name, isPlayer, segs,
    angle: 0, targetAngle: 0,
    speed, baseSpeed: speed, turn,
    alive: true, grow: 0,
    headRgb: hexRgb(head), tailRgb: hexRgb(tail),
    headCss: head, tailCss: tail, aiT: rand(0, 0.25), respawnT: 0,
    thinkSeed: Math.random() * 10,
  };
}
function freeSpot(minDistFromPlayer) {
  for (let tries = 0; tries < 24; tries++) {
    const x = rand(80, AW - 80), y = rand(80, AH - 80);
    if (minDistFromPlayer && G.player) {
      const dx = x - G.player.segs[0].x, dy = y - G.player.segs[0].y;
      if (dx * dx + dy * dy < minDistFromPlayer * minDistFromPlayer) continue;
    }
    let bad = false;
    for (const b of G.barriers) {
      if (x > b.x - 70 && x < b.x + b.w + 70 && y > b.y - 70 && y < b.y + b.h + 70) { bad = true; break; }
    }
    if (!bad) return { x, y };
  }
  return { x: AW / 2, y: AH / 2 };
}
function resetGame() {
  G.t = 0; G.timeScale = 1; G.dieT = 0; G.shake = 0;
  G.score = 0; G.newBest = false; G.combo = 0; G.comboT = 0;
  G.orbs.length = 0; G.barriers.length = 0; G.parts.length = 0; G.floaters.length = 0;
  G.magnetT = 0; G.slowmoT = 0; G.x2T = 0; G.shield = false; G.invulnT = 0;
  G.fxT = 0; G.barrierScore = 0; G.paused = false;
  G.player = makeSnake('YOU', true, '#00f0ff', '#ff2bd6', AW / 2, AH / 2, PLAYER_SPEED, PLAYER_TURN);
  G.bots = BOT_DEFS.map(d => {
    const s = freeSpot(380);
    return makeSnake(d.name, false, d.head, d.tail, s.x, s.y, BOT_SPEED, BOT_TURN);
  });
  G.cam.x = clamp(G.player.segs[0].x - W / 2, 0, AW - W);
  G.cam.y = clamp(G.player.segs[0].y - H / 2, 0, AH - H);
  for (let i = 0; i < 24; i++) spawnOrb('normal');
  pauseOverlay.classList.add('hidden');
}
resetGame();

/* ---------------- Input ---------------- */
function startGame() {
  resetGame();
  G.mode = 'playing';
  titleOverlay.classList.add('hidden');
  overOverlay.classList.add('hidden');
  if (typeof gtag === 'function') gtag('event', 'game_start', { game_name: 'neon_snake' });
}
let swipeStart = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || e.target.closest('a')) return;
  AudioSys.init();
  if (G.mode === 'title') { startGame(); return; }
  swipeStart = { x: e.clientX, y: e.clientY };
});
stage.addEventListener('pointermove', (e) => {
  if (!swipeStart || G.mode !== 'playing' || G.paused) return;
  const dx = e.clientX - swipeStart.x, dy = e.clientY - swipeStart.y;
  if (dx * dx + dy * dy > 24 * 24)
    G.player.targetAngle = Math.atan2(dy, dx);
});
window.addEventListener('pointerup', () => { swipeStart = null; });
const KEY_ANGLES = {
  ArrowUp: -Math.PI / 2, KeyW: -Math.PI / 2,
  ArrowDown: Math.PI / 2, KeyS: Math.PI / 2,
  ArrowLeft: Math.PI, KeyA: Math.PI,
  ArrowRight: 0, KeyD: 0,
};
window.addEventListener('keydown', (e) => {
  if (e.code in KEY_ANGLES) {
    e.preventDefault();
    AudioSys.init();
    if (G.mode === 'title') startGame();
    else if (G.mode === 'playing' && !G.paused) G.player.targetAngle = KEY_ANGLES[e.code];
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

/* ---------------- Orbs & barriers ---------------- */
const ORB_KINDS = {
  normal:  { color: '#00f0ff', pts: 10, weight: 78 },
  gold:    { color: '#ffd23f', pts: 50, weight: 6 },
  magnet:  { color: '#ff2bd6', pts: 15, weight: 4 },
  shield:  { color: '#7CFC00', pts: 15, weight: 4 },
  slowmo:  { color: '#b48cff', pts: 15, weight: 4 },
  x2:      { color: '#ff9f1c', pts: 15, weight: 4 },
};
const ORB_GLYPHS = { magnet: '🧲', shield: '🛡', slowmo: '⏳', x2: '✖' };
function spawnOrb(forceKind) {
  let kind = forceKind;
  if (!kind) {
    let r = Math.random() * 100, acc = 0;
    for (const k in ORB_KINDS) { acc += ORB_KINDS[k].weight; if (r <= acc) { kind = k; break; } }
    kind = kind || 'normal';
  }
  const p = freeSpot(0);
  G.orbs.push({ x: p.x, y: p.y, kind, r: ORB_R + (kind === 'gold' ? 3 : 0), ph: rand(0, TAU) });
}
function countOrbs(kind) {
  let n = 0;
  for (const o of G.orbs) if (o.kind === kind) n++;
  return n;
}
function maintainOrbs() {
  let normal = 0;
  for (const o of G.orbs) if (o.kind === 'normal' || o.kind === 'gold') normal++;
  while (normal < 24) { spawnOrb('normal'); normal++; }
  for (const k of ['magnet', 'shield', 'slowmo', 'x2'])
    if (countOrbs(k) === 0 && Math.random() < 0.012) spawnOrb(k);
}
function spawnBarrier() {
  const w = rand(70, 130), h = rand(22, 34);
  const p = freeSpot(260);
  G.barriers.push({ x: p.x - w / 2, y: p.y - h / 2, w, h, ph: rand(0, TAU) });
}
function maintainBarriers() {
  const want = Math.min(6, Math.floor(G.score / 400));
  while (G.barriers.length < want) spawnBarrier();
}

/* ---------------- Particles & floaters ---------------- */
function burst(x, y, color, n, spd) {
  for (let i = 0; i < n; i++) {
    if (G.parts.length > 260) break;
    const a = rand(0, TAU), s = rand(spd * 0.3, spd);
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.7), t: 0, color, r: rand(2, 4.5) });
  }
}
function floater(x, y, text, color) {
  G.floaters.push({ x, y, text, color: color || '#fff', t: 0, life: 1 });
}

/* ---------------- Snake movement ---------------- */
function moveSnake(s, dt) {
  s.angle = turnToward(s.angle, s.targetAngle, s.turn * dt);
  const mul = G.slowmoT > 0 ? 0.55 : 1;
  const spd = s.speed * mul;
  const head = s.segs[0];
  head.x += Math.cos(s.angle) * spd * dt;
  head.y += Math.sin(s.angle) * spd * dt;
  for (let i = 1; i < s.segs.length; i++) {
    const prev = s.segs[i - 1], cur = s.segs[i];
    const dx = prev.x - cur.x, dy = prev.y - cur.y;
    const d = Math.hypot(dx, dy);
    if (d > SEG_GAP) {
      const pull = (d - SEG_GAP) / d;
      cur.x += dx * pull; cur.y += dy * pull;
    }
  }
  if (s.grow > 0) {
    const tail = s.segs[s.segs.length - 1];
    s.segs.push({ x: tail.x, y: tail.y });
    s.grow--;
  }
}
function segCount(s) { return s.segs.length; }

/* ---------------- Bot AI ---------------- */
function botThink(b) {
  const head = b.segs[0];
  const px = Math.cos(b.angle), py = Math.sin(b.angle);
  // look ahead for danger (walls / barriers)
  const ax = head.x + px * 115, ay = head.y + py * 115;
  const margin = 55;
  let danger = ax < margin || ax > AW - margin || ay < margin || ay > AH - margin;
  if (!danger) {
    for (const br of G.barriers) {
      if (ax > br.x - 34 && ax < br.x + br.w + 34 && ay > br.y - 34 && ay < br.y + br.h + 34) { danger = true; break; }
    }
  }
  if (!danger) {
    // other snakes' bodies ahead
    const all = [G.player].concat(G.bots);
    outer: for (const o of all) {
      if (o === b || !o.alive) continue;
      for (let i = 3; i < o.segs.length; i += 2) {
        const sgm = o.segs[i];
        const dx = sgm.x - ax, dy = sgm.y - ay;
        if (dx * dx + dy * dy < 95 * 95) { danger = true; break outer; }
      }
    }
  }
  if (danger) {
    // steer toward arena center, biased by thinkSeed for variety
    const toC = Math.atan2(AH / 2 - head.y, AW / 2 - head.x);
    b.targetAngle = toC + (b.thinkSeed > 5 ? 0.7 : -0.7);
    return;
  }
  // aggression: longer bots sometimes hunt the player
  if (G.player.alive && b.segs.length > G.player.segs.length + 4 && Math.random() < 0.3) {
    const ph = G.player.segs[0];
    const dx = ph.x - head.x, dy = ph.y - head.y;
    if (dx * dx + dy * dy < 320 * 320) {
      b.targetAngle = Math.atan2(ph.y + Math.cos(G.player.angle) * 60 - head.y,
                                 ph.x + Math.sin(G.player.angle) * 60 - head.x);
      return;
    }
  }
  // seek nearest orb
  let best = null, bd = 520 * 520;
  for (const o of G.orbs) {
    const dx = o.x - head.x, dy = o.y - head.y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = o; }
  }
  if (best) {
    b.targetAngle = Math.atan2(best.y - head.y, best.x - head.x) + Math.sin(G.t * 2 + b.thinkSeed) * 0.12;
  } else {
    b.targetAngle += Math.sin(G.t * 0.9 + b.thinkSeed) * 0.02;
  }
}

/* ---------------- Eating & effects ---------------- */
function applyOrbEffect(kind, head) {
  if (kind === 'magnet') { G.magnetT = 8; floater(head.x, head.y - 24, 'MAGNET!', '#ff2bd6'); }
  else if (kind === 'shield') { G.shield = true; floater(head.x, head.y - 24, 'SHIELD!', '#7CFC00'); }
  else if (kind === 'slowmo') { G.slowmoT = 6; floater(head.x, head.y - 24, 'SLOW-MO!', '#b48cff'); }
  else if (kind === 'x2') { G.x2T = 10; floater(head.x, head.y - 24, '2X SCORE!', '#ff9f1c'); }
  AudioSys.power();
}
function eatOrb(s, idx) {
  const o = G.orbs[idx];
  G.orbs.splice(idx, 1);
  const head = s.segs[0];
  burst(o.x, o.y, ORB_KINDS[o.kind].color, o.kind === 'gold' ? 14 : 7, 130);
  if (s.isPlayer) {
    G.combo++;
    G.comboT = 3;
    const mult = Math.min(5, 1 + G.combo * 0.25);
    const pts = Math.round(ORB_KINDS[o.kind].pts * mult * (G.x2T > 0 ? 2 : 1));
    G.score += pts;
    floater(o.x, o.y - 14, '+' + pts, '#fff');
    if (o.kind === 'gold') AudioSys.gold(); else AudioSys.eat(G.combo);
    if (o.kind !== 'normal' && o.kind !== 'gold') applyOrbEffect(o.kind, head);
    s.grow += o.kind === 'gold' ? 3 : 1;
    G.shake = Math.max(G.shake, 2);
  } else {
    s.grow += o.kind === 'gold' ? 2 : 1;
  }
  // respawn a fresh orb to keep the arena stocked
  if (Math.random() < 0.9) spawnOrb();
}
function checkEating(s) {
  const head = s.segs[0];
  for (let i = G.orbs.length - 1; i >= 0; i--) {
    const o = G.orbs[i];
    // magnet pulls orbs in
    if (s.isPlayer && G.magnetT > 0) {
      const dx = head.x - o.x, dy = head.y - o.y, d = Math.hypot(dx, dy) || 1;
      if (d < 160) { o.x += dx / d * 320 * (1 / 60); o.y += dy / d * 320 * (1 / 60); }
    }
    const dx = head.x - o.x, dy = head.y - o.y;
    if (dx * dx + dy * dy < (SEG_R + o.r) * (SEG_R + o.r)) { eatOrb(s, i); return; }
  }
}

/* ---------------- Collisions & death ---------------- */
function hitsBarrier(x, y, pad) {
  for (const b of G.barriers)
    if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return true;
  return false;
}
function hitBody(head, snake, skip) {
  for (let i = skip; i < snake.segs.length; i++) {
    const s = snake.segs[i];
    const dx = head.x - s.x, dy = head.y - s.y;
    if (dx * dx + dy * dy < (SEG_R * 1.55) * (SEG_R * 1.55)) return i;
  }
  return -1;
}
function lethalHitPlayer() {
  const head = G.player.segs[0];
  if (G.invulnT > 0) return;
  if (G.shield) {
    G.shield = false; G.invulnT = 1.6;
    AudioSys.shieldBreak();
    burst(head.x, head.y, '#7CFC00', 22, 220);
    floater(head.x, head.y - 26, 'SHIELD DOWN!', '#7CFC00');
    G.shake = 8;
    return;
  }
  diePlayer();
}
function diePlayer() {
  G.mode = 'dying'; G.dieT = 0; G.timeScale = 0.25;
  AudioSys.die();
  const n = Math.min(12, G.player.segs.length);
  for (let i = 0; i < n; i++) {
    const s = G.player.segs[(i * G.player.segs.length / n) | 0];
    burst(s.x, s.y, i % 2 ? '#00f0ff' : '#ff2bd6', 6, 170);
    if (G.orbs.length < 60) G.orbs.push({ x: s.x + rand(-24, 24), y: s.y + rand(-24, 24), kind: 'normal', r: ORB_R, ph: rand(0, TAU) });
  }
  G.shake = 12;
}
function killBot(b, byPlayer) {
  b.alive = false; b.respawnT = 5;
  const head = b.segs[0];
  burst(head.x, head.y, b.headCss, 24, 230);
  const n = Math.min(8, b.segs.length);
  for (let i = 0; i < n; i++) {
    const s = b.segs[(i * b.segs.length / n) | 0];
    if (G.orbs.length < 70)
      G.orbs.push({ x: s.x + rand(-20, 20), y: s.y + rand(-20, 20), kind: Math.random() < 0.12 ? 'gold' : 'normal', r: ORB_R, ph: rand(0, TAU) });
  }
  if (byPlayer && G.mode === 'playing') {
    G.score += 100;
    floater(head.x, head.y - 26, b.name + ' DOWN! +100', b.headCss);
    AudioSys.gold();
  }
}
function checkCollisions() {
  const p = G.player;
  if (p.alive && G.mode === 'playing') {
    const head = p.segs[0];
    if (head.x < SEG_R || head.x > AW - SEG_R || head.y < SEG_R || head.y > AH - SEG_R) lethalHitPlayer();
    else if (hitsBarrier(head.x, head.y, SEG_R * 0.7)) lethalHitPlayer();
    else if (hitBody(head, p, 5) >= 0) lethalHitPlayer();
    else {
      for (const b of G.bots) {
        if (!b.alive) continue;
        const bi = hitBody(head, b, 0);
        if (bi >= 0) {
          const bh = b.segs[0];
          const dx = head.x - bh.x, dy = head.y - bh.y;
          if (dx * dx + dy * dy < (SEG_R * 2.1) * (SEG_R * 2.1)) {
            // head-on: both die
            killBot(b, false); lethalHitPlayer();
          } else lethalHitPlayer();
          break;
        }
      }
    }
  }
  // bots vs everything
  for (const b of G.bots) {
    if (!b.alive) continue;
    const head = b.segs[0];
    let dead = false, byPlayer = false;
    if (head.x < SEG_R || head.x > AW - SEG_R || head.y < SEG_R || head.y > AH - SEG_R) dead = true;
    else if (hitsBarrier(head.x, head.y, SEG_R * 0.7)) dead = true;
    else if (hitBody(head, b, 5) >= 0) dead = true;
    else {
      if (G.player.alive && hitBody(head, G.player, 0) >= 0) { dead = true; byPlayer = true; }
      if (!dead) {
        for (const o of G.bots) {
          if (o === b || !o.alive) continue;
          if (hitBody(head, o, 0) >= 0) { dead = true; break; }
        }
      }
    }
    if (dead) killBot(b, byPlayer);
  }
}

/* ---------------- Per-frame update ---------------- */
function update(dt) {
  G.t += dt;
  // timers
  if (G.magnetT > 0) G.magnetT -= dt;
  if (G.slowmoT > 0) G.slowmoT -= dt;
  if (G.x2T > 0) G.x2T -= dt;
  if (G.invulnT > 0) G.invulnT -= dt;
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) G.combo = 0; }
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 30);

  if (G.mode === 'playing') {
    moveSnake(G.player, dt);
    for (const b of G.bots) {
      if (!b.alive) {
        b.respawnT -= dt;
        if (b.respawnT <= 0) {
          const s = freeSpot(380);
          const fresh = makeSnake(b.name, false, b.headCss, b.tailCss, s.x, s.y, BOT_SPEED, BOT_TURN);
          b.segs = fresh.segs; b.angle = 0; b.targetAngle = 0; b.alive = true; b.grow = 0;
        }
        continue;
      }
      b.aiT -= dt;
      if (b.aiT <= 0) { b.aiT = 0.22; botThink(b); }
      moveSnake(b, dt);
    }
    checkEating(G.player);
    for (const b of G.bots) if (b.alive) checkEating(b);
    checkCollisions();
    maintainOrbs();
    maintainBarriers();
    // camera follows player
    const head = G.player.segs[0];
    const tx = clamp(head.x - W / 2, 0, AW - W);
    const ty = clamp(head.y - H / 2, 0, AH - H);
    G.cam.x += (tx - G.cam.x) * Math.min(1, dt * 6);
    G.cam.y += (ty - G.cam.y) * Math.min(1, dt * 6);
  } else if (G.mode === 'dying') {
    G.dieT += dt;
    G.timeScale += (1 - G.timeScale) * Math.min(1, dt * 2);
    if (G.dieT > 1.1) showOver();
  }
  // particles & floaters always animate
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.t += dt;
    if (p.t >= p.life) { G.parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.98; p.vy *= 0.98;
  }
  for (let i = G.floaters.length - 1; i >= 0; i--) {
    const f = G.floaters[i];
    f.t += dt; f.y -= 34 * dt;
    if (f.t >= f.life) G.floaters.splice(i, 1);
  }
  updateHUD();
}

/* ---------------- Rendering ---------------- */
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a0620'); g.addColorStop(0.5, '#060213'); g.addColorStop(1, '#0c0424');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const cx = -G.cam.x, cy = -G.cam.y;
  // grid
  ctx.strokeStyle = 'rgba(0,240,255,0.07)';
  ctx.lineWidth = 1;
  const step = 48;
  ctx.beginPath();
  for (let x = Math.floor(G.cam.x / step) * step; x < G.cam.x + W + step; x += step) {
    ctx.moveTo(x + cx, cy); ctx.lineTo(x + cx, AH + cy);
  }
  for (let y = Math.floor(G.cam.y / step) * step; y < G.cam.y + H + step; y += step) {
    ctx.moveTo(cx, y + cy); ctx.lineTo(AW + cx, y + cy);
  }
  ctx.stroke();
  // arena boundary walls
  ctx.save();
  ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 18;
  ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 5;
  ctx.strokeRect(cx + 2, cy + 2, AW - 4, AH - 4);
  ctx.restore();
  ctx.save();
  ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 10;
  ctx.strokeStyle = 'rgba(0,240,255,0.65)'; ctx.lineWidth = 2;
  ctx.strokeRect(cx + 8, cy + 8, AW - 16, AH - 16);
  ctx.restore();
}
function drawBarriers() {
  const cx = -G.cam.x, cy = -G.cam.y;
  for (const b of G.barriers) {
    const x = b.x + cx, y = b.y + cy;
    if (x + b.w < -40 || x > W + 40 || y + b.h < -40 || y > H + 40) continue;
    const pulse = 0.6 + Math.sin(G.t * 4 + b.ph) * 0.15;
    ctx.save();
    ctx.shadowColor = '#ff5b3b'; ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(60,10,8,0.92)';
    ctx.strokeStyle = '#ff6b3b'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, b.w, b.h, 8); else ctx.rect(x, y, b.w, b.h);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,160,60,' + pulse + ')';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + b.h / 2); ctx.lineTo(x + b.w / 2, y + 5);
    ctx.lineTo(x + b.w - 8, y + b.h / 2); ctx.lineTo(x + b.w / 2, y + b.h - 5);
    ctx.closePath(); ctx.stroke();
  }
}
function drawOrbs() {
  const cx = -G.cam.x, cy = -G.cam.y;
  for (const o of G.orbs) {
    const x = o.x + cx, y = o.y + cy;
    if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;
    const pulse = 1 + Math.sin(G.t * 5 + o.ph) * 0.12;
    const col = ORB_KINDS[o.kind].color;
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 14;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, o.r * pulse, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(x - o.r * 0.25, y - o.r * 0.25, o.r * 0.32, 0, TAU); ctx.fill();
    if (ORB_GLYPHS[o.kind]) {
      ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#060213';
      ctx.fillText(ORB_GLYPHS[o.kind], x, y + 1);
    }
  }
}
function drawSnake(s) {
  if (!s.alive) return;
  const n = s.segs.length;
  const cx = -G.cam.x, cy = -G.cam.y;
  const blink = s.isPlayer && G.invulnT > 0 && (G.t * 12 | 0) % 2 === 0;
  ctx.save();
  if (blink) ctx.globalAlpha = 0.35;
  // glow pass
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = s.headCss; ctx.shadowBlur = 16;
  ctx.strokeStyle = s.headCss; ctx.globalAlpha *= 1; ctx.globalAlpha = blink ? 0.12 : 0.28;
  ctx.lineWidth = SEG_R * 2.5;
  ctx.beginPath();
  s.segs.forEach((p, i) => { i ? ctx.lineTo(p.x + cx, p.y + cy) : ctx.moveTo(p.x + cx, p.y + cy); });
  ctx.stroke();
  ctx.restore();
  // body segments, head -> tail gradient
  ctx.save();
  if (blink) ctx.globalAlpha = 0.35;
  for (let i = n - 1; i >= 0; i--) {
    const t = n <= 1 ? 0 : i / (n - 1);
    const p = s.segs[i];
    const x = p.x + cx, y = p.y + cy;
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
    ctx.fillStyle = mixRgb(s.headRgb, s.tailRgb, t);
    ctx.beginPath();
    ctx.arc(x, y, SEG_R * (1 - t * 0.38), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  // head details
  const h = s.segs[0], hx = h.x + cx, hy = h.y + cy;
  const ex = Math.cos(s.angle), ey = Math.sin(s.angle);
  const nx = -ey, ny = ex;
  ctx.save();
  if (blink) ctx.globalAlpha = 0.35;
  for (const side of [-1, 1]) {
    const exx = hx + ex * 3 + nx * 5 * side, eyy = hy + ey * 3 + ny * 5 * side;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(exx, eyy, 3.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0a0620';
    ctx.beginPath(); ctx.arc(exx + ex * 1.4, eyy + ey * 1.4, 1.8, 0, TAU); ctx.fill();
  }
  ctx.restore();
  // bot name tag
  if (!s.isPlayer) {
    ctx.font = '700 10px Orbitron, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = s.headCss;
    ctx.shadowColor = s.headCss; ctx.shadowBlur = 8;
    ctx.fillText(s.name, hx, hy - SEG_R - 12);
    ctx.shadowBlur = 0;
  }
}
function drawParts() {
  const cx = -G.cam.x, cy = -G.cam.y;
  for (const p of G.parts) {
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x + cx, p.y + cy, p.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawFloaters() {
  const cx = -G.cam.x, cy = -G.cam.y;
  ctx.font = '800 14px Orbitron, sans-serif'; ctx.textAlign = 'center';
  for (const f of G.floaters) {
    ctx.globalAlpha = 1 - f.t / f.life;
    ctx.fillStyle = f.color;
    ctx.shadowColor = f.color; ctx.shadowBlur = 8;
    ctx.fillText(f.text, f.x + cx, f.y + cy);
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
function drawMinimap() {
  const mw = 84, mh = 126, mx = W - mw - 10, my = H - mh - 10;
  const sx = mw / AW, sy = mh / AH;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(6,2,19,0.78)';
  ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(mx, my, mw, mh, 6); else ctx.rect(mx, my, mw, mh);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#00f0ff';
  for (const o of G.orbs) ctx.fillRect(mx + o.x * sx - 1, my + o.y * sy - 1, 2, 2);
  for (const b of G.bots) {
    if (!b.alive) continue;
    ctx.fillStyle = b.headCss;
    ctx.beginPath(); ctx.arc(mx + b.segs[0].x * sx, my + b.segs[0].y * sy, 2.6, 0, TAU); ctx.fill();
  }
  if (G.player.alive) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(mx + G.player.segs[0].x * sx, my + G.player.segs[0].y * sy, 3, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
  ctx.strokeRect(mx + G.cam.x * sx, my + G.cam.y * sy, W * sx, H * sy);
  ctx.restore();
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
  drawBarriers();
  drawOrbs();
  for (const b of G.bots) drawSnake(b);
  if (G.player.alive || G.mode === 'dying') drawSnake(G.player);
  drawParts();
  drawFloaters();
  ctx.restore();
  drawMinimap();
  drawVignette();
}

/* ---------------- HUD ---------------- */
function updateHUD() {
  scoreEl.textContent = G.score.toLocaleString('en-IN');
  bestEl.textContent = Math.max(store.best, G.score).toLocaleString('en-IN');
  if (G.combo >= 3 && G.mode === 'playing') {
    comboBadge.classList.remove('hidden');
    const mult = Math.min(5, 1 + G.combo * 0.25);
    const label = 'x' + mult.toFixed(2).replace(/\.?0+$/, '') + ' COMBO';
    if (comboBadge.textContent !== label) {
      comboBadge.textContent = label;
      comboBadge.classList.remove('pop');
      void comboBadge.offsetWidth;
      comboBadge.classList.add('pop');
    }
  } else comboBadge.classList.add('hidden');
  const chips = [];
  if (G.magnetT > 0) chips.push('🧲' + Math.ceil(G.magnetT));
  if (G.x2T > 0) chips.push('✖️' + Math.ceil(G.x2T));
  if (G.slowmoT > 0) chips.push('⏳' + Math.ceil(G.slowmoT));
  if (G.shield) chips.push('🛡');
  const html = chips.map(c => '<span class="fx-chip">' + c + '</span>').join('');
  if (fxBar.innerHTML !== html) fxBar.innerHTML = html;
}

/* ---------------- Game over ---------------- */
function showOver() {
  G.mode = 'over';
  const prevBest = store.best;
  if (G.score > prevBest) { store.best = G.score; G.newBest = true; }
  titleBest.textContent = store.best.toLocaleString('en-IN');
  finalScore.textContent = G.score.toLocaleString('en-IN');
  overBest.textContent = store.best.toLocaleString('en-IN');
  newBestBadge.classList.toggle('hidden', !G.newBest);
  const msg = '🐍 I scored ' + G.score + ' in Neon Snake on PixelArena! Think you can beat it?';
  shareBtn.href = 'https://wa.me/?text=' + encodeURIComponent(msg + ' https://naresh-tech6380.github.io/pixelarena/games/neon-snake/');
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
    while (acc >= STEP && n < 5) { update(STEP * G.timeScale); acc -= STEP; n++; }
    if (n === 5) acc = 0;
  }
  render();
}
titleBest.textContent = store.best.toLocaleString('en-IN');
requestAnimationFrame(frame);

/* ---------------- Debug / test API ---------------- */
window.__neonSnake = { G, store, startGame, resetGame, spawnOrb, eatOrb, diePlayer, killBot, botThink, moveSnake, update, render, checkCollisions, makeSnake, freeSpot, ORB_KINDS };
})();
