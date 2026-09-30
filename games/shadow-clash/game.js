'use strict';
/* ============================================================
   SHADOW CLASH — 1v1 silhouette fighter (PixelArena)
   Pure combat/AI logic lives at the top (testable in node).
   All DOM/canvas/audio code runs only inside the browser guard.
   ============================================================ */

/* ---------------- Pure constants ---------------- */
const SC = {
  W: 480, H: 720, FLOOR: 600,
  GRAV: 2600, JUMP_V: 940,
  WALK: 235, AIR_CTRL: 0.75,
  ROUND_TIME: 45, ROUNDS_TO_WIN: 2,
  MIN_X: 36, MAX_X: 444,
  BODY_W: 40, BODY_H: 124,
};

/* Move frame data: startup / active / recover (seconds) */
const MOVES = {
  punch: { dmg: 6,  startup: 0.09, active: 0.09, recover: 0.22, range: 82,  kb: 180, lift: -30,  hitstun: 0.26, freeze: 0.00, spark: 8  },
  kick:  { dmg: 11, startup: 0.17, active: 0.10, recover: 0.32, range: 106, kb: 350, lift: -130, hitstun: 0.42, freeze: 0.06, spark: 15 },
};

/* AI difficulty per round: reaction (block chance), aggression, think interval, attack cooldown */
const DIFF = [
  { react: 0.22, aggro: 0.45, think: 0.24, atkCd: 0.90 },
  { react: 0.38, aggro: 0.62, think: 0.17, atkCd: 0.68 },
  { react: 0.55, aggro: 0.78, think: 0.12, atkCd: 0.50 },
];

/* Player-chosen difficulty: multiplies the per-round table above */
const DIFF_MOD = [
  { react: 0.45, aggro: 0.55, think: 1.70, atkCd: 1.60, aiDmg: 0.70 }, // easy
  { react: 1.00, aggro: 1.00, think: 1.00, atkCd: 1.00, aiDmg: 1.00 }, // normal
  { react: 1.40, aggro: 1.30, think: 0.65, atkCd: 0.65, aiDmg: 1.20 }, // hard
];
const DIFF_NAMES = ['easy', 'normal', 'hard'];

/* Effective AI params for the current round + chosen difficulty (pure) */
function aiParams(round, diffLevel) {
  const base = DIFF[clamp(round - 1, 0, DIFF.length - 1)];
  const mod = DIFF_MOD[clamp(diffLevel, 0, DIFF_MOD.length - 1)];
  return {
    react: clamp(base.react * mod.react, 0, 0.95),
    aggro: base.aggro * mod.aggro,
    think: base.think * mod.think,
    atkCd: base.atkCd * mod.atkCd,
  };
}
function aiDamageScale(diffLevel) {
  return DIFF_MOD[clamp(diffLevel, 0, DIFF_MOD.length - 1)].aiDmg;
}

const AI_ACTS = ['advance', 'retreat', 'punch', 'kick', 'block', 'jump', 'hold'];

/* ---------------- Pure helpers ---------------- */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function makeFighter(x, facing, color, isAI) {
  return {
    x: x, y: SC.FLOOR, vx: 0, vy: 0,
    facing: facing >= 0 ? 1 : -1, color: color, isAI: !!isAI,
    hp: 100, maxHp: 100,
    state: 'idle', stateT: 0,
    atkDidHit: false, hitDur: 0,
    blocking: false, invulnT: 0, flashT: 0,
    onGround: true, rounds: 0, walkPh: 0,
    ai: { nextThink: 0, plan: 'hold', planT: 0, atkCd: 0.7, wantBlock: 0, reactT: 0, acted: true },
  };
}

function resetFighter(f, x, facing) {
  f.x = x; f.y = SC.FLOOR; f.vx = 0; f.vy = 0;
  f.facing = facing >= 0 ? 1 : -1;
  f.hp = f.maxHp; f.state = 'idle'; f.stateT = 0;
  f.atkDidHit = false; f.hitDur = 0;
  f.blocking = false; f.invulnT = 0; f.flashT = 0;
  f.onGround = true; f.walkPh = 0;
  f.ai.nextThink = 0; f.ai.plan = 'hold'; f.ai.planT = 0;
  f.ai.atkCd = 0.7; f.ai.wantBlock = 0; f.ai.reactT = 0; f.ai.acted = true;
}

/* Axis-aligned body box of a fighter (feet-anchored). */
function bodyRect(f) {
  return { x1: f.x - SC.BODY_W / 2, x2: f.x + SC.BODY_W / 2, y1: f.y - SC.BODY_H, y2: f.y };
}

/* Attack hitbox in world coords (call only during active frames). */
function attackRect(f, mv) {
  const m = MOVES[mv];
  const x1 = f.facing > 0 ? f.x + 12 : f.x + 12 - m.range;
  const top = mv === 'kick' ? 98 : 114;
  const bot = mv === 'kick' ? 24 : 56;
  return { x1: x1, x2: x1 + m.range, y1: f.y - top, y2: f.y - bot };
}

