/* PixelArena home — animated game-card previews */
(() => {
'use strict';

const previews = document.querySelectorAll('canvas.preview');
if (!previews.length) return;

function makeCtx(cv) {
  const ctx = cv.getContext('2d');
  return { cv, ctx, w: cv.width, h: cv.height };
}

function skyline(ctx, w, h, baseY, seed, color, glow, drift) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = glow; ctx.shadowBlur = 8;
  let x = -(((drift + seed * 37) % 60 + 60) % 60);
  let i = 0;
  while (x < w + 60) {
    const bw = 34 + ((seed * (i + 3) * 53) % 44);
    const bh = 40 + ((seed * (i + 7) * 91) % 90);
    ctx.fillRect(x, baseY - bh, bw, bh);
    x += bw + 10; i++;
  }
  ctx.restore();
}

/* ---- Neon Rush mini preview: auto-running bot ---- */
function rushPreview(p) {
  const { ctx, w, h } = p;
  const groundY = h - 46;
  let t = 0, px = 70, py = groundY, vy = 0, spikeX = w + 40, coinX = w + 120;
  const stars = Array.from({ length: 40 }, () => ({ x: Math.random() * w, y: Math.random() * groundY * 0.7 }));
  return (dt) => {
    t += dt;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a0424'); g.addColorStop(1, '#2a0a44');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    for (const s of stars) { ctx.globalAlpha = 0.4 + 0.4 * Math.sin(t * 3 + s.x); ctx.fillRect(s.x, s.y, 2, 2); }
    ctx.globalAlpha = 1;
    skyline(ctx, w, h, groundY, 7, '#120826', '#7b2bff', t * 26);
    // ground
    ctx.fillStyle = '#070213'; ctx.fillRect(0, groundY, w, h - groundY);
    ctx.strokeStyle = '#00f0ff'; ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 10; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(w, groundY); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(0,240,255,.25)';
    for (let gx = -((t * 160) % 40); gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, groundY); ctx.lineTo(gx - 14, h); ctx.stroke(); }
    // spike
    spikeX -= 170 * dt; if (spikeX < -40) spikeX = w + 60 + Math.random() * 120;
    ctx.save(); ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 12; ctx.fillStyle = '#ff2bd6';
    ctx.beginPath(); ctx.moveTo(spikeX, groundY); ctx.lineTo(spikeX + 16, groundY - 30); ctx.lineTo(spikeX + 32, groundY); ctx.closePath(); ctx.fill(); ctx.restore();
    // coin
    coinX -= 170 * dt; if (coinX < -20) coinX = w + 40;
    ctx.save(); ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 10; ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.ellipse(coinX, groundY - 70, 8, 8, 0, 0, 7); ctx.fill(); ctx.restore();
    // bot (auto jump)
    if (spikeX - px < 90 && spikeX - px > 0 && py >= groundY) vy = -380;
    vy += 1100 * dt; py += vy * dt;
    if (py >= groundY) { py = groundY; vy = 0; }
    const run = Math.sin(t * 18);
    ctx.save(); ctx.translate(px, py);
    ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 14; ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(run * 7, 0); ctx.moveTo(0, -14); ctx.lineTo(-run * 7, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(4, -28); ctx.stroke();
    ctx.beginPath(); ctx.arc(7, -36, 7, 0, 7); ctx.stroke();
    ctx.restore();
  };
}

/* ---- Neon Snake mini preview: weaving snake ---- */
function snakePreview(p) {
  const { ctx, w, h } = p;
  let t = 0;
  const segs = [];
  for (let i = 0; i < 26; i++) segs.push({ x: -i * 12, y: h / 2 });
  const foods = [{ x: w * 0.7, y: h * 0.3 }, { x: w * 0.3, y: h * 0.7 }, { x: w * 0.8, y: h * 0.75 }];
  return (dt) => {
    t += dt;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a0424'); g.addColorStop(1, '#1c0736');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,240,255,.08)'; ctx.lineWidth = 1;
    for (let gx = 0; gx < w; gx += 28) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
    for (let gy = 0; gy < h; gy += 28) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
    // foods
    for (const f of foods) {
      ctx.save(); ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 12; ctx.fillStyle = '#ff2bd6';
      ctx.beginPath(); ctx.arc(f.x, f.y + Math.sin(t * 4 + f.x) * 3, 6, 0, 7); ctx.fill(); ctx.restore();
    }
    // head weaves
    const hx = w / 2 + Math.sin(t * 1.1) * w * 0.32;
    const hy = h / 2 + Math.sin(t * 1.7) * h * 0.26;
    segs.unshift({ x: hx, y: hy }); segs.pop();
    ctx.save(); ctx.lineCap = 'round';
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i], fade = 1 - i / segs.length;
      ctx.strokeStyle = i === 0 ? '#e8feff' : `rgba(0,240,255,${0.25 + fade * 0.75})`;
      ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = i === 0 ? 16 : 8;
      ctx.lineWidth = i === 0 ? 13 : 11 * fade + 3;
      const n = segs[Math.max(0, i - 1)];
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo((s.x + n.x) / 2, (s.y + n.y) / 2); ctx.stroke();
    }
    ctx.restore();
  };
}

const runners = [];
previews.forEach((cv) => {
  const p = makeCtx(cv);
  const kind = cv.dataset.preview;
  const draw = kind === 'snake' ? snakePreview(p) : rushPreview(p);
  runners.push({ cv, draw, visible: true, last: 0 });
});

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const r = runners.find((r) => r.cv === e.target);
      if (r) { r.visible = e.isIntersecting; r.last = performance.now(); }
    }
  }, { threshold: 0.1 });
  runners.forEach((r) => io.observe(r.cv));
}

function loop(now) {
  requestAnimationFrame(loop);
  for (const r of runners) {
    if (!r.visible) { r.last = now; continue; }
    const dt = Math.min(0.05, (now - r.last) / 1000 || 0.016);
    r.last = now;
    r.draw(dt);
  }
}
requestAnimationFrame(loop);

/* ---- scroll reveal ---- */
const revEls = document.querySelectorAll('.reveal');
if (revEls.length) {
  if ('IntersectionObserver' in window) {
    const rio = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add('in'); rio.unobserve(e.target); }
      }
    }, { threshold: 0.12 });
    revEls.forEach((el) => rio.observe(el));
  } else {
    revEls.forEach((el) => el.classList.add('in'));
  }
}
})();
