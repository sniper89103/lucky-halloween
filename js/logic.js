/* Lógica compartida (puras, sin almacenamiento): cálculo de ganadores, validaciones y ayudas.
   Es una copia de las funciones de db.js que usa la versión Firebase (db-firebase.js). */
(function (global) {
  'use strict';
  var C = global.CONFIG;
  var ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', CODE_LEN = 6;
  var MIN = C.scale.min, MAX = C.scale.max, FAV = C.publicCategory;

  function fail(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function P(fn) { return new Promise(function (res, rej) { try { res(fn()); } catch (e) { rej(e); } }); }
  function freshFav() { return { status: 'idle', endsAt: null, rounds: [] }; }
  function blankSede(name) { return { name: name, people: [], teams: [], state: { juryOpen: false, fav: freshFav() }, locked: false, fav: {}, jury: {}, comments: {}, attempts: {} }; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function ascii(s) { return String(s).normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase(); }
  function randCode(prefix) {
    var a = new Uint32Array(CODE_LEN), out = '';
    (global.crypto || global.msCrypto).getRandomValues(a);
    for (var i = 0; i < CODE_LEN; i++) out += ALPHA[a[i] % ALPHA.length];
    return (prefix || 'LUCKY') + '-' + out;
  }
  function newId(prefix) { return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }
  function cleanComment(t) { if (t == null) return ''; return String(t).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140); }
  function validScore(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= MIN && n <= MAX; }
  function validMinutes(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 1 && n <= 15; }
  function cleanName(s) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.slice(0, 60); }
  function sedeOf(d, id) { var s = d.sedes[id]; if (!s) throw fail('bad', 'Sede no válida.'); return s; }
  function personIn(s, id) { return s.people.filter(function (p) { return p.id === id; })[0]; }
  function teamIn(s, id) { return s.teams.filter(function (t) { return t.id === id; })[0]; }
  function kindOf(t) { return t.members.length <= 1 ? 'solo' : t.members.length === 2 ? 'duo' : 'grupal'; }
  function candidatesOf(s) {
    var out = [];
    s.teams.forEach(function (t) { t.members.forEach(function (m) { var p = personIn(s, m); if (p) out.push({ id: p.id, name: p.name, team: t.id, kind: kindOf(t) }); }); });
    return out;
  }
  function curRound(f) { return f.rounds.length; }
  function curCands(s) { var f = s.state.fav, r = f.rounds[f.rounds.length - 1]; return (r && r.cands) || candidatesOf(s).map(function (c) { return c.id; }); }

  /* ---------- Resultados ---------- */
  function rankBy(items, key, tiebreak) {
    items.sort(function (a, b) { return (b[key] - a[key]) || (tiebreak ? (b.tens - a.tens) : 0) || a.name.localeCompare(b.name); });
    items.forEach(function (it) { it.rank = 1 + items.filter(function (o) { return o[key] > it[key] || (tiebreak && o[key] === it[key] && o.tens > it.tens); }).length; });
    items.forEach(function (it) { it.tie = items.filter(function (o) { return o.rank === it.rank; }).length > 1 && (it.votes > 0 || it.count > 0); });
    return items;
  }
  function computeFav(s) {
    var f = s.state.fav, rounds = [], r, cands = candidatesOf(s);
    for (r = 1; r <= f.rounds.length; r++) {
      var list = f.rounds[r - 1].cands, counts = {}, total = 0;
      Object.keys(s.fav).forEach(function (k) { var a = k.split('__'); if (a[1] === 'r' + r) { counts[s.fav[k]] = (counts[s.fav[k]] || 0) + 1; total++; } });
      var items = cands.filter(function (x) { return !list || list.indexOf(x.id) >= 0; }).map(function (x) { return { id: x.id, name: x.name, kind: x.kind, votes: counts[x.id] || 0 }; });
      rounds.push({ round: r, total: total, ranking: rankBy(items, 'votes', false) });
    }
    var used = {}, final = [];
    for (r = rounds.length - 1; r >= 0; r--) {
      var rem = rounds[r].ranking.filter(function (x) { return !used[x.id]; }).map(function (x) { return { id: x.id, name: x.name, kind: x.kind, votes: x.votes }; });
      var base = final.length;
      rem.forEach(function (x) { x.rank = base + 1 + rem.filter(function (o) { return o.votes > x.votes; }).length; });
      rem.forEach(function (x) { x.tie = rem.filter(function (o) { return o.rank === x.rank; }).length > 1 && x.votes > 0; used[x.id] = 1; final.push(x); });
    }
    final.forEach(function (x) { x.byRound = {}; rounds.forEach(function (rd) { rd.ranking.forEach(function (y) { if (y.id === x.id) x.byRound[rd.round] = y.votes; }); }); });
    var top = final.filter(function (x) { return x.rank === 1 && x.votes > 0; });
    return { status: f.status, round: f.rounds.length, rounds: rounds, final: final, tied: top.length > 1 ? top.map(function (x) { return x.id; }) : [], totalVotes: rounds.length ? rounds[rounds.length - 1].total : 0 };
  }
  function notesOf(s, cat, teamId, jurors) {
    var out = [];
    jurors.forEach(function (j) {
      var k = j.id + '__' + cat + '__' + teamId, c = (s.comments || {})[k];
      if (c && c.t) out.push({ key: k, juror: j.name, score: s.jury[k], text: c.t, hidden: !!c.hidden });
    });
    return out;
  }
  function compute(s) {
    var jurors = s.people.filter(function (p) { return p.role === 'jury'; }), cats = {};
    C.categories.forEach(function (cat) {
      var arr = s.teams.filter(function (t) { return !(cat.eligible === 'groups' && kindOf(t) === 'solo'); }).map(function (t) {
        var sc = [], by = {};
        Object.keys(s.jury).forEach(function (k) { var a = k.split('__'); if (a[1] === cat.id && a[2] === t.id) { sc.push(s.jury[k]); by[a[0]] = s.jury[k]; } });
        var sum = sc.reduce(function (x, y) { return x + y; }, 0);
        return { id: t.id, name: t.name, kind: kindOf(t), members: t.members, count: sc.length, sum: sum, avg: sc.length ? sum / sc.length : 0,
          tens: sc.filter(function (n) { return n === MAX; }).length, score: sc.length ? sum / sc.length : 0, byJuror: by, notes: notesOf(s, cat.id, t.id, jurors) };
      });
      cats[cat.id] = rankBy(arr, 'score', true);
    });
    var vj = {}; Object.keys(s.jury).forEach(function (k) { vj[k.split('__')[0]] = 1; });
    return { sede: s.name, fav: computeFav(s), cats: cats, jurors: jurors.map(function (p) { return { id: p.id, name: p.name }; }),
      jurorsTotal: jurors.length, jurorsVoted: Object.keys(vj).length, totalJuryVotes: Object.keys(s.jury).length };
  }


  global.LuckyLogic = { fail: fail, P: P, freshFav: freshFav, blankSede: blankSede, clone: clone, ascii: ascii, randCode: randCode, newId: newId,
    cleanComment: cleanComment, validScore: validScore, validMinutes: validMinutes, cleanName: cleanName, sedeOf: sedeOf, personIn: personIn, teamIn: teamIn,
    kindOf: kindOf, candidatesOf: candidatesOf, curRound: curRound, curCands: curCands, computeFav: computeFav, compute: compute, rankBy: rankBy, notesOf: notesOf };
})(window);