function rectsOverlap(a, b) {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/* Which phase of a move are we in at time t? */
function attackPhase(mv, t) {
  const m = MOVES[mv];
  if (t < m.startup) return 'startup';
  if (t < m.startup + m.active) return 'active';
  if (t < m.startup + m.active + m.recover) return 'recover';
  return null;
}

/* Limb extension 0..1 for rendering the strike. */
function atkExt(mv, t) {
  const m = MOVES[mv];
  if (t < m.startup) return t / m.startup;
  if (t < m.startup + m.active) return 1;
  const r = (t - m.startup - m.active) / m.recover;
  return Math.max(0, 1 - r);
}

/*
 * Pure hit resolution. Returns a result object; the caller applies it.
 * att/def are fighter-shaped objects; mv is 'punch' | 'kick'.
 */
function resolveAttack(att, def, mv) {
  const m = MOVES[mv];
  if (def.invulnT > 0) return { landed: false, reason: 'dodge' };
  if (def.state === 'ko') return { landed: false, reason: 'down' };
  const hb = attackRect(att, mv);
  const bb = bodyRect(def);
  if (!rectsOverlap(hb, bb)) return { landed: false, reason: 'whiff' };
  const blocked = def.blocking && def.state === 'block';
  let damage = blocked ? Math.max(1, Math.round(m.dmg * 0.12)) : m.dmg;
  if (att.isAI && typeof G !== 'undefined') damage = Math.max(1, Math.round(damage * aiDamageScale(G.diffLevel)));
  return {
    landed: true,
    blocked: blocked,
    damage: damage,
    kb: m.kb * (blocked ? 0.35 : 1),
    lift: blocked ? 0 : m.lift,
    hitstun: blocked ? 0.08 : m.hitstun,
    freeze: m.freeze,
    spark: m.spark,
    dir: def.x >= att.x ? 1 : -1,
  };
}

/*
 * Pure AI brain. Returns one of AI_ACTS.
 * rand: () => [0,1) — injectable for tests.
 */
function aiDecide(self, opp, diff, rand) {
  if (self.hp <= 0 || opp.hp <= 0) return 'hold';
  const dist = Math.abs(opp.x - self.x);
  const r = rand();
  if (dist > 165) {
    if (r < 0.06) return 'jump';
    return 'advance';
  }
  if (dist < 52 && r < 0.28) return 'retreat';
  if (dist < 118) {
    if (r < diff.aggro) return r < diff.aggro * 0.62 ? 'punch' : 'kick';
    if (r < diff.aggro + 0.20) return 'block';
    return 'hold';
  }
  if (r < 0.55) return 'advance';
  if (r < 0.62) return 'jump';
  return 'hold';
}

/* Pure reactive-block check (called on a ~10Hz tick by the game loop). */
function aiShouldBlock(diff, dist, oppWindingUp, rand) {
  return !!oppWindingUp && dist <= 155 && rand() < diff.react;
}

/*
 * Round outcome: 0 = ongoing, 1 = player wins, 2 = AI wins, 3 = draw.
 */
function roundResult(p1, p2, timeLeft) {
  const d1 = p1.hp <= 0, d2 = p2.hp <= 0;
  if (d1 && d2) {
    if (p1.hp === p2.hp) return 3;
    return p1.hp > p2.hp ? 1 : 2;
  }
  if (d1) return 2;
  if (d2) return 1;
  if (timeLeft <= 0) {
    if (p1.hp === p2.hp) return 3;
    return p1.hp > p2.hp ? 1 : 2;
  }
  return 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SC: SC, MOVES: MOVES, DIFF: DIFF, DIFF_MOD: DIFF_MOD, DIFF_NAMES: DIFF_NAMES, AI_ACTS: AI_ACTS,
    clamp: clamp, makeFighter: makeFighter, resetFighter: resetFighter,
    bodyRect: bodyRect, attackRect: attackRect, rectsOverlap: rectsOverlap,
    attackPhase: attackPhase, atkExt: atkExt,
    resolveAttack: resolveAttack, aiDecide: aiDecide, aiParams: aiParams, aiDamageScale: aiDamageScale,
    aiShouldBlock: aiShouldBlock, roundResult: roundResult,
  };
}

/* ============================================================
   BROWSER GAME — everything below needs DOM + canvas.
   ============================================================ */
if (typeof document !== 'undefined' && typeof window !== 'undefined') (function () {
'use strict';

function $(id) { return document.getElementById(id); }
function storeGet(k, fb) {
  try { const v = window.localStorage.getItem(k); return v === null ? fb : v; }
  catch (e) { return fb; }
}
function storeSet(k, v) {
  try { window.localStorage.setItem(k, v); } catch (e) {}
}

/* ---------------- DOM ---------------- */
const canvas = $('game'), stage = $('stage');
const hp1El = $('hp1'), hp2El = $('hp2');
const pips1El = $('pips1'), pips2El = $('pips2');
const timerEl = $('timer'), dmg1El = $('dmg1'), dmg2El = $('dmg2');
const titleOverlay = $('titleOverlay'), overOverlay = $('overOverlay'), pauseOverlay = $('pauseOverlay');
const titleBest = $('titleBest'), overEyebrow = $('overEyebrow'), overTitle = $('overTitle');
const finalScore = $('finalScore'), overStreak = $('overStreak'), overBest = $('overBest');
const newBestBadge = $('newBest'), shareBtn = $('shareBtn');
const muteBtn = $('muteBtn'), pauseBtn = $('pauseBtn'), resumeBtn = $('resumeBtn'), retryBtn = $('retryBtn');
const controlsEl = $('fightControls');
if (!canvas || !stage) return;
const ctx = canvas.getContext('2d');
if (!ctx) return;

/* ---------------- Audio (tiny WebAudio synth) ---------------- */
const AudioSys = {
  ac: null, muted: storeGet('shadowClashMuted', '0') === '1',
  init: function () {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ac.destination);
    } catch (e) { this.ac = null; }
  },
  tone: function (f0, f1, dur, type, vol, delay) {
    if (!this.ac || this.muted) return;
    try {
      const t = this.ac.currentTime + (delay || 0);
      const o = this.ac.createOscillator(), g = this.ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(vol || 0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  },
  noise: function (dur, freq, vol, delay, q) {
    if (!this.ac || this.muted) return;
    try {
      const t = this.ac.currentTime + (delay || 0);
      const len = Math.floor(this.ac.sampleRate * dur);
      const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ac.createBufferSource(); src.buffer = buf;
      const fl = this.ac.createBiquadFilter(); fl.type = 'lowpass';
      fl.frequency.value = freq; fl.Q.value = q || 0.8;
      const g = this.ac.createGain(); g.gain.value = vol || 0.4;
      src.connect(fl); fl.connect(g); g.connect(this.master);
      src.start(t);
    } catch (e) {}
  },
  punch: function () { this.noise(0.10, 900, 0.5); this.tone(180, 60, 0.10, 'sine', 0.5); },
  kick: function () { this.noise(0.14, 600, 0.6); this.tone(130, 40, 0.16, 'sine', 0.6); },
  whiff: function () { this.noise(0.07, 2400, 0.12); },
  block: function () { this.tone(1400, 900, 0.07, 'square', 0.16); this.noise(0.06, 4000, 0.18); },
  jump: function () { this.noise(0.08, 1200, 0.10); },
  bell: function () { this.tone(880, 870, 0.5, 'sine', 0.35); this.tone(880, 860, 0.7, 'sine', 0.3, 0.35); },
  ko: function () { this.noise(0.5, 300, 0.8); this.tone(90, 28, 0.55, 'sine', 0.8); },
  ui: function () { this.tone(600, 900, 0.07, 'square', 0.12); },
};

/* ---------------- Game state ---------------- */
const G = {
  mode: 'title', paused: false,
  round: 1, timeLeft: SC.ROUND_TIME, diffLevel: 1,
  p1: makeFighter(150, 1, '#00f0ff', false),
  p2: makeFighter(330, -1, '#ff2bd6', true),
  particles: [], embers: [],
  shake: 0, freeze: 0, timeScale: 1, koSlowT: 0,
  banner: null, introT: 0, roundEndT: 0, pendingWinner: 0,
  streak: 0, best: parseInt(storeGet('shadowClashBest', '0'), 10) || 0,
  newBest: false, time: 0, flash: 0,
  skyline: [], clouds: [],
};
for (let i = 0; i < 26; i++) {
  G.embers.push({ x: Math.random() * SC.W, y: Math.random() * SC.H, s: 1 + Math.random() * 2.2, v: 12 + Math.random() * 26, ph: Math.random() * 6.28 });
}
(function buildSkyline() {
  let x = -20;
  while (x < SC.W + 40) {
    const w = 34 + Math.random() * 60, h = 90 + Math.random() * 190;
    const wins = [];
    for (let wy = 12; wy < h - 14; wy += 18)
      for (let wx = 6; wx < w - 8; wx += 14)
        if (Math.random() < 0.22) wins.push({ x: wx, y: wy });
    G.skyline.push({ x: x, w: w, h: h, wins: wins });
    x += w + 6 + Math.random() * 22;
  }
  for (let i = 0; i < 4; i++)
    G.clouds.push({ bx: Math.random() * SC.W, y: 60 + Math.random() * 170, s: 0.7 + Math.random() * 0.9, v: 6 + Math.random() * 10 });
})();

/* ---------------- Particles ---------------- */
function spawnBurst(x, y, color, n, spd) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = spd * (0.35 + Math.random() * 0.85);
    G.particles.push({
      x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - spd * 0.35,
      life: 0.35 + Math.random() * 0.35, maxLife: 0.7,
      size: 2 + Math.random() * 3.5, color: color, grav: 900, add: true,
    });
  }
  if (G.particles.length > 260) G.particles.splice(0, G.particles.length - 260);
}
function spawnDust(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    G.particles.push({
      x: x + (Math.random() - 0.5) * 44, y: y - Math.random() * 8,
      vx: (Math.random() - 0.5) * 130, vy: -40 - Math.random() * 90,
      life: 0.4 + Math.random() * 0.3, maxLife: 0.7,
      size: 3 + Math.random() * 4, color: color || 'rgba(150,160,200,0.5)', grav: -60, add: false,
    });
  }
}
function updateParticles(dt) {
  const ps = G.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) { ps.splice(i, 1); continue; }
    p.vy += p.grav * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
}

