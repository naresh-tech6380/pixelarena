/* PixelArena leaderboard — shared data layer.
 *
 * Works in the browser (portal + all 4 games) and under node for tests.
 * - Local top-3 per game in localStorage (`pa_lb_<gameId>`).
 * - Player display name in `pa_player_name`.
 * - Optional Firebase/Firestore mirroring: reads `window.PA_FIREBASE`
 *   (see js/firebase-config.js) and `window.firebase` (compat SDK).
 *   Every Firebase path is wrapped in try/catch — the site works 100%
 *   offline / without Firebase configured.
 */
(function () {
  'use strict';

  var root = typeof window !== 'undefined'
    ? window
    : (typeof globalThis !== 'undefined' ? globalThis : {});

  var GAMES = ['neon-rush', 'neon-snake', 'stack-tower', 'shadow-clash'];

  /* Sanity caps: scores above these are rejected as bogus. */
  var CAPS = {
    'neon-rush': 999999,
    'neon-snake': 999999,
    'stack-tower': 9999,
    'shadow-clash': 999 /* win streak */
  };

  var NAME_KEY = 'pa_player_name';
  var LB_PREFIX = 'pa_lb_';
  var MAX_NAME = 12;

  var PROFANITY = ['damn', 'hell', 'shit', 'fuck', 'bitch', 'ass', 'dick', 'porn', 'sex'];

  function ls() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  /* ---------- player name ---------- */

  function sanitizeName(raw) {
    var s = String(raw == null ? '' : raw);
    s = s.replace(/<[^>]*>/g, '');   /* strip HTML tags */
    s = s.replace(/[<>]/g, '');      /* strip stray angle brackets */
    s = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); /* collapse whitespace */
    if (s.length > MAX_NAME) s = s.slice(0, MAX_NAME);
    for (var i = 0; i < PROFANITY.length; i++) {
      var w = PROFANITY[i];
      s = s.replace(new RegExp('\\b' + w + '\\b', 'gi'), '***');
    }
    s = s.replace(/^\s+|\s+$/g, '');
    return s || 'PLAYER';
  }

  function getPlayerName() {
    var store = ls();
    if (!store) return 'PLAYER';
    try {
      var v = store.getItem(NAME_KEY);
      return v ? sanitizeName(v) : 'PLAYER';
    } catch (e) { return 'PLAYER'; }
  }

  function setPlayerName(name) {
    var clean = sanitizeName(name);
    var store = ls();
    if (store) { try { store.setItem(NAME_KEY, clean); } catch (e) {} }
    return clean;
  }

  /* ---------- local top-3 ---------- */

  function readTop(gameId) {
    var store = ls();
    var arr = [];
    if (store) {
      try {
        var raw = store.getItem(LB_PREFIX + gameId);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) arr = parsed;
        }
      } catch (e) { arr = []; }
    }
    /* validate + normalize */
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i] || {};
      var score = Math.floor(Number(e.score));
      if (!isFinite(score) || score < 0) continue;
      out.push({
        name: sanitizeName(e.name),
        score: score,
        date: Number(e.date) || 0
      });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 3);
  }

  function saveTop(gameId, top) {
    var store = ls();
    if (!store) return;
    try { store.setItem(LB_PREFIX + gameId, JSON.stringify(top.slice(0, 3))); }
    catch (e) {}
  }

  function getTop(gameId) {
    if (GAMES.indexOf(gameId) === -1) return [];
    return readTop(gameId);
  }

  /* ---------- Firebase (best-effort, never throws) ---------- */

  function firestore() {
    try {
      var w = (typeof window !== 'undefined') ? window : null;
      if (!w) return null;
      if (!w.PA_FIREBASE) return null;              /* not configured yet */
      if (!w.firebase || !w.firebase.firestore) return null; /* SDK not loaded */
      return w.firebase.firestore();
    } catch (e) { return null; }
  }

  function mirrorScore(gameId, entry) {
    try {
      var db = firestore();
      if (!db) return;
      db.collection('leaderboards').doc(gameId).collection('scores')
        .add({ name: entry.name, score: entry.score, date: entry.date })
        .catch(function () { /* offline / rules — local copy is enough */ });
    } catch (e) {}
  }

  /* Returns a Promise resolving to an array of {name, score, date},
   * or null when Firebase is unavailable / any error occurs. */
  function fetchCloudTop(gameId) {
    var done = function (v) {
      return { then: function (cb) { try { cb(v); } catch (e) {} } };
    };
    try {
      var db = firestore();
      if (!db) return done(null);
      return db.collection('leaderboards').doc(gameId).collection('scores')
        .orderBy('score', 'desc').limit(3).get()
        .then(function (snap) {
          var arr = [];
          snap.forEach(function (d) {
            var v = d.data() || {};
            var score = Math.floor(Number(v.score));
            if (!isFinite(score) || score < 0) return;
            arr.push({ name: sanitizeName(v.name), score: score, date: Number(v.date) || 0 });
          });
          return arr;
        })
        .catch(function () { return null; });
    } catch (e) { return done(null); }
  }

  /* ---------- submit ---------- */

  function submitScore(gameId, score) {
    if (GAMES.indexOf(gameId) === -1) return { accepted: false, rank: null, isRecord: false };
    score = Math.floor(Number(score));
    var cap = CAPS[gameId];
    if (!isFinite(score) || score < 0 || score > cap) {
      return { accepted: false, rank: null, isRecord: false };
    }
    var top = readTop(gameId);
    var entry = { name: getPlayerName(), score: score, date: Date.now() };
    var rank = null;
    for (var i = 0; i < top.length; i++) {
      if (score > top[i].score) { rank = i; break; }
    }
    if (rank === null && top.length < 3) rank = top.length;
    if (rank !== null) {
      top.splice(rank, 0, entry);
      top = top.slice(0, 3);
      saveTop(gameId, top);
      mirrorScore(gameId, entry);
    }
    return { accepted: true, rank: rank, isRecord: rank === 0 };
  }

  /* ---------- "NEW RECORD" form binding (game pages) ---------- */

  function hideRecordForm() {
    try {
      var form = (typeof document !== 'undefined') ? document.getElementById('recordForm') : null;
      if (form) form.classList.add('hidden');
    } catch (e) {}
  }

  function bindRecordForm(gameId, score) {
    try {
      if (typeof document === 'undefined') return;
      var form = document.getElementById('recordForm');
      if (!form) return;
      var input = document.getElementById('recordName');
      var saveBtn = document.getElementById('recordSave');
      var done = document.getElementById('recordDone');
      var row = document.getElementById('recordRow');

      form.dataset.gameId = gameId;
      form.dataset.score = String(Math.floor(Number(score)) || 0);
      form.classList.remove('hidden');
      if (done) done.classList.add('hidden');
      if (row) row.classList.remove('hidden');
      if (input) {
        var cur = getPlayerName();
        input.value = (cur === 'PLAYER') ? '' : cur;
      }

      var doSave = function () {
        var name = sanitizeName(input ? input.value : '');
        setPlayerName(name);
        var gid = form.dataset.gameId;
        var sc = parseInt(form.dataset.score, 10) || 0;
        var res = submitScore(gid, sc);
        if (row) row.classList.add('hidden');
        if (done) {
          done.classList.remove('hidden');
          if (res.rank === 0) done.textContent = "👑 You're #1 on the leaderboard!";
          else if (res.rank === 1) done.textContent = '🥈 Rank #2 on the leaderboard!';
          else if (res.rank === 2) done.textContent = '🥉 Rank #3 on the leaderboard!';
          else done.textContent = '✅ Score saved!';
        }
      };

      if (saveBtn && !saveBtn.dataset.bound) {
        saveBtn.dataset.bound = '1';
        saveBtn.addEventListener('click', doSave);
      }
      if (input && !input.dataset.bound) {
        input.dataset.bound = '1';
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); doSave(); }
        });
      }
    } catch (e) {}
  }

  var api = {
    GAMES: GAMES,
    CAPS: CAPS,
    sanitizeName: sanitizeName,
    getPlayerName: getPlayerName,
    setPlayerName: setPlayerName,
    getTop: getTop,
    submitScore: submitScore,
    fetchCloudTop: fetchCloudTop,
    bindRecordForm: bindRecordForm,
    hideRecordForm: hideRecordForm
  };

  root.PALeaderboard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
