/* ═══════════════════════════════════════════════════════════
   GALLERY JS — photos/gallery.js  v5
   Clean zoom state machine — no snap-back on finger lift
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MANIFEST = 'photos/manifest.json';
  var isGalleryPage = document.body.classList.contains('gl-page');
  var isBiodataPage = !isGalleryPage;

  var photos       = [];
  var currentIndex = 0;

  /* ── Zoom / pan state ── */
  var zoom  = 1, tx = 0, ty = 0;
  var zoomTrackedForCurrent = false;

  /* ── Gesture state machine ──
     mode: 'idle' | 'pinch' | 'pan' | 'swipe'
  ── */
  var gestureMode    = 'idle';
  var pinchStartDist = 0;
  var pinchStartZoom = 1;
  var panStartX      = 0, panStartY = 0;
  var panOrigTx      = 0, panOrigTy = 0;
  var swipeStartX    = 0, swipeStartY = 0;
  var lastTapTime    = 0;
  var lastTapX       = 0, lastTapY = 0;

  var mainImg = null, bgImg = null;

  /* ── Preload cache ── */
  var cache = {};
  function preload(idx) {
    if (idx >= 0 && idx < photos.length && !cache[idx]) {
      cache[idx] = new Image();
      cache[idx].src = 'photos/' + photos[idx];
    }
  }

  fetch(MANIFEST)
    .then(function (r) {
      if (!r.ok) throw new Error('Manifest not found');
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.length) { console.warn('Gallery: empty manifest'); return; }
      photos = data;
      if (isBiodataPage) initFAB(photos);
      if (isGalleryPage) initViewer(photos);
    })
    .catch(function (e) {
      console.error('Gallery Error:', e);
      if (isGalleryPage) {
        var v = document.getElementById('gl-viewer');
        if (v) v.innerHTML = '<div style="color:rgba(255,255,255,0.5);text-align:center;padding:40px">Could not load photos.<br><small>' + e.message + '</small></div>';
      }
    });

  /* ════════════════════════════════════════
     FAB + BANNER  (index.html)
  ════════════════════════════════════════ */
  function initFAB(photos) {
    var fab = document.getElementById('gallery-fab');
    if (fab) {
      fab.style.display = '';
      var hash = window.location.hash.replace('#', '');
      if (hash) fab.setAttribute('onclick', "window.location.href='photos.html#" + hash + "'");
      if (!sessionStorage.getItem('_gl_tip')) {
        var tip = document.createElement('div');
        tip.className = 'gallery-fab-tooltip';
        tip.textContent = 'Tap to view photos';
        document.body.appendChild(tip);
        setTimeout(function () { tip.remove(); sessionStorage.setItem('_gl_tip', '1'); }, 3600);
      }
    }
    var banner = document.getElementById('photo-banner');
    if (banner) {
      var ct = document.getElementById('peb-count-text');
      if (ct) ct.textContent = photos.length + ' photo' + (photos.length !== 1 ? 's' : '');
      var hash = window.location.hash.replace('#', '');
      if (hash) banner.href = 'photos.html#' + hash;
      banner.style.display = 'flex';
    }
  }

  /* ════════════════════════════════════════
     VIEWER  (photos.html)
  ════════════════════════════════════════ */
  function initViewer(photos) {
    var viewer  = document.getElementById('gl-viewer');
    var dotsEl  = document.getElementById('gl-dots');
    var prevBtn = document.getElementById('gl-nav-prev');
    var nextBtn = document.getElementById('gl-nav-next');

    bgImg = document.createElement('img');
    bgImg.className = 'gl-photo-bg';
    viewer.appendChild(bgImg);

    mainImg = document.createElement('img');
    mainImg.className = 'gl-photo-main';
    viewer.appendChild(mainImg);

    photos.forEach(function (_, i) {
      var dot = document.createElement('div');
      dot.className = 'gl-dot';
      dot.onclick = function () { goToPhoto(i); };
      dotsEl.appendChild(dot);
    });

    var urlParams = new URLSearchParams(window.location.search);
    var initial = parseInt(urlParams.get('photo')) || 0;
    if (initial < 0 || initial >= photos.length) initial = 0;

    goToPhoto(initial);

    prevBtn.onclick = function () { goToPhoto(currentIndex - 1); };
    nextBtn.onclick = function () { goToPhoto(currentIndex + 1); };

    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') goToPhoto(currentIndex + 1);
      if (e.key === 'ArrowLeft')  goToPhoto(currentIndex - 1);
      if (e.key === 'Escape')     history.back();
    });

    setupZoomPan(viewer);
    showHint();

    document.addEventListener('contextmenu', function (e) {
      if (e.target === mainImg) fireEvent('download_attempt', 0);
    });

    window.addEventListener('beforeunload', fireViewEnd);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') fireViewEnd();
    });
  }

  function showHint() {
    var old = document.querySelector('.gl-hint');
    if (old) old.remove();
    var h = document.createElement('div');
    h.className = 'gl-hint';
    h.innerHTML = '<i class="fas fa-search-plus" style="font-size:12px;opacity:0.8"></i>&nbsp; Pinch or double-tap to zoom';
    document.body.appendChild(h);
    setTimeout(function () { if (h.parentNode) h.remove(); }, 4200);
  }

  /* ════════════════════════════════════════
     NAVIGATE
  ════════════════════════════════════════ */
  function goToPhoto(index) {
    if (index < 0 || index >= photos.length) return;

    fireViewEnd();

    var dir     = (index > currentIndex) ? 1 : -1;
    var isFirst = !mainImg.src || mainImg.src === window.location.href || mainImg.naturalWidth === 0;

    /* Reset zoom state cleanly */
    zoom = 1; tx = 0; ty = 0;
    gestureMode = 'idle';
    mainImg.style.transition = 'none';
    mainImg.style.transform  = 'translate(0,0) scale(1)';
    zoomTrackedForCurrent = false;

    currentIndex = index;
    bgImg.src = 'photos/' + photos[index];

    var src = 'photos/' + photos[index];
    var img = (cache[index] && cache[index].complete && cache[index].naturalWidth > 0)
              ? cache[index] : null;

    function show(loadedImg) {
      cache[index] = loadedImg;
      if (isFirst) {
        mainImg.style.opacity = '0';
        mainImg.src = loadedImg.src;
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          mainImg.style.transition = 'opacity 0.35s ease';
          mainImg.style.opacity    = '1';
        }); });
      } else {
        /* slide out */
        mainImg.style.transition = 'transform 0.22s cubic-bezier(0.4,0,1,1), opacity 0.18s ease';
        mainImg.style.transform  = 'translateX(' + (-dir * 70) + 'px) scale(0.92)';
        mainImg.style.opacity    = '0';
        setTimeout(function () {
          mainImg.style.transition = 'none';
          mainImg.style.transform  = 'translateX(' + (dir * 60) + 'px) scale(0.92)';
          mainImg.style.opacity    = '0';
          mainImg.src = loadedImg.src;
          requestAnimationFrame(function () { requestAnimationFrame(function () {
            mainImg.style.transition = 'transform 0.3s cubic-bezier(0.22,1,0.36,1), opacity 0.25s ease';
            mainImg.style.transform  = 'translate(0,0) scale(1)';
            mainImg.style.opacity    = '1';
          }); });
        }, 160);
      }
    }

    if (img) { show(img); }
    else {
      var fresh = new Image();
      fresh.onload = function () { show(fresh); };
      fresh.src = src;
    }

    preload(index + 1);
    preload(index - 1);
    preload(index + 2);

    updateDots(index);
    updateArrows(index);
    updateCounter(index);
    fireViewStart(index);

    window._currentPhoto = photos[index];
    window._currentIndex = index;
  }

  function updateDots(i) {
    document.querySelectorAll('.gl-dot').forEach(function (d, idx) {
      d.classList.toggle('active', idx === i);
    });
  }
  function updateArrows(i) {
    var p = document.getElementById('gl-nav-prev');
    var n = document.getElementById('gl-nav-next');
    if (p) p.disabled = (i === 0);
    if (n) n.disabled = (i === photos.length - 1);
  }
  function updateCounter(i) {
    var c = document.getElementById('gl-counter-pill') || document.getElementById('gl-counter');
    if (c) c.textContent = (i + 1) + ' / ' + photos.length;
  }

  /* ════════════════════════════════════════
     ZOOM + PAN  — clean state machine
     
     States:
       idle  → on 1-finger: swipe (zoom=1) or pan (zoom>1)
       idle  → on 2-finger: pinch
       pinch → one finger lifts → back to idle (zoom STAYS)
       pan   → finger lifts → idle (zoom STAYS)
  ════════════════════════════════════════ */

  function applyTransform(animated) {
    mainImg.style.transition = animated
      ? 'transform 0.32s cubic-bezier(0.22,1,0.36,1)'
      : 'none';
    mainImg.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + zoom + ')';
  }

  function clampPan() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var iw = (mainImg && mainImg.naturalWidth)  || vw;
    var ih = (mainImg && mainImg.naturalHeight) || vh;
    var scale = Math.min(vw / iw, vh / ih);
    var maxTx = Math.max(0, (iw * scale * zoom - vw) / 2);
    var maxTy = Math.max(0, (ih * scale * zoom - vh) / 2);
    tx = Math.max(-maxTx, Math.min(maxTx, tx));
    ty = Math.max(-maxTy, Math.min(maxTy, ty));
  }

  function setupZoomPan(viewer) {

    /* ── touchstart ── */
    viewer.addEventListener('touchstart', function (e) {
      var tc = e.touches.length;

      if (tc === 2) {
        /* Start pinch — capture baseline distance AND current zoom */
        gestureMode    = 'pinch';
        pinchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        pinchStartZoom = zoom;   /* <-- THIS is the key fix: baseline zoom */

      } else if (tc === 1) {
        var t = e.touches[0];
        if (gestureMode === 'pinch') {
          /* Second finger lifting while first still down: stay in pan mode */
          gestureMode = 'pan';
          panStartX = t.clientX; panStartY = t.clientY;
          panOrigTx = tx;        panOrigTy = ty;
          return;
        }
        /* Fresh 1-finger touch */
        if (zoom > 1) {
          gestureMode = 'pan';
          panStartX = t.clientX; panStartY = t.clientY;
          panOrigTx = tx;        panOrigTy = ty;
        } else {
          gestureMode = 'swipe';
          swipeStartX = t.clientX;
          swipeStartY = t.clientY;
        }
      }
    }, { passive: true });

    /* ── touchmove ── */
    viewer.addEventListener('touchmove', function (e) {
      if (gestureMode === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        var d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        /* Scale relative to the gesture START — no drift */
        zoom = Math.min(6, Math.max(1, pinchStartZoom * (d / pinchStartDist)));
        clampPan();
        applyTransform(false);

      } else if (gestureMode === 'pan' && e.touches.length >= 1) {
        e.preventDefault();
        tx = panOrigTx + (e.touches[0].clientX - panStartX);
        ty = panOrigTy + (e.touches[0].clientY - panStartY);
        clampPan();
        applyTransform(false);
      }
    }, { passive: false });

    /* ── touchend ── */
    viewer.addEventListener('touchend', function (e) {
      var remaining = e.touches.length;
      var changed   = e.changedTouches[0];

      if (gestureMode === 'pinch') {
        if (remaining === 1) {
          /* One finger still down — switch to pan so user can reposition */
          gestureMode = 'pan';
          panStartX = e.touches[0].clientX;
          panStartY = e.touches[0].clientY;
          panOrigTx = tx;
          panOrigTy = ty;
        } else if (remaining === 0) {
          /* Both fingers up — zoom STAYS exactly where it is */
          if (zoom < 1.02) {
            zoom = 1; tx = 0; ty = 0;
            applyTransform(true);  /* snap to 1 if nearly at 1 */
          }
          gestureMode = 'idle';
        }
        return;  /* never fall through to double-tap / swipe */
      }

      if (gestureMode === 'pan' && remaining === 0) {
        gestureMode = 'idle';
        return;
      }

      if (gestureMode === 'swipe' && remaining === 0) {
        var dx = changed.clientX - swipeStartX;
        var dy = changed.clientY - swipeStartY;

        /* Double-tap detection */
        var now = Date.now();
        var dtx = changed.clientX - lastTapX;
        var dty = changed.clientY - lastTapY;
        var moved = Math.abs(dx) < 12 && Math.abs(dy) < 12;
        if (moved && now - lastTapTime < 300) {
          /* ── Double tap ── */
          if (zoom > 1.05) {
            zoom = 1; tx = 0; ty = 0;
            applyTransform(true);
          } else {
            var newZ = 2.8;
            var ntx  = (window.innerWidth  / 2 - changed.clientX) * (newZ - 1);
            var nty  = (window.innerHeight / 2 - changed.clientY) * (newZ - 1);
            zoom = newZ; tx = ntx; ty = nty;
            clampPan();
            applyTransform(true);
            trackZoom();
          }
          lastTapTime = 0;
          gestureMode = 'idle';
          return;
        }

        /* Single-tap: record for double-tap detection */
        if (moved) {
          lastTapTime = now;
          lastTapX    = changed.clientX;
          lastTapY    = changed.clientY;
        } else {
          lastTapTime = 0;
        }

        /* Swipe navigation */
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 44) {
          goToPhoto(dx < 0 ? currentIndex + 1 : currentIndex - 1);
        }

        gestureMode = 'idle';
      }
    }, { passive: true });

    /* ── Desktop wheel zoom ── */
    viewer.addEventListener('wheel', function (e) {
      e.preventDefault();
      var factor = e.deltaY > 0 ? 0.92 : 1.08;
      zoom = Math.min(6, Math.max(1, zoom * factor));
      if (zoom <= 1.02) { zoom = 1; tx = 0; ty = 0; }
      clampPan();
      applyTransform(false);
    }, { passive: false });
  }

  function trackZoom() {
    if (zoomTrackedForCurrent) return;
    zoomTrackedForCurrent = true;
    fireEvent('zoom', 0);
  }

  /* ════════════════════════════════════════
     ANALYTICS
  ════════════════════════════════════════ */
  var viewStartTime = 0;

  function fireEvent(type, duration) {
    window._galleryAnalytics && window._galleryAnalytics.trackEvent({
      photo_name:       photos[currentIndex],
      photo_index:      currentIndex,
      event_type:       type,
      duration_seconds: duration || 0
    });
  }

  function fireViewStart(index) {
    viewStartTime = Date.now();
    window._galleryAnalytics && window._galleryAnalytics.trackEvent({
      photo_name:       photos[index],
      photo_index:      index,
      event_type:       'view',
      duration_seconds: 0
    });
  }

  function fireViewEnd() {
    if (!viewStartTime) return;
    var dur = Math.round((Date.now() - viewStartTime) / 1000);
    window._galleryAnalytics && window._galleryAnalytics.trackEvent({
      photo_name:       photos[currentIndex],
      photo_index:      currentIndex,
      event_type:       'view_end',
      duration_seconds: dur
    });
    viewStartTime = 0;
  }

})();