/* ---------------- HUD ---------------- */
function updateHUD() {
  if (hp1El) hp1El.style.width = clamp(G.p1.hp / G.p1.maxHp * 100, 0, 100) + '%';
  if (hp2El) hp2El.style.width = clamp(G.p2.hp / G.p2.maxHp * 100, 0, 100) + '%';
  if (timerEl) {
    const t = Math.max(0, Math.ceil(G.timeLeft));
    timerEl.textContent = t;
    timerEl.classList.toggle('low', t <= 10 && G.mode === 'fight');
  }
  const setPips = function (el, won, cls) {
    if (!el) return;
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) kids[i].className = 'pip' + (i < won ? ' ' + cls : '');
  };
  setPips(pips1El, G.p1.rounds, 'won-p1');
  setPips(pips2El, G.p2.rounds, 'won-p2');
}

/* ---------------- Banners ---------------- */
function showBanner(text, sub, dur, color) {
  G.banner = { text: text, sub: sub || '', t: dur || 1.6, dur: dur || 1.6, color: color || '#fff' };
}

/* ---------------- Flow ---------------- */
function startGame() {
  AudioSys.init(); AudioSys.ui();
  G.p1.rounds = 0; G.p2.rounds = 0;
  G.newBest = false;
  G.mode = 'intro';
  G.paused = false;
  if (titleOverlay) titleOverlay.classList.add('hidden');
  if (overOverlay) overOverlay.classList.add('hidden');
  if (pauseOverlay) pauseOverlay.classList.add('hidden');
  if (controlsEl) controlsEl.classList.remove('hidden');
  if (typeof gtag === 'function') gtag('event', 'game_start', { game_name: 'shadow_clash', difficulty: DIFF_NAMES[clamp(G.diffLevel, 0, 2)] });
  startRound(1);
}

function startRound(n) {
  G.round = n;
  G.timeLeft = SC.ROUND_TIME;
  resetFighter(G.p1, 150, 1);
  resetFighter(G.p2, 330, -1);
  G.p1.koDust = false; G.p2.koDust = false;
  G.particles.length = 0;
  G.shake = 0; G.freeze = 0; G.timeScale = 1; G.koSlowT = 0;
  G.mode = 'intro'; G.introT = 0;
  G.banner = null;
  updateHUD();
}

function endRound(winner, how) {
  G.mode = 'roundEnd';
  G.roundEndT = 0;
  G.pendingWinner = winner;
  if (winner === 1) { G.p1.rounds++; showBanner('ROUND WON', 'you take round ' + G.round, 2.2, '#00f0ff'); }
  else if (winner === 2) { G.p2.rounds++; showBanner('ROUND LOST', 'the AI takes round ' + G.round, 2.2, '#ff2bd6'); }
  else { showBanner('DRAW', 'round ' + G.round + ' replayed', 2.2, '#ffd23f'); }
  updateHUD();
}

