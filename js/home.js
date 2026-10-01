/* PixelArena home — scroll reveal + leaderboard boards */
(() => {
'use strict';

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

/* ---- leaderboard ---- */
const LB_GAMES = [
  { id: 'neon-rush',    name: 'Neon Rush',    accent: '#00f0ff', label: 'pts' },
  { id: 'neon-snake',   name: 'Neon Snake',   accent: '#ff2bd6', label: 'pts' },
  { id: 'stack-tower',  name: 'Stack Tower',  accent: '#ffd23f', label: 'blocks' },
  { id: 'shadow-clash', name: 'Shadow Clash', accent: '#b14bff', label: 'streak' },
];

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function boardHtml(g, top) {
  let rows;
  if (top && top.length) {
    rows = '<ol class="lb-list">' + top.map((e, i) => {
      const score = Number(e.score) || 0;
      return '<li><span class="lb-rank r' + (i + 1) + '">' + (i + 1) + '</span>' +
        '<span class="lb-name">' + escapeHtml(e.name) + '</span>' +
        '<span class="lb-score">' + score.toLocaleString('en-IN') + ' <small>' + g.label + '</small></span></li>';
    }).join('') + '</ol>';
  } else {
    rows = '<p class="lb-empty">No scores yet — be the first!</p>';
  }
  return '<div class="lb-board" style="--accent:' + g.accent + '"><h3>' + g.name + '</h3>' + rows + '</div>';
}

function renderBoards(cloudMap) {
  const grid = document.getElementById('lbGrid');
  if (!grid || !window.PALeaderboard) return;
  grid.innerHTML = LB_GAMES.map((g) => {
    const cloud = cloudMap && cloudMap[g.id];
    const top = (cloud && cloud.length) ? cloud : window.PALeaderboard.getTop(g.id);
    return boardHtml(g, top);
  }).join('');
}

renderBoards(null);

/* Best-effort cloud refresh: if Firebase is configured, prefer global tops. */
if (window.PALeaderboard) {
  try {
    const jobs = LB_GAMES.map((g) =>
      window.PALeaderboard.fetchCloudTop(g.id).then((cloud) => ({ id: g.id, cloud }))
    );
    Promise.all(jobs).then((results) => {
      const map = {};
      let any = false;
      results.forEach((r) => {
        if (r.cloud && r.cloud.length) { map[r.id] = r.cloud; any = true; }
      });
      if (any) renderBoards(map);
    }).catch(() => {});
  } catch (e) {}
}
})();
