/* Utilidades compartidas: hash, escapado, toasts, modales, cuenta regresiva */
(function (global) {
  'use strict';

  /* SHA-256 síncrono (funciona también abriendo el archivo con doble clic) */
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var maxWord = Math.pow(2, 32), result = '', words = [], bitLen = ascii.length * 8, i, j;
    var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [], pc = k.length, comp = {};
    for (var cand = 2; pc < 64; cand++) {
      if (!comp[cand]) {
        for (i = 0; i < 313; i += cand) comp[i] = cand;
        hash[pc] = (Math.pow(cand, .5) * maxWord) | 0;
        k[pc++] = (Math.pow(cand, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return null;
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((bitLen / maxWord) | 0);
    words[words.length] = bitLen;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), old = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + old[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) {
      var b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? 0 : '') + b.toString(16);
    }
    return result;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initials(name) {
    var parts = String(name).replace(/[()]/g, '').split(/\s+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
  }

  function hueFor(str) {
    var n = 0; for (var i = 0; i < str.length; i++) n = (n * 31 + str.charCodeAt(i)) % 360;
    return n;
  }

  /* Toasts */
  function toast(msg, type) {
    var root = document.getElementById('toast-root'); if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.classList.add('out'); }, 3200);
    setTimeout(function () { el.remove(); }, 3700);
  }

  /* Modal de confirmación (devuelve una promesa) */
  function confirmModal(opts) {
    return new Promise(function (resolve) {
      var root = document.getElementById('modal-root');
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-emoji">' + (opts.emoji || '🎃') + '</div>' +
        '<h3>' + esc(opts.title || '¿Confirmas?') + '</h3>' +
        '<p>' + (opts.html || esc(opts.text || '')) + '</p>' +
        '<div class="modal-actions">' +
        '<button class="btn ghost" data-r="0">' + esc(opts.cancel || 'Cancelar') + '</button>' +
        '<button class="btn primary" data-r="1">' + esc(opts.ok || 'Confirmar') + '</button>' +
        '</div></div>';
      function done(v) { wrap.classList.add('out'); setTimeout(function () { wrap.remove(); }, 200); resolve(v); }
      wrap.addEventListener('click', function (e) {
        var r = e.target.getAttribute && e.target.getAttribute('data-r');
        if (r !== null && r !== undefined) done(r === '1');
        else if (e.target === wrap) done(false);
      });
      root.appendChild(wrap);
      var okb = wrap.querySelector('[data-r="1"]'); if (okb) okb.focus();
    });
  }

  /* Cuenta regresiva */
  function countdown(targetISO, cb) {
    var t = new Date(targetISO).getTime();
    function tick() {
      var d = t - Date.now();
      if (d <= 0) return cb(null);
      var s = Math.floor(d / 1000);
      cb({ d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 });
    }
    tick();
    return setInterval(tick, 1000);
  }

  function fmt(n, dec) { return (Math.round(n * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec); }

  function download(filename, text, mime) {
    var blob = new Blob(['﻿' + text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  global.U = { sha256: sha256, esc: esc, initials: initials, hueFor: hueFor, toast: toast, confirmModal: confirmModal, countdown: countdown, fmt: fmt, download: download };
})(window);
