// ============================================================
//  Admin Panel JS — analytics/admin.js
// ============================================================

function showFatalError(msg) {
  const gate = document.getElementById('gate');
  const icon = document.getElementById('gate-icon');
  const heading = document.getElementById('gate-heading');
  const gateMsg = document.getElementById('gate-msg');
  if (gate)    { gate.classList.remove('hidden'); }
  if (icon)    { icon.style.animation = 'none'; icon.textContent = '⚠️'; }
  if (heading) { heading.textContent = 'Load Error'; heading.style.opacity = '1'; }
  if (gateMsg) { gateMsg.textContent = msg; gateMsg.style.color = '#f87171'; gateMsg.style.fontSize = '13px'; gateMsg.style.marginTop = '8px'; }
  document.getElementById('app').classList.add('hidden');
}

function waitForConfig(cb, n) {
  n = n || 0;
  if (window.ANALYTICS_CONFIG) return cb(window.ANALYTICS_CONFIG);
  if (n > 100) return showFatalError('config.js failed to load. Check the file path.');
  setTimeout(function() { waitForConfig(cb, n + 1); }, 50);
}

function waitForChart(cb, n) {
  n = n || 0;
  if (window.Chart) return cb();
  if (n > 120) return showFatalError('Chart.js failed to load from both CDNs. Check internet connection.');
  setTimeout(function() { waitForChart(cb, n + 1); }, 50);
}

waitForConfig(function(cfg) {
  waitForChart(function() { initAdmin(cfg); });
});

