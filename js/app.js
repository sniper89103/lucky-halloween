/* Pantallas de votantes y jurados · ingreso solo con código */
(function () {
  'use strict';
  var C = window.CONFIG, MIN = C.scale.min, MAX = C.scale.max, FAV = C.publicCategory;
  var view = document.getElementById('view'), topEl = document.getElementById('topbar');
  var st = { user: null, sede: null, data: { teams: [], candidates: [], names: {} }, state: { juryOpen: false, fav: { status: 'idle', endsAt: null, rounds: [] } }, skew: 0, votes: { fav: {}, jury: {}, comments: {} }, cm: {}, tab: null, sel: {}, busy: false };
  var clockTimer = null, lastSig = '', lastSec = -1;

  Decor.mount();
  if (DB.mode !== 'demo') document.getElementById('demoBanner').style.display = 'none';

  /* ---------- Datos ---------- */
  function nameOf(id) { return st.data.names[id] || ''; }
  function team(id) { return st.data.teams.filter(function (t) { return t.id === id; })[0]; }
  function kindLabel(k) { return k === 'solo' ? 'Solo/a' : k === 'duo' ? 'Dúo' : 'Grupo'; }
  function serverNow() { return Date.now() + st.skew; }
  function setState(s) { st.state = { juryOpen: s.juryOpen, fav: s.fav }; st.skew = s._now - Date.now(); }
  function favInfo() {
    var f = st.state.fav, round = f.rounds.length, open = f.status === 'open' && serverNow() < f.endsAt;
    var list = round ? (f.rounds[round - 1].cands || null) : null;
    var cands = st.data.candidates.filter(function (c) { return !list || list.indexOf(c.id) >= 0; });
    return { idle: f.status === 'idle', open: open, round: round, cands: cands, endsAt: f.endsAt, mine: st.votes.fav[round] || null };
  }
  function tabsFor(user) {
    var t = [];
    if (user.role === 'jury') C.categories.forEach(function (c) { t.push({ id: c.id, icon: c.icon, name: c.name, prize: c.prize, note: c.note, kind: 'jury', cat: c }); });
    t.push({ id: FAV.id, icon: FAV.icon, name: FAV.name, prize: FAV.prize, kind: 'fav' });
    return t;
  }
  function itemsFor(tab) { return st.data.teams.filter(function (t) { return !(tab.cat.eligible === 'groups' && t.kind === 'solo'); }); }
  function myScore(tab, id) { return (st.votes.jury[tab.id] || {})[id]; }
  function myNote(tab, id) { return ((st.votes.comments || {})[tab.id] || {})[id] || ''; }
  function doneCount(tab) { return tab.kind === 'fav' ? (favInfo().mine ? 1 : 0) : itemsFor(tab).filter(function (i) { return myScore(tab, i.id) != null; }).length; }
  function totalCount(tab) { return tab.kind === 'fav' ? 1 : itemsFor(tab).length; }
  function sedeName(id) { return C.sedes.filter(function (s) { return s.id === id; })[0].name; }

  /* ---------- Barra superior ---------- */
  function renderTop() {
    var u = st.user;
    topEl.innerHTML =
      '<div class="logo-pill"><img src="img/logo.png" alt="Grupo Lucky"></div>' +
      '<span class="sede-chip">Sede ' + U.esc(sedeName(st.sede || C.sedes[0].id)) + '</span><span class="spacer"></span>' +
      (u ? '<div class="user-chip"><span class="av">' + U.esc(U.initials(u.name)) + '</span><span class="nm">' + U.esc(u.name) + '</span>' + (u.role === 'jury' ? '<span class="role-tag jury">Jurado</span>' : '') + '</div>' : '') +
      '<button class="icon-btn" id="btnSound" title="Sonido" aria-label="Sonido">' + (FX.isMuted() ? '🔇' : '🔊') + '</button>' +
      (u ? '<button class="btn ghost small" id="btnOut">Salir</button>' : '');
    document.getElementById('btnSound').onclick = function () { FX.setMuted(!FX.isMuted()); renderTop(); if (!FX.isMuted()) FX.sfx.pick(); };
    var o = document.getElementById('btnOut');
    if (o) o.onclick = function () { DB.logout(); stopClock(); st.user = null; st.sel = {}; st.tab = null; st.drawnTab = null; render(); };
  }

  /* ---------- Ingreso: elige sede y escribe su código ---------- */
  function eventLine() {
    var d = new Date(C.eventDate), dia = d.toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/La_Paz' });
    return dia.charAt(0).toUpperCase() + dia.slice(1) + ' · 16:30 · ' + C.eventPlace;
  }
  function initialSede() {
    var q = (new URLSearchParams(location.search).get('sede') || '').replace(/[^a-z]/g, '');
    if (C.sedes.some(function (s) { return s.id === q; })) return q;
    try { var l = localStorage.getItem('lucky.lastSede'); if (C.sedes.some(function (s) { return s.id === l; })) return l; } catch (e) { }
    return C.sedes[0].id;
  }
  function renderLogin() {
    stopClock(); st.sede = st.sede || initialSede();
    view.innerHTML =
      '<section class="hero"><div class="kicker">🎃 Grupo Lucky</div>' +
      '<h1 class="title"><span class="t1">Concurso de</span><span class="t2">Disfraces</span></h1>' +
      '<div class="ribbon">HALLOWEEN</div><div class="tagline">¡La creatividad también se viste de Halloween!</div>' +
      '<div class="event-line">' + U.esc(eventLine()) + '</div></section>' +
      '<form class="parchment login-wrap" id="loginForm" autocomplete="off">' +
      '<h2>Entra a votar</h2><div class="sub">Elige tu sede y escribe tu código personal</div>' +
      '<label class="lbl">Tu sede</label><div class="sede-chips" id="sedeChips">' +
      C.sedes.map(function (s) { return '<button type="button" class="sede-chip-btn' + (s.id === st.sede ? ' on' : '') + '" data-sede="' + s.id + '">' + U.esc(s.name) + '</button>'; }).join('') + '</div>' +
      '<label class="lbl" for="code">Tu código</label>' +
      '<input class="field code-input" id="code" placeholder="NOMBRE-XXXXXX" maxlength="24" autocapitalize="characters" autocomplete="off" spellcheck="false" required>' +
      '<div id="loginMsg"></div>' +
      '<button class="btn primary" style="width:100%;margin-top:18px" type="submit">Entrar 🎃</button>' +
      '<div class="lock-note">🔒 Tu código es personal e intransferible y queda ligado al primer dispositivo con el que ingreses.</div></form>' +
      '<p style="text-align:center;margin-top:18px;opacity:.7;font-size:.85rem"><a href="admin.html">Acceso organizador</a></p>';
    document.getElementById('sedeChips').onclick = function (e) {
      var b = e.target.closest('[data-sede]'); if (!b) return; st.sede = b.getAttribute('data-sede'); FX.sfx.pick();
      try { localStorage.setItem('lucky.lastSede', st.sede); } catch (er) { }
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); }); renderTop();
    };
    var form = document.getElementById('loginForm');
    form.onsubmit = function (e) {
      e.preventDefault();
      var code = document.getElementById('code').value, msg = document.getElementById('loginMsg');
      if (!code.trim()) { msg.innerHTML = '<div class="msg err">Escribe tu código.</div>'; return; }
      DB.login(st.sede, code).then(function (u) { st.user = u; st.tab = null; st.drawnTab = null; return loadAll(); })
        .then(function () { lastSig = sigOf(st.state); render(); requestAnimationFrame(function () { setTimeout(function () { FX.sfx.vote(); FX.confetti({ count: 36 }); }, 60); }); })
        .catch(function (err) { FX.sfx.error(); form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); msg.innerHTML = '<div class="msg err">' + U.esc(err.message) + '</div>'; });
    };
  }

  /* ---------- Tarjetas ---------- */
  function avatarFor(name, foto, glyph) {
    var bg = foto ? 'background-image:url(' + U.esc(foto) + ')' : 'background:hsl(' + U.hueFor(name) + ',45%,42%)';
    return '<div class="avatar" style="' + bg + '">' + (foto ? '' : (glyph || U.esc(U.initials(name)))) + '</div>';
  }
  function jcard(item, tab, idx) {
    var key = tab.id + ':' + item.id, my = myScore(tab, item.id), open = st.state.juryOpen, sel = st.sel[key];
    var chips = '<span class="chip ' + item.kind + '">' + kindLabel(item.kind) + '</span>' + (item.pending ? '<span class="chip warn">Por confirmar</span>' : '');
    var members = item.kind === 'solo' ? '' : '<div class="meta">' + U.esc(item.members.map(function (m) { return nameOf(m).split(' ')[0]; }).join(', ')) + '</div>';
    var body = '';
    if (my != null) {
      body = '<div class="mine"><div class="pump">' + my + '</div><div class="txt">Tu calificación<small>' + (open ? 'Puedes anularla y calificar de nuevo' : 'La calificación está cerrada') + '</small>' + (myNote(tab, item.id) ? '<div class="my-note">“' + U.esc(myNote(tab, item.id)) + '”</div>' : '') + '</div>' +
        (open ? '<button class="btn ghost small" style="color:#5a1a2b;background:#ffd9df" data-act="annul" data-key="' + U.esc(key) + '">Anular</button>' : '') + '</div>';
    } else if (!open) {
      body = '<div class="mine" style="background:rgba(123,101,171,.15);border-color:rgba(123,101,171,.4)"><div class="txt" style="color:#5a4378">⏳ Aún no se abre la calificación<small>Te avisaremos cuando comience</small></div></div>';
    } else {
      var btns = ''; for (var n = MIN; n <= MAX; n++) btns += '<button type="button" class="sbtn' + (sel === n ? ' sel' : '') + '" data-act="pick" data-key="' + U.esc(key) + '" data-n="' + n + '" aria-label="Nota ' + n + '">' + n + '</button>';
      body = '<div class="score-row">' + btns + '</div>';
      if (sel) body += '<label class="cm-wrap"><span class="cm-lbl">Comentario <small>(opcional · se mostrará si gana)</small></span><textarea class="field cm" rows="2" maxlength="140" data-cm="' + U.esc(key) + '" placeholder="¿Por qué esta nota? Ej: Muy creativo, gran personaje">' + U.esc(st.cm[key] || '') + '</textarea><span class="cm-cnt" data-cnt="' + U.esc(key) + '">' + (st.cm[key] || '').length + '/140</span></label>';
      if (sel) body += '<div class="confirm-row"><div class="hint">Nota elegida: <b>' + sel + '</b></div><button class="btn primary small" data-act="submit" data-key="' + U.esc(key) + '">Calificar ✔</button></div>';
    }
    return '<article class="parchment pcard' + (my != null ? ' done' : '') + '" style="animation-delay:' + Math.min(idx * 35, 500) + 'ms">' +
      '<div class="row">' + avatarFor(item.name, null, item.kind === 'duo' ? '👯' : item.kind === 'grupal' ? '👥' : '') + '<div><h3>' + U.esc(item.name) + '</h3><div>' + chips + '</div>' + members +
      (item.disfraz ? '<div class="meta">🎭 ' + U.esc(item.disfraz) + '</div>' : '') + '</div></div>' + body + '</article>';
  }
  function fcard(c, info, idx) {
    var t = team(c.team), chosen = info.mine === c.id, voted = !!info.mine, pickable = info.open && !voted;
    var others = !t || t.kind === 'solo' ? [] : t.members.filter(function (m) { return m !== c.id; }).map(nameOf);
    var meta = others.length ? '<div class="meta">En ' + (t.kind === 'duo' ? 'dúo' : 'grupo') + ' con ' + U.esc(others.join(', ')) + '</div>' : '';
    var cls = 'parchment pcard fav' + (pickable ? ' pickable' : '') + (chosen ? ' chosen' : '') + (voted && !chosen ? ' dim' : '');
    return '<article class="' + cls + '" style="animation-delay:' + Math.min(idx * 30, 500) + 'ms"' + (pickable ? ' data-act="favpick" data-id="' + U.esc(c.id) + '" role="button" tabindex="0"' : '') + '>' +
      '<div class="row">' + avatarFor(c.name) + '<div><h3>' + U.esc(c.name) + '</h3><div><span class="chip ' + c.kind + '">' + kindLabel(c.kind) + '</span>' + (t && t.pending ? '<span class="chip warn">Por confirmar</span>' : '') + '</div>' + meta + (t && t.disfraz ? '<div class="meta">🎭 ' + U.esc(t.disfraz) + '</div>' : '') + '</div></div>' +
      (chosen ? '<div class="mine"><div class="pump">🗳️</div><div class="txt">Tu voto 🔒<small>Ya no se puede cambiar</small></div></div>' : '') +
      (pickable ? '<div class="tap-hint">Toca para votar por esta persona</div>' : '') + '</article>';
  }

  /* ---------- Favorito del público ---------- */
  function fmtClock(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function favSection(tab) {
    var info = favInfo(), mineName = info.mine ? nameOf(info.mine) : '', head = '', runoff = info.round > 1;
    if (info.idle) head = '<div class="status-card"><div class="ghost-float">' + Decor.ghost + '</div><div><h3>La votación de «Mejor disfraz del año» aún no inicia</h3><p>Cuando el organizador pulse <b>Iniciar</b>, todos votamos a la vez con un reloj. Tendrás <b>un solo voto</b>, con confirmación, y no se podrá cambiar.</p></div></div>';
    else if (info.open) head = '<div class="clock-card' + (runoff ? ' runoff' : '') + '">' + (runoff ? '<div class="round-banner">⚔️ ¡DESEMPATE! Solo estos nombres</div>' : '') +
      '<div class="clock-label">' + (info.mine ? 'Gracias por votar · tiempo restante' : '¡Vota ahora! Tiempo restante') + '</div><div class="clock" id="clock">' + fmtClock(info.endsAt - serverNow()) + '</div>' +
      (info.mine ? '<div class="voted-line">✅ Votaste por <b>' + U.esc(mineName) + '</b> · tu voto no se puede cambiar</div>' : '<div class="voted-line">Toca el nombre de tu favorito y confirma con <b>Sí</b>.</div>') + '</div>';
    else head = '<div class="status-card"><div class="ghost-float">' + Decor.ghost + '</div><div><h3>' + (runoff ? 'Desempate cerrado' : 'Votación cerrada') + '</h3><p>' + (info.mine ? 'Votaste por <b>' + U.esc(mineName) + '</b>. ' : 'No registraste voto en esta ronda. ') + 'El ganador se anuncia en la ceremonia. 🎉</p></div></div>';
    return head + '<div class="cat-head"><h2>' + tab.icon + ' ' + U.esc(tab.name) + '</h2><span class="prize">Premio ' + U.esc(tab.prize) + '</span></div>' +
      (info.cands.length ? '<section class="grid">' + info.cands.map(function (c, i) { return fcard(c, info, i); }).join('') + '</section>' : '<div class="empty"><div class="big">👻</div><p>Aún no hay participantes registrados en esta sede.</p></div>');
  }
  function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }
  function startClock() {
    stopClock(); lastSec = -1; if (!favInfo().open) return;
    clockTimer = setInterval(function () {
      var left = favInfo().endsAt - serverNow(), el = document.getElementById('clock');
      if (el) { el.textContent = fmtClock(left); el.parentNode.classList.toggle('urgent', left <= 30000); }
      var sec = Math.ceil(left / 1000);
      if (left > 0 && left <= 5000 && sec !== lastSec) { lastSec = sec; FX.sfx.pick(); }
      if (left <= 0) { stopClock(); FX.sfx.boo(); U.toast('⏰ ¡Se acabó el tiempo!', 'info'); poll(true); renderHome(); }
    }, 250);
  }

  /* ---------- Pantalla principal ---------- */
  function jStatus(tab) {
    var open = st.state.juryOpen, total = itemsFor(tab).length, done = doneCount(tab), h, txt;
    if (!total) { h = 'Aún no hay participantes'; txt = 'El organizador todavía no registró participantes en esta sede.'; }
    else if (!open && done === 0) { h = 'La calificación aún no ha comenzado'; txt = 'El organizador la abrirá cuando empiece el concurso.'; }
    else if (!open) { h = 'Calificación cerrada'; txt = 'Gracias por participar. Los ganadores se revelan en la ceremonia.'; }
    else if (done === total) { h = '¡Completaste esta categoría! 🎉'; txt = 'Ya calificaste a todos. Si quieres, puedes anular una nota y cambiarla.'; }
    else { h = '¡Es hora de calificar!'; txt = 'Califica de ' + MIN + ' a ' + MAX + '. Como jurado puedes anular tu nota y cambiarla mientras esté abierto.'; }
    return '<div class="status-card"><div class="ghost-float">' + Decor.ghost + '</div><div><h3>' + h + '</h3><p>' + txt + '</p></div></div>';
  }
  function renderHome() {
    var u = st.user, tabs = tabsFor(u);
    if (!st.tab || !tabs.some(function (t) { return t.id === st.tab; })) st.tab = tabs[0].id;
    var tab = tabs.filter(function (t) { return t.id === st.tab; })[0], scrollY = window.scrollY, body;
    if (tab.kind === 'fav') body = favSection(tab);
    else {
      var items = itemsFor(tab), done = doneCount(tab), pct = items.length ? Math.round(done / items.length * 100) : 0;
      body = jStatus(tab) + '<div class="cat-head"><h2>' + tab.icon + ' ' + U.esc(tab.name) + '</h2><span class="prize">Premio ' + U.esc(tab.prize) + '</span>' + (tab.note ? '<span class="chip">' + U.esc(tab.note) + '</span>' : '') +
        '<div class="progress"><i style="width:' + pct + '%"></i></div><span class="progress-label">' + done + ' / ' + items.length + '</span></div>' +
        '<section class="grid">' + items.map(function (it, i) { return jcard(it, tab, i); }).join('') + '</section>';
    }
    view.classList.toggle('noanim', st.drawnTab === st.tab); st.drawnTab = st.tab;
    view.innerHTML = '<h2 style="font-family:var(--font-title);font-size:1.7rem;letter-spacing:1px;color:var(--parch);margin-top:6px">¡Hola, ' + U.esc(u.name.split(' ')[0]) + '! 👋</h2>' +
      (tabs.length > 1 ? '<nav class="tabs" role="tablist">' + tabs.map(function (t) { return '<button class="tab' + (t.id === st.tab ? ' on' : '') + '" data-act="tab" data-tab="' + t.id + '"><span>' + t.icon + '</span>' + U.esc(t.name) + '<span class="cnt">' + doneCount(t) + '/' + totalCount(t) + '</span></button>'; }).join('') + '</nav>' : '') + body;
    window.scrollTo(0, scrollY);
    if (tab.kind === 'fav') startClock(); else stopClock();
  }
  function render() { renderTop(); if (!st.user) renderLogin(); else renderHome(); }

  /* ---------- Acciones ---------- */
  function findTab(key) { var id = key.split(':')[0]; return tabsFor(st.user).filter(function (t) { return t.id === id; })[0]; }
  view.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b || !st.user) return;
    var act = b.getAttribute('data-act');
    if (act === 'tab') { st.tab = b.getAttribute('data-tab'); FX.sfx.pick(); renderHome(); window.scrollTo(0, 0); return; }
    if (act === 'favpick') return favPick(b.getAttribute('data-id'));
    var key = b.getAttribute('data-key'), tab = findTab(key); if (!tab) return;
    var item = itemsFor(tab).filter(function (i) { return i.id === key.split(':')[1]; })[0]; if (!item) return;
    if (act === 'pick') { st.sel[key] = parseInt(b.getAttribute('data-n'), 10); FX.sfx.pick(); renderHome(); return; }
    if (act === 'submit') return submit(tab, item, key, b);
    if (act === 'annul') return annul(tab, item);
  });
  view.addEventListener('input', function (e) {
    var t = e.target; if (!t.getAttribute || !t.getAttribute('data-cm')) return;
    var k = t.getAttribute('data-cm'); st.cm[k] = t.value.slice(0, 140);
    var c = view.querySelector('[data-cnt="' + k.replace(/"/g, '') + '"]'); if (c) c.textContent = st.cm[k].length + '/140';
  });
  view.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('data-act') === 'favpick') { e.preventDefault(); e.target.click(); } });

  function afterError(err) {
    FX.sfx.error(); U.toast(err.message || 'No se pudo guardar.', 'error');
    if (err.code === 'auth') { DB.logout(); stopClock(); st.user = null; render(); return; }
    loadAll().then(renderHome).catch(function () { });
  }
  function favPick(candId) {
    var info = favInfo(); if (!info.open || info.mine || st.busy) return;
    var c = st.data.candidates.filter(function (x) { return x.id === candId; })[0]; if (!c) return;
    FX.sfx.pick();
    U.confirmModal({ emoji: '🗳️', title: '¿Votar por ' + c.name + '?', html: 'Tienes <b>un solo voto</b>.<br>Después de confirmar <b>no podrás cambiarlo</b>.', ok: 'Sí, votar', cancel: 'No' }).then(function (ok) {
      if (!ok) return; st.busy = true;
      DB.votePublic(st.user.id, candId).then(function () {
        st.votes.fav[info.round] = candId; FX.sfx.vote(); FX.ghostBoo(); FX.confetti({ x: .5, y: .35, count: 70 });
        U.toast('¡Voto registrado para ' + c.name + '! 🎃', 'ok'); renderHome();
      }).catch(afterError).then(function () { st.busy = false; });
    });
  }
  function submit(tab, item, key, btn) {
    var n = st.sel[key]; if (!n || st.busy) return; st.busy = true; var r = btn.getBoundingClientRect();
    var cmt = (st.cm[key] || '').trim();
    DB.setJury(st.user.id, tab.id, item.id, n, cmt).then(function () {
      (st.votes.jury[tab.id] = st.votes.jury[tab.id] || {})[item.id] = n; st.votes.comments = st.votes.comments || {};
      if (cmt) (st.votes.comments[tab.id] = st.votes.comments[tab.id] || {})[item.id] = cmt.slice(0, 140); delete st.sel[key]; delete st.cm[key]; FX.sfx.vote(); FX.ghostBoo();
      FX.confetti({ x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight, count: n >= 9 ? 50 : 28 });
      U.toast('Nota guardada ✔', 'ok'); renderHome();
      if (doneCount(tab) === itemsFor(tab).length) setTimeout(function () { FX.confetti({ x: .5, y: .3, count: 80 }); FX.sfx.win(); }, 350);
    }).catch(afterError).then(function () { st.busy = false; });
  }
  function annul(tab, item) {
    U.confirmModal({ emoji: '🧹', title: '¿Anular tu nota?', html: 'Se borrará tu calificación para <b>' + U.esc(item.name) + '</b> y podrás poner otra.', ok: 'Anular nota', cancel: 'Mantener' }).then(function (ok) {
      if (!ok) return;
      DB.annulJury(st.user.id, tab.id, item.id).then(function () { delete (st.votes.jury[tab.id] || {})[item.id]; delete ((st.votes.comments || {})[tab.id] || {})[item.id]; FX.sfx.undo(); U.toast('Nota anulada', 'info'); renderHome(); }).catch(afterError);
    });
  }

  /* ---------- Carga y refresco ---------- */
  function loadAll() {
    return DB.getSede().then(function (d) { st.data = d; return DB.getState(); })
      .then(function (s) { setState(s); return DB.getMyVotes(st.user.id); }).then(function (v) { st.votes = v; });
  }
  function sigOf(s) { return JSON.stringify({ j: s.juryOpen, f: s.fav }); }
  function poll(force) {
    if (!st.user || st.busy) return;
    DB.getState().then(function (s) {
      var sig = sigOf(s), prev = st.state.fav; setState(s);
      if (sig === lastSig && !force) return;
      var wasInit = lastSig !== ''; lastSig = sig;
      var nf = s.fav, started = nf.status === 'open' && (prev.status !== 'open' || prev.rounds.length !== nf.rounds.length);
      if (wasInit && started) { FX.sfx.boo(); st.tab = FAV.id; U.toast(nf.rounds.length > 1 ? '⚔️ ¡Desempate! Vota de nuevo entre los empatados' : '🗳️ ¡Comenzó la votación de «Mejor disfraz del año»!', 'info'); }
      else if (wasInit) FX.sfx.pick();
      if (nf.rounds.length !== prev.rounds.length) return loadAll().then(renderHome);
      renderHome();
    }).catch(function (e) { if (e && e.code === 'auth') { DB.logout(); stopClock(); st.user = null; render(); } });
  }
  setInterval(poll, 2000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  /* ---------- Inicio ---------- */
  var restoring = DB.restoreAsync ? DB.restoreAsync() : Promise.resolve(DB.restore());
  if (DB.restoreAsync) view.innerHTML = '<p style="text-align:center;margin-top:60px;opacity:.8">Conectando…</p>';
  restoring.then(function (restored) {
    if (restored) { st.user = restored; st.sede = restored.sede; return loadAll().then(function () { lastSig = sigOf(st.state); render(); }); }
    render();
  }).catch(function () { DB.logout(); st.user = null; render(); });
})();