function endMatch() {
  const won = G.p1.rounds >= SC.ROUNDS_TO_WIN;
  G.mode = 'over';
  G.timeScale = 1; G.shake = 0;
  if (controlsEl) controlsEl.classList.add('hidden');
  if (won) {
    G.streak++;
    if (G.streak > G.best) { G.best = G.streak; G.newBest = true; storeSet('shadowClashBest', String(G.best)); }
  } else {
    G.streak = 0;
  }
  if (overEyebrow) overEyebrow.textContent = won ? 'Flawless victory' : 'The shadow prevails';
  if (overTitle) { overTitle.textContent = won ? 'VICTORY' : 'DEFEAT'; overTitle.style.filter = won ? '' : 'hue-rotate(140deg) saturate(1.4)'; }
  if (finalScore) finalScore.textContent = G.p1.rounds + ' – ' + G.p2.rounds;
  if (overStreak) overStreak.textContent = G.streak;
  if (overBest) overBest.textContent = G.best;
  if (titleBest) titleBest.textContent = G.best;
  if (newBestBadge) newBestBadge.classList.toggle('show', G.newBest);
  if (shareBtn) {
    const msg = won
      ? 'I beat the AI ' + G.p1.rounds + '-' + G.p2.rounds + ' in Shadow Clash on PixelArena — win streak ' + G.streak + '! Think you can top it? ' + window.location.href
      : 'I went ' + G.p1.rounds + '-' + G.p2.rounds + ' vs the AI in Shadow Clash on PixelArena — can you beat it? ' + window.location.href;
    shareBtn.href = 'https://wa.me/?text=' + encodeURIComponent(msg);
  }
  if (typeof gtag === 'function') {
    gtag('event', 'game_over', { game_name: 'shadow_clash', result: won ? 'win' : 'lose', rounds_won: G.p1.rounds });
  }
  if (overOverlay) overOverlay.classList.remove('hidden');
}

function pauseGame() {
  if (G.mode !== 'fight' && G.mode !== 'intro' && G.mode !== 'roundEnd') return;
  if (G.paused) return;
  G.paused = true;
  if (pauseOverlay) pauseOverlay.classList.remove('hidden');
}
function resumeGame() {
  G.paused = false;
  if (pauseOverlay) pauseOverlay.classList.add('hidden');
}

/* ---------------- Combat actions ---------------- */
function faceOpp(f, opp) {
  if (opp.x !== f.x) f.facing = opp.x > f.x ? 1 : -1;
}
function canAct(f) {
  return (f.state === 'idle' || f.state === 'walk') && f.hp > 0;
}
function tryAttack(f, opp, mv) {
  if (!canAct(f)) return false;
  faceOpp(f, opp);
  f.state = mv; f.stateT = 0; f.atkDidHit = false; f.blocking = false;
  AudioSys.whiff();
  return true;
}
function tryJump(f) {
  if (!canAct(f) || !f.onGround) return false;
  f.vy = SC.JUMP_V * -1; f.onGround = false;
  f.invulnT = 0.28; /* dodge window on the way up */
  f.state = 'jump'; f.stateT = 0; f.blocking = false;
  AudioSys.jump();
  spawnDust(f.x, f.y, 5);
  return true;
}
function setBlock(f, on) {
  if (f.hp <= 0 || f.state === 'hit' || f.state === 'ko') return;
  if (on) {
    if (f.onGround && (f.state === 'idle' || f.state === 'walk')) {
      f.state = 'block'; f.stateT = 0; f.blocking = true; f.vx = 0;
    }
  } else if (f.state === 'block') {
    f.state = 'idle'; f.stateT = 0; f.blocking = false;
  }
}
function moveFighter(f, dir, dt) {
  if (!canAct(f)) return;
  if (f.state !== 'walk') { f.state = 'walk'; f.stateT = 0; }
  const sp = f.onGround ? SC.WALK : SC.WALK * SC.AIR_CTRL;
  if (f.onGround) f.x += dir * sp * dt;
  else f.vx = dir * sp; /* air drift handled in physics */
  f.facing = dir > 0 ? 1 : dir < 0 ? -1 : f.facing;
  f.walkPh += dt * 11;
}
function stopMove(f) {
  if (f.state === 'walk') { f.state = 'idle'; f.stateT = 0; }
}

function applyHit(att, def, r) {
  def.hp = Math.max(0, def.hp - r.damage);
  def.flashT = 0.12;
  def.vx = r.dir * r.kb;
  if (r.lift !== 0 && def.onGround) { def.vy = r.lift; def.onGround = false; }
  def.hitDur = r.hitstun;
  if (!r.blocked) {
    def.state = 'hit'; def.stateT = 0; def.blocking = false;
  }
  const ix = (att.x + def.x) / 2, iy = def.y - 92;
  spawnBurst(ix, iy, r.blocked ? '#b14bff' : att.color, r.spark, r.blocked ? 160 : 260);
  G.shake = r.blocked ? 3 : (r.damage >= 11 ? 13 : 7);
  if (r.freeze) G.freeze = r.freeze;
  if (r.blocked) AudioSys.block();
  else if (r.damage >= 11) AudioSys.kick();
  else AudioSys.punch();
  if (def.hp <= 0) {
    def.state = 'ko'; def.stateT = 0; def.blocking = false;
    def.vx = r.dir * 300; def.vy = -260; def.onGround = false;
    AudioSys.ko();
    G.timeScale = 0.25; G.koSlowT = 1.0;
    G.flash = 0.55;
    spawnBurst(def.x, def.y - 80, '#ffffff', 26, 340);
    spawnDust(def.x, def.y, 12);
  }
  updateHUD();
}

/* ---------------- Per-fighter update ---------------- */
function updateFighter(f, opp, dt) {
  f.stateT += dt;
  if (f.invulnT > 0) f.invulnT -= dt;
  if (f.flashT > 0) f.flashT -= dt;
  const st = f.state;

  if (st === 'punch' || st === 'kick') {
    const m = MOVES[st];
    const total = m.startup + m.active + m.recover;
    if (!f.atkDidHit && attackPhase(st, f.stateT) === 'active') {
      f.atkDidHit = true;
      const r = resolveAttack(f, opp, st);
      if (r.landed) applyHit(f, opp, r);
    }
    if (f.stateT >= total) { f.state = 'idle'; f.stateT = 0; f.blocking = false; }
  } else if (st === 'hit') {
    if (f.stateT >= f.hitDur) { f.state = 'idle'; f.stateT = 0; }
  } else if (st === 'ko') {
    /* handled by physics; round ends via koSlowT */
  }

  /* physics */
  if (!f.onGround || f.vy !== 0) {
    f.vy += SC.GRAV * dt;
    f.y += f.vy * dt;
    f.x += f.vx * dt;
    if (f.y >= SC.FLOOR) {
      f.y = SC.FLOOR; f.vy = 0; f.onGround = true;
      if (f.state === 'jump') { f.state = 'idle'; f.stateT = 0; spawnDust(f.x, f.y, 6); }
      if (f.state === 'ko') { f.vx *= 0.6; if (Math.abs(f.vx) < 20) f.vx = 0; }
    }
  } else {
    f.x += f.vx * dt;
    f.vx *= Math.pow(0.001, dt);
    if (Math.abs(f.vx) < 8) f.vx = 0;
  }
  f.x = clamp(f.x, SC.MIN_X, SC.MAX_X);

  /* body separation */
  const dx = f.x - opp.x;
  if (Math.abs(dx) < 44 && f.y === opp.y) {
    f.x = opp.x + (dx >= 0 ? 44 : -44);
    f.x = clamp(f.x, SC.MIN_X, SC.MAX_X);
  }

  /* auto-face while grounded and neutral */
  if (f.onGround && (f.state === 'idle' || f.state === 'walk' || f.state === 'block')) faceOpp(f, opp);
}

