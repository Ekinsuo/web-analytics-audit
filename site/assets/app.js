(function () {
  'use strict';
  var REPO = 'Ekinsuo/web-analytics-audit';
  var RAW = 'https://raw.githubusercontent.com/' + REPO + '/reports/reports/';
  var E = window.AuditEngine;
  var current = null;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
  var STATUS_TR = { pass: 'Pass', fail: 'Fail', warn: 'Partial', na: 'Not verifiable' };
  var MODE_TR = { live: 'Live scan (GitHub Actions)', har: 'HAR analysis (in browser)' };

  $('#repoLink').href = 'https://github.com/' + REPO;

  // ---------- Tabs
  $$('.tab').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.tab').forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      $$('.panel').forEach(function (p) { p.hidden = p.dataset.panel !== b.dataset.tab; });
      if (b.dataset.tab === 'open') loadRecent();
    });
  });
  function selectTab(name) { var b = $('.tab[data-tab="' + name + '"]'); if (b) b.click(); }

  // ---------- Check catalogue
  $('#catalog').innerHTML = E.CATALOG.map(function (c) {
    return '<div class="card"><h4>' + esc(c.area) + '</h4><ul>' + c.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>';
  }).join('');

  // ---------- Live scan → GitHub issue form
  function normUrl(u) { u = (u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; try { return new URL(u).toString(); } catch (e) { return ''; } }
  $('#liveForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var url = normUrl($('#lUrl').value);
    if (!url) { toast('Enter a valid URL'); return; }
    var host = new URL(url).hostname;
    var q = new URLSearchParams({
      template: 'audit.yml', title: '[Audit] ' + host, url: url,
      sector: $('#lSector').value, currency: ($('#lCur').value || 'TRY').toUpperCase(),
      product_url: normUrl($('#lProduct').value), cart_url: normUrl($('#lCart').value), checkout_url: normUrl($('#lCheckout').value)
    });
    window.open('https://github.com/' + REPO + '/issues/new?' + q.toString(), '_blank', 'noopener');
    toast('Request opened on GitHub — remember to click Submit');
  });

  // ---------- HAR
  var files = { main: null, reject: null };
  function setupDrop(el, key) {
    var input = $('input', el);
    el.addEventListener('click', function () { input.click(); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', function () { el.classList.remove('over'); });
    el.addEventListener('drop', function (e) { e.preventDefault(); el.classList.remove('over'); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); });
    input.addEventListener('change', function () { if (input.files[0]) take(input.files[0]); });
    function take(f) {
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var j = JSON.parse(rd.result);
          if (!(j.log && j.log.entries)) throw new Error('not a HAR file');
          files[key] = j;
          $('.fname', el).textContent = f.name + ' · ' + j.log.entries.length + ' requests';
          if (key === 'main' && !$('#hUrl').value) {
            var page = (j.log.pages && j.log.pages[0] && j.log.pages[0].title) || '';
            var first = j.log.entries.filter(function (e) { return e._resourceType === 'document'; })[0] || j.log.entries[0];
            $('#hUrl').value = /^https?:/.test(page) ? page : (first ? first.request.url : '');
          }
        } catch (err) { files[key] = null; $('.fname', el).textContent = ''; toast('Could not read file: ' + err.message); }
      };
      rd.readAsText(f);
    }
  }
  setupDrop($('#dropMain'), 'main');
  setupDrop($('#dropReject'), 'reject');
  $('#copySnippet').addEventListener('click', function () {
    navigator.clipboard.writeText($('#dlSnippet').textContent).then(function () { toast('Copied — paste it into your site console'); });
  });
  function parseDL(text) {
    text = (text || '').trim();
    if (!text) return [];
    var out = [];
    try { var j = JSON.parse(text); return Array.isArray(j) ? j : [j]; } catch (e) { /* multiple */ }
    try { var many = JSON.parse('[' + text.replace(/\]\s*,?\s*\[/g, '],[') + ']'); many.forEach(function (a) { out = out.concat(Array.isArray(a) ? a : [a]); }); return out; } catch (e) { throw new Error('Could not parse the dataLayer JSON'); }
  }
  $('#harForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!files.main) { toast('Upload the funnel HAR file first'); return; }
    var dl;
    try { dl = parseDL($('#hDl').value); } catch (e) { toast(e.message); return; }
    var m = E.fromHAR(files.main, 'har');
    var input = {
      meta: { url: normUrl($('#hUrl').value) || m.pageUrl, sector: $('#hSector').value, currency: ($('#hCur').value || '').toUpperCase(), mode: 'har', scannedAt: new Date().toISOString(), notes: [] },
      phases: { har: { requests: m.requests, cookies: m.cookies } }, dataLayer: dl, html: m.html, cmp: {}
    };
    if (!m.cookies.length) input.meta.notes.push('The HAR contains no cookie data (sanitized export). Export "with sensitive data" for cookie checks.');
    if (!dl.length) input.meta.notes.push('No dataLayer uploaded; DataLayer checks were skipped.');
    if (files.reject) { var r = E.fromHAR(files.reject, 'har_reject'); input.phases.har_reject = { requests: r.requests, cookies: r.cookies.length ? r.cookies : undefined }; input.cmp.rejectClicked = true; }
    else input.meta.notes.push('No "after reject" HAR uploaded; the CMP reject test was skipped.');
    show(input, null);
  });

  // ---------- Report loading
  $('#openForm').addEventListener('submit', function (ev) { ev.preventDefault(); var id = $('#oId').value.trim().replace(/^#/, ''); if (id) openReport(id); });
  $('#demoBtn').addEventListener('click', function () { loadCapture('demo/capture.json', 'demo'); });

  function loadCapture(url, id) {
    var rep = $('#report'); rep.hidden = false;
    rep.innerHTML = '<div class="card" style="padding:24px"><span class="spinner"></span> Loading report…</div>';
    rep.scrollIntoView({ behavior: 'smooth' });
    return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status === 404 ? 'Report not ready or not found (the scan may still be running — try again in 1–2 minutes).' : 'HTTP ' + r.status); return r.json(); })
      .then(function (cap) { show(cap, id); })
      .catch(function (e) { rep.innerHTML = '<div class="card" style="padding:24px"><b class="bad">Could not open the report.</b> <span class="hint">' + esc(e.message) + '</span></div>'; });
  }
  function openReport(id) {
    if (!/^[\w-]{1,40}$/.test(id)) { toast('Invalid report ID'); return; }
    history.replaceState(null, '', '?id=' + encodeURIComponent(id));
    loadCapture(RAW + encodeURIComponent(id) + '.json', id);
  }
  function loadRecent() {
    var ul = $('#recent');
    fetch(RAW + 'index.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (list) {
      if (!list.length) { ul.innerHTML = '<li class="hint">No audits yet.</li>'; return; }
      ul.innerHTML = list.slice(0, 15).map(function (x) {
        return '<li><a href="?id=' + encodeURIComponent(x.id) + '">' + esc(x.url) + '</a><span class="hint">#' + esc(x.id) + ' · ' + esc((x.date || '').slice(0, 10)) + ' · score ' + esc(x.score) + '</span></li>';
      }).join('');
    }).catch(function () { ul.innerHTML = '<li class="hint">No audits yet.</li>'; });
  }

  // ---------- Report rendering
  function sevBadge(s) { return s ? '<span class="sev sev' + s + '" title="Severity ' + s + '">' + s + '</span>' : ''; }
  function chips(c) { return '<span class="chip c-pass">' + c.pass + ' pass</span><span class="chip c-fail">' + c.fail + ' fail</span><span class="chip c-warn">' + c.warn + ' partial</span><span class="chip c-na">' + c.na + ' not verifiable</span>'; }
  function scoreRing(s) {
    var col = s >= 80 ? 'var(--green)' : s >= 60 ? 'var(--amber)' : 'var(--red)';
    var c = 2 * Math.PI * 40;
    return '<div class="score"><svg width="92" height="92"><circle cx="46" cy="46" r="40" stroke="var(--grey-bg)" stroke-width="8" fill="none"/><circle cx="46" cy="46" r="40" stroke="' + col + '" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="' + (c * s / 100) + ' ' + c + '"/></svg><span>' + s + '</span></div>';
  }

  function componentTable(p) {
    return '<div class="band"><div class="bandlabel">' + esc(p.name) + '</div><div class="tblwrap"><table><thead><tr><th>Component</th><th>Status</th><th>Detection</th><th>Risk / Gap</th><th>Recommendation</th></tr></thead><tbody>' +
      p.components.map(function (c) {
        return '<tr><td><b>' + esc(c.component) + '</b></td><td class="st st-' + esc(c.status) + '">' + esc(c.status) + '</td><td class="val">' + esc(c.detection) + '</td><td class="' + (c.risk !== '—' ? 'bad' : '') + '">' + esc(c.risk) + '</td><td>' + esc(c.recommendation) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  function errorTable(p) {
    if (!p.errors.length) return '<div class="tblwrap"><div class="empty">✓ No errors found on this platform.</div></div>';
    var rows = '';
    p.errors.forEach(function (g) {
      g.rows.forEach(function (r, i) {
        rows += '<tr>' + (i === 0 ? '<td class="ev" rowspan="' + g.rows.length + '">' + esc(g.event) + '</td>' : '') +
          '<td>' + esc(r.description) + '</td><td style="text-align:center">' + sevBadge(r.severity) + '</td><td class="val bad">' + esc(r.wrong) + '</td><td class="val good">' + esc(r.expected) + '</td><td>' + esc(r.impact) + '</td></tr>';
      });
    });
    return '<div class="band"><div class="bandlabel">' + esc(p.name) + '</div><div class="tblwrap"><table><thead><tr><th>Event Name</th><th>Error Description</th><th>Severity</th><th>Observed (Wrong) Value</th><th>Expected Value</th><th>Impact</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function passTable(p) {
    var ps = p.checks.filter(function (c) { return c.status === 'pass'; });
    if (!ps.length) return '<div class="tblwrap"><div class="empty" style="color:var(--muted)">No passing checks.</div></div>';
    return '<div class="band"><div class="bandlabel green">Passed</div><div class="tblwrap"><table><thead><tr><th>Event Name</th><th>Check</th><th>Result</th><th>Observed (correct) value</th><th>Expected</th></tr></thead><tbody>' +
      ps.map(function (c) { return '<tr><td><b>' + esc(c.event) + '</b></td><td>' + esc(c.title) + '</td><td class="st st-pass">✓ Pass</td><td class="val good">' + esc(c.observed) + '</td><td class="val">' + esc(c.expected) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
  }
  function allChecks(p) {
    return '<div class="filter" data-key="' + p.key + '"><button class="on" data-f="all">All (' + p.checks.length + ')</button><button data-f="fail">Fail</button><button data-f="warn">Partial</button><button data-f="pass">Pass</button><button data-f="na">Not verifiable</button></div>' +
      '<div class="tblwrap"><table><thead><tr><th>Component</th><th>Event</th><th>What was checked</th><th>Result</th><th>Severity</th><th>Observed</th><th>Expected</th></tr></thead><tbody>' +
      p.checks.map(function (c) { return '<tr data-s="' + c.status + '"><td>' + esc(c.component) + '</td><td><b>' + esc(c.event) + '</b></td><td>' + esc(c.title) + '</td><td class="st st-' + c.status + '">' + STATUS_TR[c.status] + '</td><td>' + sevBadge(c.severity) + '</td><td class="val' + (c.status === 'fail' ? ' bad' : '') + '">' + esc(c.observed) + '</td><td class="val">' + esc(c.expected) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }

  function show(input, id) {
    var R;
    try { R = E.run(input); } catch (e) { console.error(e); toast('Analysis error: ' + e.message); return; }
    current = { R: R, input: input, id: id };
    var rep = $('#report'); rep.hidden = false;
    var t = R.totals;
    var html = '';
    html += '<div class="card"><div class="rhead">' + scoreRing(R.score) + '<div><div class="hint">Audit report' + (id ? ' · #' + esc(id) : '') + (id === 'demo' ? ' · <b>Sample (synthetic test store)</b>' : '') + '</div><h2>' + esc(R.meta.url || 'Site') + '</h2><div class="hint">' + esc(MODE_TR[R.meta.mode] || R.meta.mode) + ' · ' + esc((R.meta.scannedAt || R.generatedAt).slice(0, 16).replace('T', ' ')) + ' · ' + esc(R.meta.requestCount) + ' requests · business model: ' + esc(R.meta.sector) + (R.meta.currency ? ' · ' + esc(R.meta.currency) : '') + '</div></div>' +
      '<div class="kpis"><div class="kpi crit"><b>' + t.critical + '</b><small>Critical (severity 1)</small></div><div class="kpi fail"><b>' + t.fail + '</b><small>Fail</small></div><div class="kpi warn"><b>' + t.warn + '</b><small>Partial</small></div><div class="kpi pass"><b>' + t.pass + '</b><small>Pass</small></div><div class="kpi"><b>' + t.na + '</b><small>Not verifiable</small></div></div></div>' +
      '<div class="actions"><button class="btn" id="xlsxBtn">⬇ Download Excel report</button><button class="btn secondary" id="jsonBtn">Raw data (JSON)</button><button class="btn secondary" id="printBtn">Print / PDF</button><button class="btn secondary" id="expandBtn">Expand all</button>' + (id && id !== 'demo' ? '<button class="btn secondary" id="shareBtn">Copy link</button>' : '') + '</div></div>';

    if (R.meta.notes && R.meta.notes.length) html += '<div class="section"><div class="note"><b>Scan notes</b><ul class="notes">' + R.meta.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div></div>';

    html += '<div class="section"><h3>Platform inventory</h3><div class="inv">' + R.inventory.map(function (i) {
      return '<div class="' + (i.detected ? 'on' : 'off') + '"><b>' + esc(i.platform) + '</b><span class="st ' + (i.detected ? 'st-pass' : 'st-na') + '" style="font-size:12px">' + (i.detected ? 'Installed' : 'Not installed') + '</span><br><small>' + esc((i.ids || []).join(', ')) + '</small></div>';
    }).join('') + '</div></div>';

    html += '<div class="section"><h3>Audit by platform</h3>';
    R.platforms.forEach(function (p) {
      var open = p.counts.fail > 0;
      html += '<details class="card plat" id="p-' + p.key + '"' + (open ? ' open' : '') + '><summary><h3>' + esc(p.name) + '</h3><div class="chips">' + chips(p.counts) + '</div></summary><div class="pbody">' +
        '<h4>Component status</h4>' + componentTable(p) +
        '<h4>Error table <span class="hint" style="text-transform:none;letter-spacing:0">— grouped by event, sorted by severity</span></h4>' + errorTable(p) +
        '<h4>Checks that passed</h4>' + passTable(p) +
        '<details style="margin-top:16px"><summary style="cursor:pointer;font-weight:600">All checks performed (' + p.checks.length + ')</summary><div style="margin-top:10px">' + allChecks(p) + '</div></details>' +
        '</div></details>';
    });
    html += '</div>';

    // Mapping + recommendations
    var rec = R.recommendations;
    html += '<div class="section card" style="padding:20px"><h3>Event mapping reference</h3><div class="tblwrap"><table><thead><tr><th>GA4</th><th>Meta</th><th>TikTok</th><th>Google Ads</th></tr></thead><tbody>' +
      R.mapping.map(function (m) { return '<tr>' + m.map(function (v) { return '<td class="val">' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></div>';
    html += '<div class="section card" style="padding:20px"><h3>Domain-specific DataLayer plan + GA4 event structure (online + offline)</h3><div class="tblwrap"><table><thead><tr><th>Stage</th><th>Channel</th><th>GA4 Event</th><th>Trigger</th><th>Key Parameters</th><th>Example Value</th></tr></thead><tbody>' +
      rec.funnel.map(function (f) { return '<tr><td><b>' + esc(f[0]) + '</b></td><td class="st ' + (f[1] === 'Offline' ? 'st-warn' : 'st-pass') + '">' + esc(f[1]) + '</td><td class="val"><b>' + esc(f[2]) + '</b></td><td>' + esc(f[3]) + '</td><td class="val">' + esc(f[4]) + '</td><td class="val">' + esc(f[5]) + '</td></tr>'; }).join('') +
      '</tbody></table></div><div class="grid2" style="margin-top:14px"><div><b>Example dataLayer push</b><div class="snippet"><pre>' + esc(rec.dlExample) + '</pre></div></div><div><b>How offline data flows to the platforms</b><ul class="notes">' + rec.flows.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></div></div></div>';
    html += '<div class="section card" style="padding:20px"><h3>Event & marketing growth scenarios</h3><div class="tblwrap"><table><thead><tr><th>Scenario</th><th>Setup</th><th>Sales / marketing impact</th></tr></thead><tbody>' +
      rec.scenarios.map(function (s) { return '<tr><td><b>' + esc(s[0]) + '</b></td><td>' + esc(s[1]) + '</td><td>' + esc(s[2]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<h3 style="margin-top:20px">sGTM Pantheon recommendations</h3><div class="tblwrap"><table><thead><tr><th>Component</th><th>Domain-specific example</th><th>Impact</th></tr></thead><tbody>' +
      rec.pantheon.map(function (s) { return '<tr><td><b>' + esc(s[0]) + '</b></td><td>' + esc(s[1]) + '</td><td>' + esc(s[2]) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';

    rep.innerHTML = html;
    rep.scrollIntoView({ behavior: 'smooth' });

    $$('.filter', rep).forEach(function (f) {
      f.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        $$('button', f).forEach(function (x) { x.classList.toggle('on', x === b); });
        var tb = f.nextElementSibling;
        $$('tr[data-s]', tb).forEach(function (tr) { tr.hidden = b.dataset.f !== 'all' && tr.dataset.s !== b.dataset.f; });
      });
    });
    $('#xlsxBtn').addEventListener('click', downloadXlsx);
    $('#jsonBtn').addEventListener('click', function () { save(new Blob([JSON.stringify(current.input)], { type: 'application/json' }), fileBase() + '-capture.json'); });
    $('#printBtn').addEventListener('click', function () { $$('details', rep).forEach(function (d) { d.open = true; }); setTimeout(function () { window.print(); }, 100); });
    $('#expandBtn').addEventListener('click', function () { $$('details.plat', rep).forEach(function (d) { d.open = true; }); });
    var sh = $('#shareBtn'); if (sh) sh.addEventListener('click', function () { navigator.clipboard.writeText(location.href).then(function () { toast('Link copied'); }); });
  }

  function fileBase() {
    var h = ''; try { h = new URL(current.R.meta.url).hostname.replace(/^www\./, ''); } catch (e) { h = 'site'; }
    return 'tracking-qa-' + h + '-' + (current.R.meta.scannedAt || current.R.generatedAt).slice(0, 10);
  }
  function save(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function downloadXlsx() {
    if (!window.ExcelJS) { toast('Excel library still loading, try again'); return; }
    var wb = window.AuditExcel.build(window.ExcelJS, current.R);
    wb.xlsx.writeBuffer().then(function (buf) { save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileBase() + '.xlsx'); });
  }

  // ---------- URL parameter
  var qs = new URLSearchParams(location.search);
  if (qs.get('id')) { selectTab('open'); $('#oId').value = qs.get('id'); if (qs.get('id') === 'demo') loadCapture('demo/capture.json', 'demo'); else openReport(qs.get('id')); }
})();
