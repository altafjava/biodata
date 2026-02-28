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
  waitForChart(function() {
    initAdmin(cfg);
  });
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

  // ── Fetch with timeout + IPv6 retry via proxy ───────────────
  function abortFetch(url, opts, ms) {
    const controller = window.AbortController ? new AbortController() : null;
    const timer = controller ? setTimeout(function() { controller.abort(); }, ms) : null;
    const fetchOpts = controller ? Object.assign({}, opts, { signal: controller.signal }) : opts;
    return fetch(url, fetchOpts).finally(function() { if (timer) clearTimeout(timer); });
  }

  // Tries direct fetch first (8s), then falls back to corsproxy.io (for IPv6-only devices)
  async function robustFetch(url, opts) {
    try {
      const res = await abortFetch(url, opts, 8000);
      return res;
    } catch (e1) {
      // Direct failed (likely IPv6 timeout) — try CORS proxy as fallback
      console.warn('[Analytics] Direct fetch failed, trying proxy fallback:', e1.message);
      const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
      // Proxy doesn't forward custom headers well, so we embed key in URL for GET only
      // For Supabase, we can pass apikey as query param
      const proxyUrlWithKey = proxyUrl.replace(
        encodeURIComponent(SUPABASE_URL),
        encodeURIComponent(SUPABASE_URL)
      );
      try {
        const res2 = await abortFetch(proxyUrlWithKey, {}, 12000);
        return res2;
      } catch (e2) {
        throw new Error('Direct: ' + e1.message + ' | Proxy: ' + e2.message);
      }
    }
  }

  // Supabase-specific fetch: direct with key headers, proxy fallback strips headers so use apikey param
  async function supabaseFetch(path, opts) {
    const fullUrl = SUPABASE_URL + path;
    const headers = Object.assign({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }, (opts && opts.headers) || {});

    // Try 1: Direct
    try {
      const res = await abortFetch(fullUrl, Object.assign({}, opts, { headers }), 9000);
      return res;
    } catch (e1) {
      console.warn('[Analytics] Supabase direct failed (' + e1.message + '), trying proxy...');
    }

    // Try 2: corsproxy.io (works on IPv6-only networks since proxy has IPv4)
    try {
      const proxied = 'https://corsproxy.io/?' + encodeURIComponent(fullUrl);
      const res = await abortFetch(proxied, Object.assign({}, opts, { headers }), 12000);
      return res;
    } catch (e2) {
      console.warn('[Analytics] corsproxy.io failed (' + e2.message + '), trying allorigins...');
    }

    // Try 3: api.allorigins.win (second proxy fallback, GET only)
    if (!opts || !opts.method || opts.method === 'GET') {
      try {
        const proxied2 = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(fullUrl);
        const res = await abortFetch(proxied2, {}, 12000);
        return res;
      } catch (e3) {
        throw new Error('All fetch attempts failed. IPv6 network cannot reach Supabase.');
      }
    }

    throw new Error('All fetch attempts failed. IPv6 network cannot reach Supabase.');
  }

  async function fetchVisits(period) {
    let path = `/rest/v1/${TABLE_NAME}?select=*&order=visited_at.desc`;
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

  function makeChart(id, type, labels, data) {
    if(charts[id]) charts[id].destroy();
    const ctx=document.getElementById(id);
    if(!ctx) return;
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
      options:{
        responsive:true, maintainAspectRatio:true,
        plugins:{
          legend:{
            display:type!=='line'&&type!=='bar',
            position:'right',
            labels:{
              boxWidth:10, padding:14,
              font:{size:11},
              generateLabels: function(chart) {
                const data = chart.data;
                return data.labels.map((label, i) => ({
                  text: `${label}  (${data.datasets[0].data[i]})`,
                  fillStyle: Array.isArray(data.datasets[0].backgroundColor)
                    ? data.datasets[0].backgroundColor[i]
                    : data.datasets[0].backgroundColor,
                  hidden: false,
                  index: i,
                }));
              }
            }
          },
          tooltip:{
            backgroundColor:'#0f1221',
            borderColor:'rgba(255,255,255,0.08)',
            borderWidth:1, padding:12, cornerRadius:10,
            titleFont:{size:12,weight:'600'},
            bodyFont:{size:11},
          }
        },
        scales:type==='line'||type==='bar'?{
          x:{grid:{color:'#f0f2f8'},ticks:{maxTicksLimit:10,font:{size:10}}},
          y:{grid:{color:'#f0f2f8'},beginAtZero:true,ticks:{font:{size:10}}}
        }:{},
      }
    });
  }

  // ── Overview ───────────────────────────────────────────────
  function renderOverview(rows) {
    const total     = rows.length;
    const sessions  = new Set(rows.map(r=>r.session_id));
    const unique    = sessions.size;
    const returning = [...sessions].filter(s=>rows.filter(r=>r.session_id===s).length>1).length;
    const waCnt     = rows.filter(r=>r.source==='whatsapp').length;
    const phCnt     = rows.filter(r=>r.source==='phone').length;
    const contacted = waCnt + phCnt;
    const durs      = rows.map(r=>r.duration_seconds).filter(d=>d>0);
    const avgDur    = durs.length?Math.round(durs.reduce((a,b)=>a+b,0)/durs.length):0;
    const scrls     = rows.map(r=>r.scroll_depth_pct).filter(s=>s>0);
    const avgScrl   = scrls.length?Math.round(scrls.reduce((a,b)=>a+b,0)/scrls.length):0;
    const todayCnt  = rows.filter(r=>new Date(r.visited_at).toDateString()===new Date().toDateString()).length;
    const convRate  = unique?Math.round(contacted/unique*100):0;
    const gpsCnt    = rows.filter(r=>r.gps_granted).length;

    countUp(document.getElementById('stat-total'),  total);
    countUp(document.getElementById('stat-unique'), unique);
    countUp(document.getElementById('stat-wa'),     waCnt);
    countUp(document.getElementById('stat-phone'),  phCnt);
    countUp(document.getElementById('stat-gps'),    gpsCnt);

    document.getElementById('stat-today').textContent      = `${todayCnt} today`;
    document.getElementById('stat-unique-sub').textContent = returning>0?`${returning} returning`:'all first-time';
    document.getElementById('stat-avgtime').textContent    = fmtDur(avgDur);
    document.getElementById('stat-scroll').textContent     = avgScrl?`${avgScrl}%`:'—';
    document.getElementById('stat-gps-pct').textContent    = unique?`${Math.round(gpsCnt/unique*100)}% of visitors`:'of visitors';
    document.getElementById('cb-rate').textContent         = `${convRate}%`;
    const cbRate2 = document.getElementById('cb-rate2');
    if(cbRate2) cbRate2.textContent = `${convRate}%`;

    const byDay={};
    rows.forEach(r=>{
      const d=new Date(r.visited_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
      byDay[d]=(byDay[d]||0)+1;
    });
    const days=Object.keys(byDay);
    makeChart('chart-timeline','line',days,days.map(k=>byDay[k]));

    const refs=countBy(rows,'referrer').slice(0,6);
    makeChart('chart-referrer','doughnut',refs.map(r=>r[0]),refs.map(r=>r[1]));

    const srcData=[['WhatsApp',waCnt],['Phone',phCnt],['No contact',total-waCnt-phCnt]].filter(s=>s[1]>0);
    makeChart('chart-source','doughnut',srcData.map(s=>s[0]),srcData.map(s=>s[1]));

    const hours=Array(24).fill(0);
    rows.forEach(r=>{hours[new Date(r.visited_at).getHours()]++;});
    makeChart('chart-hours','bar',Array.from({length:24},(_,i)=>i+':00'),hours);
  }

  // ── Visitors Table ─────────────────────────────────────────
  let expandedSessions = new Set();

  function renderTable(rows) {
    document.getElementById('visit-count-badge').textContent = rows.length;
    const tbody = document.getElementById('visits-tbody');
    if (!rows.length) {
      tbody.innerHTML='<tr><td colspan="10" class="empty-cell">No visits found in this period.</td></tr>';
      return;
    }

    const sessionMap = new Map();
    rows.forEach(r => {
      if (!sessionMap.has(r.session_id)) sessionMap.set(r.session_id, []);
      sessionMap.get(r.session_id).push(r);
    });

    function srcTag(src) {
      if(src==='whatsapp') return `<span class="tag tag-wa">💬 WhatsApp</span>`;
      if(src==='phone')    return `<span class="tag tag-phone">📞 Phone</span>`;
      return `<span class="tag tag-none">—</span>`;
    }
    function deviceTag(t) {
      const cls=t==='Mobile'?'tag-mobile':t==='Tablet'?'tag-tablet':'tag-desktop';
      return t?`<span class="tag ${cls}">${t}</span>`:'—';
    }

    let html = '';
    let idx = 0;
    sessionMap.forEach((sessionRows, sessionId) => {
      idx++;
      const latest   = sessionRows[0];
      const count    = sessionRows.length;
      const isExpanded = expandedSessions.has(sessionId);

      const bestSource = sessionRows.find(r=>r.source==='whatsapp')?.source
        || sessionRows.find(r=>r.source==='phone')?.source || 'none';
      const totalDur  = sessionRows.reduce((s,r)=>s+(r.duration_seconds||0),0);
      const maxScroll = Math.max(...sessionRows.map(r=>r.scroll_depth_pct||0));
      const gpsRow    = sessionRows.find(r=>r.gps_granted);
      const location  = [latest.city, latest.country].filter(Boolean).join(', ') || '—';

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
              <span class="dv-field"><b>Time</b> ${fmtDate(r.visited_at)}</span>
              <span class="dv-field"><b>Duration</b> ${fmtDur(r.duration_seconds)}</span>
              <span class="dv-field"><b>Scroll</b> ${r.scroll_depth_pct?r.scroll_depth_pct+'%':'—'}</span>
              <span class="dv-field"><b>Source</b> ${r.source||'none'}</span>
              <span class="dv-field"><b>GPS</b> ${r.gps_granted?'✅ Granted':'—'}</span>
              ${r.gps_lat?`<span class="dv-field"><b>GPS Coords</b> ${r.gps_lat.toFixed(5)}, ${r.gps_lng.toFixed(5)}</span>`:''}
              ${r.gps_accuracy?`<span class="dv-field"><b>Accuracy</b> ±${r.gps_accuracy}m</span>`:''}
            </div>
          </div>`).join('');

        html += `<tr class="detail-row">
          <td colspan="10">
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
                  <div class="detail-col"><div class="dc-label">Language</div><div class="dc-value">${latest.language||'—'}</div></div>
                  <div class="detail-col"><div class="dc-label">Screen</div><div class="dc-value mono">${latest.screen_resolution||'—'}</div></div>
                  <div class="detail-col"><div class="dc-label">Timezone</div><div class="dc-value">${latest.timezone||'—'}</div></div>
                  ${gpsRow ? `
                  <div class="detail-col"><div class="dc-label">GPS Lat/Lng</div><div class="dc-value mono">${gpsRow.gps_lat?.toFixed(5)}, ${gpsRow.gps_lng?.toFixed(5)}</div></div>
                  <div class="detail-col"><div class="dc-label">GPS Accuracy</div><div class="dc-value mono">±${gpsRow.gps_accuracy}m</div></div>
                  ${gpsRow.gps_lat ? `<div class="detail-col detail-col-full"><a class="map-link" href="https://maps.google.com/?q=${gpsRow.gps_lat},${gpsRow.gps_lng}" target="_blank">📍 Open in Google Maps</a></div>` : ''}` : ''}
                  <div class="detail-col"><div class="dc-label">Referrer</div><div class="dc-value">${latest.referrer||'—'}</div></div>
                  <div class="detail-col detail-col-full"><div class="dc-label">Page URL</div><div class="dc-value mono small">${latest.page_url||'—'}</div></div>
                </div>
              </div>
              <div class="detail-section">
                <div class="detail-section-title">All ${count} Visit${count>1?'s':''}</div>
                ${allVisitsHtml}
              </div>
            </div>
          </td>
        </tr>`;
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

  // ── Load ───────────────────────────────────────────────────
  let allRows=[];
  async function loadData() {
    const period=document.getElementById('date-filter').value;
    document.getElementById('visits-tbody').innerHTML=
      '<tr><td colspan="10" class="empty-cell">⏳ Loading… (may take a few seconds on mobile networks)</td></tr>';
    try {
      allRows=await fetchVisits(period);
      expandedSessions.clear();
      renderOverview(allRows);
      renderTable(allRows);
      renderDevices(allRows);
      renderGeo(allRows);
      document.getElementById('last-updated').textContent=
        new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    } catch(e) {
      document.getElementById('visits-tbody').innerHTML=
        `<tr><td colspan="10" class="empty-cell" style="color:#e11d48">
          <strong>${e.message}</strong><br>
          <small style="color:var(--muted)">
            IPv6-only networks (Jio/Airtel 5G) may not reach Supabase.<br>
            Try switching to WiFi or 4G and refresh.
          </small>
        </td></tr>`;
    }
  }

  // ── Search ─────────────────────────────────────────────────
  document.getElementById('search-input').addEventListener('input',function(){
    const q=this.value.toLowerCase();
    renderTable(allRows.filter(r=>
      ['ipv4','ipv6','city','browser','os','country','isp','device_type','referrer','source']
        .some(k=>(r[k]||'').toLowerCase().includes(q))
    ));
  });

  // ── Nav ────────────────────────────────────────────────────
  const subtitles={
    overview:'Performance summary',
    visitors:'Unique visitors — click any row to expand all visits',
    devices:'Device & browser breakdown',
    geo:'Location & ISP data'
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
        if(sec==='devices') renderDevices(allRows);
        if(sec==='geo')     renderGeo(allRows);
      }
    });
  });

  document.getElementById('refresh-btn').addEventListener('click',loadData);
  document.getElementById('date-filter').addEventListener('change',loadData);

  checkAccess();
  window.addEventListener('hashchange',checkAccess);
} // end initAdmin
