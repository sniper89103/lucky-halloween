/* Capa de datos · FIREBASE (Auth + Firestore). Misma API que db.js (modo demo).
   - Cada persona entra con su código: el código es la contraseña de una cuenta de Firebase Auth
     cuyo correo se deriva del código (nadie escribe correos).
   - Los datos viven en Firestore. La pantalla lee de un espejo en memoria alimentado por
     escuchas en tiempo real (onSnapshot): así el reloj y los votos se sincronizan sin recargar y
     sin gastar lecturas de más.
   - Las reglas del servidor (firestore.rules) son la defensa real: un voto por persona y ronda,
     hora del servidor, solo el organizador activo lee resultados.
   Si no existe data/firebase-config.js, este archivo no hace nada y queda el modo demo. */
(function (global) {
  'use strict';
  var CFG = global.FIREBASE_CONFIG, L = global.LuckyLogic, C = global.CONFIG;
  if (!CFG) return;                                   /* sin configuración → modo demo (db.js) */
  if (!global.firebase || !L) {                        /* hay configuración pero no cargó Firebase: nunca caer en demo en silencio */
    var err = function () { var e = new Error('No se pudo cargar Firebase. Revisa tu internet y recarga la página.'); e.code = 'net'; return e; };
    global.DB = new Proxy({ mode: 'firebase', hasData: function () { return true; }, restore: function () { return null; } }, {
      get: function (t, k) { return k in t ? t[k] : function () { return Promise.reject(err()); }; } });
    return;
  }

  var fail = L.fail, MIN = C.scale.min, MAX = C.scale.max, FAV = C.publicCategory;
  var DEV = 'lucky.device.v1', ATT = 'lucky.fb.attempts';
  var FV = firebase.firestore.FieldValue;
  var appV = firebase.initializeApp(CFG, 'voter');      /* sesión de votante / jurado */
  var appS = firebase.initializeApp(CFG, 'staff');      /* sesión de organizador (aparte, se pueden tener las dos) */
  var appC = firebase.initializeApp(CFG, 'creator');    /* solo para crear cuentas sin cerrar la sesión del organizador */
  try { appC.auth().setPersistence(firebase.auth.Auth.Persistence.NONE); } catch (e) { }
  /* Algunos celulares/navegadores bloquean la conexión en tiempo real: se detecta y se usa un método alterno */
  [appV, appS, appC].forEach(function (a) { try { a.firestore().settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch (e) { } });

  /* ---------- utilidades ---------- */
  function deviceId() {
    var id = localStorage.getItem(DEV);
    if (!id) { id = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(DEV, id); }
    return id;
  }
  function norm(code) { return String(code == null ? '' : code).trim().toUpperCase(); }
  function emailFor(kind, sede, code) { return U.sha256('lucky-2026:' + kind + ':' + (sede || '') + ':' + norm(code)).slice(0, 32) + '@lucky.app'; }
  function authErr(e) {
    var c = (e && e.code) || '';
    if (/too-many/.test(c)) return fail('locked', 'Demasiados intentos. Espera unos minutos.');
    if (/network/.test(c)) return fail('net', 'Sin conexión. Revisa tu internet e intenta de nuevo.');
    if (/invalid|not-found|wrong-password|invalid-email|missing-password/.test(c)) return fail('bad', 'Código incorrecto.');
    return fail('bad', 'No se pudo ingresar (' + (c || (e && e.message) || 'error') + ').');
  }
  function mapErr(e, msg) {
    var c = (e && e.code) || '';
    if (!(e && e.name === 'FirebaseError')) return e instanceof Error ? e : fail('bad', String(e));
    if (c === 'permission-denied') return fail('denied', msg || 'El servidor no permitió esta acción.');
    if (c === 'unavailable' || c === 'deadline-exceeded') return fail('net', 'Sin conexión. Revisa tu internet e intenta de nuevo.');
    return e instanceof Error ? e : fail('bad', String(e));
  }
  function withTimeout(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(fail('net', 'Sin conexión. Revisa tu internet e intenta de nuevo.')); }, ms || 9000);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  /* límite de intentos por dispositivo (además del que ya aplica Firebase) */
  var throttle = {
    check: function () { var a = this.get(); if (a.until > Date.now()) throw fail('locked', 'Demasiados intentos. Espera ' + Math.ceil((a.until - Date.now()) / 1000) + ' s.'); },
    get: function () { try { return JSON.parse(localStorage.getItem(ATT)) || { n: 0, until: 0 }; } catch (e) { return { n: 0, until: 0 }; } },
    bad: function (max, wait) { var a = this.get(); a.n++; if (a.n >= max) { a.until = Date.now() + wait; a.n = 0; } localStorage.setItem(ATT, JSON.stringify(a)); },
    ok: function () { localStorage.removeItem(ATT); }
  };
  function normState(st) {
    st = st || {}; var f = st.fav || {};
    return { juryOpen: !!st.juryOpen, fav: { status: f.status || 'idle', endsAt: f.endsAt == null ? null : f.endsAt, rounds: f.rounds || [] } };
  }
  /* si el reloj ya llegó a cero, se ve como cerrado aunque el organizador aún no haya escrito el cierre */
  function effFav(s, now) { var f = s.state.fav; return (f.status === 'open' && now >= f.endsAt) ? { status: 'closed', endsAt: f.endsAt, rounds: f.rounds } : f; }
  function effSede(s, now) { var f = effFav(s, now); if (f !== s.state.fav) s.state.fav = f; return s; }
  function watch(unsubs, q, handler) {
    return new Promise(function (res, rej) {
      var first = true;
      var un = q.onSnapshot(function (snap) { handler(snap); if (first) { first = false; res(); } },
        function (err) { if (first) { first = false; rej(err); } else if (global.console) console.warn('Escucha interrumpida', err && err.code); });
      unsubs.push(un);
    });
  }
  function docsOf(snap) { return snap.docs.map(function (x) { var o = x.data(); o.id = x.id; return o; }); }
  function fillSede(s, kind, snap) {
    if (kind === 'sede') { var d = snap.exists ? snap.data() : {}; s.locked = !!d.locked; s.state = normState(d.state); }
    else if (kind === 'people') s.people = docsOf(snap);
    else if (kind === 'teams') s.teams = docsOf(snap).map(function (t) { t.members = t.members || []; return t; });
    else if (kind === 'votes') { s.fav = {}; snap.forEach(function (x) { s.fav[x.id] = x.data().cand; }); }
    else if (kind === 'scores') {
      s.jury = {}; s.comments = {};
      snap.forEach(function (x) { var o = x.data(); s.jury[x.id] = o.score; if (o.comment) s.comments[x.id] = { t: o.comment, hidden: !!o.hidden }; });
    }
  }
  function chunks(arr, n) { var out = []; for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
  function wipe(db, snaps) {
    var refs = []; snaps.forEach(function (sn) { sn.forEach(function (x) { refs.push(x.ref); }); });
    return chunks(refs, 400).reduce(function (p, grp) { return p.then(function () { var b = db.batch(); grp.forEach(function (r) { b.delete(r); }); return b.commit(); }); }, Promise.resolve());
  }
  function sedeName(id) { var s = C.sedes.filter(function (x) { return x.id === id; })[0]; if (!s) throw fail('bad', 'Sede no válida.'); return s.name; }

  /* ====================================================================
     VOTANTES Y JURADOS
     ==================================================================== */
  var V = null;               /* { sede, pid, uid, name, role, s, unsubs, skew } */
  var vSkew = 0;
  function nowV() { return Date.now() + vSkew; }
  function detachV() { if (V) { V.unsubs.forEach(function (u) { try { u(); } catch (e) { } }); } V = null; }
  function newV(sede, uid, pid, name, role) {
    var s = L.blankSede(sedeName(sede)); s.name = sedeName(sede);
    return { sede: sede, pid: pid, uid: uid, name: name, role: role, s: s, unsubs: [] };
  }
  function attachVoter() {
    var db = appV.firestore(), base = db.collection('sedes').doc(V.sede), s = V.s, u = V.unsubs;
    var ps = [
      watch(u, base, function (sn) { fillSede(s, 'sede', sn); }),
      watch(u, base.collection('people'), function (sn) { fillSede(s, 'people', sn); }),
      watch(u, base.collection('teams'), function (sn) { fillSede(s, 'teams', sn); }),
      watch(u, base.collection('votes').where('pid', '==', V.pid), function (sn) { fillSede(s, 'votes', sn); })
    ];
    if (V.role === 'jury') ps.push(watch(u, base.collection('scores').where('pid', '==', V.pid), function (sn) { fillSede(s, 'scores', sn); }));
    return Promise.all(ps);
  }
  /* reloj: se calcula la diferencia con la hora del servidor escribiendo una marca y leyéndola */
  function calibrate(docRef) {
    var t0 = Date.now();
    return docRef.update({ seen: FV.serverTimestamp() }).then(function () { return docRef.get({ source: 'server' }); }).then(function (sn) {
      var t1 = Date.now(), sv = sn.data().seen; if (sv && sv.toMillis) return sv.toMillis() - Math.round((t0 + t1) / 2);
      return 0;
    });
  }
  function voterFromUser(user, sedeHint) {
    var db = appV.firestore();
    return db.collection('users').doc(user.uid).get().then(function (us) {
      var u = us.exists ? us.data() : null;
      if (!u || u.type !== 'person' || (sedeHint && u.sede !== sedeHint)) throw fail('bad', 'Código incorrecto.');
      return db.collection('sedes').doc(u.sede).collection('people').doc(u.pid).get().then(function (ps) {
        if (!ps.exists) throw fail('bad', 'Código incorrecto.');
        return { u: u, p: ps.data(), ref: ps.ref };
      });
    });
  }
  function startVoter(user, info) {
    detachV();
    V = newV(info.u.sede, user.uid, info.u.pid, info.p.name, info.p.role);
    return calibrate(info.ref).then(function (sk) { vSkew = sk; return attachVoter(); })
      .then(function () { return { id: V.pid, name: V.name, role: V.role, sede: V.sede }; });
  }
  function meV(uid) { if (!V || V.pid !== uid) throw fail('auth', 'Sesión no válida. Vuelve a ingresar.'); return V; }

  var VOTER = {
    login: function (sede, code) {
      return Promise.resolve().then(function () {
        sedeName(sede); throttle.check();
        return appV.auth().signInWithEmailAndPassword(emailFor('p', sede, code), norm(code)).catch(function (e) { var er = authErr(e); if (er.code === 'bad') throttle.bad(5, 60000); throw er; });
      }).then(function (cred) {
        return voterFromUser(cred.user, sede).then(function (info) {
          if (info.p.device && info.p.device !== deviceId()) {
            return info.ref.update({ blocked: FV.increment(1), blockedAt: Date.now() }).catch(function () { }).then(function () {
              return appV.auth().signOut().then(function () { throw fail('device', 'Este código ya se usó en otro dispositivo. Pide al organizador que lo reinicie.'); });
            });
          }
          return info.ref.update({ device: deviceId(), joined: info.p.joined || Date.now() }).then(function () { throttle.ok(); return startVoter(cred.user, info); });
        }, function (e) { return appV.auth().signOut().then(function () { throw e; }); });
      });
    },
    restore: function () { return null; },
    restoreAsync: function () {
      return new Promise(function (res) { var un = appV.auth().onAuthStateChanged(function (u) { un(); res(u); }); }).then(function (u) {
        if (!u) return null;
        return voterFromUser(u).then(function (info) {
          if (!info.p.device || info.p.device !== deviceId()) return appV.auth().signOut().then(function () { return null; });
          return startVoter(u, info);
        }).catch(function () { return null; });
      });
    },
    logout: function () { detachV(); appV.auth().signOut(); },
    getSede: function () {
      return Promise.resolve().then(function () {
        if (!V) throw fail('auth', 'Sesión no válida.');
        var s = V.s, names = {}; s.people.forEach(function (p) { names[p.id] = p.name; });
        return { id: V.sede, name: s.name,
          teams: s.teams.map(function (t) { return { id: t.id, name: t.name, kind: L.kindOf(t), members: t.members.slice(), disfraz: t.disfraz || '', pending: !!t.pending }; }),
          candidates: L.candidatesOf(s), names: names };
      });
    },
    getState: function () {
      return Promise.resolve().then(function () {
        if (!V) throw fail('auth', 'Sesión no válida.');
        var now = nowV(), s = effSede(V.s, now);
        return { juryOpen: s.state.juryOpen, fav: s.state.fav, locked: s.locked, _now: now };
      });
    },
    getMyVotes: function (uid) {
      return Promise.resolve().then(function () {
        var v = meV(uid), s = v.s, out = { fav: {}, jury: {}, comments: {} };
        Object.keys(s.fav).forEach(function (k) { var a = k.split('__'); if (a[0] === uid) out.fav[parseInt(a[1].slice(1), 10)] = s.fav[k]; });
        Object.keys(s.jury).forEach(function (k) { var a = k.split('__'); if (a[0] === uid) (out.jury[a[1]] = out.jury[a[1]] || {})[a[2]] = s.jury[k]; });
        Object.keys(s.comments).forEach(function (k) { var a = k.split('__'); if (a[0] === uid) (out.comments[a[1]] = out.comments[a[1]] || {})[a[2]] = s.comments[k].t; });
        return out;
      });
    },
    votePublic: function (uid, candId) {
      return Promise.resolve().then(function () {
        var v = meV(uid), s = effSede(v.s, nowV()), f = s.state.fav;
        if (f.status !== 'open') throw fail('closed', 'La votación no está abierta.');
        var cands = L.curCands(s); if (cands.indexOf(candId) < 0) throw fail('bad', 'Ese nombre no participa en esta ronda.');
        var r = L.curRound(f), k = uid + '__r' + r;
        if (s.fav.hasOwnProperty(k)) throw fail('dup', 'Ya votaste en esta ronda. El voto no se puede cambiar.');
        return withTimeout(appV.firestore().collection('sedes').doc(v.sede).collection('votes').doc(k).set({ pid: uid, round: r, cand: candId }))
          .then(function () { s.fav[k] = candId; return candId; })
          .catch(function (e) { throw mapErr(e, 'No se pudo registrar el voto: la votación ya cerró o ya votaste.'); });
      });
    },
    setJury: function (uid, cat, teamId, score, comment) {
      return Promise.resolve().then(function () {
        var v = meV(uid), s = effSede(v.s, nowV());
        if (v.role !== 'jury') throw fail('role', 'Solo los jurados califican esta categoría.');
        if (!s.state.juryOpen) throw fail('closed', 'La calificación del jurado no está abierta.');
        var cat_ = C.categories.filter(function (x) { return x.id === cat; })[0], t = L.teamIn(s, teamId);
        if (!cat_ || !t) throw fail('bad', 'Datos no válidos.');
        if (cat_.eligible === 'groups' && L.kindOf(t) === 'solo') throw fail('bad', 'Esta categoría es solo para dúos y grupos.');
        if (!L.validScore(score)) throw fail('bad', 'La nota debe ser un entero del ' + MIN + ' al ' + MAX + '.');
        var key = uid + '__' + cat + '__' + teamId, txt = L.cleanComment(comment);
        return withTimeout(appV.firestore().collection('sedes').doc(v.sede).collection('scores').doc(key).set({ pid: uid, cat: cat, team: teamId, score: score, comment: txt }))
          .then(function () { s.jury[key] = score; if (txt) s.comments[key] = { t: txt }; else delete s.comments[key]; return score; })
          .catch(function (e) { throw mapErr(e, 'No se pudo guardar la nota: la calificación está cerrada.'); });
      });
    },
    annulJury: function (uid, cat, teamId) {
      return Promise.resolve().then(function () {
        var v = meV(uid), s = effSede(v.s, nowV());
        if (v.role !== 'jury') throw fail('role', 'Solo los jurados.');
        if (!s.state.juryOpen) throw fail('closed', 'La calificación del jurado no está abierta.');
        var key = uid + '__' + cat + '__' + teamId;
        return withTimeout(appV.firestore().collection('sedes').doc(v.sede).collection('scores').doc(key).delete())
          .then(function () { delete s.jury[key]; delete s.comments[key]; return true; })
          .catch(function (e) { throw mapErr(e, 'No se pudo anular la nota.'); });
      });
    }
  };

  /* ====================================================================
     ORGANIZADORES
     ==================================================================== */
  var S = null;                                    /* { sid, uid, name, role, unsubs, sedeUnsubs, ready, attachP } */
  var M = { sedes: {}, staff: [], control: { holder: null } };    /* espejo con la misma forma que usa db.js */
  var sSkew = 0;
  function nowS() { return Date.now() + sSkew; }
  function resetM() { M = { sedes: {}, staff: [], control: { holder: null } }; C.sedes.forEach(function (x) { M.sedes[x.id] = L.blankSede(x.name); }); }
  resetM();
  function sdb() { return appS.firestore(); }
  function sref(sede) { return sdb().collection('sedes').doc(sede); }
  function isActiveS() { return !!S && (S.role === 'admin' || M.control.holder === S.sid); }
  function detachSedes() { if (S) { (S.sedeUnsubs || []).forEach(function (u) { try { u(); } catch (e) { } }); S.sedeUnsubs = []; S.attachP = null; } }
  function detachS() { if (S) { detachSedes(); (S.unsubs || []).forEach(function (u) { try { u(); } catch (e) { } }); } S = null; resetM(); }
  function attachSedes() {
    if (!S || S.attachP) return S && S.attachP;
    S.sedeUnsubs = [];
    var all = C.sedes.map(function (x) {
      var base = sref(x.id), s = M.sedes[x.id], u = S.sedeUnsubs;
      return base.get().then(function (sn) { if (!sn.exists) return base.set({ locked: false, state: { juryOpen: false, fav: L.freshFav() } }); }).then(function () {
        return Promise.all([
          watch(u, base, function (sn) { fillSede(s, 'sede', sn); }),
          watch(u, base.collection('people'), function (sn) { fillSede(s, 'people', sn); }),
          watch(u, base.collection('teams'), function (sn) { fillSede(s, 'teams', sn); }),
          watch(u, base.collection('votes'), function (sn) { fillSede(s, 'votes', sn); }),
          watch(u, base.collection('scores'), function (sn) { fillSede(s, 'scores', sn); })
        ]);
      });
    });
    S.attachP = Promise.all(all).catch(function (e) { detachSedes(); throw e; });
    return S.attachP;
  }
  function syncActive() {
    if (!S) return Promise.resolve();
    if (isActiveS()) return attachSedes();
    if (S.attachP) detachSedes();
    return Promise.resolve();
  }
  function startStaff(user, sid, name, role, staffRef) {
    detachS(); S = { sid: sid, uid: user.uid, name: name, role: role, unsubs: [], sedeUnsubs: [], attachP: null };
    var u = S.unsubs;
    S.ready = Promise.all([
      watch(u, sdb().collection('meta').doc('control'), function (sn) { M.control.holder = sn.exists ? (sn.data().holder || null) : null; if (S) syncActive().catch(function () { }); }),
      watch(u, sdb().collection('staff'), function (sn) { M.staff = docsOf(sn).map(function (x) { return { id: x.id, name: x.name, role: x.role, uid: x.uid }; }); })
    ]);
    return calibrate(staffRef).then(function (sk) { sSkew = sk; }).catch(function () { }).then(function () { return S && S.ready; })
      .then(function () { return syncActive(); }).then(function () { return { id: sid, name: name, role: role }; });
  }
  function staffFromUser(user) {
    var db = appS.firestore();
    return db.collection('users').doc(user.uid).get().then(function (us) {
      var u = us.exists ? us.data() : null; if (!u || u.type !== 'staff') throw fail('bad', 'Código incorrecto.');
      var ref = db.collection('staff').doc(u.sid);
      return ref.get().then(function (ss) { if (!ss.exists) throw fail('bad', 'Código incorrecto.'); return { sid: u.sid, name: ss.data().name, role: ss.data().role, ref: ref }; });
    });
  }
  function needStaff() { if (!S) throw fail('auth', 'Debes entrar como organizador.'); return { d: normM(), st: { id: S.sid, name: S.name, role: S.role } }; }
  function normM() { var now = nowS(); Object.keys(M.sedes).forEach(function (k) { effSede(M.sedes[k], now); }); return M; }
  function needActive() { var c = needStaff(); if (!isActiveS()) throw fail('standby', 'Estás en modo espera. Pide que te pasen el control.'); if (!S.attachP) throw fail('net', 'Cargando datos… intenta de nuevo en un momento.'); return c; }
  function needAdmin() { var c = needStaff(); if (S.role !== 'admin') throw fail('auth', 'Solo el administrador puede hacer esto.'); return c; }
  function needUnlocked(s) { if (s.locked) throw fail('locked', 'El evento está bloqueado. El administrador debe desbloquearlo para editar.'); }
  function wait(c) { return Promise.resolve(c); }
  function sede_(c, id) { return L.sedeOf(c.d, id); }

  function createAccount(email, pw) {
    return appC.auth().createUserWithEmailAndPassword(email, pw).then(function (cred) { var uid = cred.user.uid; return appC.auth().signOut().then(function () { return uid; }); })
      .catch(function (e) {
        var c = (e && e.code) || '';
        if (/email-already-in-use/.test(c)) throw fail('bad', 'Ese código ya está en uso en esta sede. Prueba con otro.');
        if (/too-many|quota/.test(c)) throw fail('rate', 'Firebase limitó la creación de cuentas. Espera unos minutos y repite con los que faltan.');
        if (/network/.test(c)) throw fail('net', 'Sin conexión.');
        throw fail('bad', 'No se pudo crear la cuenta (' + (c || e.message) + ').');
      });
  }
  function newCode(name, prefix) { return L.randCode(prefix || (L.ascii(String(name).split(/\s+/)[0]).slice(0, 8) || 'LUCKY')); }
  /* crea persona + cuenta. Devuelve la persona con su código. */
  /* código elegido a mano (ej. para que un jurado use el mismo en varias sedes): letras, números y guion, 6 a 24 caracteres */
  function customCode(c) { c = norm(c); if (!/^[A-Z0-9][A-Z0-9-]{5,23}$/.test(c)) throw fail('bad', 'El código debe tener de 6 a 24 letras, números o guiones (sin espacios).'); return c; }
  function makePerson(sede, spec) {
    var code = spec.code ? customCode(spec.code) : newCode(spec.name, spec.prefix), pid = spec.id || L.newId('p');
    return createAccount(emailFor('p', sede, code), code).then(function (uid) {
      var b = sdb().batch();
      b.set(sdb().collection('users').doc(uid), { type: 'person', sede: sede, pid: pid, role: spec.role });
      b.set(sref(sede).collection('people').doc(pid), { name: spec.name, role: spec.role, note: spec.note || '', test: !!spec.test, uid: uid });
      return b.commit().then(function () { return { id: pid, uid: uid, name: spec.name, role: spec.role, code: code }; });
    });
  }
  function serial(list, fn, out) {
    var err = null;
    return list.reduce(function (p, it) { return p.then(function () { if (err) return; return fn(it).then(function (r) { out.push(r); }, function (e) { err = e; }); }); }, Promise.resolve()).then(function () { return err; });
  }
  function cascadePerson(sede, pid, uid, s) {
    var base = sref(sede), db = sdb(), b = db.batch(), n = 0;
    return Promise.all([base.collection('votes').where('pid', '==', pid).get(), base.collection('votes').where('cand', '==', pid).get(), base.collection('scores').where('pid', '==', pid).get()]).then(function (a) {
      a.forEach(function (sn) { sn.forEach(function (x) { b.delete(x.ref); n++; }); });
      b.delete(base.collection('people').doc(pid)); if (uid) b.delete(db.collection('users').doc(uid));
      s.teams.forEach(function (t) {
        if (t.members.indexOf(pid) < 0) return; var m = t.members.filter(function (x) { return x !== pid; });
        if (m.length) b.update(base.collection('teams').doc(t.id), { members: m }); else b.delete(base.collection('teams').doc(t.id));
      });
      return b.commit();
    });
  }
  function personsReset(sede, s) {
    var b = sdb().batch(); s.people.forEach(function (p) { b.update(sref(sede).collection('people').doc(p.id), { device: FV.delete(), joined: FV.delete(), blocked: FV.delete(), blockedAt: FV.delete() }); }); return b.commit();
  }
  function staffCodesSeed(id) { return id === 'admin' ? 'ADMIN' : (L.ascii(String(id)).slice(0, 8) + 'ORG'); }

  var STAFF = {
    needsSetup: function () { return sdb().collection('meta').doc('init').get().then(function (sn) { return !sn.exists; }, function () { return false; }); },
    /* Solo la primera vez: crea al administrador. Las reglas exigen la clave de configuración que está escrita en firestore.rules. */
    setupAdmin: function (o) {
      return Promise.resolve().then(function () {
        var name = L.cleanName(o.name), key = String(o.key || '').trim(), code = norm(o.code);
        if (!name) throw fail('bad', 'Escribe tu nombre.'); if (!key) throw fail('bad', 'Falta la clave de configuración.'); if (code.length < 8) throw fail('bad', 'El código debe tener al menos 8 caracteres.');
        return appS.auth().createUserWithEmailAndPassword(emailFor('s', '', code), code).catch(function (e) {
          if (e && e.code === 'auth/email-already-in-use') throw fail('bad', 'Ese código ya está en uso. Prueba con otro.'); throw authErr(e);
        }).then(function (cred) {
          var db = sdb(), b = db.batch(), uid = cred.user.uid;
          b.set(db.collection('users').doc(uid), { type: 'staff', sid: 'admin', role: 'admin', setupKey: key });
          b.set(db.collection('staff').doc('admin'), { name: name, role: 'admin', uid: uid });
          b.set(db.collection('meta').doc('control'), { holder: null });
          b.set(db.collection('meta').doc('init'), { done: true, at: FV.serverTimestamp() });
          return b.commit().then(function () { return { code: code }; }, function (e) {
            return cred.user.delete().catch(function () { }).then(function () { throw mapErr(e, 'La clave de configuración no es correcta o el sistema ya fue configurado.'); });
          });
        });
      });
    },
    staffLogin: function (code) {
      return Promise.resolve().then(function () {
        throttle.check();
        return appS.auth().signInWithEmailAndPassword(emailFor('s', '', code), norm(code)).catch(function (e) { var er = authErr(e); if (er.code === 'bad') throttle.bad(5, 120000); throw er; });
      }).then(function (cred) {
        return staffFromUser(cred.user).then(function (info) { throttle.ok(); return startStaff(cred.user, info.sid, info.name, info.role, info.ref); },
          function (e) { return appS.auth().signOut().then(function () { throw e; }); });
      });
    },
    staffRestore: function () {
      return new Promise(function (res) { var un = appS.auth().onAuthStateChanged(function (u) { un(); res(u); }); }).then(function (u) {
        if (!u) return false;
        return staffFromUser(u).then(function (info) { return startStaff(u, info.sid, info.name, info.role, info.ref).then(function () { return true; }); }).catch(function () { return false; });
      });
    },
    staffLogout: function () { detachS(); appS.auth().signOut(); },
    staffInfo: function () {
      return Promise.resolve().then(function () { if (!S) throw fail('auth', 'Debes entrar como organizador.'); return S.ready; }).then(function () { return syncActive(); }).then(function () {
        var c = needStaff(), d = c.d, h = d.staff.filter(function (x) { return x.id === d.control.holder; })[0];
        return { id: c.st.id, name: c.st.name, role: c.st.role, active: isActiveS(), holder: d.control.holder, holderName: h ? h.name : '—',
          operators: d.staff.filter(function (x) { return x.role !== 'admin'; }).map(function (x) { return { id: x.id, name: x.name, role: x.role }; }),
          sedes: C.sedes.map(function (s) { return { id: s.id, name: s.name }; }) };
      });
    },
    passControl: function (toId) {
      return Promise.resolve().then(function () {
        var c = needActive(), to = c.d.staff.filter(function (x) { return x.id === toId; })[0];
        if (!to || to.role === 'admin') throw fail('bad', 'Esa persona no puede recibir el control.');
        return sdb().collection('meta').doc('control').set({ holder: toId }).then(function () { M.control.holder = toId; return true; }, function (e) { throw mapErr(e); });
      });
    },
    overview: function () {
      return Promise.resolve().then(function () {
        var c = needActive(), d = c.d;
        return C.sedes.map(function (x) {
          var s = d.sedes[x.id], f = s.state.fav, r = L.curRound(f), n = 0;
          Object.keys(s.fav).forEach(function (k) { if (k.split('__')[1] === 'r' + r) n++; });
          return { id: x.id, name: s.name, people: s.people.length, candidates: L.candidatesOf(s).length, juryOpen: s.state.juryOpen, fav: f.status === 'idle' ? 'idle' : f.status, round: r, favVoted: n, locked: s.locked };
        });
      });
    },
    sedeData: function (sede) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede), r = L.curRound(s.state.fav);
        var inTeam = {}; s.teams.forEach(function (t) { t.members.forEach(function (m) { inTeam[m] = t.id; }); });
        return { id: sede, name: s.name, locked: s.locked,
          people: s.people.map(function (p) {
            var jn = 0; Object.keys(s.jury).forEach(function (k) { if (k.indexOf(p.id + '__') === 0) jn++; });
            return { id: p.id, name: p.name, role: p.role, note: p.note || '', test: !!p.test, joined: !!p.joined, bound: !!p.device, team: inTeam[p.id] || null, favVoted: r > 0 && s.fav.hasOwnProperty(p.id + '__r' + r), juryVotes: jn, blocked: p.blocked || 0, blockedAt: p.blockedAt || 0 };
          }),
          teams: s.teams.map(function (t) { return { id: t.id, name: t.name, kind: L.kindOf(t), members: t.members.slice(), disfraz: t.disfraz || '', pending: !!t.pending }; }),
          state: { juryOpen: s.state.juryOpen, fav: s.state.fav, _now: nowS() } };
      });
    },

    addPeople: function (sede, list) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede); needUnlocked(s);
        if (!list || !list.length || list.length > 80) throw fail('bad', 'Agrega entre 1 y 80 personas a la vez.');
        var specs = [];
        list.forEach(function (it) { var name = L.cleanName(it.name); if (name) specs.push({ name: name, role: it.role === 'jury' ? 'jury' : 'voter', test: !!it.test, code: it.code || '' }); });
        if (!specs.length) throw fail('bad', 'Escribe al menos un nombre.');
        var out = [];
        return serial(specs, function (sp) { return makePerson(sede, sp); }, out).then(function (err) {
          if (err && !out.length) throw err;
          if (err) out.warn = err.message + ' Se crearon ' + out.length + ' de ' + specs.length + '; los demás no se guardaron.';
          return out;
        });
      });
    },
    updatePerson: function (sede, id, patch) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede), p = L.personIn(s, id); if (!p) throw fail('bad', 'Persona no encontrada.');
        needUnlocked(s);
        var up = {};
        if (patch.name != null) { var n = L.cleanName(patch.name); if (!n) throw fail('bad', 'El nombre no puede estar vacío.'); up.name = n; }
        if (patch.role === 'jury' || patch.role === 'voter') up.role = patch.role;
        if (patch.note != null) up.note = String(patch.note).slice(0, 120);
        var b = sdb().batch(); b.update(sref(sede).collection('people').doc(id), up);
        if (up.role && p.uid) b.update(sdb().collection('users').doc(p.uid), { role: up.role });
        return b.commit().then(function () { return true; }, function (e) { throw mapErr(e); });
      });
    },
    deletePerson: function (sede, id) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede); needUnlocked(s);
        var p = L.personIn(s, id); if (!p) throw fail('bad', 'Persona no encontrada.');
        return cascadePerson(sede, id, p.uid, s).then(function () { return true; }, function (e) { throw mapErr(e); });
      });
    },
    regenCode: function (sede, id, custom) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede), p = L.personIn(s, id); if (!p) throw fail('bad', 'Persona no encontrada.');
        var code = custom ? customCode(custom) : newCode(p.name);
        return createAccount(emailFor('p', sede, code), code).then(function (uid) {
          var db = sdb(), b = db.batch();
          b.set(db.collection('users').doc(uid), { type: 'person', sede: sede, pid: id, role: p.role });
          if (p.uid) b.delete(db.collection('users').doc(p.uid));
          b.update(sref(sede).collection('people').doc(id), { uid: uid, device: FV.delete(), joined: FV.delete(), blocked: FV.delete(), blockedAt: FV.delete() });
          return b.commit().then(function () { return code; }, function (e) { throw mapErr(e); });
        });
      });
    },
    resetDevice: function (sede, id) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede), p = L.personIn(s, id); if (!p) throw fail('bad', 'Persona no encontrada.');
        return sref(sede).collection('people').doc(id).update({ device: FV.delete(), blocked: FV.delete(), blockedAt: FV.delete() }).then(function () { return true; }, function (e) { throw mapErr(e); });
      });
    },
    saveTeam: function (sede, t) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede); needUnlocked(s);
        var members = (t.members || []).filter(function (m, i, a) { return a.indexOf(m) === i; });
        if (members.length < 1 || members.length > 12) throw fail('bad', 'Un equipo lleva de 1 a 12 integrantes.');
        members.forEach(function (m) {
          if (!L.personIn(s, m)) throw fail('bad', 'Integrante no válido.');
          s.teams.forEach(function (o) { if (o.id !== t.id && o.members.indexOf(m) >= 0) throw fail('bad', L.personIn(s, m).name + ' ya está en otro equipo.'); });
        });
        var name = L.cleanName(t.name) || (members.length === 1 ? L.personIn(s, members[0]).name : members.length === 2 ? members.map(function (m) { return L.personIn(s, m).name.split(' ')[0]; }).join(' & ') : 'Grupo de ' + members.length);
        var ex = t.id && L.teamIn(s, t.id), id = ex ? ex.id : L.newId('t'), base = sref(sede), b = sdb().batch();
        var data = { name: name, members: members, disfraz: String(t.disfraz || '').slice(0, 80), pending: !!t.pending };
        if (ex) b.set(base.collection('teams').doc(id), data); else b.set(base.collection('teams').doc(id), data);
        var removed = ex ? ex.members.filter(function (m) { return members.indexOf(m) < 0; }) : [];
        return Promise.all(removed.map(function (m) { return base.collection('votes').where('cand', '==', m).get(); })).then(function (snaps) {
          snaps.forEach(function (sn) { sn.forEach(function (x) { b.delete(x.ref); }); });
          return b.commit();
        }).then(function () { return true; }, function (e) { throw mapErr(e); });
      });
    },
    deleteTeam: function (sede, id) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede); needUnlocked(s);
        var t = L.teamIn(s, id); if (!t) throw fail('bad', 'Equipo no encontrado.');
        var base = sref(sede), b = sdb().batch();
        return Promise.all([base.collection('scores').where('team', '==', id).get()].concat(t.members.map(function (m) { return base.collection('votes').where('cand', '==', m).get(); }))).then(function (snaps) {
          snaps.forEach(function (sn) { sn.forEach(function (x) { b.delete(x.ref); }); });
          b.delete(base.collection('teams').doc(id)); return b.commit();
        }).then(function () { return true; }, function (e) { throw mapErr(e); });
      });
    },

    setJuryOpen: function (sede, open) {
      return Promise.resolve().then(function () { var c = needActive(); sede_(c, sede); return sref(sede).update({ 'state.juryOpen': !!open }).then(function () { return true; }, function (e) { throw mapErr(e); }); });
    },
    favStart: function (sede, minutes) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede), f = s.state.fav;
        if (!L.validMinutes(minutes)) throw fail('bad', 'El tiempo debe ser de 1 a 15 minutos.');
        if (f.status !== 'idle') throw fail('state', 'La votación del favorito ya fue iniciada.');
        var cands = L.candidatesOf(s).map(function (x) { return x.id; });
        if (cands.length < 2) throw fail('bad', 'Hacen falta al menos 2 participantes en ' + s.name + '.');
        var nf = { status: 'open', endsAt: nowS() + minutes * 60000, rounds: [{ cands: cands, minutes: minutes }] };
        return sref(sede).update({ 'state.fav': nf }).then(function () { return nf; }, function (e) { throw mapErr(e); });
      });
    },
    favStartAll: function (minutes) {
      return Promise.resolve().then(function () {
        var c = needActive(), d = c.d, started = [], now = nowS(), b = sdb().batch();
        if (!L.validMinutes(minutes)) throw fail('bad', 'El tiempo debe ser de 1 a 15 minutos.');
        C.sedes.forEach(function (x) {
          var s = d.sedes[x.id], f = s.state.fav, cands = L.candidatesOf(s).map(function (y) { return y.id; });
          if (f.status === 'idle' && cands.length >= 2) { b.update(sref(x.id), { 'state.fav': { status: 'open', endsAt: now + minutes * 60000, rounds: [{ cands: cands, minutes: minutes }] } }); started.push(s.name); }
        });
        if (!started.length) throw fail('state', 'Ninguna sede está lista para iniciar.');
        return b.commit().then(function () { return started; }, function (e) { throw mapErr(e); });
      });
    },
    favExtend: function (sede, minutes) {
      return Promise.resolve().then(function () {
        var c = needActive(), f = sede_(c, sede).state.fav;
        if (!L.validMinutes(minutes)) throw fail('bad', 'El tiempo debe ser de 1 a 15 minutos.');
        if (f.status !== 'open') throw fail('state', 'La votación ya está cerrada.');
        return sref(sede).update({ 'state.fav.endsAt': FV.increment(minutes * 60000) }).then(function () { return f; }, function (e) { throw mapErr(e); });
      });
    },
    favClose: function (sede) {
      return Promise.resolve().then(function () {
        var c = needActive(), f = sede_(c, sede).state.fav;
        if (f.status !== 'open') throw fail('state', 'La votación no está abierta.');
        return sref(sede).update({ 'state.fav.status': 'closed', 'state.fav.endsAt': nowS() }).then(function () { return f; }, function (e) { throw mapErr(e); });
      });
    },
    favStartRunoff: function (sede, minutes) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede), f = s.state.fav;
        if (!L.validMinutes(minutes)) throw fail('bad', 'El tiempo debe ser de 1 a 15 minutos.');
        if (f.status !== 'closed') throw fail('state', 'Primero debe cerrarse la votación.');
        var tied = L.computeFav(s).tied; if (tied.length < 2) throw fail('notie', 'No hay empate en el primer lugar.');
        var nf = { status: 'open', endsAt: nowS() + minutes * 60000, rounds: f.rounds.concat([{ cands: tied, minutes: minutes }]) };
        return sref(sede).update({ 'state.fav': nf }).then(function () { return nf; }, function (e) { throw mapErr(e); });
      });
    },
    favProgress: function (sede) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede), f = s.state.fav, r = L.curRound(f), n = 0;
        Object.keys(s.fav).forEach(function (k) { if (k.split('__')[1] === 'r' + r) n++; });
        return { voted: n, total: s.people.length, round: r, status: f.status, endsAt: f.endsAt };
      });
    },
    stats: function (sede) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede), voted = {}, r = L.curRound(s.state.fav), fv = 0;
        Object.keys(s.jury).forEach(function (k) { voted[k.split('__')[0]] = 1; });
        Object.keys(s.fav).forEach(function (k) { if (k.split('__')[1] === 'r' + r) fv++; });
        var jurors = s.people.filter(function (p) { return p.role === 'jury'; });
        return { fav: fv, favTotal: s.people.length, jury: Object.keys(s.jury).length, jurorsVoted: Object.keys(voted).length, jurorsTotal: jurors.length,
          joined: s.people.filter(function (p) { return p.joined; }).length, people: s.people.length };
      });
    },
    results: function (sede) { return Promise.resolve().then(function () { var c = needActive(); return L.compute(sede_(c, sede)); }); },
    hideComment: function (sede, key, hidden) {
      return Promise.resolve().then(function () {
        var c = needActive(), s = sede_(c, sede);
        if (!s.comments[key]) throw fail('bad', 'Comentario no encontrado.');
        return sref(sede).collection('scores').doc(key).update({ hidden: !!hidden }).then(function () { return !!hidden; }, function (e) { throw mapErr(e); });
      });
    },

    /* --- Solo administrador --- */
    lock: function (sede, on) {
      return Promise.resolve().then(function () { var c = needAdmin(); sede_(c, sede); return sref(sede).update({ locked: !!on }).then(function () { return !!on; }, function (e) { throw mapErr(e); }); });
    },
    resetVotes: function (sede, word) {
      return Promise.resolve().then(function () {
        var c = needAdmin(), s = sede_(c, sede);
        if (word !== 'REINICIAR') throw fail('bad', 'Escribe REINICIAR para confirmar.');
        needUnlocked(s);
        var base = sref(sede);
        return Promise.all([base.collection('votes').get(), base.collection('scores').get()]).then(function (sn) { return wipe(sdb(), sn); })
          .then(function () { return base.update({ state: { juryOpen: false, fav: L.freshFav() } }); }).then(function () { return true; }, function (e) { throw mapErr(e); });
      });
    },
    resetAll: function (sede, word) {
      return Promise.resolve().then(function () {
        var c = needAdmin(), s = sede_(c, sede);
        if (word !== 'REINICIAR') throw fail('bad', 'Escribe REINICIAR para confirmar.');
        needUnlocked(s);
        var base = sref(sede);
        return Promise.all([base.collection('votes').get(), base.collection('scores').get()]).then(function (sn) { return wipe(sdb(), sn); })
          .then(function () { return base.update({ state: { juryOpen: false, fav: L.freshFav() } }); }).then(function () { return personsReset(sede, s); }).then(function () { return true; }, function (e) { throw mapErr(e); });
      });
    },
    addTestUsers: function (sede) {
      return Promise.resolve().then(function () {
        var c = needAdmin(), s = sede_(c, sede); needUnlocked(s);
        var specs = [['PRUEBA 1', 'voter'], ['PRUEBA 2', 'voter'], ['PRUEBA 3', 'voter'], ['PRUEBA 4', 'voter'], ['PRUEBA JURADO', 'jury']].map(function (x) {
          return { name: x[0] + ' (' + s.name + ')', role: x[1], test: true, note: 'Usuario de prueba: se elimina antes del evento', prefix: 'PRUEBA' };
        });
        var out = []; return serial(specs, function (sp) { return makePerson(sede, sp); }, out).then(function (err) { if (err && !out.length) throw err; if (err) out.warn = err.message; return out; });
      });
    },
    deleteTestUsers: function (sede) {
      return Promise.resolve().then(function () {
        var c = needAdmin(), s = sede_(c, sede), gone = s.people.filter(function (p) { return p.test; });
        return gone.reduce(function (p, x) { return p.then(function () { return cascadePerson(sede, x.id, x.uid, s); }); }, Promise.resolve()).then(function () { return gone.length; }, function (e) { throw mapErr(e); });
      });
    },
    staffList: function () { return Promise.resolve().then(function () { var c = needAdmin(); return c.d.staff.map(function (x) { return { id: x.id, name: x.name, role: x.role }; }); }); },
    regenStaffCode: function (id) {
      return Promise.resolve().then(function () {
        var c = needAdmin(), st = c.d.staff.filter(function (x) { return x.id === id; })[0]; if (!st) throw fail('bad', 'No encontrado.');
        var code = newCode(st.name, id === 'admin' ? 'ADMIN' : (L.ascii(st.name.split(/\s+/)[0]).slice(0, 8) + 'ORG'));
        return createAccount(emailFor('s', '', code), code).then(function (uid) {
          var db = sdb(), b = db.batch();
          b.set(db.collection('users').doc(uid), { type: 'staff', sid: id, role: st.role });
          if (st.uid) b.delete(db.collection('users').doc(st.uid));
          b.update(db.collection('staff').doc(id), { uid: uid });
          return b.commit().then(function () { return code; }, function (e) { throw mapErr(e); });
        });
      });
    }
  };

  /* Carga inicial desde el archivo seed.js de la demo: crea organizadores, personas y equipos con códigos NUEVOS. */
  STAFF.importSeed = function (seed, onProgress) {
    return Promise.resolve().then(function () {
      var c = needAdmin(), d = c.d, say = onProgress || function () { }, db = sdb(), todo = [], results = [];
      (seed.staff || []).forEach(function (st) { if (st.role !== 'admin' && !d.staff.some(function (x) { return x.id === st.id; })) todo.push({ kind: 'staff', st: st }); });
      Object.keys(seed.sedes || {}).forEach(function (sk) {
        if (!d.sedes[sk] || d.sedes[sk].people.length) return;
        needUnlocked(d.sedes[sk]);
        (seed.sedes[sk].people || []).forEach(function (p) { todo.push({ kind: 'person', sede: sk, p: p }); });
      });
      var n = 0, total = todo.length;
      return serial(todo, function (it) {
        say('Creando cuentas… ' + (++n) + ' de ' + total);
        if (it.kind === 'staff') {
          var code = newCode(it.st.name, L.ascii(it.st.name.split(/\s+/)[0]).slice(0, 8) + 'ORG');
          return createAccount(emailFor('s', '', code), code).then(function (uid) {
            var b = db.batch(); b.set(db.collection('users').doc(uid), { type: 'staff', sid: it.st.id, role: it.st.role }); b.set(db.collection('staff').doc(it.st.id), { name: it.st.name, role: it.st.role, uid: uid });
            return b.commit().then(function () { return { kind: 'staff', name: it.st.name, role: it.st.role, code: code }; });
          });
        }
        return makePerson(it.sede, { id: it.p.id, name: L.cleanName(it.p.name), role: it.p.role === 'jury' ? 'jury' : 'voter', note: it.p.note || '' }).then(function (r) { r.kind = 'person'; r.sede = it.sede; return r; });
      }, results).then(function (err) {
        /* equipos: solo de las sedes que se acaban de importar */
        var sedesDone = {}; results.forEach(function (r) { if (r.kind === 'person') sedesDone[r.sede] = 1; });
        var b = db.batch(), any = false;
        Object.keys(sedesDone).forEach(function (sk) {
          (seed.sedes[sk].teams || []).forEach(function (t) {
            var ok = (t.members || []).filter(function (m) { return results.some(function (r) { return r.kind === 'person' && r.sede === sk && r.id === m; }); });
            if (ok.length) { b.set(sref(sk).collection('teams').doc(t.id), { name: t.name, members: ok, disfraz: t.disfraz || '', pending: !!t.pending }); any = true; }
          });
        });
        if (seed.chief && !d.control.holder && d.staff.concat(results.filter(function (r) { return r.kind === 'staff'; })).length) { b.set(db.collection('meta').doc('control'), { holder: seed.chief }); any = true; }
        return (any ? b.commit() : Promise.resolve()).then(function () {
          results.warn = err ? err.message + ' Se alcanzaron a crear ' + results.length + ' de ' + total + '. Repite la importación para completar los que faltan.' : '';
          return results;
        });
      });
    });
  };

  var DB = { mode: 'firebase', hasData: function () { return true; } };
  Object.keys(VOTER).forEach(function (k) { DB[k] = VOTER[k]; });
  Object.keys(STAFF).forEach(function (k) { DB[k] = STAFF[k]; });
  global.DB = DB;
})(window);