/* ---------------- AI driver ---------------- */
function updateAI(f, opp, dt) {
  if (f.hp <= 0) return;
  const d = aiParams(G.round, G.diffLevel);
  const ai = f.ai;

  /* reactive block tick (~10Hz) */
  ai.reactT += dt;
  if (ai.reactT >= 0.1) {
    ai.reactT = 0;
    const winding = (opp.state === 'punch' || opp.state === 'kick') && attackPhase(opp.state, opp.stateT) === 'startup';
    if (aiShouldBlock(d, Math.abs(opp.x - f.x), winding, Math.random)) ai.wantBlock = 0.45;
  }
  if (ai.wantBlock > 0) {
    ai.wantBlock -= dt;
    setBlock(f, true);
    return;
  }
  ai.nextThink -= dt; ai.planT -= dt;
  if (ai.nextThink <= 0) {
    ai.plan = aiDecide(f, opp, d, Math.random);
    ai.planT = 0.35 + Math.random() * 0.35;
    ai.nextThink = d.think;
    ai.acted = false;
  }
  setBlock(f, false);
  const dir = opp.x > f.x ? 1 : -1;
  const dist = Math.abs(opp.x - f.x);
  switch (ai.plan) {
    case 'advance': moveFighter(f, dir, dt); break;
    case 'retreat': moveFighter(f, -dir, dt); break;
    case 'punch':
    case 'kick':
      if (!ai.acted) {
        ai.acted = true;
        if (ai.atkCd <= 0 && dist < 120 && tryAttack(f, opp, ai.plan)) {
          ai.atkCd = d.atkCd * (0.8 + Math.random() * 0.5);
        } else { moveFighter(f, dir, dt); }
      }
      break;
    case 'block': setBlock(f, true); break;
    case 'jump': if (!ai.acted) { ai.acted = true; tryJump(f); } break;
    default: stopMove(f);
  }
  if (ai.planT <= 0 && (ai.plan === 'advance' || ai.plan === 'retreat' || ai.plan === 'hold')) stopMove(f);
  ai.atkCd -= dt;
}

/* ---------------- Input ---------------- */
const keys = {};
let blockHeld = false, moveL = false, moveR = false;

function onPunch() {
  AudioSys.init();
  if (G.mode === 'title') { startGame(); return; }
  if (G.mode !== 'fight' || G.paused) return;
  tryAttack(G.p1, G.p2, 'punch');
}
function onKick() {
  AudioSys.init();
  if (G.mode === 'title') { startGame(); return; }
  if (G.mode !== 'fight' || G.paused) return;
  tryAttack(G.p1, G.p2, 'kick');
}
function onJump() {
  AudioSys.init();
  if (G.mode === 'title') { startGame(); return; }
  if (G.mode !== 'fight' || G.paused) return;
  tryJump(G.p1);
}
function setBlockHeld(on, btn) {
  blockHeld = on;
  if (btn) btn.classList.toggle('held', on);
  if (G.mode !== 'fight' || G.paused) return;
  setBlock(G.p1, on);
}

window.addEventListener('keydown', function (e) {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) >= 0) e.preventDefault();
  AudioSys.init();
  if (k === 'enter' && G.mode === 'title') { startGame(); return; }
  if ((k === '1' || k === '2' || k === '3') && G.mode === 'title') { startWithDiff(parseInt(k, 10) - 1); return; }
  if (k === 'p' || k === 'escape') { G.paused ? resumeGame() : pauseGame(); return; }
  if (G.mode !== 'fight' || G.paused) return;
  if (e.repeat) return;
  keys[k] = true;
  if (k === 'a' || k === 'arrowleft') moveL = true;
  if (k === 'd' || k === 'arrowright') moveR = true;
  if (k === 'j') onPunch();
  if (k === 'k') onKick();
  if (k === 'l' || k === 's' || k === 'arrowdown') setBlockHeld(true, $('blockBtn'));
  if (k === 'w' || k === ' ' || k === 'arrowup') onJump();
});
window.addEventListener('keyup', function (e) {
  const k = e.key.toLowerCase();
  keys[k] = false;
  if (k === 'a' || k === 'arrowleft') moveL = false;
  if (k === 'd' || k === 'arrowright') moveR = false;
  if (k === 'l' || k === 's' || k === 'arrowdown') setBlockHeld(false, $('blockBtn'));
});

function bindHold(id, down, up) {
  const el = $(id);
  if (!el) return;
  const d = function (e) { e.preventDefault(); AudioSys.init(); el.classList.add('held'); down(); };
  const u = function (e) { if (e) e.preventDefault(); el.classList.remove('held'); up(); };
  el.addEventListener('touchstart', d, { passive: false });
  el.addEventListener('touchend', u, { passive: false });
  el.addEventListener('touchcancel', u, { passive: false });
  el.addEventListener('mousedown', d);
  el.addEventListener('mouseup', u);
  el.addEventListener('mouseleave', function () { el.classList.remove('held'); up(); });
}
function bindTap(id, fn) {
  const el = $(id);
  if (!el) return;
  const h = function (e) { e.preventDefault(); fn(); };
  el.addEventListener('touchstart', h, { passive: false });
  el.addEventListener('mousedown', h);
}
bindHold('leftBtn', function () { moveL = true; }, function () { moveL = false; });
bindHold('rightBtn', function () { moveR = true; }, function () { moveR = false; });
bindTap('punchBtn', onPunch);
bindTap('kickBtn', onKick);
bindTap('jumpBtn', onJump);
bindHold('blockBtn', function () { setBlockHeld(true, $('blockBtn')); }, function () { setBlockHeld(false, $('blockBtn')); });