function initAdmin(cfg) {
  const SECRET_KEY   = cfg.adminSecret;
  const SUPABASE_URL = cfg.supabaseUrl;
  const SUPABASE_KEY = cfg.supabaseKey;
  const TABLE_NAME   = cfg.tableName || "visits";

  const charts = {};

  Chart.defaults.color       = '#8892b0';
  Chart.defaults.borderColor = '#e8ecf5';
  Chart.defaults.font.family = "'Poppins',sans-serif";
  Chart.defaults.font.size   = 11;

  const P = [
    '#4f46e5','#ef4444','#10b981','#f59e0b','#06b6d4',
    '#8b5cf6','#f97316','#14b8a6','#ec4899','#84cc16',
  ];

  // ── Access Gate ────────────────────────────────────────────
  function checkAccess() {
    const hash = window.location.hash.replace('#','');
    if (hash === SECRET_KEY) {
      document.getElementById('gate').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      loadData();
    } else {
      const icon    = document.getElementById('gate-icon');
      const heading = document.getElementById('gate-heading');
      if (icon)    { icon.style.animation='none'; icon.textContent='🔐'; }
      if (heading) { heading.textContent='Access Restricted'; heading.style.opacity='1'; heading.style.fontWeight='700'; }
      document.getElementById('gate').classList.remove('hidden');
      document.getElementById('app').classList.add('hidden');
    }
  }

  // ── Fetch with timeout + IPv6 fallback via proxy ────────────
  function abortFetch(url, opts, ms) {
    const controller = window.AbortController ? new AbortController() : null;
    const timer = controller ? setTimeout(function() { controller.abort(); }, ms) : null;
    const fetchOpts = controller ? Object.assign({}, opts, { signal: controller.signal }) : opts;
    return fetch(url, fetchOpts).finally(function() { if (timer) clearTimeout(timer); });
  }

  async function supabaseFetch(path, opts) {
    const fullUrl = SUPABASE_URL + path;
    const headers = Object.assign({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }, (opts && opts.headers) || {});
    try {
      return await abortFetch(fullUrl, Object.assign({}, opts, { headers }), 9000);
    } catch (e1) {
      console.warn('[Analytics] Direct failed, trying proxy:', e1.message);
    }
    try {
      return await abortFetch('https://corsproxy.io/?' + encodeURIComponent(fullUrl), Object.assign({}, opts, { headers }), 12000);
    } catch (e2) {
      console.warn('[Analytics] corsproxy failed, trying allorigins:', e2.message);
    }
    if (!opts || !opts.method || opts.method === 'GET') {
      try {
        return await abortFetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(fullUrl), {}, 12000);
      } catch (e3) {
        throw new Error('All fetch attempts failed. IPv6 network cannot reach Supabase.');
      }
    }
    throw new Error('All fetch attempts failed.');
  }

  async function fetchVisits(period) {
    let path = `/rest/v1/${TABLE_NAME}?select=*&order=visited_at.asc`;
    if (period === 'today') {
      const t = new Date(); t.setHours(0,0,0,0);
      path += `&visited_at=gte.${t.toISOString()}`;
    } else if (period !== 'all') {
      path += `&visited_at=gte.${new Date(Date.now()-parseInt(period)*86400000).toISOString()}`;
    }
    path += `&limit=5000`;
    const res = await supabaseFetch(path, { headers:{} });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  }

  // ── Fetch photo_events ─────────────────────────────────────
  async function fetchPhotoEvents(period) {
    let path = `/rest/v1/photo_events?select=*&order=visited_at.asc`;
    if (period === 'today') {
      const t = new Date(); t.setHours(0,0,0,0);
      path += `&visited_at=gte.${t.toISOString()}`;
    } else if (period !== 'all') {
      path += `&visited_at=gte.${new Date(Date.now()-parseInt(period)*86400000).toISOString()}`;
    }
    path += `&limit=10000`;
    try {
      const res = await supabaseFetch(path, { headers:{} });
      if (!res.ok) return [];
      return res.json();
    } catch(e) {
      return [];
    }
  }

  // ── Helpers ────────────────────────────────────────────────
  function countBy(arr, key) {
    const m={};
    arr.forEach(r=>{const v=r[key]||'Unknown'; m[v]=(m[v]||0)+1;});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  }
  function fmtDur(s) {
    if(!s||s<=0) return '—';
    if(s<60) return `${s}s`;
    return `${Math.floor(s/60)}m ${s%60}s`;
  }
  function fmtDate(iso, short=false) {
    if(!iso) return '—';
    const d = new Date(iso);
    if (short) return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})
      +' '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
      +' '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }
  function countUp(el, target, suffix='') {
    if(!el) return;
    if(typeof target !== 'number' || isNaN(target)) { el.textContent = target||'—'; return; }
    const dur=700, start=Date.now();
    const tick=()=>{
      const p=Math.min((Date.now()-start)/dur,1);
      const ease=1-Math.pow(1-p,3);
      el.textContent = Math.round(target*ease) + suffix;
      if(p<1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function T(entries) { return [entries.map(e=>e[0]), entries.map(e=>e[1])]; }

  function makeChart(id, type, labels, data, extraOpts) {
    if(charts[id]) charts[id].destroy();
    const ctx=document.getElementById(id);
    if(!ctx) return;
    const baseOpts = {
      responsive:true, maintainAspectRatio:true,
      plugins:{
        legend:{
          display:type!=='line'&&type!=='bar',
          position:'right',
          labels:{
            boxWidth:10, padding:14, font:{size:11},
            generateLabels: function(chart) {
              const d = chart.data;
              return d.labels.map((label, i) => ({
                text: `${label}  (${d.datasets[0].data[i]})`,
                fillStyle: Array.isArray(d.datasets[0].backgroundColor)
                  ? d.datasets[0].backgroundColor[i]
                  : d.datasets[0].backgroundColor,
                hidden: false, index: i,
              }));
            }
          }
        },
        tooltip:{
          backgroundColor:'#0f1221', borderColor:'rgba(255,255,255,0.08)',
          borderWidth:1, padding:12, cornerRadius:10,
          titleFont:{size:12,weight:'600'}, bodyFont:{size:11},
        }
      },
      scales: type==='line'||type==='bar' ? {
        x:{ grid:{color:'#f0f2f8'}, ticks:{maxTicksLimit:10,font:{size:10}}, position:'bottom' },
        y:{ grid:{color:'#f0f2f8'}, beginAtZero:true, ticks:{font:{size:10}}, position:'right' }
      } : {},
    };
    // Deep merge extraOpts if provided
    const finalOpts = extraOpts ? Object.assign({}, baseOpts, extraOpts,
      { plugins: Object.assign({}, baseOpts.plugins, extraOpts.plugins||{}),
        scales:  Object.assign({}, baseOpts.scales,  extraOpts.scales||{}) }
    ) : baseOpts;

    charts[id]=new Chart(ctx,{
      type,
      data:{
        labels,
        datasets:[{
          data,
          backgroundColor: type==='line'?'rgba(79,70,229,0.08)':P.slice(0,data.length),
          borderColor:     type==='line'?'#4f46e5':P.slice(0,data.length),
          borderWidth: type==='line'?2.5:1.5,
          fill: type==='line', tension:0.4,
          pointRadius:type==='line'?4:undefined,
          pointBackgroundColor:type==='line'?'#4f46e5':undefined,
          pointBorderColor:type==='line'?'#fff':undefined,
          pointBorderWidth:type==='line'?2:undefined,
          borderRadius:type==='bar'?6:undefined,
        }]
      },
      options: finalOpts,
    });
  }

  // ── Overview ───────────────────────────────────────────────
  function renderOverview(rows, photoRows) {
    const total    = rows.length;
    const sessions = new Set(rows.map(r=>r.session_id));
    const unique   = sessions.size;
    const returning= [...sessions].filter(s=>rows.filter(r=>r.session_id===s).length>1).length;
    const durs     = rows.map(r=>r.duration_seconds).filter(d=>d>0);
    const avgDur   = durs.length?Math.round(durs.reduce((a,b)=>a+b,0)/durs.length):0;
    const scrls    = rows.map(r=>r.scroll_depth_pct).filter(s=>s>0);
    const avgScrl  = scrls.length?Math.round(scrls.reduce((a,b)=>a+b,0)/scrls.length):0;
    const todayCnt = rows.filter(r=>new Date(r.visited_at).toDateString()===new Date().toDateString()).length;
    const gpsCnt   = rows.filter(r=>r.gps_granted).length;
    const recipientClicks = new Set(rows.filter(r=>r.recipient_tag).map(r=>r.recipient_tag)).size;

    countUp(document.getElementById('stat-total'),  total);
    countUp(document.getElementById('stat-unique'), unique);
    countUp(document.getElementById('stat-gps'),    gpsCnt);
    countUp(document.getElementById('stat-recipients'), recipientClicks);

    document.getElementById('stat-today').textContent      = `${todayCnt} today`;
    document.getElementById('stat-unique-sub').textContent = returning>0?`${returning} returning`:'all first-time';
    document.getElementById('stat-avgtime').textContent    = fmtDur(avgDur);
    document.getElementById('stat-scroll').textContent     = avgScrl?`${avgScrl}%`:'—';
    document.getElementById('stat-gps-pct').textContent    = unique?`${Math.round(gpsCnt/unique*100)}% of visitors`:'of visitors';

    // Photo Views + Zooms KPIs (shown if photo_events data exists)
    const photoViews = photoRows.filter(r=>r.event_type==='view').length;
    const photoZooms = photoRows.filter(r=>r.event_type==='zoom').length;
    const zoomRate   = photoViews ? Math.round(photoZooms/photoViews*100) : 0;
    const pvEl = document.getElementById('stat-photo-views');
    const pzEl = document.getElementById('stat-photo-zooms');
    const pvCard = document.getElementById('kpi-photo-views');
    const pzCard = document.getElementById('kpi-photo-zooms');
    if (pvCard) pvCard.style.display = photoRows.length ? '' : 'none';
    if (pzCard) pzCard.style.display = photoRows.length ? '' : 'none';
    if (pvEl) countUp(pvEl, photoViews);
    if (pzEl) { countUp(pzEl, photoZooms); }
    const pzSub = document.getElementById('stat-photo-zooms-sub');
    if (pzSub) pzSub.textContent = photoViews ? `${zoomRate}% zoom rate` : '—';

    // ── Visits Over Time ──
    const byDay = {};
    const orderedDays = [];
    rows.forEach(r => {
      const d = new Date(r.visited_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
      if (!byDay[d]) { byDay[d] = 0; orderedDays.push(d); }
      byDay[d]++;
    });
    makeChart('chart-timeline','line', orderedDays, orderedDays.map(k=>byDay[k]));

    // Referrer
    const refs=countBy(rows,'referrer').slice(0,6);
    makeChart('chart-referrer','doughnut',refs.map(r=>r[0]),refs.map(r=>r[1]));

    // Recipients Activity chart — last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const recipRows7   = rows.filter(r => r.recipient_tag && new Date(r.visited_at) >= sevenDaysAgo);
    const recipCard    = document.getElementById('recipients-card');
    const recipBadge   = document.getElementById('recipients-badge');
    const recipToggle  = document.getElementById('recipients-toggle');

    if (recipRows7.length > 0) {
      const recipTagMap = {};
      recipRows7.forEach(r => {
        const t = r.recipient_tag;
        if (!recipTagMap[t]) recipTagMap[t] = { tag: t, count: 0, lastSeen: r.visited_at };
        recipTagMap[t].count++;
        if (r.visited_at > recipTagMap[t].lastSeen) recipTagMap[t].lastSeen = r.visited_at;
      });
      const allRecipCounts = Object.values(recipTagMap)
        .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
        .map(r => [r.tag, r.count]);
      const totalRecip     = allRecipCounts.length;
      recipCard.style.display = '';
      recipBadge.textContent  = `last 7 days · ${totalRecip} recipient${totalRecip !== 1 ? 's' : ''}`;
      recipToggle.style.display = 'none';

      const label = allRecipCounts.map(r => r[0]);
      const vals  = allRecipCounts.map(r => r[1]);
      const bg    = label.map((_, i) => P[i % P.length]);

      const isMobile = window.innerWidth < 768;
      const body = document.getElementById('recipients-chart-body');
      const canvas = document.getElementById('chart-recipients');
      const listEl = document.getElementById('recipients-list');

      if (charts['chart-recipients']) { charts['chart-recipients'].destroy(); }

      if (isMobile) {
        canvas.style.display = 'none';
        listEl.style.display = 'flex';
        body.style.padding = '12px 16px';
        const maxVal = Math.max(...vals, 1);
        listEl.innerHTML = allRecipCounts.map(([tag, count], i) => `
          <div class="rl-row">
            <span class="rl-index">${i + 1}</span>
            <span class="rl-label" title="${tag}">${tag}</span>
            <div class="rl-bar-wrap">
              <div class="rl-bar" style="width:${Math.round((count/maxVal)*100)}%;background:${bg[i % bg.length]}"></div>
            </div>
            <span class="rl-count">${count}</span>
          </div>`).join('');
      } else {
        canvas.style.display = '';
        listEl.style.display = 'none';
        const rotate = totalRecip > 8 ? 90 : 0;
        body.style.height = '';
        body.style.padding = '';
        body.style.paddingBottom = rotate === 90 ? '60px' : '16px';
        if (!canvas) return;
        charts['chart-recipients'] = new Chart(canvas, {
          type: 'bar',
          data: {
            labels: label,
            datasets: [{ data: vals, backgroundColor: bg, borderRadius: 6, borderWidth: 0 }]
          },
          options: {
            responsive: true, maintainAspectRatio: true,
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: '#0f1221', borderColor: 'rgba(255,255,255,0.08)',
                borderWidth: 1, padding: 10, cornerRadius: 8,
                callbacks: { label: c => ` ${c.parsed.y} visit${c.parsed.y !== 1 ? 's' : ''}` }
              }
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { font: { size: totalRecip > 12 ? 9 : 11 }, maxRotation: rotate, minRotation: rotate, autoSkip: false },
              },
              y: { grid: { color: '#f0f2f8' }, beginAtZero: true, ticks: { font: { size: 10 }, stepSize: 1 }, position: 'right' }
            }
          }
        });
      }
    } else {
      recipCard.style.display = 'none';
    }

    // Visit by Hour
    const hours=Array(24).fill(0);
    rows.forEach(r=>{hours[new Date(r.visited_at).getHours()]++;});
    makeChart('chart-hours','bar',Array.from({length:24},(_,i)=>i+':00'),hours);
  }

  // ── Visitors Table ─────────────────────────────────────────
  let expandedSessions = new Set();

  function renderTable(rows) {
    const sortedRows = [...rows].sort((a,b)=>new Date(b.visited_at)-new Date(a.visited_at));
    document.getElementById('visit-count-badge').textContent = sortedRows.length;
    const tbody = document.getElementById('visits-tbody');
    if (!sortedRows.length) {
      tbody.innerHTML='<tr><td colspan="11" class="empty-cell">No visits found in this period.</td></tr>';
      return;
    }

    const sessionMap = new Map();
    sortedRows.forEach(r => {
      if (!sessionMap.has(r.session_id)) sessionMap.set(r.session_id, []);
      sessionMap.get(r.session_id).push(r);
    });

    function srcTag(src) {
      if(src==='whatsapp') return `<span class="tag tag-wa">💬 WA</span>`;
      if(src==='phone')    return `<span class="tag tag-phone">📞 Call</span>`;
      return `<span class="tag tag-none">—</span>`;
    }
    function deviceTag(t) {
      const cls=t==='Mobile'?'tag-mobile':t==='Tablet'?'tag-tablet':'tag-desktop';
      return t?`<span class="tag ${cls}">${t}</span>`:'—';
    }
    function recipTag(tag) {
      if (!tag) return '<span class="tag tag-none">Direct</span>';
      return `<span class="tag tag-recip" title="${tag}">${tag}</span>`;
    }

    let html = '';
    let idx = 0;
    sessionMap.forEach((sessionRows, sessionId) => {
      idx++;
      const latest     = sessionRows[0];
      const count      = sessionRows.length;
      const isExpanded = expandedSessions.has(sessionId);
      const bestSource = sessionRows.find(r=>r.source==='whatsapp')?.source
        || sessionRows.find(r=>r.source==='phone')?.source || 'none';
      const totalDur   = sessionRows.reduce((s,r)=>s+(r.duration_seconds||0),0);
      const maxScroll  = Math.max(...sessionRows.map(r=>r.scroll_depth_pct||0));
      const gpsRow     = sessionRows.find(r=>r.gps_granted);
      const location   = [latest.city, latest.country].filter(Boolean).join(', ') || '—';
      const tag        = sessionRows.map(r=>r.recipient_tag).find(t=>t) || null;

      html += `<tr class="session-row${isExpanded?' session-expanded':''}" data-session="${sessionId}">
        <td class="mono muted">${idx}</td>
        <td class="mono sm">${fmtDate(latest.visited_at, true)}</td>
        <td class="mono accent">${latest.ipv4||'—'}</td>
        <td>${location}</td>
        <td>${deviceTag(latest.device_type)}</td>
        <td>${latest.browser||'—'}</td>
        <td class="mono">${fmtDur(totalDur)}</td>
        <td class="mono">${maxScroll?maxScroll+'%':'—'}</td>
        <td>${srcTag(bestSource)}</td>
        <td>${recipTag(tag)}</td>
        <td>
          ${count>1
            ? `<span class="tag tag-repeat expand-toggle">↩ ${count}× ${isExpanded?'▲':'▼'}</span>`
            : `<span class="tag tag-new">New</span>`}
        </td>
      </tr>`;

      if (isExpanded) {
        const allVisitsHtml = sessionRows.map((r,i) => `
          <div class="detail-visit">
            <div class="dv-num">${i+1}</div>
            <div class="dv-fields">
              <span class="dv-field"><b>⏰</b> ${fmtDate(r.visited_at)}</span>
              <span class="dv-field"><b>🌎</b> ${r.ipv4||'—'}</span>
              <span class="dv-field"><b>📍</b> ${[r.city, r.region, r.country].filter(Boolean).join(', ')||'—'}</span>
              <span class="dv-field"><b>📱</b> ${r.device_type||'—'}</span>
              <span class="dv-field"><b>🌐</b> ${r.browser||'—'}</span>
              <span class="dv-field"><b>⏳</b> ${fmtDur(r.duration_seconds)}</span>
              <span class="dv-field"><b>⬆️</b> ${r.scroll_depth_pct?r.scroll_depth_pct+'%':'—'}</span>
              <span class="dv-field"><b>📞</b> ${r.source||'none'}</span>
              <span class="dv-field"><b>📡</b> ${r.gps_granted?'✅':'—'}${r.gps_lat?` ${r.gps_lat.toFixed(4)},${r.gps_lng.toFixed(4)} ±${r.gps_accuracy}m`:''}</span>
              ${r.recipient_tag?`<span class="dv-field"><b>🏷️</b> ${r.recipient_tag}</span>`:''}
            </div>
          </div>`).join('');

        html += `<tr class="detail-row"><td colspan="11">
          <div class="detail-card">
            <div class="detail-section">
              <div class="detail-grid">
                <div class="detail-col"><div class="dc-label">IPv4</div><div class="dc-value mono">${latest.ipv4||'—'}</div></div>
                <div class="detail-col"><div class="dc-label">IPv6</div><div class="dc-value mono small">${latest.ipv6||'—'}</div></div>
                <div class="detail-col"><div class="dc-label">City</div><div class="dc-value">${latest.city||'—'}</div></div>
                <div class="detail-col"><div class="dc-label">Region</div><div class="dc-value">${latest.region||'—'}</div></div>
                <div class="detail-col"><div class="dc-label">Country</div><div class="dc-value">${latest.country||'—'}</div></div>
                <div class="detail-col"><div class="dc-label">ISP</div><div class="dc-value">${latest.isp||'—'}</div></div>
                <div class="detail-col"><div class="dc-label">OS</div><div class="dc-value">${latest.os||'—'}</div></div>
                <div class="detail-col"><div class="dc-label">Browser</div><div class="dc-value">${latest.browser||'—'}</div></div>
                <div class="detail-col"><div class="dc-label">Screen</div><div class="dc-value mono">${latest.screen_resolution||'—'}</div></div>
                <div class="detail-col"><div class="dc-label">Language</div><div class="dc-value">${latest.language||'—'}</div></div>
                ${tag?`<div class="detail-col detail-col-full"><div class="dc-label">Recipient Tag</div><div class="dc-value" style="color:#4f46e5;font-weight:600">🏷️ ${tag}</div></div>`:''}
                ${gpsRow?`
                <div class="detail-col"><div class="dc-label">GPS Lat/Lng</div><div class="dc-value mono">${gpsRow.gps_lat?.toFixed(5)}, ${gpsRow.gps_lng?.toFixed(5)}</div></div>
                <div class="detail-col"><div class="dc-label">Accuracy</div><div class="dc-value mono">±${gpsRow.gps_accuracy}m</div></div>
                ${gpsRow.gps_lat?`<div class="detail-col detail-col-full"><a class="map-link" href="https://maps.google.com/?q=${gpsRow.gps_lat},${gpsRow.gps_lng}" target="_blank">📍 Open in Google Maps</a></div>`:''}`:``}
                <div class="detail-col"><div class="dc-label">Referrer</div><div class="dc-value">${latest.referrer||'—'}</div></div>
                <div class="detail-col detail-col-full"><div class="dc-label">Page URL</div><div class="dc-value mono small">${latest.page_url||'—'}</div></div>
              </div>
            </div>
            <div class="detail-section">
              <div class="detail-section-title">All ${count} Visit${count>1?'s':''}</div>
              ${allVisitsHtml}
            </div>
          </div>
        </td></tr>`;
      }
    });

    tbody.innerHTML = html;
    tbody.querySelectorAll('.session-row').forEach(row => {
      row.addEventListener('click', () => {
        const sid = row.dataset.session;
        if (expandedSessions.has(sid)) expandedSessions.delete(sid);
        else expandedSessions.add(sid);
        renderTable(rows);
      });
    });
  }

  // ── Recipients Tab ─────────────────────────────────────────
  function renderRecipients(rows) {
    const tbody = document.getElementById('recipients-tbody');
    const tagged = rows.filter(r => r.recipient_tag);
    if (!tagged.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No tagged links clicked yet.</td></tr>';
      return;
    }

    const map = {};
    tagged.forEach(r => {
      const t = r.recipient_tag;
      if (!map[t]) map[t] = { tag:t, visits:[], firstSeen:r.visited_at, lastSeen:r.visited_at };
      map[t].visits.push(r);
      if (r.visited_at < map[t].firstSeen) map[t].firstSeen = r.visited_at;
      if (r.visited_at > map[t].lastSeen)  map[t].lastSeen  = r.visited_at;
    });

    const sorted = Object.values(map).sort((a,b) => new Date(b.lastSeen) - new Date(a.lastSeen));

    tbody.innerHTML = sorted.map((rec, i) => {
      const v         = rec.visits;
      const sessions  = new Set(v.map(r=>r.session_id)).size;
      const maxScroll = Math.max(...v.map(r=>r.scroll_depth_pct||0));
      const totalDur  = v.reduce((s,r)=>s+(r.duration_seconds||0),0);
      const waRow = v.find(r=>r.source==='whatsapp');
      const phRow = v.find(r=>r.source==='phone');
      const src   = waRow ? '<span class="tag tag-wa">💬 WhatsApp</span>'
                  : phRow ? '<span class="tag tag-phone">📞 Phone</span>'
                  : '—';

      return `<tr>
        <td class="mono muted">${i+1}</td>
        <td style="font-weight:600;color:#4f46e5">🏷️ ${rec.tag}</td>
        <td class="mono">${v.length} (${sessions} session${sessions>1?'s':''})</td>
        <td class="mono">${fmtDate(rec.firstSeen, true)}</td>
        <td class="mono">${fmtDate(rec.lastSeen, true)}</td>
        <td class="mono">${maxScroll?maxScroll+'%':'—'} · ${fmtDur(Math.round(totalDur/v.length))}</td>
        <td>${src}</td>
      </tr>`;
    }).join('');
  }

  // ── Devices ────────────────────────────────────────────────
  function renderDevices(rows) {
    makeChart('chart-device',    'doughnut', ...T(countBy(rows,'device_type')));
    makeChart('chart-os',        'doughnut', ...T(countBy(rows,'os')));
    makeChart('chart-browser',   'doughnut', ...T(countBy(rows,'browser')));
    makeChart('chart-resolution','bar',      ...T(countBy(rows,'screen_resolution').slice(0,8)));
  }

  // ── Geo ────────────────────────────────────────────────────
  function renderGeo(rows) {
    makeChart('chart-country','bar',...T(countBy(rows,'country').slice(0,8)));
    makeChart('chart-city',   'bar',...T(countBy(rows,'city').slice(0,8)));
    const total=rows.length||1;
    document.getElementById('isp-tbody').innerHTML=countBy(rows,'isp').map(([n,c])=>`
      <tr>
        <td>${n}</td>
        <td style="font-family:var(--mono)">${c}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="height:5px;width:${Math.round(c/total*100)}%;max-width:100px;background:#4f46e5;border-radius:3px;min-width:3px"></div>
            <span style="color:var(--muted);font-family:var(--mono);font-size:11px">${Math.round(c/total*100)}%</span>
          </div>
        </td>
      </tr>`).join('');
  }

  // ── Gallery ────────────────────────────────────────────────
  function renderGallery(photoRows) {
    if (!photoRows || !photoRows.length) {
      const el = document.getElementById('gallery-empty');
      if (el) el.style.display = '';
      const content = document.getElementById('gallery-content');
      if (content) content.style.display = 'none';
      return;
    }

    const emptyEl = document.getElementById('gallery-empty');
    if (emptyEl) emptyEl.style.display = 'none';
    const content = document.getElementById('gallery-content');
    if (content) content.style.display = '';

    const views      = photoRows.filter(r => r.event_type === 'view');
    const lbOpens    = photoRows.filter(r => r.event_type === 'lightbox_open');
    const zooms      = photoRows.filter(r => r.event_type === 'zoom');
    const downloads  = photoRows.filter(r => r.event_type === 'download_attempt');
    const viewEnds   = photoRows.filter(r => r.event_type === 'view_end');
    const avgViewDur = viewEnds.length
      ? Math.round(viewEnds.reduce((s,r) => s + (r.duration_seconds||0), 0) / viewEnds.length)
      : 0;
    const uniqueViewers = new Set(views.map(r => r.session_id)).size;

    countUp(document.getElementById('stat-gl-views'),    views.length);
    countUp(document.getElementById('stat-gl-lb'),       lbOpens.length);
    countUp(document.getElementById('stat-gl-zooms'),    zooms.length);
    countUp(document.getElementById('stat-gl-downloads'),downloads.length);
    const durEl = document.getElementById('stat-gl-avgdur');
    if (durEl) durEl.textContent = fmtDur(avgViewDur);
    countUp(document.getElementById('stat-gl-unique'), uniqueViewers);

    // ── Per-photo table ──
    const photoMap = {};
    photoRows.forEach(r => {
      const name = r.photo_name || 'unknown';
      if (!photoMap[name]) photoMap[name] = { name, index: r.photo_index, views:0, viewEndDurs:[], lbOpens:0, zooms:0, downloads:0 };
      if (r.event_type === 'view')              photoMap[name].views++;
      if (r.event_type === 'view_end')          photoMap[name].viewEndDurs.push(r.duration_seconds||0);
      if (r.event_type === 'lightbox_open')     photoMap[name].lbOpens++;
      if (r.event_type === 'zoom')              photoMap[name].zooms++;
      if (r.event_type === 'download_attempt')  photoMap[name].downloads++;
    });

    const photoList = Object.values(photoMap).sort((a,b) => (a.index||0) - (b.index||0));
    const photoTbody = document.getElementById('gallery-photo-tbody');
    if (photoTbody) {
      photoTbody.innerHTML = photoList.map((p, i) => {
        const avgDur = p.viewEndDurs.length
          ? Math.round(p.viewEndDurs.reduce((s,d)=>s+d,0)/p.viewEndDurs.length)
          : 0;
        return `<tr>
          <td class="mono muted">${i+1}</td>
          <td style="font-weight:600;color:#4f46e5">${p.name}</td>
          <td class="mono">${p.views}</td>
          <td class="mono">${fmtDur(avgDur)}</td>
          <td class="mono">${p.lbOpens}</td>
          <td class="mono">${p.zooms}</td>
          <td class="mono">${p.downloads || '—'}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="empty-cell">No photo events yet.</td></tr>';
    }

    // ── Photo Views Over Time (last 7 days) ──
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const recentViews  = views.filter(r => new Date(r.visited_at) >= sevenDaysAgo);
    const byDay = {}; const orderedDays = [];
    recentViews.forEach(r => {
      const d = new Date(r.visited_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
      if (!byDay[d]) { byDay[d] = 0; orderedDays.push(d); }
      byDay[d]++;
    });
    makeChart('chart-gl-timeline', 'line', orderedDays, orderedDays.map(k => byDay[k]));

    // ── Views per Photo (bar) ──
    const byPhoto = photoList.map(p => [p.name, p.views]);
    makeChart('chart-gl-photos', 'bar', byPhoto.map(x=>x[0]), byPhoto.map(x=>x[1]));
  }

  // ── Load ───────────────────────────────────────────────────
  let allRows=[], allPhotoRows=[];
  async function loadData() {
    const period=document.getElementById('date-filter').value;
    document.getElementById('visits-tbody').innerHTML=
      '<tr><td colspan="11" class="empty-cell">⏳ Loading…</td></tr>';
    try {
      [allRows, allPhotoRows] = await Promise.all([
        fetchVisits(period),
        fetchPhotoEvents(period),
      ]);
      expandedSessions.clear();
      renderOverview(allRows, allPhotoRows);
      renderTable(allRows);
      renderRecipients(allRows);
      renderDevices(allRows);
      renderGeo(allRows);
      renderGallery(allPhotoRows);
      document.getElementById('last-updated').textContent=
        new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    } catch(e) {
      document.getElementById('visits-tbody').innerHTML=
        `<tr><td colspan="11" class="empty-cell" style="color:#e11d48">
          <strong>${e.message}</strong><br>
          <small style="color:var(--muted)">Try switching to WiFi or 4G and refresh.</small>
        </td></tr>`;
    }
  }

  // ── Search ─────────────────────────────────────────────────
  document.getElementById('search-input').addEventListener('input',function(){
    const q=this.value.toLowerCase();
    renderTable(allRows.filter(r=>
      ['ipv4','ipv6','city','browser','os','country','isp','device_type','referrer','source','recipient_tag']
        .some(k=>(r[k]||'').toLowerCase().includes(q))
    ));
  });

  // ── Nav ────────────────────────────────────────────────────
  const subtitles={
    overview:'Performance summary',
    visitors:'All visitors — click any row to expand',
    recipients:'Track who clicked your shared links',
    devices:'Device & browser breakdown',
    geo:'Location & ISP data',
    gallery:'Photo gallery engagement'
  };
  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click',e=>{
      e.preventDefault();
      const sec=item.dataset.section;
      document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(`section-${sec}`).classList.add('active');
      document.getElementById('section-title').textContent=item.textContent.trim();
      document.getElementById('section-sub').textContent=subtitles[sec]||'';
      if(allRows.length){
        if(sec==='devices')    renderDevices(allRows);
        if(sec==='geo')        renderGeo(allRows);
        if(sec==='recipients') renderRecipients(allRows);
      }
      if(sec==='gallery') renderGallery(allPhotoRows);
    });
  });

  document.getElementById('refresh-btn').addEventListener('click',loadData);
  document.getElementById('date-filter').addEventListener('change',loadData);

  checkAccess();
  window.addEventListener('hashchange',checkAccess);
} // end initAdmin
