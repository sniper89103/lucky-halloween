/* Capa de datos v3 · MODO DEMO (localStorage del navegador).
   Todas las reglas viven aquí y son las que se llevarán a Firebase (reglas del servidor).
   Para pasar a Firebase se reemplaza este archivo manteniendo la misma API.

   Roles de organizador:
     admin  → todo (reinicio, candado, códigos de organizadores, datos de prueba). Siempre activo.
     chief  → Alexis: maneja las 3 sedes (favorito, jurados, personas, resultados) mientras tenga el control.
     backup → Michele y Roselva: entran en MODO ESPERA (solo ven que están en espera) hasta que les pasen el control.
   Cada sede es un concurso independiente: votantes, jurados, equipos, votos y ganadores propios. */
(function (global) {
  'use strict';
  var C = global.CONFIG;
  var KEY = 'lucky.v3.db', SES = 'lucky.v3.session', STF = 'lucky.v3.staff', DEV = 'lucky.device.v1';
  var SALT = 'lucky-2026-halloween', ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', CODE_LEN = 6;
  var MIN = C.scale.min, MAX = C.scale.max, FAV = C.publicCategory;

  function fail(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function P(fn) { return new Promise(function (res, rej) { try { res(fn()); } catch (e) { rej(e); } }); }
  function freshFav() { return { status: 'idle', endsAt: null, rounds: [] }; }
  function blankSede(name) { return { name: name, people: [], teams: [], state: { juryOpen: false, fav: freshFav() }, locked: false, fav: {}, jury: {}, comments: {}, attempts: {} }; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- almacenamiento ---------- */
  function seedData() {
    var d = { v: 3, staff: [], control: { holder: null }, attempts: {}, sedes: {} };
    C.sedes.forEach(function (s) { d.sedes[s.id] = blankSede(s.name); });
    var sd = global.SEED;
    if (sd) {
      d.staff = clone(sd.staff); d.control.holder = sd.chief || null;
      Object.keys(sd.sedes || {}).forEach(function (k) {
        if (!d.sedes[k]) return; d.sedes[k].people = clone(sd.sedes[k].people); d.sedes[k].teams = clone(sd.sedes[k].teams);
      });
    }
    return d;
  }
  function load() {
    var d = null; try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { }
    var vacia = d && d.v === 3 && global.SEED && !(d.staff && d.staff.length);
    if (!d || d.v !== 3 || vacia) { d = seedData(); localStorage.setItem(KEY, JSON.stringify(d)); }
    var now = Date.now();
    Object.keys(d.sedes).forEach(function (k) { var f = d.sedes[k].state.fav; if (f.status === 'open' && now >= f.endsAt) f.status = 'closed'; });
    return d;
  }
  function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); }

  /* ---------- utilidades ---------- */
  function deviceId() {
    var id = localStorage.getItem(DEV);
    if (!id) { id = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(DEV, id); }
    return id;
  }
  function hashCode(code) { return U.sha256(SALT + ':' + String(code).trim().toUpperCase()); }
  function ascii(s) { return String(s).normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase(); }
  function randCode(prefix) {
    var a = new Uint32Array(CODE_LEN), out = '';
    (global.crypto || global.msCrypto).getRandomValues(a);
    for (var i = 0; i < CODE_LEN; i++) out += ALPHA[a[i] % ALPHA.length];
    return (prefix || 'LUCKY') + '-' + out;
  }
  function uniqueCode(d, name, prefixOverride) {
    var taken = {};
    d.staff.forEach(function (x) { taken[x.hash] = 1; });
    Object.keys(d.sedes).forEach(function (k) { d.sedes[k].people.forEach(function (p) { taken[p.hash] = 1; }); });
    var pre = prefixOverride || ascii(String(name).split(/\s+/)[0]).slice(0, 8) || 'LUCKY', c;
    do { c = randCode(pre); } while (taken[hashCode(c)]);
    return c;
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

  /* ---------- sesiones ---------- */
  function getSession() { try { return JSON.parse(localStorage.getItem(SES)); } catch (e) { return null; } }
  function me(uid) {
    var x = getSession(); if (!x || x.id !== uid) throw fail('auth', 'Sesión no válida. Vuelve a ingresar.');
    var d = load(), s = d.sedes[x.sede], p = s && personIn(s, uid);
    if (!p || p.hash !== x.proof) throw fail('auth', 'Sesión no válida. Vuelve a ingresar.');
    return { d: d, s: s, p: p };
  }
  function getStaffSes() { try { return JSON.parse(localStorage.getItem(STF)); } catch (e) { return null; } }
  function staffCtx() {
    var x = getStaffSes(); if (!x) return null;
    var d = load(), st = d.staff.filter(function (a) { return a.id === x.id; })[0];
    return (st && st.hash === x.proof) ? { d: d, st: st } : null;
  }
  function isActive(c) { return c.st.role === 'admin' || c.d.control.holder === c.st.id; }
  function needStaff() { var c = staffCtx(); if (!c) throw fail('auth', 'Debes entrar como organizador.'); return c; }
  function needActive() { var c = needStaff(); if (!isActive(c)) throw fail('standby', 'Estás en modo espera. Pide que te pasen el control.'); return c; }
  function needAdmin() { var c = needStaff(); if (c.st.role !== 'admin') throw fail('auth', 'Solo el administrador puede hacer esto.'); return c; }
  function needUnlocked(s) { if (s.locked) throw fail('locked', 'El evento está bloqueado. El administrador debe desbloquearlo para editar.'); }

  /* Bloqueo por intentos fallidos (por dispositivo) */
  function tryLogin(d, find, max, wait) {
    var key = deviceId(), at = d.attempts[key] || { n: 0, until: 0 }, now = Date.now();
    if (at.until > now) throw fail('locked', 'Demasiados intentos. Espera ' + Math.ceil((at.until - now) / 1000) + ' s.');
    var found = find();
    if (!found) { at.n++; if (at.n >= max) { at.until = now + wait; at.n = 0; } d.attempts[key] = at; save(d); throw fail('bad', 'Código incorrecto.'); }
    d.attempts[key] = { n: 0, until: 0 };
    return found;
  }

  var DB = {
    mode: 'demo',
    hasData: function () { var d = load(); return d.staff.length > 0 || C.sedes.some(function (s) { return d.sedes[s.id].people.length > 0; }); },

    /* ====================== VOTANTES / JURADOS ====================== */
    login: function (sede, code) {
      return P(function () {
        var d = load(), s = sedeOf(d, sede), h = hashCode(code);
        var p = tryLogin(d, function () { return s.people.filter(function (x) { return x.hash === h; })[0]; }, 5, 60000);
        if (p.device && p.device !== deviceId()) { p.blocked = (p.blocked || 0) + 1; p.blockedAt = Date.now(); save(d); throw fail('device', 'Este código ya se usó en otro dispositivo. Pide al organizador que lo reinicie.'); }
        p.device = deviceId(); p.joined = p.joined || Date.now(); save(d);
        localStorage.setItem(SES, JSON.stringify({ sede: sede, id: p.id, proof: p.hash }));
        return { id: p.id, name: p.name, role: p.role, sede: sede };
      });
    },
    restore: function () {
      var x = getSession(); if (!x) return null;
      var d = load(), s = d.sedes[x.sede], p = s && personIn(s, x.id);
      if (!p || p.hash !== x.proof || (p.device && p.device !== deviceId())) return null;
      return { id: p.id, name: p.name, role: p.role, sede: x.sede };
    },
    logout: function () { localStorage.removeItem(SES); },

    /* Datos de la sede visibles para quien ya entró (solo nombres, nunca códigos) */
    getSede: function () {
      return P(function () {
        var x = getSession(); if (!x) throw fail('auth', 'Sesión no válida.');
        var d = load(), s = sedeOf(d, x.sede); me(x.id);
        var names = {}; s.people.forEach(function (p) { names[p.id] = p.name; });
        return { id: x.sede, name: s.name,
          teams: s.teams.map(function (t) { return { id: t.id, name: t.name, kind: kindOf(t), members: t.members.slice(), disfraz: t.disfraz || '', pending: !!t.pending }; }),
          candidates: candidatesOf(s), names: names };
      });
    },
    getState: function () {
      return P(function () {
        var x = getSession(); if (!x) throw fail('auth', 'Sesión no válida.');
        var s = sedeOf(load(), x.sede);
        return { juryOpen: s.state.juryOpen, fav: s.state.fav, locked: s.locked, _now: Date.now() };
      });
    },
    getMyVotes: function (uid) {
      return P(function () {
        var c = me(uid), s = c.s, out = { fav: {}, jury: {}, comments: {} };
        Object.keys(s.fav).forEach(function (k) { var a = k.split('__'); if (a[0] === uid) out.fav[parseInt(a[1].slice(1), 10)] = s.fav[k]; });
        Object.keys(s.jury).forEach(function (k) { var a = k.split('__'); if (a[0] === uid) { (out.jury[a[1]] = out.jury[a[1]] || {})[a[2]] = s.jury[k]; } });
        Object.keys(s.comments || {}).forEach(function (k) { var a = k.split('__'); if (a[0] === uid) { (out.comments[a[1]] = out.comments[a[1]] || {})[a[2]] = s.comments[k].t; } });
        return out;
      });
    },
    /* Favorito: UN voto por ronda, solo mientras corre el reloj, sin cambios. */
    votePublic: function (uid, candId) {
      return P(function () {
        var c = me(uid), s = c.s, f = s.state.fav;
        if (f.status !== 'open') throw fail('closed', 'La votación del favorito no está abierta.');
        if (curCands(s).indexOf(candId) < 0) throw fail('bad', 'Ese nombre no participa en esta ronda.');
        var k = uid + '__r' + curRound(f);
        if (s.fav.hasOwnProperty(k)) throw fail('dup', 'Ya votaste en esta ronda. El voto no se puede cambiar.');
        s.fav[k] = candId; save(c.d); return candId;
      });
    },
    setJury: function (uid, cat, teamId, score, comment) {
      return P(function () {
        var c = me(uid), s = c.s;
        if (c.p.role !== 'jury') throw fail('role', 'Solo los jurados califican esta categoría.');
        if (!s.state.juryOpen) throw fail('closed', 'La calificación del jurado no está abierta.');
        var cat_ = C.categories.filter(function (x) { return x.id === cat; })[0], t = teamIn(s, teamId);
        if (!cat_ || !t) throw fail('bad', 'Datos no válidos.');
        if (cat_.eligible === 'groups' && kindOf(t) === 'solo') throw fail('bad', 'Esta categoría es solo para dúos y grupos.');
        if (!validScore(score)) throw fail('bad', 'La nota debe ser un entero del ' + MIN + ' al ' + MAX + '.');
        var key = uid + '__' + cat + '__' + teamId, txt = cleanComment(comment);
        s.comments = s.comments || {}; s.jury[key] = score; if (txt) s.comments[key] = { t: txt }; else delete s.comments[key];
        save(c.d); return score;
      });
    },
    annulJury: function (uid, cat, teamId) {
      return P(function () {
        var c = me(uid), s = c.s;
        if (c.p.role !== 'jury') throw fail('role', 'Solo los jurados.');
        if (!s.state.juryOpen) throw fail('closed', 'La calificación del jurado no está abierta.');
        delete s.jury[uid + '__' + cat + '__' + teamId]; if (s.comments) delete s.comments[uid + '__' + cat + '__' + teamId]; save(c.d); return true;
      });
    },

    /* ====================== ORGANIZADORES ====================== */
    staffLogin: function (code) {
      return P(function () {
        var d = load(), h = hashCode(code);
        var st = tryLogin(d, function () { return d.staff.filter(function (x) { return x.hash === h; })[0]; }, 5, 120000);
        localStorage.setItem(STF, JSON.stringify({ id: st.id, proof: st.hash }));
        return { id: st.id, name: st.name, role: st.role };
      });
    },
    staffLogout: function () { localStorage.removeItem(STF); },
    staffInfo: function () {
      return P(function () {
        var c = needStaff(), d = c.d, h = d.staff.filter(function (x) { return x.id === d.control.holder; })[0];
        return { id: c.st.id, name: c.st.name, role: c.st.role, active: isActive(c), holder: d.control.holder, holderName: h ? h.name : '—',
          operators: d.staff.filter(function (x) { return x.role !== 'admin'; }).map(function (x) { return { id: x.id, name: x.name, role: x.role }; }),
          sedes: C.sedes.map(function (s) { return { id: s.id, name: s.name }; }) };
      });
    },
    /* Pasar el control: lo hace el administrador o quien lo tiene ahora. */
    passControl: function (toId) {
      return P(function () {
        var c = needActive(), d = c.d, to = d.staff.filter(function (x) { return x.id === toId; })[0];
        if (!to || to.role === 'admin') throw fail('bad', 'Esa persona no puede recibir el control.');
        d.control.holder = toId; save(d); return true;
      });
    },
    overview: function () {
      return P(function () {
        var c = needActive(), d = c.d;
        return C.sedes.map(function (x) {
          var s = d.sedes[x.id], f = s.state.fav, r = curRound(f), n = 0;
          Object.keys(s.fav).forEach(function (k) { if (k.split('__')[1] === 'r' + r) n++; });
          return { id: x.id, name: s.name, people: s.people.length, candidates: candidatesOf(s).length, juryOpen: s.state.juryOpen, fav: f.status === 'idle' ? 'idle' : f.status, round: r, favVoted: n, locked: s.locked };
        });
      });
    },
    sedeData: function (sede) {
      return P(function () {
        var c = needActive(), s = sedeOf(c.d, sede), r = curRound(s.state.fav);
        var inTeam = {}; s.teams.forEach(function (t) { t.members.forEach(function (m) { inTeam[m] = t.id; }); });
        return { id: sede, name: s.name, locked: s.locked,
          people: s.people.map(function (p) {
            var jn = 0; Object.keys(s.jury).forEach(function (k) { if (k.indexOf(p.id + '__') === 0) jn++; });
            return { id: p.id, name: p.name, role: p.role, note: p.note || '', test: !!p.test, joined: !!p.joined, bound: !!p.device, team: inTeam[p.id] || null, favVoted: r > 0 && s.fav.hasOwnProperty(p.id + '__r' + r), juryVotes: jn, blocked: p.blocked || 0, blockedAt: p.blockedAt || 0 };
          }),
          teams: s.teams.map(function (t) { return { id: t.id, name: t.name, kind: kindOf(t), members: t.members.slice(), disfraz: t.disfraz || '', pending: !!t.pending }; }),
          state: { juryOpen: s.state.juryOpen, fav: s.state.fav, _now: Date.now() } };
      });
    },

    /* --- Personas (el admin carga todo desde el panel) --- */
    addPeople: function (sede, list) {
      return P(function () {
        var c = needActive(), d = c.d, s = sedeOf(d, sede), out = [];
        needUnlocked(s);
        if (!list || !list.length || list.length > 80) throw fail('bad', 'Agrega entre 1 y 80 personas a la vez.');
        list.forEach(function (it) {
          var name = cleanName(it.name); if (!name) return;
          var role = it.role === 'jury' ? 'jury' : 'voter', code = uniqueCode(d, name);
          s.people.push({ id: newId('p'), name: name, role: role, note: '', hash: hashCode(code), test: !!it.test });
          out.push({ name: name, role: role, code: code });
        });
        if (!out.length) throw fail('bad', 'Escribe al menos un nombre.');
        save(d); return out;
      });
    },
    updatePerson: function (sede, id, patch) {
      return P(function () {
        var c = needActive(), s = sedeOf(c.d, sede), p = personIn(s, id); if (!p) throw fail('bad', 'Persona no encontrada.');
        needUnlocked(s);
        if (patch.name != null) { var n = cleanName(patch.name); if (!n) throw fail('bad', 'El nombre no puede estar vacío.'); p.name = n; }
        if (patch.role === 'jury' || patch.role === 'voter') p.role = patch.role;
        if (patch.note != null) p.note = String(patch.note).slice(0, 120);
        save(c.d); return true;
      });
    },
    deletePerson: function (sede, id) {
      return P(function () {
        var c = needActive(), d = c.d, s = sedeOf(d, sede); needUnlocked(s);
        var i = s.people.map(function (p) { return p.id; }).indexOf(id); if (i < 0) throw fail('bad', 'Persona no encontrada.');
        s.people.splice(i, 1);
        Object.keys(s.fav).forEach(function (k) { if (k.indexOf(id + '__') === 0 || s.fav[k] === id) delete s.fav[k]; });
        Object.keys(s.jury).forEach(function (k) { if (k.indexOf(id + '__') === 0) delete s.jury[k]; });
        s.teams.forEach(function (t) { t.members = t.members.filter(function (m) { return m !== id; }); });
        s.teams = s.teams.filter(function (t) { return t.members.length > 0; });
        save(d); return true;
      });
    },
    /* Nuevo código (también libera el dispositivo). Se muestra una sola vez. */
    regenCode: function (sede, id) {
      return P(function () {
        var c = needActive(), d = c.d, s = sedeOf(d, sede), p = personIn(s, id); if (!p) throw fail('bad', 'Persona no encontrada.');
        var code = uniqueCode(d, p.name); p.hash = hashCode(code); delete p.device; delete p.joined; delete p.blocked; delete p.blockedAt; save(d); return code;
      });
    },
    resetDevice: function (sede, id) {
      return P(function () {
        var c = needActive(), s = sedeOf(c.d, sede), p = personIn(s, id); if (!p) throw fail('bad', 'Persona no encontrada.');
        delete p.device; delete p.blocked; delete p.blockedAt; save(c.d); return true;
      });
    },

    /* --- Equipos (solo / dúo / grupo se deduce de los integrantes) --- */
    saveTeam: function (sede, t) {
      return P(function () {
        var c = needActive(), d = c.d, s = sedeOf(d, sede); needUnlocked(s);
        var members = (t.members || []).filter(function (m, i, a) { return a.indexOf(m) === i; });
        if (members.length < 1 || members.length > 12) throw fail('bad', 'Un equipo lleva de 1 a 12 integrantes.');
        members.forEach(function (m) {
          if (!personIn(s, m)) throw fail('bad', 'Integrante no válido.');
          s.teams.forEach(function (o) { if (o.id !== t.id && o.members.indexOf(m) >= 0) throw fail('bad', personIn(s, m).name + ' ya está en otro equipo.'); });
        });
        var name = cleanName(t.name) || (members.length === 1 ? personIn(s, members[0]).name : members.length === 2 ? members.map(function (m) { return personIn(s, m).name.split(' ')[0]; }).join(' & ') : 'Grupo de ' + members.length);
        var ex = t.id && teamIn(s, t.id), removed = [];
        if (ex) { removed = ex.members.filter(function (m) { return members.indexOf(m) < 0; }); ex.name = name; ex.members = members; ex.disfraz = String(t.disfraz || '').slice(0, 80); ex.pending = !!t.pending; }
        else s.teams.push({ id: newId('t'), name: name, members: members, disfraz: String(t.disfraz || '').slice(0, 80), pending: !!t.pending });
        if (removed.length) Object.keys(s.fav).forEach(function (k) { if (removed.indexOf(s.fav[k]) >= 0) delete s.fav[k]; });
        save(d); return true;
      });
    },
    deleteTeam: function (sede, id) {
      return P(function () {
        var c = needActive(), d = c.d, s = sedeOf(d, sede); needUnlocked(s);
        var t = teamIn(s, id); if (!t) throw fail('bad', 'Equipo no encontrado.');
        Object.keys(s.jury).forEach(function (k) { if (k.split('__')[2] === id) delete s.jury[k]; });
        Object.keys(s.fav).forEach(function (k) { if (t.members.indexOf(s.fav[k]) >= 0) delete s.fav[k]; });
        s.teams = s.teams.filter(function (x) { return x.id !== id; }); save(d); return true;
      });
    },

    /* --- Fases y favorito (admin o quien tiene el control) --- */
    setJuryOpen: function (sede, open) {
      return P(function () { var c = needActive(), s = sedeOf(c.d, sede); s.state.juryOpen = !!open; save(c.d); return true; });
    },
    favStart: function (sede, minutes) {
      return P(function () {
        var c = needActive(), s = sedeOf(c.d, sede), f = s.state.fav;
        if (!validMinutes(minutes)) throw fail('bad', 'El tiempo debe ser de 1 a 15 minutos.');
        if (f.status !== 'idle') throw fail('state', 'La votación del favorito ya fue iniciada.');
        if (candidatesOf(s).length < 2) throw fail('bad', 'Hacen falta al menos 2 participantes en ' + s.name + '.');
        f.status = 'open'; f.endsAt = Date.now() + minutes * 60000; f.rounds = [{ cands: null, minutes: minutes }]; save(c.d); return f;
      });
    },
    /* Inicia el favorito en todas las sedes listas, a la misma hora */
    favStartAll: function (minutes) {
      return P(function () {
        var c = needActive(), d = c.d, started = [], now = Date.now();
        if (!validMinutes(minutes)) throw fail('bad', 'El tiempo debe ser de 1 a 15 minutos.');
        C.sedes.forEach(function (x) {
          var s = d.sedes[x.id], f = s.state.fav;
          if (f.status === 'idle' && candidatesOf(s).length >= 2) { f.status = 'open'; f.endsAt = now + minutes * 60000; f.rounds = [{ cands: null, minutes: minutes }]; started.push(s.name); }
        });
        if (!started.length) throw fail('state', 'Ninguna sede está lista para iniciar.');
        save(d); return started;
      });
    },
    favExtend: function (sede, minutes) {
      return P(function () {
        var c = needActive(), f = sedeOf(c.d, sede).state.fav;
        if (!validMinutes(minutes)) throw fail('bad', 'El tiempo debe ser de 1 a 15 minutos.');
        if (f.status !== 'open') throw fail('state', 'La votación ya está cerrada.');
        f.endsAt += minutes * 60000; save(c.d); return f;
      });
    },
    favClose: function (sede) {
      return P(function () {
        var c = needActive(), f = sedeOf(c.d, sede).state.fav;
        if (f.status !== 'open') throw fail('state', 'La votación no está abierta.');
        f.status = 'closed'; f.endsAt = Date.now(); save(c.d); return f;
      });
    },
    favStartRunoff: function (sede, minutes) {
      return P(function () {
        var c = needActive(), s = sedeOf(c.d, sede), f = s.state.fav;
        if (!validMinutes(minutes)) throw fail('bad', 'El tiempo debe ser de 1 a 15 minutos.');
        if (f.status !== 'closed') throw fail('state', 'Primero debe cerrarse la votación.');
        var tied = computeFav(s).tied; if (tied.length < 2) throw fail('notie', 'No hay empate en el primer lugar.');
        f.rounds.push({ cands: tied, minutes: minutes }); f.status = 'open'; f.endsAt = Date.now() + minutes * 60000; save(c.d); return f;
      });
    },
    favProgress: function (sede) {
      return P(function () {
        var c = needActive(), s = sedeOf(c.d, sede), f = s.state.fav, r = curRound(f), n = 0;
        Object.keys(s.fav).forEach(function (k) { if (k.split('__')[1] === 'r' + r) n++; });
        return { voted: n, total: s.people.length, round: r, status: f.status, endsAt: f.endsAt };
      });
    },
    stats: function (sede) {
      return P(function () {
        var c = needActive(), s = sedeOf(c.d, sede), voted = {}, r = curRound(s.state.fav), fv = 0;
        Object.keys(s.jury).forEach(function (k) { voted[k.split('__')[0]] = 1; });
        Object.keys(s.fav).forEach(function (k) { if (k.split('__')[1] === 'r' + r) fv++; });
        var jurors = s.people.filter(function (p) { return p.role === 'jury'; });
        return { fav: fv, favTotal: s.people.length, jury: Object.keys(s.jury).length, jurorsVoted: Object.keys(voted).length, jurorsTotal: jurors.length,
          joined: s.people.filter(function (p) { return p.joined; }).length, people: s.people.length };
      });
    },
    results: function (sede) {
      return P(function () { var c = needActive(), s = sedeOf(c.d, sede); return compute(s); });
    },

    /* Moderación: el organizador puede ocultar un comentario antes de la ceremonia */
    hideComment: function (sede, key, hidden) {
      return P(function () {
        var c = needActive(), s = sedeOf(c.d, sede); s.comments = s.comments || {};
        if (!s.comments[key]) throw fail('bad', 'Comentario no encontrado.');
        s.comments[key].hidden = !!hidden; save(c.d); return !!hidden;
      });
    },

    /* --- Solo administrador --- */
    lock: function (sede, on) { return P(function () { var c = needAdmin(), s = sedeOf(c.d, sede); s.locked = !!on; save(c.d); return s.locked; }); },
    /* Reiniciar votos: borra todos los votos, el reloj y las rondas. Pide escribir REINICIAR. */
    resetVotes: function (sede, word) {
      return P(function () {
        var c = needAdmin(), s = sedeOf(c.d, sede);
        if (word !== 'REINICIAR') throw fail('bad', 'Escribe REINICIAR para confirmar.');
        needUnlocked(s);
        s.fav = {}; s.jury = {}; s.comments = {}; s.state = { juryOpen: false, fav: freshFav() }; save(c.d); return true;
      });
    },
    /* Reiniciar todo: además libera dispositivos e ingresos. Las personas y sus códigos se conservan. */
    resetAll: function (sede, word) {
      return P(function () {
        var c = needAdmin(), s = sedeOf(c.d, sede);
        if (word !== 'REINICIAR') throw fail('bad', 'Escribe REINICIAR para confirmar.');
        needUnlocked(s);
        s.fav = {}; s.jury = {}; s.comments = {}; s.state = { juryOpen: false, fav: freshFav() }; s.attempts = {};
        s.people.forEach(function (p) { delete p.device; delete p.joined; delete p.blocked; delete p.blockedAt; }); c.d.attempts = {}; save(c.d); return true;
      });
    },
    addTestUsers: function (sede) {
      return P(function () {
        var c = needAdmin(), d = c.d, s = sedeOf(d, sede); needUnlocked(s);
        var out = [];
        [['PRUEBA 1', 'voter'], ['PRUEBA 2', 'voter'], ['PRUEBA 3', 'voter'], ['PRUEBA 4', 'voter'], ['PRUEBA JURADO', 'jury']].forEach(function (x) {
          var code = uniqueCode(d, x[0], 'PRUEBA');
          s.people.push({ id: newId('x'), name: x[0] + ' (' + s.name + ')', role: x[1], note: 'Usuario de prueba: se elimina antes del evento', hash: hashCode(code), test: true });
          out.push({ name: x[0], role: x[1], code: code });
        });
        save(d); return out;
      });
    },
    deleteTestUsers: function (sede) {
      return P(function () {
        var c = needAdmin(), d = c.d, s = sedeOf(d, sede), gone = s.people.filter(function (p) { return p.test; }).map(function (p) { return p.id; });
        s.people = s.people.filter(function (p) { return !p.test; });
        Object.keys(s.fav).forEach(function (k) { if (gone.indexOf(k.split('__')[0]) >= 0 || gone.indexOf(s.fav[k]) >= 0) delete s.fav[k]; });
        Object.keys(s.jury).forEach(function (k) { if (gone.indexOf(k.split('__')[0]) >= 0) delete s.jury[k]; });
        Object.keys(s.comments || {}).forEach(function (k) { if (gone.indexOf(k.split('__')[0]) >= 0) delete s.comments[k]; });
        s.teams.forEach(function (t) { t.members = t.members.filter(function (m) { return gone.indexOf(m) < 0; }); });
        s.teams = s.teams.filter(function (t) { return t.members.length > 0; }); save(d); return gone.length;
      });
    },
    staffList: function () {
      return P(function () { var c = needAdmin(); return c.d.staff.map(function (x) { return { id: x.id, name: x.name, role: x.role }; }); });
    },
    regenStaffCode: function (id) {
      return P(function () {
        var c = needAdmin(), d = c.d, st = d.staff.filter(function (x) { return x.id === id; })[0]; if (!st) throw fail('bad', 'No encontrado.');
        var code = uniqueCode(d, st.name, st.role === 'admin' ? 'ADMIN' : ascii(st.name.split(/\s+/)[0]).slice(0, 8) + 'ORG'); st.hash = hashCode(code); save(d); return code;
      });
    },
    /* Votos de prueba para ensayar (solo administrador) */
    seedDemo: function (sede, withTie) {
      return P(function () {
        var c = needAdmin(), s = sedeOf(c.d, sede); needUnlocked(s);
        function rnd() { var r = Math.random(); return Math.max(MIN, Math.min(MAX, Math.round(5.5 + (r + Math.random() - 1) * 6))); }
        var cands = candidatesOf(s); if (cands.length < 3) throw fail('bad', 'Faltan participantes para generar una prueba.');
        s.jury = {}; s.fav = {}; s.comments = {};
        var DEMO_C = ['Muy buena idea y mucho detalle.', 'Se nota el esfuerzo y la actitud.', 'Me hizo reír, gran personaje.', 'El maquillaje quedó espectacular.', 'Original y bien ejecutado.'];
        s.people.filter(function (p) { return p.role === 'jury'; }).forEach(function (p) {
          C.categories.forEach(function (cat) { s.teams.forEach(function (t) {
            if (cat.eligible === 'groups' && kindOf(t) === 'solo') return; var k = p.id + '__' + cat.id + '__' + t.id; s.jury[k] = rnd(); if (Math.random() < .6) s.comments[k] = { t: DEMO_C[Math.floor(Math.random() * DEMO_C.length)] }; }); });
        });
        var ids = cands.map(function (x) { return x.id; }).sort(function () { return Math.random() - .5; });
        s.people.forEach(function (p, i) {
          var rest = ids.slice(2), pick;
          if (withTie) pick = i < 22 ? ids[i % 2] : (rest.length ? rest[Math.floor(Math.random() * rest.length)] : ids[0]); /* los dos primeros empatan exacto */
          else pick = Math.random() < .45 ? ids[Math.floor(Math.random() * Math.min(4, ids.length))] : ids[Math.floor(Math.random() * ids.length)];
          if (withTie || Math.random() < .94) s.fav[p.id + '__r1'] = pick;
        });
        s.state.fav = { status: 'closed', endsAt: Date.now(), rounds: [{ cands: null, minutes: 4 }] }; save(c.d); return true;
      });
    }
  };

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

  global.DB = DB;
})(window);
