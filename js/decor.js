/* Inserta la decoración de Halloween (luna, niebla, telarañas, velas, gato) en cualquier página */
(function (global) {
  'use strict';
  var WEB = '<svg viewBox="0 0 150 150" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"><path d="M0 0 L150 0 M0 0 L0 150 M0 0 L125 100 M0 0 L100 125 M0 0 L140 50 M0 0 L50 140"/><path d="M22 0 Q18 18 0 22 M45 0 Q38 38 0 45 M70 0 Q58 58 0 70 M98 0 Q80 80 0 98 M128 0 Q104 104 0 128"/></svg>';
  var CAT = '<svg viewBox="0 0 120 130"><path d="M18 130 C10 90 22 62 40 50 L34 14 L56 34 C60 33 64 33 68 34 L90 14 L84 50 C102 62 112 90 102 130 Z" fill="#0d0617"/>' +
    '<g class="eyewrap"><circle class="eye" cx="45" cy="64" r="13"/><circle class="pupil" cx="45" cy="64" r="6"/></g>' +
    '<g class="eyewrap"><circle class="eye" cx="76" cy="64" r="13"/><circle class="pupil" cx="76" cy="64" r="6"/></g>' +
    '<path d="M57 80 L61 85 L65 80 Z" fill="#ff8aa8"/><path d="M26 76 L4 70 M26 82 L4 86 M96 76 L118 70 M96 82 L118 86" stroke="#6b5a8c" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M30 22 L26 8 L42 18 Z M90 22 L94 8 L78 18 Z" fill="#0d0617"/></svg>';
  var GHOST = '<svg viewBox="0 0 100 120"><path d="M50 4 C24 4 10 24 10 50 L10 112 L24 100 L37 114 L50 100 L63 114 L76 100 L90 112 L90 50 C90 24 76 4 50 4 Z" fill="#fff6ff"/>' +
    '<ellipse cx="38" cy="48" rx="6" ry="9" fill="#2b1442"/><ellipse cx="62" cy="48" rx="6" ry="9" fill="#2b1442"/>' +
    '<ellipse cx="28" cy="64" rx="7" ry="4.5" fill="#ffb3c7" opacity=".8"/><ellipse cx="72" cy="64" rx="7" ry="4.5" fill="#ffb3c7" opacity=".8"/>' +
    '<path d="M42 68 Q50 78 58 68" stroke="#2b1442" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>';

  function mount() {
    var h = '<canvas id="fx-bg"></canvas><div class="moon"></div><div class="mist"></div>' +
      '<div class="web tl">' + WEB + '</div><div class="web tr">' + WEB + '</div>' +
      '<div class="candles"><div class="candle c1"><i class="flame"></i></div><div class="candle c2"><i class="flame"></i></div></div>' +
      '<div class="cat">' + CAT + '</div>' +
      '<div id="modal-root"></div><div id="toast-root"></div>';
    var d = document.createElement('div'); d.innerHTML = h;
    while (d.firstChild) document.body.insertBefore(d.firstChild, document.body.firstChild);
    FX.startBackground(document.getElementById('fx-bg'));
    FX.catEyes();
  }
  global.Decor = { mount: mount, ghost: GHOST };
})(window);
