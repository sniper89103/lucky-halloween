/* Efectos: luciérnagas, murciélagos, confeti de emojis, sonidos y gato que sigue el cursor */
(function (global) {
  'use strict';
  var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Fondo animado ---------- */
  function startBackground(canvas) {
    var ctx = canvas.getContext('2d'), W, H, dpr = Math.min(global.devicePixelRatio || 1, 2);
    var flies = [], bats = [], stars = [];
    var glow = document.createElement('canvas'); glow.width = glow.height = 64;
    (function () { var g = glow.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,214,102,1)'); gr.addColorStop(1, 'rgba(255,160,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); })();
    function resize() {
      W = canvas.width = innerWidth * dpr; H = canvas.height = innerHeight * dpr;
      canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
      var nf = reduce ? 0 : Math.round(Math.min(46, innerWidth / 30));
      flies = []; for (var i = 0; i < nf; i++) flies.push({ x: Math.random() * W, y: Math.random() * H, r: (1 + Math.random() * 2.2) * dpr, a: Math.random() * 6.28, s: .15 + Math.random() * .35, p: Math.random() * 6.28 });
      stars = []; for (i = 0; i < 70; i++) stars.push({ x: Math.random() * W, y: Math.random() * H * .6, r: Math.random() * 1.3 * dpr, p: Math.random() * 6.28 });
    }
    resize(); addEventListener('resize', resize);

    function spawnBat() {
      var dir = Math.random() < .5 ? 1 : -1, sz = (14 + Math.random() * 22) * dpr;
      bats.push({ x: dir > 0 ? -60 : W + 60, y: (.08 + Math.random() * .4) * H, vx: dir * (1.2 + Math.random() * 1.6) * dpr, sz: sz, ph: Math.random() * 6, amp: 30 + Math.random() * 40 });
    }
    function drawBat(b, t) {
      var f = Math.sin(t * .02 + b.ph), s = b.sz;
      ctx.save(); ctx.translate(b.x, b.y + Math.sin(t * .004 + b.ph) * b.amp * dpr * .2); ctx.scale(b.vx > 0 ? 1 : -1, 1);
      ctx.fillStyle = '#0b0614';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(s * .45, -s * (.7 + f * .5), s, -s * .15 * (1 + f));
      ctx.quadraticCurveTo(s * .75, s * .1, s * .5, s * .15);
      ctx.quadraticCurveTo(s * .3, s * .02, 0, s * .22);
      ctx.quadraticCurveTo(-s * .3, s * .02, -s * .5, s * .15);
      ctx.quadraticCurveTo(-s * .75, s * .1, -s, -s * .15 * (1 + f));
      ctx.quadraticCurveTo(-s * .45, -s * (.7 + f * .5), 0, 0);
      ctx.fill();
      ctx.beginPath(); ctx.arc(0, -s * .05, s * .13, 0, 6.28); ctx.fill();
      ctx.restore();
    }
    var last = 0;
    function frame(t) {
      ctx.clearRect(0, 0, W, H);
      stars.forEach(function (s) { ctx.globalAlpha = .35 + .35 * Math.sin(t * .002 + s.p); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill(); });
      ctx.globalAlpha = 1;
      flies.forEach(function (f) {
        f.a += (Math.random() - .5) * .08; f.x += Math.cos(f.a) * f.s * dpr; f.y += Math.sin(f.a) * f.s * dpr - .05 * dpr;
        if (f.x < -10) f.x = W + 10; if (f.x > W + 10) f.x = -10; if (f.y < -10) f.y = H + 10; if (f.y > H + 10) f.y = -10;
        var al = .35 + .55 * Math.abs(Math.sin(t * .0015 + f.p));
        ctx.globalAlpha = al; ctx.drawImage(glow, f.x - f.r * 7, f.y - f.r * 7, f.r * 14, f.r * 14);
      });
      ctx.globalAlpha = 1;
      if (!reduce) {
        if (t - last > 5500 && bats.length < 5) { spawnBat(); if (Math.random() < .5) spawnBat(); last = t; }
        bats = bats.filter(function (b) { b.x += b.vx; return b.x > -120 && b.x < W + 120; });
        bats.forEach(function (b) { drawBat(b, t); });
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    if (!reduce) setTimeout(spawnBat, 800);
  }

  /* ---------- Confeti de emojis (sprites precalculados: rápido en celulares) ---------- */
  var cf = { c: null, ctx: null, parts: [], run: false, dpr: 1 };
  var sprites = {};
  function sprite(e, s) {
    var k = e + s; if (sprites[k]) return sprites[k];
    var c = document.createElement('canvas'), n = Math.ceil(s * 1.5); c.width = c.height = n;
    var x = c.getContext('2d'); x.font = s + 'px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(e, n / 2, n / 2);
    return (sprites[k] = c);
  }
  function confetti(opts) {
    opts = opts || {};
    if (reduce) return;
    if (!cf.c) {
      cf.c = document.createElement('canvas'); cf.c.className = 'confetti-canvas';
      document.body.appendChild(cf.c); cf.ctx = cf.c.getContext('2d');
    }
    cf.dpr = Math.min(devicePixelRatio || 1, 1.5);
    var w = Math.round(innerWidth * cf.dpr), h = Math.round(innerHeight * cf.dpr);
    if (cf.c.width !== w || cf.c.height !== h) { cf.c.width = w; cf.c.height = h; cf.c.style.width = innerWidth + 'px'; cf.c.style.height = innerHeight + 'px'; }
    var dpr = cf.dpr, em = opts.emojis || ['🎃', '👻', '🦇', '⭐', '🍬', '💜'];
    var n = Math.min(opts.count || 50, 90), ox = (opts.x == null ? .5 : opts.x) * innerWidth, oy = (opts.y == null ? .4 : opts.y) * innerHeight;
    var sizes = [20, 28, 36];
    for (var i = 0; i < n && cf.parts.length < 220; i++) {
      var ang = Math.random() * 6.28, sp = (4 + Math.random() * 9) * dpr;
      cf.parts.push({ x: ox * dpr, y: oy * dpr, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 5 * dpr, g: .22 * dpr, r: Math.random() * 6, vr: (Math.random() - .5) * .3,
        sp: sprite(em[i % em.length], Math.round(sizes[i % 3] * dpr)), life: 0, max: 80 + Math.random() * 40 });
    }
    if (!cf.run) { cf.run = true; requestAnimationFrame(cfStep); }
  }
  function cfStep() {
    var ctx = cf.ctx; ctx.clearRect(0, 0, cf.c.width, cf.c.height);
    cf.parts = cf.parts.filter(function (p) { return p.life < p.max; });
    cf.parts.forEach(function (p) {
      p.life++; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.r += p.vr;
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max); ctx.setTransform(Math.cos(p.r), Math.sin(p.r), -Math.sin(p.r), Math.cos(p.r), p.x, p.y);
      ctx.drawImage(p.sp, -p.sp.width / 2, -p.sp.height / 2);
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    if (cf.parts.length) requestAnimationFrame(cfStep); else { cf.run = false; ctx.clearRect(0, 0, cf.c.width, cf.c.height); }
  }

  /* ---------- Sonido (WebAudio, sin archivos) ---------- */
  var ac = null, muted = localStorage.getItem('lucky.muted') === '1';
  function ctxA() {
    if (muted) return null;
    if (!ac) { try { ac = new (global.AudioContext || global.webkitAudioContext)(); } catch (e) { return null; } }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(freq, start, dur, type, vol) {
    var a = ctxA(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime + start;
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol || .12, t0 + .02); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + .05);
  }
  var sfx = {
    pick: function () { tone(520, 0, .08, 'triangle', .07); },
    vote: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * .08, .28, 'sine', .12); }); },
    undo: function () { tone(330, 0, .12, 'sawtooth', .06); tone(220, .1, .2, 'sawtooth', .06); },
    error: function () { tone(160, 0, .22, 'square', .07); tone(120, .15, .3, 'square', .07); },
    boo: function () { tone(180, 0, .5, 'sawtooth', .05); tone(140, .15, .6, 'triangle', .06); },
    drum: function (n) { for (var i = 0; i < (n || 12); i++) tone(70 + i * 4, i * .16, .14, 'triangle', .22); },
    win: function () { [523, 659, 784, 1047, 784, 1047, 1319].forEach(function (f, i) { tone(f, i * .12, .45, 'triangle', .14); }); }
  };
  function setMuted(m) { muted = m; localStorage.setItem('lucky.muted', m ? '1' : '0'); }
  function isMuted() { return muted; }

  /* ---------- Gato con ojos que siguen el cursor ---------- */
  function catEyes() {
    var pupils = document.querySelectorAll('.cat .pupil'); if (!pupils.length) return;
    function look(x, y) {
      pupils.forEach(function (p) {
        var r = p.parentNode.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1, m = Math.min(6, d / 30);
        p.style.transform = 'translate(' + (dx / d * m) + 'px,' + (dy / d * m) + 'px)';
      });
    }
    addEventListener('pointermove', function (e) { look(e.clientX, e.clientY); }, { passive: true });
    addEventListener('touchmove', function (e) { var t = e.touches[0]; if (t) look(t.clientX, t.clientY); }, { passive: true });
  }

  /* Pequeña animación del fantasma al votar */
  function ghostBoo() {
    var g = document.querySelector('.ghost-float'); if (!g) return;
    g.classList.remove('boo'); void g.offsetWidth; g.classList.add('boo');
  }

  global.FX = { startBackground: startBackground, confetti: confetti, sfx: sfx, setMuted: setMuted, isMuted: isMuted, catEyes: catEyes, ghostBoo: ghostBoo, reduce: reduce };
})(window);
