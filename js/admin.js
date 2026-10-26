/* Panel del organizador · 3 sedes · gestión de personas y equipos · favorito con reloj · resultados y ceremonia */
(function () {
  'use strict';
  var C = window.CONFIG, MAX = C.scale.max, FAV = C.publicCategory;
  var view = document.getElementById('view'), topEl = document.getElementById('topbar');
  var st = { me: null, info: null, sede: null, tab: 'panel', sd: null, prog: null, stats: null, res: null, ov: [], staff: [], skew: 0, resTab: null, showPrivate: false, filter: '' };
  var clockTimer = null, pollTimer = null, favMin = 4, runoffMin = 1, allMin = 4;

  Decor.mount();
  if (DB.mode !== 'demo') document.getElementById('demoBanner').style.display = 'none';

  function isAdmin() { return st.me && st.me.role === 'admin'; }
  function active() { return st.info && st.info.active; }
  function serverNow() { return Date.now() + st.skew; }
  function fav() { return st.sd.state.fav; }
  function favOpen() { var f = fav(); return f.status === 'open' && serverNow() < f.endsAt; }
  function fmtClock(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function sedeLabel(id) { return C.sedes.filter(function (s) { return s.id === id; })[0].name; }
  function roleLabel(r) { return r === 'admin' ? 'Administrador' : r === 'chief' ? 'Organizador principal' : 'Respaldo'; }

  /* ---------- Diálogo con formulario ---------- */
  function dialog(o) {
    return new Promise(function (resolve) {
      var root = document.getElementById('modal-root'), wrap = document.createElement('div'); wrap.className = 'modal-backdrop';
      wrap.innerHTML = '<div class="modal wide" role="dialog" aria-modal="true"><div class="modal-emoji">' + (o.emoji || '🎃') + '</div><h3>' + U.esc(o.title) + '</h3>' +
        '<div class="modal-body">' + o.body + '</div><div id="dlgErr"></div><div class="modal-actions">' +
        (o.cancel === false ? '' : '<button class="btn ghost" data-r="0">' + U.esc(o.cancel || 'Cancelar') + '</button>') +
        '<button class="btn primary" data-r="1">' + U.esc(o.ok || 'Aceptar') + '</button></div></div>';
      function close(v) { wrap.classList.add('out'); setTimeout(function () { wrap.remove(); }, 200); resolve(v); }
      wrap.addEventListener('click', function (e) {
        var r = e.target.getAttribute && e.target.getAttribute('data-r');
        if (r === '1') {
          if (!o.read) return close(true);
          try { var v = o.read(wrap); close(v === undefined ? true : v); } catch (er) { wrap.querySelector('#dlgErr').innerHTML = '<div class="msg err">' + U.esc(er.message) + '</div>'; }
        } else if (r === '0' || (e.target === wrap && o.cancel !== false)) close(null);
      });
      root.appendChild(wrap); if (o.onOpen) o.onOpen(wrap);
      var f = wrap.querySelector('input:not([type=checkbox]),textarea,select'); if (f) f.focus();
    });
  }
  function csvOf(rows) { return rows.map(function (r) { return r.map(function (x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }).join(','); }).join('\n'); }
  function showCodes(title, list, filename) {
    var rows = list.map(function (x) { return '<tr><td>' + U.esc(x.name) + '</td><td>' + (x.role === 'jury' ? 'Jurado' : x.role === 'voter' ? 'Votante' : U.esc(x.role || '')) + '</td><td class="codecell">' + U.esc(x.code) + '</td></tr>'; }).join('');
    return dialog({ emoji: '🔑', title: title, ok: 'Listo, ya los guardé', cancel: false,
      body: '<p style="margin:0 0 10px"><b>Guarda estos códigos ahora.</b> Por seguridad no se vuelven a mostrar (si se pierde uno, se genera otro).</p><div class="tbl-light"><table><thead><tr><th>Nombre</th><th>Rol</th><th>Código</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<button class="btn purple small" id="dlCodes" style="margin-top:10px">⬇ Descargar CSV</button>',
      onOpen: function (w) { w.querySelector('#dlCodes').onclick = function () { U.download(filename || 'codigos.csv', csvOf([['Sede', 'Nombre', 'Rol', 'Código']].concat(list.map(function (x) { return [sedeLabel(st.sede), x.name, x.role === 'jury' ? 'Jurado' : x.role === 'voter' ? 'Votante' : x.role, x.code]; })))); }; } });
  }

  /* ---------- Barra y acceso ---------- */
  function renderTop() {
    topEl.innerHTML = '<div class="logo-pill"><img src="img/logo.png" alt="Grupo Lucky"></div><span class="sede-chip">' + (st.me ? U.esc(roleLabel(st.me.role)) : 'Organizador') + '</span><span class="spacer"></span>' +
      '<a class="btn ghost small" href="index.html" style="text-decoration:none">Ver votación</a><button class="icon-btn" id="btnSound">' + (FX.isMuted() ? '🔇' : '🔊') + '</button>' +
      (st.me ? '<button class="btn ghost small" id="btnOut">Salir</button>' : '');
    document.getElementById('btnSound').onclick = function () { FX.setMuted(!FX.isMuted()); renderTop(); };
    var o = document.getElementById('btnOut'); if (o) o.onclick = function () { DB.staffLogout(); st.me = st.info = st.sd = st.res = null; stopTimers(); render(); };
  }
  function renderLogin() {
    var nodata = !DB.hasData();
    view.innerHTML = '<section class="hero"><div class="kicker">🎃 Zona del organizador</div><h1 class="title"><span class="t2" style="font-size:clamp(2.6rem,9vw,4.4rem)">Panel</span></h1></section>' +
      '<form class="parchment login-wrap" id="f" autocomplete="off"><h2>Acceso organizador</h2><div class="sub">Escribe tu código de organizador</div>' +
      (nodata ? '<div class="msg info" style="margin-top:12px">Esta demo no tiene datos cargados (falta <b>data/private/seed.js</b>). Con Firebase el administrador se crea desde la consola.</div>' : '') +
      '<label class="lbl" for="c">Código</label><input class="field code-input" id="c" placeholder="NOMBRE-XXXXXX" required autocapitalize="characters" autocomplete="off" spellcheck="false">' +
      '<div id="m"></div><button class="btn primary" style="width:100%;margin-top:18px">Entrar</button></form>';
    if (DB.needsSetup) DB.needsSetup().then(function (need) { if (need && !st.me) renderSetup(); });
    document.getElementById('f').onsubmit = function (e) {
      e.preventDefault();
      DB.staffLogin(document.getElementById('c').value).then(function () { st.tab = 'panel'; FX.sfx.vote(); return refresh(); }).then(render)
        .catch(function (err) { FX.sfx.error(); document.getElementById('m').innerHTML = '<div class="msg err">' + U.esc(err.message) + '</div>'; });
    };
  }

  /* Primera vez con Firebase: crear al administrador (una sola vez) */
  function renderSetup() {
    var sug = LuckyLogic.randCode('ADMIN');
    view.innerHTML = '<section class="hero"><div class="kicker">🎃 Primera configuración</div><h1 class="title"><span class="t2" style="font-size:clamp(2.2rem,8vw,3.8rem)">Crear administrador</span></h1></section>' +
      '<form class="parchment login-wrap" id="fs" autocomplete="off"><h2>Solo se hace una vez</h2><div class="sub">Crea tu acceso de administrador</div>' +
      '<label class="lbl" for="sn">Tu nombre completo</label><input class="field" id="sn" required maxlength="60" placeholder="Nombre y apellidos">' +
      '<label class="lbl" for="sk">Clave de configuración <small style="font-weight:400;opacity:.7">(está escrita en firestore.rules)</small></label><input class="field code-input" id="sk" required autocomplete="off" spellcheck="false">' +
      '<label class="lbl" for="sc">Tu código de administrador <small style="font-weight:400;opacity:.7">(guárdalo, es tu contraseña)</small></label><input class="field code-input" id="sc" required value="' + U.esc(sug) + '" spellcheck="false">' +
      '<div id="m"></div><button class="btn primary" style="width:100%;margin-top:18px">Crear administrador</button></form>';
    document.getElementById('fs').onsubmit = function (e) {
      e.preventDefault(); var code = document.getElementById('sc').value;
      DB.setupAdmin({ name: document.getElementById('sn').value, key: document.getElementById('sk').value, code: code })
        .then(function () { return U.confirmModal({ emoji: '🔑', title: 'Administrador creado', html: 'Tu código es:<br><b style="font-size:1.4rem;letter-spacing:2px">' + U.esc(code.trim().toUpperCase()) + '</b><br>Anótalo ahora: no se vuelve a mostrar.', ok: 'Ya lo anoté', cancel: '' }); })
        .then(function () { return DB.staffLogin(code); }).then(function () { st.tab = 'panel'; return refresh(); }).then(render)
        .catch(function (err) { FX.sfx.error(); document.getElementById('m').innerHTML = '<div class="msg err">' + U.esc(err.message) + '</div>'; });
    };
  }

  /* ---------- Datos ---------- */
  function refresh() {
    return DB.staffInfo().then(function (info) {
      st.info = info; st.me = { id: info.id, name: info.name, role: info.role };
      if (!st.sede) st.sede = info.sedes[0].id;
      if (!info.active) { st.sd = st.res = null; return; }
      return Promise.all([DB.sedeData(st.sede), DB.favProgress(st.sede), DB.stats(st.sede), DB.results(st.sede), DB.overview(), isAdmin() ? DB.staffList() : Promise.resolve([])]).then(function (a) {
        st.sd = a[0]; st.skew = a[0].state._now - Date.now(); st.prog = a[1]; st.stats = a[2]; st.res = a[3]; st.ov = a[4]; st.staff = a[5];
      });
    });
  }
  var JURY_POSSIBLE = function () { return C.categories.reduce(function (n, c) { return n + st.sd.teams.filter(function (t) { return !(c.eligible === 'groups' && t.kind === 'solo'); }).length; }, 0); };

  /* ---------- Estructura ---------- */
  function shell(inner) {
    var tabs = [['panel', '🎛️ Panel'], ['personas', '👥 Personas'], ['equipos', '🎭 Equipos'], ['favorito', '🎩 Voto de todos'], ['resultados', '🏆 Resultados']];
    if (isAdmin()) tabs.push(['sistema', '⚙️ Sistema']);
    view.innerHTML = '<div class="sede-bar">' + C.sedes.map(function (s) { var o = st.ov.filter(function (x) { return x.id === s.id; })[0]; return '<button class="sede-btn' + (s.id === st.sede ? ' on' : '') + '" data-sedechip="' + s.id + '">' + U.esc(s.name) + (o && o.locked ? ' 🔒' : '') + '</button>'; }).join('') + '</div>' +
      '<nav class="tabs">' + tabs.map(function (t) { return '<button class="tab' + (st.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</nav>' + inner;
  }
  function viewStandby() {
    stopTimers();
    view.innerHTML = '<div class="status-card" style="max-width:640px;margin:30px auto"><div class="ghost-float">' + Decor.ghost + '</div><div><h3>Estás en modo espera 🕯️</h3><p>Hoy maneja el concurso <b>' + U.esc(st.info.holderName) + '</b>. Tu acceso está listo: cuando te pasen el control, esta pantalla se activa sola.</p></div></div>';
    pollTimer = setInterval(function () { refresh().then(function () { if (active()) render(); }).catch(function () { }); }, 3000);
  }

  /* ---------- Panel ---------- */
  function viewPanel() {
    var r = st.stats, on = st.sd.state.juryOpen;
    var ops = st.info.operators.map(function (o) { return '<option value="' + o.id + '"' + (o.id === st.info.holder ? ' selected' : '') + '>' + U.esc(o.name) + ' (' + roleLabel(o.role).toLowerCase() + ')</option>'; }).join('');
    shell(
      '<div class="adm-grid"><div class="panel phase"><div class="info"><h3>🎩 Jurados · ' + U.esc(st.sd.name) + ' · <span class="' + (on ? 'badge-on' : 'badge-off') + '">' + (on ? 'ABIERTO' : 'CERRADO') + '</span></h3><p>Las 4 categorías: disfraz del año, creativo, grupal e interpretación.</p></div>' +
      '<label class="switch"><input type="checkbox" data-phase="juryOpen"' + (on ? ' checked' : '') + '><span class="sl"></span></label></div>' +
      '<div class="panel phase"><div class="info"><h3>🕯️ Quién tiene el control</h3><p>Ahora: <b>' + U.esc(st.info.holderName) + '</b>. Los demás organizadores quedan en espera.</p>' +
      '<div class="mins-row" style="margin:8px 0 0"><select class="field" id="ctlTo" style="max-width:260px">' + ops + '</select><button class="btn purple small" data-act="passctl">Pasar el control</button></div></div></div></div>' +
      '<div class="adm-grid">' +
      '<div class="panel stat"><b>' + r.joined + '/' + r.people + '</b><span>personas que ya ingresaron</span></div>' +
      '<div class="panel stat"><b>' + r.fav + '/' + r.favTotal + '</b><span>votos del favorito (ronda actual)</span></div>' +
      '<div class="panel stat"><b>' + r.jury + '/' + (JURY_POSSIBLE() * r.jurorsTotal) + '</b><span>notas de jurado (máx. con ' + r.jurorsTotal + ' jurados)</span></div>' +
      '<div class="panel stat"><b>' + r.jurorsVoted + '/' + r.jurorsTotal + '</b><span>jurados que ya calificaron</span></div></div>' +
      '<div class="panel" style="margin-bottom:16px"><h3 style="margin-bottom:6px">🚀 Iniciar el voto de todos en las 3 sedes a la vez</h3><p style="margin:0 0 10px;opacity:.85;font-size:.9rem">Abre la votación del favorito, con el mismo reloj, en todas las sedes que estén listas (con al menos 2 participantes).</p>' +
      '<div class="mins-row"><button class="btn ghost small" data-act="adec">−</button><input class="field mins" id="allmins" type="number" min="1" max="15" value="' + allMin + '"><button class="btn ghost small" data-act="ainc">+</button><button class="btn primary" data-act="favall">▶ Iniciar las 3 sedes</button></div></div>' +
      '<div class="panel tbl-wrap"><table class="tbl"><thead><tr><th>Sede</th><th>Personas</th><th>Participantes</th><th>Jurados</th><th>Favorito</th><th>Candado</th></tr></thead><tbody>' +
      st.ov.map(function (o) { return '<tr><td><b>' + U.esc(o.name) + '</b></td><td>' + o.people + '</td><td>' + o.candidates + '</td><td>' + (o.juryOpen ? '<span class="badge-on">Abierto</span>' : '<span class="badge-off">Cerrado</span>') + '</td><td>' + (o.fav === 'idle' ? '—' : o.fav === 'open' ? '<span class="badge-on">En curso</span> (' + o.favVoted + ')' : 'Cerrado (' + o.favVoted + ')') + (o.round > 1 ? ' · desempate' : '') + '</td><td>' + (o.locked ? '🔒' : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="warn-box">🔒 Los resultados solo los ve quien tiene el control. Los votantes nunca ven totales ni posiciones.</div>'
    );
  }

  /* ---------- Personas ---------- */
  function viewPersonas() {
    var q = st.filter.toLowerCase(), lock = st.sd.locked;
    var rows = st.sd.people.filter(function (u) { return !q || u.name.toLowerCase().indexOf(q) >= 0; }).map(function (u) {
      return '<tr><td>' + U.esc(u.name) + (u.test ? ' <span class="chip warn">Prueba</span>' : '') + (u.note ? '<div style="font-size:.75rem;opacity:.7">' + U.esc(u.note) + '</div>' : '') + (u.blocked ? '<div class="alert-dev">⚠ ' + u.blocked + (u.blocked === 1 ? ' intento' : ' intentos') + ' desde otro aparato · ' + new Date(u.blockedAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }) + '</div>' : '') + '</td>' +
        '<td>' + (u.role === 'jury' ? '<span class="role-tag jury">Jurado</span>' : 'Votante') + '</td><td>' + (u.team ? '🎭' : '<span style="opacity:.5" title="No está en ningún equipo">—</span>') + '</td>' +
        '<td><span class="dot' + (u.joined ? ' on' : '') + '"></span>' + (u.joined ? 'Ingresó' : '—') + '</td><td>' + (u.favVoted ? '✅' : '—') + '</td><td>' + (u.role === 'jury' ? u.juryVotes + '/' + JURY_POSSIBLE() : '—') + '</td>' +
        '<td class="acts"><button class="btn ghost small" data-act="editperson" data-id="' + u.id + '"' + (lock ? ' disabled' : '') + '>Editar</button> <button class="btn ghost small" data-act="regen" data-id="' + u.id + '">Nuevo código</button> ' +
        ((u.bound || u.blocked) ? '<button class="btn ghost small" data-act="resetdev" data-id="' + u.id + '">Liberar dispositivo</button> ' : '') + '<button class="btn danger small" data-act="delperson" data-id="' + u.id + '"' + (lock ? ' disabled' : '') + '>Eliminar</button></td></tr>';
    }).join('');
    var nBlk = st.sd.people.filter(function (u) { return u.blocked; }).length;
    shell((nBlk ? '<div class="warn-box" style="border-color:var(--bad)">⚠ <b>' + nBlk + (nBlk === 1 ? ' persona' : ' personas') + '</b> intentó entrar con su código desde otro aparato. Puede ser que cambió de celular o que prestó su código. Revisa la lista y usa <b>Liberar dispositivo</b> o <b>Nuevo código</b>.</div>' : '') + (lock ? '<div class="warn-box">🔒 El evento está bloqueado: no se pueden agregar, editar ni eliminar personas. Solo se pueden generar códigos nuevos.</div>' : '') +
      '<div class="panel" style="margin-bottom:16px"><h3 style="margin-bottom:6px">➕ Agregar personas a ' + U.esc(st.sd.name) + '</h3><p style="margin:0 0 8px;opacity:.85;font-size:.9rem">Escribe o pega los nombres, <b>uno por línea</b>. Cada uno recibe su código.</p>' +
      '<textarea class="field" id="addNames" rows="4" placeholder="Ana Pérez&#10;Carlos Rojas Soto" style="min-height:90px"' + (lock ? ' disabled' : '') + '></textarea>' +
      '<div class="mins-row" style="margin-top:10px"><select class="field" id="addRole" style="max-width:200px"><option value="voter">Votante</option><option value="jury">Jurado</option></select><button class="btn primary" data-act="addpeople"' + (lock ? ' disabled' : '') + '>Agregar y generar códigos</button></div></div>' +
      '<div class="toolbar"><input class="field" id="flt" placeholder="Buscar persona…" value="' + U.esc(st.filter) + '"><span style="opacity:.8">' + st.sd.people.length + ' personas</span></div>' +
      '<div class="panel tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Rol</th><th>Equipo</th><th>Ingreso</th><th>Fav.</th><th>Notas</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" style="opacity:.7;padding:20px">Aún no hay personas en esta sede. Agrégalas arriba.</td></tr>') + '</tbody></table></div>' +
      '<p style="opacity:.75;font-size:.85rem;margin-top:12px">“Nuevo código” también libera el dispositivo. Para que una persona pueda ser votada, agrégala a un equipo en la pestaña <b>Equipos</b>.</p>');
    var f = document.getElementById('flt'); f.oninput = function () { st.filter = f.value; var p = f.selectionStart; viewPersonas(); var n = document.getElementById('flt'); n.focus(); n.setSelectionRange(p, p); };
  }

  /* ---------- Equipos ---------- */
  function viewEquipos() {
    var lock = st.sd.locked, loose = st.sd.people.filter(function (p) { return !p.team && !p.test; });
    shell((lock ? '<div class="warn-box">🔒 El evento está bloqueado: no se pueden crear, editar ni eliminar equipos.</div>' : '') +
      '<div class="toolbar"><button class="btn primary" data-act="addteam"' + (lock ? ' disabled' : '') + '>➕ Nuevo participante / equipo</button><span style="opacity:.8">' + st.sd.teams.length + ' participaciones · ' + st.sd.teams.reduce(function (n, t) { return n + t.members.length; }, 0) + ' personas que compiten</span></div>' +
      '<p style="opacity:.8;font-size:.9rem;margin:0 0 12px">Una persona sola es <b>solo/a</b>, dos son <b>dúo</b> y tres o más son <b>grupo</b>. En las categorías de jurado se califica por equipo; en el favorito del público se vota por persona.</p>' +
      '<section class="grid">' + (st.sd.teams.map(function (t) {
        return '<article class="parchment pcard"><div class="row"><div class="avatar" style="background:hsl(' + U.hueFor(t.name) + ',45%,42%)">' + (t.kind === 'solo' ? U.esc(U.initials(t.name)) : t.kind === 'duo' ? '👯' : '👥') + '</div><div><h3>' + U.esc(t.name) + '</h3><div><span class="chip ' + t.kind + '">' + (t.kind === 'solo' ? 'Solo/a' : t.kind === 'duo' ? 'Dúo' : 'Grupo') + '</span>' + (t.pending ? '<span class="chip warn">Por confirmar</span>' : '') + '</div>' +
          (t.kind !== 'solo' ? '<div class="meta">' + U.esc(t.members.map(function (m) { return (st.sd.people.filter(function (p) { return p.id === m; })[0] || {}).name || '?'; }).join(', ')) + '</div>' : '') + (t.disfraz ? '<div class="meta">🎭 ' + U.esc(t.disfraz) + '</div>' : '') + '</div></div>' +
          '<div class="confirm-row"><div class="hint"></div><button class="btn ghost small" style="color:#3b1a6b;background:#e8dffa" data-act="editteam" data-id="' + t.id + '"' + (lock ? ' disabled' : '') + '>Editar</button><button class="btn danger small" data-act="delteam" data-id="' + t.id + '"' + (lock ? ' disabled' : '') + '>Eliminar</button></div></article>';
      }).join('') || '<div class="empty" style="grid-column:1/-1"><div class="big">🎭</div><p>Aún no hay participantes en esta sede.<br>Agrega personas y luego crea sus equipos aquí.</p></div>') + '</section>' +
      (loose.length ? '<div class="warn-box" style="margin-top:16px">Personas que <b>no compiten</b> (solo votan): ' + U.esc(loose.map(function (p) { return p.name; }).join(', ')) + '.</div>' : ''));
  }
  function teamDialog(t) {
    var others = {}; st.sd.teams.forEach(function (x) { if (!t || x.id !== t.id) x.members.forEach(function (m) { others[m] = 1; }); });
    var cur = t ? t.members : [], list = st.sd.people.filter(function (p) { return !others[p.id]; });
    return dialog({ emoji: '🎭', title: t ? 'Editar participante' : 'Nuevo participante / equipo', ok: 'Guardar',
      body: '<label class="lbl">Nombre del equipo <small>(opcional: se arma solo)</small></label><input class="field" id="tName" value="' + U.esc(t ? t.name : '') + '" maxlength="60">' +
        '<label class="lbl">Nombre del disfraz <small>(opcional)</small></label><input class="field" id="tDis" value="' + U.esc(t ? t.disfraz : '') + '" maxlength="80">' +
        '<label class="lbl">Integrantes <small>(1 = solo, 2 = dúo, 3 o más = grupo)</small></label><div class="check-list">' +
        list.map(function (p) { return '<label class="chk"><input type="checkbox" value="' + p.id + '"' + (cur.indexOf(p.id) >= 0 ? ' checked' : '') + '> ' + U.esc(p.name) + '</label>'; }).join('') + '</div>' +
        '<label class="chk" style="margin-top:10px"><input type="checkbox" id="tPend"' + (t && t.pending ? ' checked' : '') + '> Participación por confirmar</label>',
      read: function (w) { var m = Array.prototype.map.call(w.querySelectorAll('.check-list input:checked'), function (i) { return i.value; }); if (!m.length) throw new Error('Marca al menos un integrante.'); return { id: t ? t.id : null, name: w.querySelector('#tName').value, disfraz: w.querySelector('#tDis').value, members: m, pending: w.querySelector('#tPend').checked }; } });
  }

  /* ---------- Favorito ---------- */
  function viewFavorito() {
    var f = fav(), p = st.prog, open = favOpen(), round = f.rounds.length, pct = p.total ? Math.round(p.voted / p.total * 100) : 0, body;
    var title = '⭐ ' + FAV.name + ' · ' + U.esc(st.sd.name) + (round > 1 ? ' · Desempate (ronda ' + round + ')' : '');
    if (f.status === 'idle') {
      body = '<div class="panel fav-ctl"><h3>' + title + '</h3><p>Cada persona (jurados incluidos) tiene <b>un solo voto</b> con confirmación. Al pulsar Iniciar, la votación se abre para <b>todos a la vez</b> y corre el reloj.</p>' +
        '<label class="lbl" style="color:#fff" for="mins">Tiempo para votar (minutos)</label><div class="mins-row"><button class="btn ghost small" data-act="dec">−</button><input class="field mins" id="mins" type="number" min="1" max="15" value="' + favMin + '"><button class="btn ghost small" data-act="inc">+</button></div>' +
        '<button class="btn primary big" data-act="favstart">▶ Iniciar votación de todos</button></div>';
    } else if (open) {
      body = '<div class="panel fav-ctl"><h3>' + title + ' · <span class="badge-on">EN CURSO</span></h3><div class="clock-card' + (round > 1 ? ' runoff' : '') + '" id="admClockCard"><div class="clock-label">Tiempo restante</div><div class="clock" id="admClock">' + fmtClock(f.endsAt - serverNow()) + '</div></div>' +
        '<div class="vote-meter"><div class="progress"><i style="width:' + pct + '%"></i></div><b>' + p.voted + ' / ' + p.total + '</b> han votado</div>' +
        '<div class="toolbar"><button class="btn ghost" data-act="favext1">+1 minuto</button><button class="btn ghost" data-act="favext2">+2 minutos</button><button class="btn danger" data-act="favclose">⏹ Cerrar ya</button></div></div>';
    } else {
      var tied = st.res.fav.tied, names = tied.map(function (id) { return st.res.fav.final.filter(function (x) { return x.id === id; })[0].name; });
      body = '<div class="panel fav-ctl"><h3>' + title + ' · <span class="badge-off">CERRADA</span></h3><p>Votaron <b>' + p.voted + ' de ' + p.total + '</b> personas en esta ronda.</p>';
      if (tied.length > 1) body += '<div class="warn-box">⚖️ <b>Empate en el primer lugar</b> entre: <b>' + names.map(U.esc).join(', ') + '</b>.<br>Puedes abrir un desempate: votarán de nuevo, pero solo entre esos nombres.</div>' +
        '<label class="lbl" style="color:#fff" for="rmins">Tiempo del desempate (minutos)</label><div class="mins-row"><button class="btn ghost small" data-act="rdec">−</button><input class="field mins" id="rmins" type="number" min="1" max="15" value="' + runoffMin + '"><button class="btn ghost small" data-act="rinc">+</button></div><button class="btn primary big" data-act="runoff">⚔️ Iniciar desempate</button>';
      else body += '<div class="warn-box" style="border-color:var(--ok)">✅ <b>Sin empate.</b> Ya puedes ir a <b>Resultados</b> para revelar al ganador.</div><button class="btn primary" data-tab="resultados">🏆 Ir a Resultados</button>';
      body += '</div>';
    }
    shell(body); startTimers();
  }
  function stopTimers() { if (clockTimer) clearInterval(clockTimer); if (pollTimer) clearInterval(pollTimer); clockTimer = pollTimer = null; }
  var lastSig = '';
  function favSig() { var f = fav(), p = st.prog || {}; return [st.sede, f.status, f.endsAt, f.rounds.length, p.voted, favOpen()].join('|'); }
  function startTimers() {
    stopTimers(); if (!st.me) return;
    if (st.tab !== 'favorito') {
      /* otras pestañas: se redibuja sola cuando cambian los datos (sin molestar si estás escribiendo o hay una ventana abierta) */
      var sig = function () { return JSON.stringify([st.sede, st.stats, st.prog, st.res, st.sd && st.sd.people, st.sd && st.sd.state && [st.sd.state.juryOpen, st.sd.state.fav]]); };
      var last = sig(), tab0 = st.tab;
      pollTimer = setInterval(function () {
        if (st.tab !== tab0) return;
        refresh().then(function () {
          if (!active()) return render();
          var n = sig(); if (n === last) return; last = n;
          var a = document.activeElement, mr = document.getElementById('modal-root');
          if ((a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) || (mr && mr.children.length)) { last = ''; return; }
          render();
        }).catch(function () { });
      }, 2500);
      return;
    }
    lastSig = favSig();
    clockTimer = setInterval(function () {
      var el = document.getElementById('admClock'); if (!el) return; var left = fav().endsAt - serverNow(); el.textContent = fmtClock(left);
      var c = document.getElementById('admClockCard'); if (c) c.classList.toggle('urgent', left <= 30000);
      if (left <= 0) { stopTimers(); refresh().then(function () { if (st.tab === 'favorito') render(); }); }
    }, 250);
    pollTimer = setInterval(function () {
      if (st.tab !== 'favorito') return;
      refresh().then(function () { if (!active()) return render(); if (favSig() !== lastSig && st.tab === 'favorito') { var a = document.activeElement; if (!(a && a.tagName === 'INPUT')) render(); } }).catch(function () { });
    }, 2000);
  }

  /* ---------- Resultados ---------- */
  function resultTabs() { var t = C.categories.map(function (c) { return { id: c.id, icon: c.icon, name: c.name, prize: c.prize }; }); t.push({ id: FAV.id, icon: FAV.icon, name: FAV.name, prize: FAV.prize }); return t; }
  function viewResultados() {
    var tabs = resultTabs(); if (!st.resTab) st.resTab = tabs[0].id;
    var inner = '<div class="toolbar"><button class="btn primary" data-act="ceremony">🎬 Iniciar ceremonia · ' + U.esc(st.sd.name) + '</button><button class="btn ghost" data-act="private">' + (st.showPrivate ? '🙈 Ocultar vista privada' : '👁 Ver vista privada') + '</button><button class="btn ghost" data-act="csv">⬇ Exportar CSV</button></div>';
    if (!st.showPrivate) inner += '<div class="status-card"><div class="ghost-float">' + Decor.ghost + '</div><div><h3>Resultados sellados 🔒</h3><p>Nada se muestra hasta que lo pidas. Puedes proyectar esta pantalla sin riesgo de spoilers.</p></div></div>';
    else {
      inner += '<nav class="tabs">' + tabs.map(function (t) { return '<button class="tab' + (st.resTab === t.id ? ' on' : '') + '" data-rtab="' + t.id + '">' + t.icon + ' ' + U.esc(t.name) + '</button>'; }).join('') + '</nav>';
      inner += st.resTab === FAV.id ? favTable() : catTable(st.resTab);
    }
    shell(inner);
  }
  function catTable(id) {
    var rk = st.res.cats[id], J = st.res.jurors;
    if (!rk.length) return '<div class="warn-box">Aún no hay participantes en esta categoría.</div>';
    return '<div class="warn-box">👀 Vista privada · ' + U.esc(st.sd.name) + '. Puntaje = promedio de los jurados que calificaron (' + st.res.jurorsVoted + ' de ' + st.res.jurorsTotal + '). Desempate: más notas ' + MAX + '.</div>' +
      '<div class="panel tbl-wrap"><table class="tbl rank-tbl"><thead><tr><th>#</th><th>Participante</th>' + J.map(function (j) { return '<th>' + U.esc(j.name.split(' ')[0]) + '</th>'; }).join('') + '<th>Promedio</th><th>Notas ' + MAX + '</th></tr></thead><tbody>' +
      rk.map(function (x) { return '<tr><td class="pos">' + x.rank + '</td><td>' + U.esc(x.name) + (x.tie ? ' <span class="tie">EMPATE</span>' : '') + '</td>' + J.map(function (j) { var n = x.byJuror[j.id]; return '<td>' + (n == null ? '<span style="opacity:.4">—</span>' : n) + '</td>'; }).join('') + '<td><b>' + (x.count ? U.fmt(x.avg, 2) : '—') + '</b></td><td>' + x.tens + '</td></tr>'; }).join('') + '</tbody></table></div>' + notesPanel(rk);
  }
  function notesPanel(rk) {
    var any = rk.filter(function (x) { return x.notes && x.notes.length; });
    if (!any.length) return '<div class="warn-box">Ningún jurado dejó comentarios en esta categoría.</div>';
    return '<div class="panel" style="margin-top:14px"><h3 style="margin-bottom:6px">💬 Comentarios de los jurados</h3><p style="margin:0 0 10px;opacity:.85;font-size:.9rem">En la ceremonia solo se muestran los del ganador. Oculta cualquiera que no quieras proyectar.</p>' +
      any.map(function (x) { return '<div class="cm-group"><b>' + U.esc(x.name) + '</b>' + x.notes.map(function (n) { return '<div class="cm-row' + (n.hidden ? ' off' : '') + '"><span class="cm-txt">“' + U.esc(n.text) + '” <small>· ' + U.esc(n.juror.split(' ')[0]) + ' (' + n.score + ')</small></span><button class="btn ghost small" data-act="hidecm" data-key="' + U.esc(n.key) + '" data-hide="' + (n.hidden ? '0' : '1') + '">' + (n.hidden ? 'Mostrar' : 'Ocultar') + '</button></div>'; }).join('') + '</div>'; }).join('') + '</div>';
  }
  function favTable() {
    var fv = st.res.fav, R = fv.rounds;
    if (!R.length) return '<div class="warn-box">La votación de todos aún no ha comenzado.</div>';
    return '<div class="warn-box">👀 Vista privada · ' + U.esc(st.sd.name) + '. Gana quien tenga <b>más votos</b>. Votos en la ronda ' + R.length + ': ' + fv.totalVotes + '.' + (fv.status === 'open' ? ' <b>La votación sigue abierta: cifras parciales.</b>' : '') + '</div>' +
      '<div class="panel tbl-wrap"><table class="tbl rank-tbl"><thead><tr><th>#</th><th>Participante</th>' + R.map(function (r) { return '<th>Ronda ' + r.round + '</th>'; }).join('') + '</tr></thead><tbody>' +
      fv.final.map(function (x) { return '<tr><td class="pos">' + x.rank + '</td><td>' + U.esc(x.name) + (x.tie ? ' <span class="tie">EMPATE</span>' : '') + '</td>' + R.map(function (r) { var n = x.byRound[r.round]; return '<td>' + (n == null ? '<span style="opacity:.4">—</span>' : '<b>' + n + '</b>') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function resultsCsvRows() {
    var J = st.res.jurors, rows = [['Sede', 'Categoria', 'Posicion', 'Participante'].concat(J.map(function (j) { return 'Nota ' + j.name; })).concat(['Promedio', 'Notas ' + MAX, 'Comentarios'])];
    C.categories.forEach(function (c) { st.res.cats[c.id].forEach(function (x) { rows.push([st.sd.name, c.name, x.rank, x.name].concat(J.map(function (j) { return x.byJuror[j.id] == null ? '' : x.byJuror[j.id]; })).concat([x.count ? U.fmt(x.avg, 2) : '', x.tens, (x.notes || []).map(function (n) { return n.juror.split(' ')[0] + ': ' + n.text + (n.hidden ? ' [oculto]' : ''); }).join(' | ')])); }); });
    rows.push([]); rows.push(['Sede', 'Categoria', 'Posicion', 'Participante'].concat(st.res.fav.rounds.map(function (r) { return 'Votos ronda ' + r.round; })));
    st.res.fav.final.forEach(function (x) { rows.push([st.sd.name, FAV.name, x.rank, x.name].concat(st.res.fav.rounds.map(function (r) { return x.byRound[r.round] == null ? '' : x.byRound[r.round]; }))); });
    return rows;
  }
  function exportCsv(prefix) { U.download((prefix || 'resultados') + '_' + st.sede + '.csv', csvOf(resultsCsvRows())); }

  /* ---------- Sistema (solo administrador) ---------- */
  function viewSistema() {
    var lock = st.sd.locked;
    shell('<div class="adm-grid"><div class="panel phase"><div class="info"><h3>🔒 Candado del evento · ' + U.esc(st.sd.name) + ' · <span class="' + (lock ? 'badge-on' : 'badge-off') + '">' + (lock ? 'ACTIVADO' : 'DESACTIVADO') + '</span></h3><p>Actívalo el día del concurso: nadie podrá agregar, editar ni eliminar personas o equipos, ni reiniciar votos. Solo tú puedes desactivarlo.</p></div><label class="switch"><input type="checkbox" data-lock="1"' + (lock ? ' checked' : '') + '><span class="sl"></span></label></div></div>' +
      '<div class="panel" style="margin-bottom:16px"><h3 style="margin-bottom:6px">♻️ Reiniciar · ' + U.esc(st.sd.name) + '</h3><p style="margin:0 0 12px;opacity:.85;font-size:.9rem"><b>Reiniciar votos:</b> borra todos los votos, notas, reloj y rondas. Las personas y sus códigos se conservan.<br><b>Reiniciar todo:</b> además libera los dispositivos y los ingresos (úsalo justo antes del evento real). Antes de borrar se descarga un respaldo en CSV.</p>' +
      '<button class="btn danger small" data-act="resetvotes"' + (lock ? ' disabled' : '') + '>Reiniciar votos</button> <button class="btn danger small" data-act="resetall"' + (lock ? ' disabled' : '') + '>Reiniciar todo</button></div>' +
      '<div class="panel" style="margin-bottom:16px"><h3 style="margin-bottom:6px">🧪 Pruebas · ' + U.esc(st.sd.name) + '</h3><p style="margin:0 0 12px;opacity:.85;font-size:.9rem">Crea usuarios de prueba (4 votantes y 1 jurado) para ensayar con tu celular sin usar los códigos de tus compañeros. <b>Elimínalos antes del evento.</b></p>' +
      '<button class="btn purple small" data-act="addtest"' + (lock ? ' disabled' : '') + '>Crear usuarios de prueba</button> <button class="btn ghost small" data-act="deltest"' + (lock ? ' disabled' : '') + '>Eliminar usuarios de prueba</button> ' +
      (DB.mode === 'demo' ? '<button class="btn purple small" data-act="seed"' + (lock ? ' disabled' : '') + '>Cargar votos de prueba</button> <button class="btn purple small" data-act="seedtie"' + (lock ? ' disabled' : '') + '>Cargar prueba CON empate</button>' : '') + '</div>' +
      (DB.importSeed ? '<div class="panel" style="margin-bottom:16px"><h3 style="margin-bottom:6px">📥 Carga inicial desde seed.js</h3><p style="margin:0 0 10px;opacity:.85;font-size:.9rem">Elige tu archivo <code>seed.js</code> (el privado). Crea los organizadores, las personas y los equipos que falten, con <b>códigos nuevos</b>, y descarga la lista de códigos. Se omiten las sedes que ya tienen personas.</p><input type="file" id="seedFile" accept=".js,.json,.txt" class="field" style="max-width:360px"> <button class="btn purple small" data-act="importseed"' + (lock ? ' disabled' : '') + '>Importar</button><div id="impMsg" style="margin-top:8px;font-size:.9rem"></div></div>' : '') +
      '<div class="panel tbl-wrap"><h3 style="margin-bottom:8px">🛡️ Organizadores</h3><table class="tbl"><thead><tr><th>Nombre</th><th>Rol</th><th></th></tr></thead><tbody>' +
      st.staff.map(function (x) { return '<tr><td>' + U.esc(x.name) + '</td><td>' + roleLabel(x.role) + '</td><td><button class="btn ghost small" data-act="regenstaff" data-id="' + x.id + '">Generar código nuevo</button></td></tr>'; }).join('') + '</tbody></table></div>');
  }

  function render() {
    renderTop();
    if (!st.me) { stopTimers(); return renderLogin(); }
    if (!active()) return viewStandby();
    var t = st.tab; if (t === 'sistema' && !isAdmin()) t = st.tab = 'panel';
    if (t === 'panel') viewPanel(); else if (t === 'personas') viewPersonas(); else if (t === 'equipos') viewEquipos();
    else if (t === 'favorito') viewFavorito(); else if (t === 'resultados') viewResultados(); else viewSistema();
    if (t === 'sistema') stopTimers(); else if (t !== 'favorito') startTimers();
  }

  /* ---------- Eventos ---------- */
  function done(msg) { return function () { return refresh().then(function () { if (msg) { FX.sfx.vote(); U.toast(msg, 'ok'); } render(); }); }; }
  function fail(er) { FX.sfx.error(); U.toast(er.message, 'error'); refresh().then(render).catch(function () { }); }
  function readMins(id, fb) { var el = document.getElementById(id), n = el ? parseInt(el.value, 10) : fb; return isFinite(n) ? n : fb; }
  function personById(id) { return st.sd.people.filter(function (p) { return p.id === id; })[0]; }
  function typeWord(title, text) {
    return dialog({ emoji: '⚠️', title: title, ok: 'Reiniciar', body: '<p>' + text + '</p><label class="lbl">Escribe <b>REINICIAR</b> para confirmar</label><input class="field code-input" id="word" autocomplete="off">', read: function (w) { var v = w.querySelector('#word').value.trim().toUpperCase(); if (v !== 'REINICIAR') throw new Error('Escribe REINICIAR para confirmar.'); return v; } });
  }

  view.addEventListener('change', function (e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute('data-phase')) {
      var on = t.checked;
      return U.confirmModal({ emoji: on ? '🔓' : '🔒', title: on ? '¿Abrir la calificación del jurado?' : '¿Cerrar la calificación del jurado?', html: 'Sede <b>' + U.esc(st.sd.name) + '</b>. ' + (on ? 'Los jurados conectados verán el cambio en segundos.' : 'Nadie podrá calificar hasta que lo vuelvas a abrir.'), ok: on ? 'Abrir' : 'Cerrar' })
        .then(function (ok) { if (!ok) { t.checked = !on; return; } DB.setJuryOpen(st.sede, on).then(done('Listo')).catch(fail); });
    }
    if (t.getAttribute && t.getAttribute('data-lock')) {
      var l = t.checked;
      return U.confirmModal({ emoji: l ? '🔒' : '🔓', title: l ? '¿Activar el candado del evento?' : '¿Desactivar el candado?', html: l ? 'Nadie podrá editar personas, equipos ni reiniciar votos en <b>' + U.esc(st.sd.name) + '</b>.' : 'Se podrá volver a editar y reiniciar en <b>' + U.esc(st.sd.name) + '</b>.', ok: l ? 'Activar' : 'Desactivar' })
        .then(function (ok) { if (!ok) { t.checked = !l; return; } DB.lock(st.sede, l).then(done('Listo')).catch(fail); });
    }
  });

  view.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab],[data-rtab],[data-act],[data-sedechip]'); if (!t || t.disabled) return;
    if (t.hasAttribute('data-sedechip')) { st.sede = t.getAttribute('data-sedechip'); st.resTab = null; FX.sfx.pick(); return refresh().then(render); }
    if (t.hasAttribute('data-tab')) { st.tab = t.getAttribute('data-tab'); st.showPrivate = false; return refresh().then(render); }
    if (t.hasAttribute('data-rtab')) { st.resTab = t.getAttribute('data-rtab'); FX.sfx.pick(); return render(); }
    var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    var step = { dec: ['mins', -1], inc: ['mins', 1], rdec: ['rmins', -1], rinc: ['rmins', 1], adec: ['allmins', -1], ainc: ['allmins', 1] }[act];
    if (step) { var el = document.getElementById(step[0]); el.value = Math.min(15, Math.max(1, (parseInt(el.value, 10) || 1) + step[1])); var v = +el.value; if (step[0] === 'mins') favMin = v; else if (step[0] === 'rmins') runoffMin = v; else allMin = v; return; }

    if (act === 'passctl') { var to = document.getElementById('ctlTo').value; return U.confirmModal({ emoji: '🕯️', title: '¿Pasar el control?', html: 'A partir de ahora lo manejará la persona elegida y los demás organizadores quedarán en espera.', ok: 'Pasar el control' }).then(function (ok) { if (ok) DB.passControl(to).then(done('Control entregado')).catch(fail); }); }
    if (act === 'favall') { allMin = readMins('allmins', 4); return U.confirmModal({ emoji: '🚀', title: '¿Iniciar las 3 sedes a la vez?', html: 'Se abre la votación de todos en las sedes listas, con un reloj de <b>' + allMin + ' min</b>.', ok: '¡Iniciar!' }).then(function (ok) { if (ok) DB.favStartAll(allMin).then(function (n) { FX.sfx.drum(6); FX.confetti({ count: 50 }); return refresh().then(function () { U.toast('Iniciado en: ' + n.join(', '), 'ok'); render(); }); }).catch(fail); }); }

    if (act === 'addpeople') { var names = document.getElementById('addNames').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean), role = document.getElementById('addRole').value;
      if (!names.length) return U.toast('Escribe al menos un nombre.', 'error');
      return DB.addPeople(st.sede, names.map(function (n) { return { name: n, role: role }; })).then(function (out) { if (out.warn) U.toast(out.warn, 'error'); return refresh().then(function () { render(); return showCodes('Códigos nuevos · ' + st.sd.name, out, 'codigos_nuevos_' + st.sede + '.csv'); }); }).catch(fail); }
    if (act === 'editperson') { var p = personById(id);
      return dialog({ emoji: '✏️', title: 'Editar persona', ok: 'Guardar', body: '<label class="lbl">Nombre</label><input class="field" id="eN" value="' + U.esc(p.name) + '" maxlength="60"><label class="lbl">Rol</label><select class="field" id="eR"><option value="voter"' + (p.role === 'voter' ? ' selected' : '') + '>Votante</option><option value="jury"' + (p.role === 'jury' ? ' selected' : '') + '>Jurado</option></select><label class="lbl">Nota interna <small>(opcional)</small></label><input class="field" id="eT" value="' + U.esc(p.note) + '" maxlength="120">',
        read: function (w) { return { name: w.querySelector('#eN').value, role: w.querySelector('#eR').value, note: w.querySelector('#eT').value }; } })
        .then(function (v) { if (v) DB.updatePerson(st.sede, id, v).then(done('Guardado')).catch(fail); }); }
    if (act === 'delperson') { var q = personById(id), has = q.favVoted || q.juryVotes > 0 || (q.team && true);
      return U.confirmModal({ emoji: '🗑️', title: '¿Eliminar a ' + q.name + '?', html: has ? 'Se eliminará su acceso y <b>también sus votos y su lugar en un equipo</b>. No se puede deshacer.' : 'Se eliminará su acceso. No se puede deshacer.', ok: 'Eliminar' }).then(function (ok) { if (ok) DB.deletePerson(st.sede, id).then(done('Persona eliminada')).catch(fail); }); }
    if (act === 'regen') { var r = personById(id);
      return U.confirmModal({ emoji: '🔑', title: 'Código nuevo para ' + r.name, html: 'El código anterior dejará de funcionar y el dispositivo queda libre.', ok: 'Generar' }).then(function (ok) { if (ok) DB.regenCode(st.sede, id).then(function (code) { return refresh().then(function () { render(); return showCodes('Código nuevo', [{ name: r.name, role: r.role, code: code }], 'codigo_' + st.sede + '.csv'); }); }).catch(fail); }); }
    if (act === 'resetdev') return DB.resetDevice(st.sede, id).then(done('Dispositivo liberado')).catch(fail);

    if (act === 'addteam') return teamDialog(null).then(function (v) { if (v) DB.saveTeam(st.sede, v).then(done('Equipo creado')).catch(fail); });
    if (act === 'editteam') return teamDialog(st.sd.teams.filter(function (x) { return x.id === id; })[0]).then(function (v) { if (v) DB.saveTeam(st.sede, v).then(done('Guardado')).catch(fail); });
    if (act === 'delteam') { var tm = st.sd.teams.filter(function (x) { return x.id === id; })[0];
      return U.confirmModal({ emoji: '🗑️', title: '¿Eliminar a ' + tm.name + '?', html: 'Se quitará de las categorías y se borrarán las notas y votos que recibió. Las personas siguen existiendo como votantes.', ok: 'Eliminar' }).then(function (ok) { if (ok) DB.deleteTeam(st.sede, id).then(done('Equipo eliminado')).catch(fail); }); }

    if (act === 'favstart') { favMin = readMins('mins', 4); return U.confirmModal({ emoji: '🚀', title: '¿Iniciar la votación de todos?', html: 'Sede <b>' + U.esc(st.sd.name) + '</b>. Se abre para <b>todos a la vez</b> y el reloj correrá <b>' + favMin + ' min</b>.', ok: '¡Iniciar!', cancel: 'Todavía no' }).then(function (ok) { if (ok) DB.favStart(st.sede, favMin).then(function () { FX.sfx.drum(6); FX.confetti({ count: 40 }); return done()(); }).catch(fail); }); }
    if (act === 'favext1' || act === 'favext2') return DB.favExtend(st.sede, act === 'favext1' ? 1 : 2).then(done('Tiempo agregado')).catch(fail);
    if (act === 'favclose') return U.confirmModal({ emoji: '⏹', title: '¿Cerrar la votación ahora?', text: 'Nadie más podrá votar.', ok: 'Cerrar ya', cancel: 'Seguir' }).then(function (ok) { if (ok) DB.favClose(st.sede).then(function () { FX.sfx.boo(); return done()(); }).catch(fail); });
    if (act === 'runoff') { runoffMin = readMins('rmins', 1); return U.confirmModal({ emoji: '⚔️', title: '¿Iniciar el desempate?', html: 'Solo votarán entre los empatados, durante <b>' + runoffMin + ' min</b>.', ok: 'Iniciar desempate', cancel: 'Todavía no' }).then(function (ok) { if (ok) DB.favStartRunoff(st.sede, runoffMin).then(function () { FX.sfx.drum(6); return done()(); }).catch(fail); }); }

    if (act === 'private') { st.showPrivate = !st.showPrivate; return refresh().then(render); }
    if (act === 'hidecm') return DB.hideComment(st.sede, t.getAttribute('data-key'), t.getAttribute('data-hide') === '1').then(done()).catch(fail);
    if (act === 'csv') return exportCsv();
    if (act === 'ceremony') return refresh().then(startCeremony);

    if (act === 'resetvotes' || act === 'resetall') { var all = act === 'resetall';
      return typeWord(all ? 'Reiniciar TODO · ' + st.sd.name : 'Reiniciar votos · ' + st.sd.name, all ? 'Se borran los votos, el reloj y las rondas, y se liberan todos los dispositivos. Se descargará un respaldo antes.' : 'Se borran todos los votos, notas, el reloj y las rondas de esta sede. Se descargará un respaldo antes.').then(function (w) {
        if (!w) return; exportCsv('respaldo_antes_de_reiniciar'); (all ? DB.resetAll : DB.resetVotes)(st.sede, w).then(done('Sede reiniciada')).catch(fail); }); }
    if (act === 'importseed') {
      var fi = document.getElementById('seedFile'), msg = document.getElementById('impMsg');
      if (!fi || !fi.files.length) return U.toast('Elige primero el archivo seed.js', 'error');
      var rd = new FileReader();
      rd.onload = function () {
        var seed; try { var txt = String(rd.result); seed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch (er) { return U.toast('No se pudo leer el archivo. ¿Es el seed.js?', 'error'); }
        U.confirmModal({ emoji: '📥', title: '¿Importar datos?', html: 'Se crearán cuentas con <b>códigos nuevos</b>. Los códigos viejos del CSV dejarán de servir.', ok: 'Importar', cancel: 'Cancelar' }).then(function (ok) {
          if (!ok) return;
          DB.importSeed(seed, function (t) { if (msg) msg.textContent = t; }).then(function (res) {
            var rows = [['Sede', 'Nombre', 'Rol', 'Código']].concat(res.map(function (r) { return [r.kind === 'staff' ? 'Organizador' : sedeLabel(r.sede), r.name, r.kind === 'staff' ? roleLabel(r.role) : (r.role === 'jury' ? 'Jurado' : 'Votante'), r.code]; }));
            if (res.length) U.download('codigos_importados.csv', csvOf(rows));
            if (res.warn) U.toast(res.warn, 'error'); else U.toast('Importación lista: ' + res.length + ' cuentas. Se descargó el CSV de códigos.', 'ok');
            return refresh().then(render);
          }).catch(fail);
        });
      };
      rd.readAsText(fi.files[0]); return;
    }
    if (act === 'addtest') return DB.addTestUsers(st.sede).then(function (out) { return refresh().then(function () { render(); return showCodes('Usuarios de prueba · ' + st.sd.name, out, 'codigos_prueba_' + st.sede + '.csv'); }); }).catch(fail);
    if (act === 'deltest') return U.confirmModal({ emoji: '🧹', title: '¿Eliminar usuarios de prueba?', text: 'También se borran sus votos.', ok: 'Eliminar' }).then(function (ok) { if (ok) DB.deleteTestUsers(st.sede).then(done('Usuarios de prueba eliminados')).catch(fail); });
    if (act === 'seed' || act === 'seedtie') return U.confirmModal({ emoji: '🧪', title: '¿Cargar votos de prueba?', text: act === 'seedtie' ? 'Reemplaza los votos por unos de prueba, con EMPATE en el voto de todos.' : 'Reemplaza los votos por unos aleatorios de prueba.', ok: 'Cargar' }).then(function (ok) { if (ok) DB.seedDemo(st.sede, act === 'seedtie').then(done('Votos de prueba cargados')).catch(fail); });
    if (act === 'regenstaff') { var sf = st.staff.filter(function (x) { return x.id === id; })[0];
      return U.confirmModal({ emoji: '🔑', title: 'Código nuevo para ' + sf.name, html: 'El código anterior dejará de funcionar.', ok: 'Generar' }).then(function (ok) { if (ok) DB.regenStaffCode(id).then(function (code) { return showCodes('Código de organizador', [{ name: sf.name, role: roleLabel(sf.role), code: code }], 'codigo_organizador.csv'); }).catch(fail); }); }
  });

  /* ---------- Ceremonia: el ganador en grande ---------- */
  function startCeremony() {
    var order = ['interpretacion', 'grupal', 'creativo', 'anio', FAV.id], tabs = resultTabs();
    var seq = order.map(function (id) { return tabs.filter(function (t) { return t.id === id; })[0]; }).filter(Boolean);
    tabs.forEach(function (t) { if (seq.indexOf(t) < 0) seq.push(t); });
    var i = 0, el = document.createElement('div'); el.className = 'stage'; document.body.appendChild(el); var timers = [];
    function clearT() { timers.forEach(clearTimeout); timers = []; }
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function close() { clearT(); el.remove(); }
    function scene() {
      var t = seq[i]; clearT();
      el.innerHTML = '<button class="icon-btn close" data-c="x" title="Cerrar">✕</button><div class="logo-pill"><img src="img/logo.png" alt="Grupo Lucky"></div><div class="stage-sede">Sede ' + U.esc(st.sd.name) + '</div>' +
        '<h2>' + t.icon + ' ' + U.esc(t.name) + '</h2><div class="prize">Premio ' + U.esc(t.prize) + '</div>' +
        '<div class="center" id="cc"><button class="btn primary" style="font-size:1.4rem;padding:18px 38px" data-c="reveal">🥁 Revelar ganador</button><div class="steps">Categoría ' + (i + 1) + ' de ' + seq.length + '</div></div>';
    }
    function entries(t) {
      if (t.id === FAV.id) { var fv = st.res.fav; return { ready: fv.status === 'closed', list: fv.final.filter(function (x) { return x.votes > 0; }), text: function (x) { return x.votes + (x.votes === 1 ? ' voto' : ' votos'); }, note: fv.round > 1 && fv.tied.length < 2 ? 'Ganó en la ronda de desempate' : '', pending: fv.tied.length > 1 }; }
      return { ready: true, notes: function (x) { return (x.notes || []).filter(function (n) { return !n.hidden; }); }, list: st.res.cats[t.id].filter(function (x) { return x.count > 0; }), text: function (x) { return U.fmt(x.avg, 2) + ' de promedio · ' + x.count + (x.count === 1 ? ' jurado' : ' jurados'); }, note: '', pending: false };
    }
    function reveal() {
      var t = seq[i], cc = document.getElementById('cc'), en = entries(t);
      if (!en.ready) { cc.innerHTML = '<h3 style="font-size:1.6rem;text-align:center">⏳ La votación de todos aún no termina.<br><small style="opacity:.8">Ciérrala en la pestaña Voto de todos.</small></h3>' + nav(); return; }
      cc.innerHTML = '<div class="bignum" id="bn">3</div>'; FX.sfx.drum(14);
      function tick(n) { var b = document.getElementById('bn'); if (b) { b.textContent = n; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; } }
      later(function () { tick('2'); }, 1000); later(function () { tick('1'); }, 2000); later(function () { winner(en); }, 3000);
    }
    function jnotes(en, firsts, tie) {
      if (!en.notes || tie) return '';
      var ns = en.notes(firsts[0]); if (!ns.length) return '';
      return '<div class="jnotes" id="jn">' + ns.map(function (n) { return '<div class="jnote"><span class="q">“' + U.esc(n.text) + '”</span><span class="by">' + U.esc(n.juror.split(' ')[0]) + ' · ' + n.score + '</span></div>'; }).join('') + '</div>';
    }
    function winner(en) {
      var cc = document.getElementById('cc'); if (!cc) return;
      if (!en.list.length) { cc.innerHTML = '<h3 style="font-size:1.6rem">Aún no hay votos en esta categoría 👻</h3>' + nav(); return; }
      var firsts = en.list.filter(function (x) { return x.rank === 1; }), tie = firsts.length > 1;
      cc.innerHTML = '<div class="winner"><div class="w-ribbon">' + (tie ? '⚖️ ¡EMPATE!' : '🏆 ¡GANADOR!') + '</div><div class="w-name' + (tie ? ' multi' : '') + '">' + firsts.map(function (x) { return '<div>' + U.esc(x.name) + '</div>'; }).join('') + '</div>' +
        '<div class="w-score">' + U.esc(en.text(firsts[0])) + '</div>' + (en.note ? '<div class="w-note">' + en.note + '</div>' : '') + (en.pending ? '<div class="w-note">Hay empate: abre el desempate en la pestaña Voto de todos.</div>' : '') + jnotes(en, firsts, tie) + '</div><div id="nv" style="visibility:hidden">' + nav() + '</div>';
      FX.sfx.win(); FX.confetti({ x: .5, y: .3, count: 90 });
      later(function () { FX.confetti({ x: .2, y: .5, count: 45 }); FX.confetti({ x: .8, y: .5, count: 45 }); }, 700);
      later(function () { var jn = document.getElementById('jn'); if (jn) jn.classList.add('show'); }, 1400);
      later(function () { var n = document.getElementById('nv'); if (n) n.style.visibility = 'visible'; }, 1800);
    }
    function nav() { return '<div class="actions">' + (i < seq.length - 1 ? '<button class="btn primary" data-c="next">Siguiente categoría ▶</button>' : '<button class="btn primary" data-c="end">🎉 Finalizar</button>') + '<button class="btn ghost" data-c="x">Cerrar</button></div>'; }
    el.addEventListener('click', function (e) { var c = e.target.closest('[data-c]'); if (!c) return; var a = c.getAttribute('data-c'); if (a === 'x' || a === 'end') close(); else if (a === 'reveal') reveal(); else if (a === 'next') { i++; scene(); } });
    scene();
  }

  document.addEventListener('keydown', function (e) {
    if ((e.key === 'h' || e.key === 'H' || e.key === 'Escape') && st.showPrivate && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) { st.showPrivate = false; render(); }
  });

  if (DB.staffRestore) {
    view.innerHTML = '<p style="text-align:center;margin-top:60px;opacity:.8">Conectando…</p>';
    DB.staffRestore().then(function (ok) { return ok ? refresh().then(render) : render(); }).catch(function () { st.me = null; render(); });
  } else if (DB.hasData() && localStorage.getItem('lucky.v3.staff')) refresh().then(render).catch(function () { st.me = null; render(); }); else render();
})();
