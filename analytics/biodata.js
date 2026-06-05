// ============================================================
//  Biodata Analytics — analytics/biodata.js  v2
//  ALL settings in analytics/config.js
//
//  Key fixes in this version:
//  ① Event queue: gallery events fired before visitId is ready
//    are buffered and flushed once the visit INSERT completes.
//  ② ipv4 is hoisted to module scope so the gallery bridge can
//    include the real IP in every photo_events row.
//  ③ GPS is skipped on photos.html — it adds 2-5 s of latency
//    for no benefit on the gallery page.
// ============================================================
(function () {

  function waitForConfig(cb, retries) {
    retries = retries === undefined ? 0 : retries;
    if (window.ANALYTICS_CONFIG) return cb(window.ANALYTICS_CONFIG);
    if (retries > 100) return;
    setTimeout(function () { waitForConfig(cb, retries + 1); }, 50);
  }

  waitForConfig(function (cfg) {
    const SUPABASE_URL = cfg.supabaseUrl;
    const SUPABASE_KEY = cfg.supabaseKey;
    const TABLE_NAME   = cfg.tableName   || 'visits';
    const ADMIN_SECRET = cfg.adminSecret;
    const DEBUG        = cfg.debug       || false;

    const log = function () {
      if (DEBUG) console.log.apply(console, ['[Analytics]'].concat(Array.prototype.slice.call(arguments)));
    };
    const err = function () {
      console.error.apply(console, ['[Analytics ERROR]'].concat(Array.prototype.slice.call(arguments)));
    };

    // ── Page context ──────────────────────────────────────────
    // Resolved lazily inside init() once the DOM is ready.
    // photos.html has class "gl-page"; we skip GPS there (saves 2–5 s).
    let isGalleryPage = false;

    // ── Persistent session (same browser = same unique visitor) ──
    const SESSION_KEY = '_bd_sid';
    let sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
      localStorage.setItem(SESSION_KEY, sessionId);
      log('New visitor — session:', sessionId);
    } else {
      log('Returning visitor — session:', sessionId);
    }

    // ── Extract recipient tag from URL hash ───────────────────
    function getRecipientTag() {
      const hash = window.location.hash.replace('#', '').trim();
      if (!hash || hash === ADMIN_SECRET) return null;
      return hash.replace(/[^a-zA-Z0-9\-_]/g, '').substring(0, 60) || null;
    }

    const sessionStart = Date.now();
    let visitId        = null;
    let scrollDepth    = 0;
    let source         = 'none';

    // ── FIX ①: module-level ipv4 so gallery bridge can read it ──
    let resolvedIpv4   = null;

    const recipientTag = getRecipientTag();
    log('Recipient tag:', recipientTag || '(none — direct visit)');

    // ── FIX ②: Event queue for gallery events before visitId ──
    // Any trackEvent call that arrives before the visit INSERT
    // returns is buffered here and replayed once visitId is set.
    let eventQueue = [];
    let visitReady = false;

    function flushQueue() {
      if (!eventQueue.length) return;
      log('Flushing', eventQueue.length, 'queued gallery event(s)');
      const toFlush = eventQueue.slice();
      eventQueue = [];
      toFlush.forEach(function (data) { sendPhotoEvent(data); });
    }

    // ── Device helpers ────────────────────────────────────────
    function getDeviceType() {
      const ua = navigator.userAgent;
      if (/tablet|ipad|playbook|silk/i.test(ua))                                  return 'Tablet';
      if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile/i.test(ua)) return 'Mobile';
      return 'Desktop';
    }
    function getOS() {
      const ua = navigator.userAgent;
      if (/windows/i.test(ua))          return 'Windows';
      if (/macintosh|mac os/i.test(ua)) return 'macOS';
      if (/android/i.test(ua))          return 'Android';
      if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
      if (/linux/i.test(ua))            return 'Linux';
      return 'Unknown';
    }
    function getBrowser() {
      const ua = navigator.userAgent;
      if (/edg\//i.test(ua))                             return 'Edge';
      if (/opr\//i.test(ua) || /opera/i.test(ua))       return 'Opera';
      if (/samsungbrowser/i.test(ua))                    return 'Samsung Browser';
      if (/miui.*browser|miuibrowser/i.test(ua))         return 'MIUI Browser';
      if (/ucbrowser/i.test(ua))                         return 'UC Browser';
      if (/yabrowser/i.test(ua))                         return 'Yandex Browser';
      if (/brave/i.test(ua))                             return 'Brave';
      if (/duckduckgo/i.test(ua))                        return 'DuckDuckGo';
      if (/vivaldi/i.test(ua))                           return 'Vivaldi';
      if (/chromium/i.test(ua))                          return 'Chromium';
      if (/chrome/i.test(ua))                            return 'Chrome';
      if (/firefox/i.test(ua))                           return 'Firefox';
      if (/safari/i.test(ua))                            return 'Safari';
      return 'Unknown';
    }
    function getReferrer() {
      const ref = document.referrer;
      if (!ref)                        return 'Direct / Unknown';
      if (/google/i.test(ref))         return 'Google';
      if (/whatsapp/i.test(ref))       return 'WhatsApp';
      if (/facebook/i.test(ref))       return 'Facebook';
      if (/instagram/i.test(ref))      return 'Instagram';
      if (/twitter|t\.co/i.test(ref))  return 'Twitter';
      if (/linkedin/i.test(ref))       return 'LinkedIn';
      return ref.split('/')[2] || ref;
    }

    // ── Supabase fetch with IPv6 fallback ─────────────────────
    function abortFetch(url, opts, ms) {
      const controller = window.AbortController ? new AbortController() : null;
      const timer = controller ? setTimeout(function () { controller.abort(); }, ms) : null;
      const fetchOpts = controller ? Object.assign({}, opts, { signal: controller.signal }) : opts;
      return fetch(url, fetchOpts).finally(function () { if (timer) clearTimeout(timer); });
    }

    async function supabaseFetch(path, opts) {
      const fullUrl = SUPABASE_URL + path;
      try {
        return await abortFetch(fullUrl, opts, 7000);
      } catch (e1) {
        log('Direct Supabase failed (' + e1.message + '), trying proxy…');
      }
      try {
        const proxied = 'https://corsproxy.io/?' + encodeURIComponent(fullUrl);
        return await abortFetch(proxied, opts, 10000);
      } catch (e2) {
        throw new Error('Supabase unreachable (direct + proxy both failed): ' + e2.message);
      }
    }

    async function insertVisit(data) {
      log('Inserting visit…', data);
      try {
        const res = await supabaseFetch('/rest/v1/' + TABLE_NAME, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'apikey':         SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Prefer':         'return=representation',
          },
          body: JSON.stringify(data),
        });
        const text = await res.text();
        if (!res.ok) { err('Insert failed:', res.status, text); return; }
        const json = JSON.parse(text);
        if (json && json[0]) {
          visitId = json[0].id;
          log('Inserted! ID:', visitId);
          // ── FIX ①: visit is ready — flush any queued gallery events ──
          visitReady = true;
          flushQueue();
        }
      } catch (e) { err('Network error:', e.message); }
    }

    async function updateVisit(data) {
      if (!visitId) return;
      log('Updating visit:', visitId, data);
      try {
        await supabaseFetch('/rest/v1/' + TABLE_NAME + '?id=eq.' + visitId, {
          method: 'PATCH',
          headers: {
            'Content-Type':  'application/json',
            'apikey':         SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
          },
          body: JSON.stringify(data),
        });
      } catch (e) { err('Update failed:', e.message); }
    }

    // ── Geo + IPv4 + IPv6 ─────────────────────────────────────
    async function getGeoData() {
      log('Fetching IP geo…');
      let ipv4 = null, ipv6 = null, geo = {};

      await Promise.allSettled([
        fetch('https://api4.my-ip.io/v2/ip.json')
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d.ip) { ipv4 = d.ip; log('IPv4:', ipv4); } })
          .catch(function () { log('IPv4 endpoint failed'); }),
        fetch('https://api6.my-ip.io/v2/ip.json')
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d.ip && d.ip.includes(':')) { ipv6 = d.ip; log('IPv6:', ipv6); } })
          .catch(function () { log('IPv6 not available'); }),
      ]);

      try {
        const res = await fetch('https://ipapi.co/json/');
        const d   = await res.json();
        if (!d.error) {
          if (!ipv4 && d.ip && !d.ip.includes(':')) ipv4 = d.ip;
          if (!ipv6 && d.ip &&  d.ip.includes(':')) ipv6 = d.ip;
          geo = {
            city:      d.city         || null,
            region:    d.region       || null,
            country:   d.country_name || null,
            isp:       d.org          || null,
            latitude:  d.latitude     || null,
            longitude: d.longitude    || null,
            timezone:  d.timezone     || null,
          };
        }
      } catch (e) { log('ipapi.co failed:', e.message); }

      // ── FIX ②: hoist resolved ipv4 to module scope ──
      resolvedIpv4 = ipv4;

      return { ipv4, ipv6, ...geo };
    }

    // ── GPS Location (only on biodata page) ───────────────────
    async function getGPSLocation() {
      // FIX ③: skip GPS entirely on photos.html
      if (isGalleryPage) return { gps_granted: false };
      if (!navigator.geolocation) return { gps_granted: false };
      return new Promise(function (resolve) {
        setTimeout(function () {
          navigator.geolocation.getCurrentPosition(
            function (pos) {
              resolve({
                gps_granted:  true,
                gps_lat:      pos.coords.latitude,
                gps_lng:      pos.coords.longitude,
                gps_accuracy: Math.round(pos.coords.accuracy),
              });
            },
            function () { resolve({ gps_granted: false }); },
            { timeout: 10000, maximumAge: 300000, enableHighAccuracy: false }
          );
        }, 2500);
      });
    }

    // ── Scroll ────────────────────────────────────────────────
    function trackScroll() {
      window.addEventListener('scroll', function () {
        const docH = document.documentElement.scrollHeight - window.innerHeight;
        if (docH > 0) {
          const pct = Math.round((window.scrollY / docH) * 100);
          if (pct > scrollDepth) scrollDepth = pct;
        }
      });
    }

    // ── Button clicks ─────────────────────────────────────────
    function trackButtons() {
      const waBtn    = document.querySelector('a[href*="wa.me"]');
      const phoneBtn = document.querySelector('a[href*="tel:"]');
      if (waBtn) {
        waBtn.addEventListener('click', function () {
          log('WhatsApp clicked');
          source = 'whatsapp';
          updateVisit({ source: 'whatsapp' });
        });
      }
      if (phoneBtn) {
        phoneBtn.addEventListener('click', function () {
          log('Phone clicked');
          source = 'phone';
          updateVisit({ source: 'phone' });
        });
      }
    }

    // ── Session end ───────────────────────────────────────────
    function trackSessionEnd() {
      const save = function () {
        const dur    = Math.round((Date.now() - sessionStart) / 1000);
        const update = { duration_seconds: dur, scroll_depth_pct: scrollDepth };
        if (source !== 'none') update.source = source;
        updateVisit(update);
      };
      window.addEventListener('beforeunload', save);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') save();
      });
      setInterval(function () { if (visitId) save(); }, 15000);
    }

    // ── Gallery photo_events insert (internal) ────────────────
    async function sendPhotoEvent(data) {
      try {
        await supabaseFetch('/rest/v1/photo_events', {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'apikey':         SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Prefer':         'return=minimal',
          },
          body: JSON.stringify({
            session_id:       sessionId,
            visit_id:         visitId,           // FK to visits row (nullable)
            visited_at:       new Date().toISOString(),
            photo_name:       data.photo_name       || null,
            photo_index:      data.photo_index !== undefined ? data.photo_index : null,
            event_type:       data.event_type        || 'view',
            duration_seconds: data.duration_seconds  || 0,
            zoom_pct:         data.zoom_pct           || 0,   // max zoom % for view_end events
            recipient_tag:    recipientTag,           // always from module scope
            device_type:      getDeviceType(),
            ipv4:             resolvedIpv4,           // FIX ②: real IP, not null
          }),
        });
        log('photo_event sent:', data.event_type, data.photo_name);
      } catch (e) {
        log('photo_event failed (silent):', e.message);
      }
    }

    // ── Gallery Analytics Bridge (public API) ─────────────────
    // gallery.js calls window._galleryAnalytics.trackEvent(data)
    //
    // On photos.html (gallery page): visitId is always null because
    // we intentionally skip the visit INSERT. Send photo events
    // directly — visit_id is nullable in the schema.
    //
    // On index.html: visitId may not be set yet when the first
    // gallery event fires, so queue and flush once INSERT completes.
    window._galleryAnalytics = {
      trackEvent: function (data) {
        if (isGalleryPage) {
          // Gallery page — no visitId, send directly every time
          sendPhotoEvent(data);
        } else if (visitReady && visitId) {
          sendPhotoEvent(data);
        } else {
          log('visitId not ready — queuing event:', data.event_type, data.photo_name);
          eventQueue.push(data);
        }
      },
    };

    // ── Init ──────────────────────────────────────────────────
    async function init() {
      isGalleryPage = document.body.classList.contains('gl-page');

      // ── photos.html: no visit row ever ───────────────────────
      // biodata.js runs on photos.html only to expose the
      // _galleryAnalytics bridge. Photo engagement goes into
      // photo_events (visit_id nullable). Exit before any DB write.
      if (isGalleryPage) {
        log('Gallery page — skipping visit insert, bridge ready.');
        return;
      }

      // ── index.html: skip if user is navigating BACK from gallery ──
      // Clicking "< Biodata" sets referrer to photos.html — that is
      // not a fresh visit, just back-navigation. Don't record it.
      if (document.referrer && /photos\.html/.test(document.referrer)) {
        log('Skipping visit — back-navigation from photos.html');
        return;
      }

      if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_')) { err('supabaseUrl not set!'); return; }
      if (!SUPABASE_KEY || SUPABASE_KEY.includes('YOUR_')) { err('supabaseKey not set!'); return; }

      const [geo, gps] = await Promise.all([getGeoData(), getGPSLocation()]);

      await insertVisit({
        session_id:        sessionId,
        visited_at:        new Date().toISOString(),
        device_type:       getDeviceType(),
        os:                getOS(),
        browser:           getBrowser(),
        screen_resolution: screen.width + 'x' + screen.height,
        referrer:          getReferrer(),
        language:          navigator.language || null,
        page_url:          window.location.href,
        duration_seconds:  0,
        scroll_depth_pct:  0,
        source:            'none',
        recipient_tag:     recipientTag,
        ...geo,
        ...gps,
      });

      trackScroll();
      trackButtons();
      trackSessionEnd();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  });

})();