if (titleOverlay) titleOverlay.addEventListener('click', function () { startGame(); });

/* Difficulty select: tapping a level starts the game at that difficulty */
function startWithDiff(i) {
  G.diffLevel = clamp(i, 0, 2);
  startGame();
}
(function () {
  var btns = document.querySelectorAll('#diffRow .diff-btn');
  for (var i = 0; i < btns.length; i++) {
    (function (btn) {
      var go = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        startWithDiff(parseInt(btn.getAttribute('data-diff'), 10) || 0);
      };
      btn.addEventListener('touchstart', go, { passive: false });
      btn.addEventListener('mousedown', go);
    })(btns[i]);
  }
})();
if (retryBtn) retryBtn.addEventListener('click', function (e) { e.stopPropagation(); startGame(); });
if (resumeBtn) resumeBtn.addEventListener('click', function (e) { e.stopPropagation(); resumeGame(); });
if (pauseBtn) pauseBtn.addEventListener('click', function (e) { e.stopPropagation(); AudioSys.init(); G.paused ? resumeGame() : pauseGame(); });
function syncMuteIcon() { if (muteBtn) muteBtn.textContent = AudioSys.muted ? '🔇' : '🔊'; }
if (muteBtn) muteBtn.addEventListener('click', function (e) {
  e.stopPropagation();
  AudioSys.init();
  AudioSys.muted = !AudioSys.muted;
  storeSet('shadowClashMuted', AudioSys.muted ? '1' : '0');
  syncMuteIcon();
});
syncMuteIcon();
document.addEventListener('visibilitychange', function () { if (document.hidden) pauseGame(); });
window.addEventListener('contextmenu', function (e) { if (stage && stage.contains(e.target)) e.preventDefault(); });

/* ---------------- Update ---------------- */
function updatePlayer(dt) {
  const p = G.p1;
  if (p.hp <= 0) return;
  if (moveL && !moveR) moveFighter(p, -1, dt);
  else if (moveR && !moveL) moveFighter(p, 1, dt);
  else if (p.state === 'walk') stopMove(p);
  if (blockHeld) setBlock(p, true);
  else if (p.state === 'block') setBlock(p, false);
}

let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const now = t / 1000;
  let dt = Math.min(0.05, now - (lastT || now));
  lastT = now;
  if (G.paused) { render(now); return; }

  if (G.freeze > 0) { G.freeze -= dt; render(now); return; }

  const sdt = dt * G.timeScale;
  G.time += sdt;

  /* KO slow-mo bookkeeping (real time) */
  if (G.koSlowT > 0) {
    G.koSlowT -= dt;
    if (G.koSlowT <= 0) {
      G.timeScale = 1;
      endRound(roundResult(G.p1, G.p2, G.timeLeft), 'ko');
      AudioSys.bell();
    }
  }

  if (G.mode === 'intro') {
    G.introT += dt;
    updateFighter(G.p1, G.p2, sdt);
    updateFighter(G.p2, G.p1, sdt);
    if (G.introT < 1.3 && !G.banner) showBanner('ROUND ' + G.round, 'best of 3', 1.3, '#fff');
    if (G.introT >= 1.3 && G.introT < 2.0 && (!G.banner || G.banner.t <= 0.05)) { showBanner('FIGHT!', '', 0.7, '#ffd23f'); AudioSys.bell(); }
    if (G.introT >= 2.0) { G.mode = 'fight'; G.banner = null; }
  } else if (G.mode === 'fight') {
    G.timeLeft -= dt;
    updatePlayer(sdt);
    updateAI(G.p2, G.p1, sdt);
    updateFighter(G.p1, G.p2, sdt);
    updateFighter(G.p2, G.p1, sdt);
    updateHUD();
    if (G.p1.hp <= 0 || G.p2.hp <= 0) {
      /* KO handled via koSlowT in applyHit; nothing to do here */
    } else {
      const w = roundResult(G.p1, G.p2, G.timeLeft);
      if (w !== 0) { endRound(w, 'time'); AudioSys.bell(); }
    }
  } else if (G.mode === 'roundEnd') {
    G.roundEndT += dt;
    updateFighter(G.p1, G.p2, sdt);
    updateFighter(G.p2, G.p1, sdt);
    if (G.roundEndT >= 2.3) {
      if (G.p1.rounds >= SC.ROUNDS_TO_WIN || G.p2.rounds >= SC.ROUNDS_TO_WIN) endMatch();
      else if (G.pendingWinner === 3) startRound(G.round); /* draw: replay */
      else startRound(G.round + 1);
    }
  } else {
    /* title / over: idle animation */
    updateFighter(G.p1, G.p2, sdt);
    updateFighter(G.p2, G.p1, sdt);
  }

  if (G.banner) { G.banner.t -= dt; if (G.banner.t <= 0) G.banner = null; }
  if (G.flash > 0) G.flash -= dt * 2;
  G.shake *= Math.pow(0.001, dt);
  if (G.shake < 0.2) G.shake = 0;
  updateParticles(sdt);
  /* embers drift always */
  for (let i = 0; i < G.embers.length; i++) {
    const e = G.embers[i];
    e.y -= e.v * dt; e.x += Math.sin(G.time * 0.8 + e.ph) * 8 * dt;
    if (e.y < -10) { e.y = SC.H + 10; e.x = Math.random() * SC.W; }
  }
  for (let i = 0; i < G.clouds.length; i++) {
    const c = G.clouds[i];
    c.bx += c.v * dt;
    if (c.bx > SC.W + 160) c.bx = -160;
  }
  render(now);
}

