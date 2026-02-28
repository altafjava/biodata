// ============================================================
//  Biodata Analytics — analytics/biodata.js
//  ALL settings in analytics/config.js
// ============================================================
(function () {
  function waitForConfig(cb, retries) {
    retries = retries === undefined ? 0 : retries;
    if (window.ANALYTICS_CONFIG) return cb(window.ANALYTICS_CONFIG);
    if (retries > 100) return; // Give up after 5s — don't block page
    setTimeout(() => waitForConfig(cb, retries + 1), 50);
  }

  waitForConfig(function (cfg) {
    const SUPABASE_URL = cfg.supabaseUrl;
    const SUPABASE_KEY = cfg.supabaseKey;
    const TABLE_NAME   = cfg.tableName   || "visits";
    const ADMIN_SECRET = cfg.adminSecret;
    const SHORTCUT_KEY = cfg.shortcutKey || "A";
    const DEBUG        = cfg.debug       || false;

    const log = (...a) => { if (DEBUG) console.log("[Analytics]", ...a); };
    const err = (...a) => console.error("[Analytics ERROR]", ...a);

    // ── Persistent session (same browser = same unique visitor) ──
    const SESSION_KEY = '_bd_sid';
    let sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = Math.random().toString(36).substr(2,9) + Date.now().toString(36);
      localStorage.setItem(SESSION_KEY, sessionId);
      log("New visitor — session:", sessionId);
    } else {
      log("Returning visitor — session:", sessionId);
    }

    const sessionStart = Date.now();
    let visitId        = null;
    let scrollDepth    = 0;
    let source         = 'none';

    // ── Device helpers ────────────────────────────────────────
    function getDeviceType() {
      const ua = navigator.userAgent;
      if (/tablet|ipad|playbook|silk/i.test(ua))                                  return "Tablet";
      if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile/i.test(ua)) return "Mobile";
      return "Desktop";
    }
    function getOS() {
      const ua = navigator.userAgent;
      if (/windows/i.test(ua))          return "Windows";
      if (/macintosh|mac os/i.test(ua)) return "macOS";
      if (/android/i.test(ua))          return "Android";
      if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
      if (/linux/i.test(ua))            return "Linux";
      return "Unknown";
    }
    function getBrowser() {
      const ua = navigator.userAgent;
      if (/edg/i.test(ua))                              return "Edge";
      if (/chrome/i.test(ua) && !/chromium/i.test(ua)) return "Chrome";
      if (/firefox/i.test(ua))                          return "Firefox";
      if (/safari/i.test(ua) && !/chrome/i.test(ua))   return "Safari";
      if (/opera|opr/i.test(ua))                        return "Opera";
      if (/samsung/i.test(ua))                          return "Samsung Browser";
      return "Unknown";
    }
    function getReferrer() {
      const ref = document.referrer;
      if (!ref)                        return "Direct / Unknown";
      if (/google/i.test(ref))         return "Google";
      if (/whatsapp/i.test(ref))       return "WhatsApp";
      if (/facebook/i.test(ref))       return "Facebook";
      if (/instagram/i.test(ref))      return "Instagram";
      if (/twitter|t\.co/i.test(ref))  return "Twitter";
      if (/linkedin/i.test(ref))       return "LinkedIn";
      return ref.split("/")[2] || ref;
    }

    // ── Supabase fetch with IPv6 fallback via proxy ──────────
    function abortFetch(url, opts, ms) {
      const controller = window.AbortController ? new AbortController() : null;
      const timer = controller ? setTimeout(function() { controller.abort(); }, ms) : null;
      const fetchOpts = controller ? Object.assign({}, opts, { signal: controller.signal }) : opts;
      return fetch(url, fetchOpts).finally(function() { if (timer) clearTimeout(timer); });
    }

    async function supabaseFetch(path, opts) {
      const fullUrl = SUPABASE_URL + path;
      // Try 1: Direct connection (works on IPv4 networks)
      try {
        const res = await abortFetch(fullUrl, opts, 7000);
        return res;
      } catch (e1) {
        log("Direct Supabase failed (" + e1.message + "), trying proxy...");
      }
      // Try 2: corsproxy.io — has IPv4 connectivity, works for IPv6-only devices
      try {
        const proxied = "https://corsproxy.io/?" + encodeURIComponent(fullUrl);
        const res = await abortFetch(proxied, opts, 10000);
        return res;
      } catch (e2) {
        throw new Error("Supabase unreachable (direct + proxy both failed): " + e2.message);
      }
    }

    async function insertVisit(data) {
      log("Inserting visit...", data);
      try {
        const res = await supabaseFetch(`/rest/v1/${TABLE_NAME}`, {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "apikey":         SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Prefer":         "return=representation"
          },
          body: JSON.stringify(data),
        });
        const text = await res.text();
        if (!res.ok) { err("Insert failed:", res.status, text); return; }
        const json = JSON.parse(text);
        if (json && json[0]) { visitId = json[0].id; log("Inserted! ID:", visitId); }
      } catch (e) { err("Network error:", e.message); }
    }

    async function updateVisit(data) {
      if (!visitId) return;
      log("Updating visit:", visitId, data);
      try {
        await supabaseFetch(`/rest/v1/${TABLE_NAME}?id=eq.${visitId}`, {
          method: "PATCH",
          headers: {
            "Content-Type":  "application/json",
            "apikey":         SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`
          },
          body: JSON.stringify(data),
        });
      } catch (e) { err("Update failed:", e.message); }
    }

    // ── Geo + IPv4 + IPv6 (all HTTPS, mixed-content safe) ────────
    async function getGeoData() {
      log("Fetching IP geo...");
      let ipv4 = null, ipv6 = null, geo = {};

      // Fetch IPv4 and IPv6 in parallel using dedicated endpoints
      await Promise.allSettled([
        // IPv4-only endpoint (forces IPv4 connection)
        fetch("https://api4.my-ip.io/v2/ip.json")
          .then(r => r.json())
          .then(d => { if (d.ip) { ipv4 = d.ip; log("IPv4:", ipv4); } })
          .catch(() => log("IPv4 endpoint failed")),

        // IPv6-only endpoint (forces IPv6 connection if available)
        fetch("https://api6.my-ip.io/v2/ip.json")
          .then(r => r.json())
          .then(d => { if (d.ip && d.ip.includes(":")) { ipv6 = d.ip; log("IPv6:", ipv6); } })
          .catch(() => log("IPv6 not available (normal for IPv4-only connections)")),
      ]);

      // Get geo info from ipapi.co (HTTPS, reliable)
      try {
        const res = await fetch("https://ipapi.co/json/");
        const d   = await res.json();
        if (!d.error) {
          log("ipapi.co geo:", d);
          // If we didn't get IPv4 yet, use ipapi.co's IP
          if (!ipv4 && d.ip && !d.ip.includes(":")) ipv4 = d.ip;
          if (!ipv6 && d.ip && d.ip.includes(":"))  ipv6 = d.ip;
          geo = {
            city:      d.city          || null,
            region:    d.region        || null,
            country:   d.country_name  || null,
            isp:       d.org           || null,
            latitude:  d.latitude      || null,
            longitude: d.longitude     || null,
            timezone:  d.timezone      || null,
          };
        }
      } catch(e) { log("ipapi.co failed (normal on localhost):", e.message); }

      log("Final IPs — IPv4:", ipv4, "IPv6:", ipv6);
      return { ipv4, ipv6, ...geo };
    }

    // ── GPS Location (ask permission) ─────────────────────────
    async function getGPSLocation() {
      if (!navigator.geolocation) {
        log("Geolocation not supported");
        return { gps_granted: false };
      }
      return new Promise((resolve) => {
        // Small delay so page loads first before permission popup
        setTimeout(() => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              log("GPS granted:", pos.coords);
              resolve({
                gps_granted:  true,
                gps_lat:      pos.coords.latitude,
                gps_lng:      pos.coords.longitude,
                gps_accuracy: Math.round(pos.coords.accuracy),
              });
            },
            (error) => {
              log("GPS denied or error:", error.message);
              resolve({ gps_granted: false });
            },
            { timeout: 10000, maximumAge: 300000, enableHighAccuracy: false }
          );
        }, 2500); // wait 2.5s after page load
      });
    }

    // ── Scroll ────────────────────────────────────────────────
    function trackScroll() {
      window.addEventListener("scroll", function () {
        const docH = document.documentElement.scrollHeight - window.innerHeight;
        if (docH > 0) {
          const pct = Math.round((window.scrollY / docH) * 100);
          if (pct > scrollDepth) {
            scrollDepth = pct;
          }
        }
      });
    }

    // ── Button clicks → source ────────────────────────────────
    function trackButtons() {
      const waBtn    = document.querySelector('a[href*="wa.me"]');
      const phoneBtn = document.querySelector('a[href*="tel:"]');
      if (waBtn) {
        waBtn.addEventListener("click", () => {
          log("WhatsApp clicked → source: whatsapp");
          source = 'whatsapp';
          updateVisit({ source: 'whatsapp' });
        });
      }
      if (phoneBtn) {
        phoneBtn.addEventListener("click", () => {
          log("Phone clicked → source: phone");
          source = 'phone';
          updateVisit({ source: 'phone' });
        });
      }
    }

    // ── Session end + periodic save ──────────────────────────
    function trackSessionEnd() {
      const save = () => {
        const dur = Math.round((Date.now() - sessionStart) / 1000);
        log("Saving session. Duration:", dur + "s, Scroll:", scrollDepth + "%, Source:", source);
        const update = { duration_seconds: dur, scroll_depth_pct: scrollDepth };
        if (source !== 'none') update.source = source;
        updateVisit(update);
      };

      // Save on tab close / navigation
      window.addEventListener("beforeunload", save);
      // Save when tab goes to background (most reliable on mobile)
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") save();
      });
      // Also save every 15s while page is open, so scroll data is never lost
      setInterval(() => {
        if (visitId) save();
      }, 15000);
    }

    // ── Admin shortcut ────────────────────────────────────────
    function setupAdminShortcut() {
      const adminUrl = `analytics/admin.html#${ADMIN_SECRET}`;
      const isMac    = /macintosh|mac os/i.test(navigator.userAgent);
      document.addEventListener("keydown", function (e) {
        const mod = isMac ? e.metaKey : e.ctrlKey;
        if (mod && e.shiftKey && e.key === SHORTCUT_KEY) {
          e.preventDefault();
          window.open(adminUrl, "_blank");
        }
      });
    }

    // ── Init ──────────────────────────────────────────────────
    async function init() {
      if (!SUPABASE_URL || SUPABASE_URL.includes("YOUR_")) { err("supabaseUrl not set in config.js!"); return; }
      if (!SUPABASE_KEY || SUPABASE_KEY.includes("YOUR_")) { err("supabaseKey not set in config.js!"); return; }

      // Run geo + GPS in parallel (GPS waits 2.5s before showing popup)
      const [geo, gps] = await Promise.all([getGeoData(), getGPSLocation()]);

      await insertVisit({
        session_id:        sessionId,
        visited_at:        new Date().toISOString(),
        device_type:       getDeviceType(),
        os:                getOS(),
        browser:           getBrowser(),
        screen_resolution: `${screen.width}x${screen.height}`,
        referrer:          getReferrer(),
        language:          navigator.language || null,
        page_url:          window.location.href,
        duration_seconds:  0,
        scroll_depth_pct:  0,
        source:            'none',
        ...geo,
        ...gps,
      });

      trackScroll();
      trackButtons();
      trackSessionEnd();
      setupAdminShortcut();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  });
})();
