// ============================================================
//  gallery.js — Entry point only (runs on index.html)
//  Fetches manifest.json → if photos exist:
//    1. Shows the "View Photos" banner at bottom of biodata
//    2. Shows the right-edge arrow button
//  Clicking either navigates to photos.html
// ============================================================
(function () {
  'use strict';

  function loadManifest(cb) {
    fetch('photos/manifest.json?_=' + Date.now())
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) { cb(Array.isArray(d) && d.length ? d : []); })
      .catch(function () { cb([]); });
  }

  function init() {
    loadManifest(function (photos) {
      if (!photos.length) return; // no photos — do nothing

      var count = photos.length;

      // ── 1. Inject "View Photos" banner at bottom of .container ──
      var container = document.querySelector('.container');
      if (container) {
        var banner = document.createElement('a');
        banner.href = 'photos.html';
        banner.className = 'photos-entry-banner';
        banner.setAttribute('aria-label', 'View photos');
        banner.innerHTML =
          '<span class="peb-icon">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<rect x="3" y="7" width="18" height="13" rx="2"/>' +
              '<path d="M16 3l-4 4-4-4"/>' +
              '<circle cx="12" cy="13" r="3"/>' +
            '</svg>' +
          '</span>' +
          '<span class="peb-text">View Photos</span>' +
          '<span class="peb-count">' + count + ' photo' + (count !== 1 ? 's' : '') + '</span>' +
          '<span class="peb-arrow">›</span>';
        container.appendChild(banner);
      }

      // ── 2. Show right-edge arrow button ──────────────────────
      var arrow = document.getElementById('photos-edge-arrow');
      if (arrow) {
        arrow.style.display = 'flex';
        arrow.addEventListener('click', function () {
          window.location.href = 'photos.html';
        });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