/* ---------------- Rendering ---------------- */
function render(now) {
  const W = SC.W, H = SC.H;
  ctx.save();
  if (G.shake > 0) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);

  /* sky */
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#04010d'); sky.addColorStop(0.55, '#0d0424'); sky.addColorStop(0.85, '#170a33');
  ctx.fillStyle = sky; ctx.fillRect(-20, -20, W + 40, H + 40);

  /* moon */
  ctx.save();
  ctx.shadowColor = 'rgba(210,225,255,0.55)'; ctx.shadowBlur = 70;
  ctx.fillStyle = '#e6efff';
  ctx.beginPath(); ctx.arc(352, 148, 62, 0, 6.283); ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(160,175,210,0.35)';
  [[334, 132, 12], [366, 160, 9], [352, 120, 7]].forEach(function (c) {
    ctx.beginPath(); ctx.arc(c[0], c[1], c[2], 0, 6.283); ctx.fill();
  });

  /* clouds (parallax, behind moon partially) */
  ctx.fillStyle = 'rgba(10,6,26,0.92)';
  G.clouds.forEach(function (cl) {
    ctx.save(); ctx.translate(cl.bx, cl.y); ctx.scale(cl.s, cl.s);
    ctx.beginPath();
    ctx.ellipse(0, 0, 70, 20, 0, 0, 6.283);
    ctx.ellipse(-44, 6, 44, 15, 0, 0, 6.283);
    ctx.ellipse(46, 7, 48, 16, 0, 0, 6.283);
    ctx.fill(); ctx.restore();
  });

  /* skyline */
  G.skyline.forEach(function (b) {
    const y0 = SC.FLOOR - b.h;
    ctx.fillStyle = '#0a0518';
    ctx.fillRect(b.x, y0, b.w, b.h);
    ctx.fillStyle = 'rgba(255,210,63,0.5)';
    b.wins.forEach(function (w) { ctx.fillRect(b.x + w.x, y0 + w.y, 6, 8); });
  });
  /* rooftop neon edge */
  ctx.save();
  ctx.shadowColor = 'rgba(255,43,214,0.6)'; ctx.shadowBlur = 12;
  ctx.strokeStyle = 'rgba(255,43,214,0.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, SC.FLOOR); ctx.lineTo(W, SC.FLOOR); ctx.stroke();
  ctx.restore();

  /* floor */
  const fg = ctx.createLinearGradient(0, SC.FLOOR, 0, H);
  fg.addColorStop(0, '#0b061e'); fg.addColorStop(1, '#040110');
  ctx.fillStyle = fg; ctx.fillRect(-20, SC.FLOOR, W + 40, H - SC.FLOOR + 20);
  ctx.strokeStyle = 'rgba(0,240,255,0.10)'; ctx.lineWidth = 1;
  for (let gx = 24; gx < W; gx += 48) {
    ctx.beginPath(); ctx.moveTo(gx, SC.FLOOR + 6); ctx.lineTo(gx - 30, H); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,240,255,0.16)';
  for (let gy = SC.FLOOR + 24; gy < H; gy += 34) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }

  /* embers */
  G.embers.forEach(function (e) {
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(G.time * 2 + e.ph));
    ctx.fillStyle = 'rgba(255,150,80,' + (0.5 * tw).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(e.x, e.y, e.s, 0, 6.283); ctx.fill();
  });

  /* fighters (AI behind player slightly) */
  drawFighter(G.p2, now);
  drawFighter(G.p1, now);

  /* particles (additive sparks) */
  G.particles.forEach(function (p) {
    const a = clamp(p.life / p.maxLife, 0, 1);
    if (p.add) ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  });

  /* KO flash */
  if (G.flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + clamp(G.flash, 0, 0.6).toFixed(3) + ')';
    ctx.fillRect(-20, -20, W + 40, H + 40);
  }

  /* banner */
  if (G.banner) {
    const b = G.banner;
    const p = 1 - b.t / b.dur; /* 0→1 */
    const a = b.t < 0.35 ? b.t / 0.35 : 1;
    const scale = 1 + 0.45 * Math.exp(-p * 7);
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(W / 2, H * 0.38);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.font = '900 52px Orbitron, sans-serif';
    ctx.shadowColor = b.color; ctx.shadowBlur = 26;
    ctx.fillStyle = b.color;
    ctx.fillText(b.text, 0, 0);
    if (b.sub) {
      ctx.font = '600 17px Orbitron, sans-serif';
      ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(b.sub.toUpperCase(), 0, 34);
    }
    ctx.restore();
  }

  ctx.restore();
}

/* Procedural silhouette fighter with neon rim light. */
function drawFighter(f, now) {
  const col = f.color, fx = f.facing;
  const x = f.x, fy = f.y;
  const st = f.state, t = f.stateT;

  /* floor reflection glow */
  ctx.save();
  ctx.globalAlpha = 0.20;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(x, SC.FLOOR + 10, 52, 12, 0, 0, 6.283); ctx.fill();
  ctx.restore();

  if (st === 'ko') { drawKOFighter(f, now); return; }

  let crouch = 0, lean = 0;
  const bob = Math.sin(now * 2.4 + f.walkPh) * 2;
  let fistF = { x: x + fx * 26, y: fy - 92 + bob };
  let fistB = { x: x - fx * 12, y: fy - 82 + bob };
  let footF = { x: x + fx * 13, y: fy };
  let footB = { x: x - fx * 13, y: fy };

  if (st === 'walk') {
    const s = Math.sin(f.walkPh);
    footF = { x: x + fx * (8 + 20 * s), y: fy - Math.max(0, 13 * s) };
    footB = { x: x - fx * (8 + 20 * s), y: fy - Math.max(0, -13 * s) };
    fistF = { x: x + fx * 24, y: fy - 90 + bob * 0.5 };
  } else if (st === 'punch' || st === 'kick') {
    const e = atkExt(st, t);
    if (st === 'punch') {
      fistF = { x: x + fx * (28 + 54 * e), y: fy - 96 - 8 * e };
      lean = 0.18 * e;
    } else {
      footF = { x: x + fx * (26 + 74 * e), y: fy - 26 - 52 * e };
      lean = -0.22 * e;
      fistF = { x: x - fx * 14, y: fy - 92 };
    }
  } else if (st === 'block') {
    crouch = 12;
    fistF = { x: x + fx * 20, y: fy - 96 + crouch * 0.6 };
    fistB = { x: x + fx * 25, y: fy - 82 + crouch * 0.6 };
  } else if (st === 'hit') {
    lean = -0.55;
    fistF = { x: x - fx * 22, y: fy - 108 };
    fistB = { x: x - fx * 8, y: fy - 70 };
  } else if (!f.onGround || st === 'jump') {
    footF = { x: x + fx * 14, y: fy - 28 };
    footB = { x: x - fx * 12, y: fy - 20 };
    fistF = { x: x + fx * 22, y: fy - 100 };
  }

  const hip = { x: x + lean * 26, y: fy - 54 + crouch };
  const sho = { x: x + lean * 40, y: fy - 98 + crouch * 0.7 + bob * 0.4 };
  const head = { x: sho.x + fx * 5 + lean * 10, y: sho.y - 17, r: 11 };

  const paths = [];
  /* torso */
  paths.push(function () { ctx.moveTo(hip.x, hip.y); ctx.lineTo(sho.x, sho.y); });
  /* front arm: shoulder -> fist (elbow via quadratic) */
  paths.push(function () {
    ctx.moveTo(sho.x, sho.y);
    ctx.quadraticCurveTo((sho.x + fistF.x) / 2 - fx * 8, (sho.y + fistF.y) / 2 + 7, fistF.x, fistF.y);
  });
  /* back arm */
  paths.push(function () {
    ctx.moveTo(sho.x, sho.y);
    ctx.quadraticCurveTo((sho.x + fistB.x) / 2 + fx * 6, (sho.y + fistB.y) / 2 + 6, fistB.x, fistB.y);
  });
  /* front leg: hip -> foot (knee forward) */
  paths.push(function () {
    ctx.moveTo(hip.x, hip.y);
    ctx.quadraticCurveTo((hip.x + footF.x) / 2 + fx * 10, (hip.y + footF.y) / 2, footF.x, footF.y);
  });
  /* back leg */
  paths.push(function () {
    ctx.moveTo(hip.x, hip.y);
    ctx.quadraticCurveTo((hip.x + footB.x) / 2 - fx * 6, (hip.y + footB.y) / 2, footB.x, footB.y);
  });

  const hitFlash = f.flashT > 0;
  /* pass 1: neon rim glow */
  ctx.save();
  ctx.shadowColor = col; ctx.shadowBlur = 16;
  ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineCap = 'round';
  paths.forEach(function (p) { ctx.beginPath(); p(); ctx.lineWidth = 12; ctx.stroke(); });
  ctx.beginPath(); ctx.arc(head.x, head.y, head.r + 2, 0, 6.283); ctx.stroke();
  ctx.restore();
  /* pass 2: dark silhouette body */
  ctx.save();
  ctx.strokeStyle = hitFlash ? '#ffffff' : '#07070f'; ctx.lineCap = 'round';
  paths.forEach(function (p, i) { ctx.beginPath(); p(); ctx.lineWidth = i === 0 ? 14 : 9; ctx.stroke(); });
  ctx.fillStyle = hitFlash ? '#ffffff' : '#07070f';
  ctx.beginPath(); ctx.arc(head.x, head.y, head.r, 0, 6.283); ctx.fill();
  /* neon headband slash */
  ctx.strokeStyle = col; ctx.lineWidth = 3;
  ctx.shadowColor = col; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(head.x, head.y, head.r, -0.5 + (fx > 0 ? 0 : 2.6), 0.9 + (fx > 0 ? 0 : 2.6)); ctx.stroke();
  ctx.restore();

  /* block shield */
  if (st === 'block') {
    ctx.save();
    const pulse = 0.55 + 0.3 * Math.sin(now * 6);
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = col; ctx.lineWidth = 4;
    ctx.shadowColor = col; ctx.shadowBlur = 18;
    ctx.beginPath();
    if (fx > 0) ctx.arc(x + fx * 30, sho.y + 4, 34, -1.25, 1.25);
    else ctx.arc(x + fx * 30, sho.y + 4, 34, Math.PI - 1.25, Math.PI + 1.25);
    ctx.stroke();
    ctx.restore();
  }

  /* dodge shimmer while invulnerable */
  if (f.invulnT > 0 && f.onGround === false) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(now * 18);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, fy - 62, 46, 0, 6.283); ctx.stroke();
    ctx.restore();
  }
}

function drawKOFighter(f, now) {
  const col = f.color, fx = f.facing;
  const t = Math.min(1, f.stateT * 2.2);
  const x = f.x, gy = SC.FLOOR - 12;
  const twitch = f.stateT < 0.8 ? Math.sin(f.stateT * 40) * 3 * (1 - f.stateT) : 0;
  const hip = { x: x - fx * 6 * t, y: gy };
  const sho = { x: x - fx * 52 * t, y: gy - 4 + twitch };
  const head = { x: x - fx * 70 * t, y: gy - 6, r: 11 };
  ctx.save();
  ctx.shadowColor = col; ctx.shadowBlur = 14;
  ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineCap = 'round'; ctx.lineWidth = 11;
  ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(sho.x, sho.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sho.x, sho.y); ctx.quadraticCurveTo(sho.x - fx * 10, sho.y - 18, sho.x + fx * 6, sho.y - 26 + twitch); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.quadraticCurveTo(hip.x + fx * 16, hip.y - 8, hip.x + fx * 34, hip.y - 4); ctx.stroke();
  ctx.beginPath(); ctx.arc(head.x, head.y, head.r, 0, 6.283); ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = '#07070f'; ctx.lineCap = 'round'; ctx.fillStyle = '#07070f';
  ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(sho.x, sho.y); ctx.stroke();
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(sho.x, sho.y); ctx.quadraticCurveTo(sho.x - fx * 10, sho.y - 18, sho.x + fx * 6, sho.y - 26 + twitch); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.quadraticCurveTo(hip.x + fx * 16, hip.y - 8, hip.x + fx * 34, hip.y - 4); ctx.stroke();
  ctx.beginPath(); ctx.arc(head.x, head.y, head.r - 1, 0, 6.283); ctx.fill();
  ctx.restore();
  spawnDustOnce(f);
}
function spawnDustOnce(f) {
  if (!f.koDust) { f.koDust = true; spawnDust(f.x, SC.FLOOR, 14); }
}

/* ---------------- Boot ---------------- */
if (titleBest) titleBest.textContent = G.best;
updateHUD();
requestAnimationFrame(frame);

})();
