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
  var STATUS_TR = { pass: 'Doğru', fail: 'Hatalı', warn: 'Kısmen', na: 'Kontrol edilemedi' };
  var MODE_TR = { live: 'Canlı tarama (GitHub Actions)', har: 'HAR analizi (tarayıcıda)' };

  $('#repoLink').href = 'https://github.com/' + REPO;

  // ---------- Sekmeler
  $$('.tab').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.tab').forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      $$('.panel').forEach(function (p) { p.hidden = p.dataset.panel !== b.dataset.tab; });
      if (b.dataset.tab === 'open') loadRecent();
    });
  });
  function selectTab(name) { var b = $('.tab[data-tab="' + name + '"]'); if (b) b.click(); }

  // ---------- Kontrol kataloğu
  $('#catalog').innerHTML = E.CATALOG.map(function (c) {
    return '<div class="card"><h4>' + esc(c.area) + '</h4><ul>' + c.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>';
  }).join('');

  // ---------- Canlı tarama → GitHub issue formu
  function normUrl(u) { u = (u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; try { return new URL(u).toString(); } catch (e) { return ''; } }
  $('#liveForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var url = normUrl($('#lUrl').value);
    if (!url) { toast('Geçerli bir URL girin'); return; }
    var host = new URL(url).hostname;
    var q = new URLSearchParams({
      template: 'audit.yml', title: '[Audit] ' + host, url: url,
      sector: $('#lSector').value, currency: ($('#lCur').value || 'TRY').toUpperCase(),
      product_url: normUrl($('#lProduct').value), cart_url: normUrl($('#lCart').value), checkout_url: normUrl($('#lCheckout').value)
    });
    window.open('https://github.com/' + REPO + '/issues/new?' + q.toString(), '_blank', 'noopener');
    toast('GitHub\'da talep açıldı — Submit\'e basmayı unutmayın');
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
          if (!(j.log && j.log.entries)) throw new Error('HAR formatı değil');
          files[key] = j;
          $('.fname', el).textContent = f.name + ' · ' + j.log.entries.length + ' istek';
          if (key === 'main' && !$('#hUrl').value) {
            var page = (j.log.pages && j.log.pages[0] && j.log.pages[0].title) || '';
            var first = j.log.entries.filter(function (e) { return e._resourceType === 'document'; })[0] || j.log.entries[0];
            $('#hUrl').value = /^https?:/.test(page) ? page : (first ? first.request.url : '');
          }
        } catch (err) { files[key] = null; $('.fname', el).textContent = ''; toast('Dosya okunamadı: ' + err.message); }
      };
      rd.readAsText(f);
    }
  }
  setupDrop($('#dropMain'), 'main');
  setupDrop($('#dropReject'), 'reject');
  $('#copySnippet').addEventListener('click', function () {
    navigator.clipboard.writeText($('#dlSnippet').textContent).then(function () { toast('Kopyalandı — sitenizin konsoluna yapıştırın'); });
  });
  function parseDL(text) {
    text = (text || '').trim();
    if (!text) return [];
    var out = [];
    try { var j = JSON.parse(text); return Array.isArray(j) ? j : [j]; } catch (e) { /* çoklu */ }
    try { var many = JSON.parse('[' + text.replace(/\]\s*,?\s*\[/g, '],[') + ']'); many.forEach(function (a) { out = out.concat(Array.isArray(a) ? a : [a]); }); return out; } catch (e) { throw new Error('dataLayer JSON okunamadı'); }
  }
  $('#harForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!files.main) { toast('Önce funnel HAR dosyasını yükleyin'); return; }
    var dl;
    try { dl = parseDL($('#hDl').value); } catch (e) { toast(e.message); return; }
    var m = E.fromHAR(files.main, 'har');
    var input = {
      meta: { url: normUrl($('#hUrl').value) || m.pageUrl, sector: $('#hSector').value, currency: ($('#hCur').value || '').toUpperCase(), mode: 'har', scannedAt: new Date().toISOString(), notes: [] },
      phases: { har: { requests: m.requests, cookies: m.cookies } }, dataLayer: dl, html: m.html, cmp: {}
    };
    if (!m.cookies.length) input.meta.notes.push('HAR\'da çerez bilgisi yok (sanitized export). Çerez kontrolleri için "with sensitive data" ile dışa aktarın.');
    if (!dl.length) input.meta.notes.push('dataLayer yüklenmedi; DataLayer kontrolleri yapılamadı.');
    if (files.reject) { var r = E.fromHAR(files.reject, 'har_reject'); input.phases.har_reject = { requests: r.requests, cookies: r.cookies.length ? r.cookies : undefined }; input.cmp.rejectClicked = true; }
    else input.meta.notes.push('"Reddet sonrası HAR" yüklenmedi; CMP reddet testi yapılamadı.');
    show(input, null);
  });

  // ---------- Rapor yükleme
  $('#openForm').addEventListener('submit', function (ev) { ev.preventDefault(); var id = $('#oId').value.trim().replace(/^#/, ''); if (id) openReport(id); });
  $('#demoBtn').addEventListener('click', function () { loadCapture('demo/capture.json', 'demo'); });

  function loadCapture(url, id) {
    var rep = $('#report'); rep.hidden = false;
    rep.innerHTML = '<div class="card" style="padding:24px"><span class="spinner"></span> Rapor yükleniyor…</div>';
    rep.scrollIntoView({ behavior: 'smooth' });
    return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status === 404 ? 'Rapor henüz hazır değil veya bulunamadı (tarama sürüyor olabilir — 1-2 dk sonra tekrar deneyin).' : 'HTTP ' + r.status); return r.json(); })
      .then(function (cap) { show(cap, id); })
      .catch(function (e) { rep.innerHTML = '<div class="card" style="padding:24px"><b class="bad">Rapor açılamadı.</b> <span class="hint">' + esc(e.message) + '</span></div>'; });
  }
  function openReport(id) {
    if (!/^[\w-]{1,40}$/.test(id)) { toast('Geçersiz rapor ID'); return; }
    history.replaceState(null, '', '?id=' + encodeURIComponent(id));
    loadCapture(RAW + encodeURIComponent(id) + '.json', id);
  }
  function loadRecent() {
    var ul = $('#recent');
    fetch(RAW + 'index.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (list) {
      if (!list.length) { ul.innerHTML = '<li class="hint">Henüz denetim yok.</li>'; return; }
      ul.innerHTML = list.slice(0, 15).map(function (x) {
        return '<li><a href="?id=' + encodeURIComponent(x.id) + '">' + esc(x.url) + '</a><span class="hint">#' + esc(x.id) + ' · ' + esc((x.date || '').slice(0, 10)) + ' · skor ' + esc(x.score) + '</span></li>';
      }).join('');
    }).catch(function () { ul.innerHTML = '<li class="hint">Henüz denetim yok.</li>'; });
  }

  // ---------- Rapor render
  function sevBadge(s) { return s ? '<span class="sev sev' + s + '" title="Önem ' + s + '">' + s + '</span>' : ''; }
  function chips(c) { return '<span class="chip c-pass">' + c.pass + ' doğru</span><span class="chip c-fail">' + c.fail + ' hatalı</span><span class="chip c-warn">' + c.warn + ' kısmen</span><span class="chip c-na">' + c.na + ' kontrol edilemedi</span>'; }
  function scoreRing(s) {
    var col = s >= 80 ? 'var(--green)' : s >= 60 ? 'var(--amber)' : 'var(--red)';
    var c = 2 * Math.PI * 40;
    return '<div class="score"><svg width="92" height="92"><circle cx="46" cy="46" r="40" stroke="var(--grey-bg)" stroke-width="8" fill="none"/><circle cx="46" cy="46" r="40" stroke="' + col + '" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="' + (c * s / 100) + ' ' + c + '"/></svg><span>' + s + '</span></div>';
  }

  function componentTable(p) {
    return '<div class="band"><div class="bandlabel">' + esc(p.name) + '</div><div class="tblwrap"><table><thead><tr><th>Bileşen</th><th>Durum</th><th>Tespit</th><th>Risk / Eksiklik</th><th>Öneri</th></tr></thead><tbody>' +
      p.components.map(function (c) {
        return '<tr><td><b>' + esc(c.component) + '</b></td><td class="st st-' + esc(c.status) + '">' + esc(c.status) + '</td><td class="val">' + esc(c.detection) + '</td><td class="' + (c.risk !== '—' ? 'bad' : '') + '">' + esc(c.risk) + '</td><td>' + esc(c.recommendation) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  function errorTable(p) {
    if (!p.errors.length) return '<div class="tblwrap"><div class="empty">✓ Bu platformda hata bulunmadı.</div></div>';
    var rows = '';
    p.errors.forEach(function (g) {
      g.rows.forEach(function (r, i) {
        rows += '<tr>' + (i === 0 ? '<td class="ev" rowspan="' + g.rows.length + '">' + esc(g.event) + '</td>' : '') +
          '<td>' + esc(r.description) + '</td><td style="text-align:center">' + sevBadge(r.severity) + '</td><td class="val bad">' + esc(r.wrong) + '</td><td class="val good">' + esc(r.expected) + '</td><td>' + esc(r.impact) + '</td></tr>';
      });
    });
    return '<div class="band"><div class="bandlabel">' + esc(p.name) + '</div><div class="tblwrap"><table><thead><tr><th>Event Name</th><th>Hata Açıklaması</th><th>Önem</th><th>Hatalı Gelen Değer</th><th>Olması Gereken Değer</th><th>Etkisi</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function passTable(p) {
    var ps = p.checks.filter(function (c) { return c.status === 'pass'; });
    if (!ps.length) return '<div class="tblwrap"><div class="empty" style="color:var(--muted)">Doğrulanan kontrol yok.</div></div>';
    return '<div class="band"><div class="bandlabel green">Doğrular</div><div class="tblwrap"><table><thead><tr><th>Event Name</th><th>Kontrol</th><th>Durum</th><th>Gözlenen (doğru) değer</th><th>Beklenen</th></tr></thead><tbody>' +
      ps.map(function (c) { return '<tr><td><b>' + esc(c.event) + '</b></td><td>' + esc(c.title) + '</td><td class="st st-pass">✓ Doğru</td><td class="val good">' + esc(c.observed) + '</td><td class="val">' + esc(c.expected) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
  }
  function allChecks(p) {
    return '<div class="filter" data-key="' + p.key + '"><button class="on" data-f="all">Tümü (' + p.checks.length + ')</button><button data-f="fail">Hatalı</button><button data-f="warn">Kısmen</button><button data-f="pass">Doğru</button><button data-f="na">Kontrol edilemedi</button></div>' +
      '<div class="tblwrap"><table><thead><tr><th>Bileşen</th><th>Event</th><th>Kontrol edilen</th><th>Sonuç</th><th>Önem</th><th>Gözlenen</th><th>Beklenen</th></tr></thead><tbody>' +
      p.checks.map(function (c) { return '<tr data-s="' + c.status + '"><td>' + esc(c.component) + '</td><td><b>' + esc(c.event) + '</b></td><td>' + esc(c.title) + '</td><td class="st st-' + c.status + '">' + STATUS_TR[c.status] + '</td><td>' + sevBadge(c.severity) + '</td><td class="val' + (c.status === 'fail' ? ' bad' : '') + '">' + esc(c.observed) + '</td><td class="val">' + esc(c.expected) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }

  function show(input, id) {
    var R;
    try { R = E.run(input); } catch (e) { console.error(e); toast('Analiz hatası: ' + e.message); return; }
    current = { R: R, input: input, id: id };
    var rep = $('#report'); rep.hidden = false;
    var t = R.totals;
    var html = '';
    html += '<div class="card"><div class="rhead">' + scoreRing(R.score) + '<div><div class="hint">Denetim raporu' + (id ? ' · #' + esc(id) : '') + (id === 'demo' ? ' · <b>Örnek (sentetik test mağazası)</b>' : '') + '</div><h2>' + esc(R.meta.url || 'Site') + '</h2><div class="hint">' + esc(MODE_TR[R.meta.mode] || R.meta.mode) + ' · ' + esc((R.meta.scannedAt || R.generatedAt).slice(0, 16).replace('T', ' ')) + ' · ' + esc(R.meta.requestCount) + ' istek · iş modeli: ' + esc(R.meta.sector) + (R.meta.currency ? ' · ' + esc(R.meta.currency) : '') + '</div></div>' +
      '<div class="kpis"><div class="kpi crit"><b>' + t.critical + '</b><small>Kritik hata (önem 1)</small></div><div class="kpi fail"><b>' + t.fail + '</b><small>Hatalı</small></div><div class="kpi warn"><b>' + t.warn + '</b><small>Kısmen</small></div><div class="kpi pass"><b>' + t.pass + '</b><small>Doğru</small></div><div class="kpi"><b>' + t.na + '</b><small>Kontrol edilemedi</small></div></div></div>' +
      '<div class="actions"><button class="btn" id="xlsxBtn">⬇ Excel raporu indir</button><button class="btn secondary" id="jsonBtn">Ham veri (JSON)</button><button class="btn secondary" id="printBtn">Yazdır / PDF</button><button class="btn secondary" id="expandBtn">Tümünü aç</button>' + (id && id !== 'demo' ? '<button class="btn secondary" id="shareBtn">Linki kopyala</button>' : '') + '</div></div>';

    if (R.meta.notes && R.meta.notes.length) html += '<div class="section"><div class="note"><b>Tarama notları</b><ul class="notes">' + R.meta.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div></div>';

    html += '<div class="section"><h3>Platform envanteri</h3><div class="inv">' + R.inventory.map(function (i) {
      return '<div class="' + (i.detected ? 'on' : 'off') + '"><b>' + esc(i.platform) + '</b><span class="st ' + (i.detected ? 'st-pass' : 'st-na') + '" style="font-size:12px">' + (i.detected ? 'Kurulu' : 'Kurulu değil') + '</span><br><small>' + esc((i.ids || []).join(', ')) + '</small></div>';
    }).join('') + '</div></div>';

    html += '<div class="section"><h3>Platform bazlı denetim</h3>';
    R.platforms.forEach(function (p) {
      var open = p.counts.fail > 0;
      html += '<details class="card plat" id="p-' + p.key + '"' + (open ? ' open' : '') + '><summary><h3>' + esc(p.name) + '</h3><div class="chips">' + chips(p.counts) + '</div></summary><div class="pbody">' +
        '<h4>Bileşen durumu</h4>' + componentTable(p) +
        '<h4>Hata tablosu <span class="hint" style="text-transform:none;letter-spacing:0">— event bazlı, öneme göre sıralı</span></h4>' + errorTable(p) +
        '<h4>Doğru çalışan kontroller</h4>' + passTable(p) +
        '<details style="margin-top:16px"><summary style="cursor:pointer;font-weight:600">Yapılan tüm kontroller (' + p.checks.length + ')</summary><div style="margin-top:10px">' + allChecks(p) + '</div></details>' +
        '</div></details>';
    });
    html += '</div>';

    // Mapping + öneriler
    var rec = R.recommendations;
    html += '<div class="section card" style="padding:20px"><h3>Event eşleştirme referansı</h3><div class="tblwrap"><table><thead><tr><th>GA4</th><th>Meta</th><th>TikTok</th><th>Google Ads</th></tr></thead><tbody>' +
      R.mapping.map(function (m) { return '<tr>' + m.map(function (v) { return '<td class="val">' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></div>';
    html += '<div class="section card" style="padding:20px"><h3>Domaine özel DataLayer önerisi + GA4 event yapısı (online + offline)</h3><div class="tblwrap"><table><thead><tr><th>Aşama</th><th>Kanal</th><th>GA4 Event</th><th>Tetikleyici</th><th>Kritik Parametreler</th><th>Örnek Değer</th></tr></thead><tbody>' +
      rec.funnel.map(function (f) { return '<tr><td><b>' + esc(f[0]) + '</b></td><td class="st ' + (f[1] === 'Offline' ? 'st-warn' : 'st-pass') + '">' + esc(f[1]) + '</td><td class="val"><b>' + esc(f[2]) + '</b></td><td>' + esc(f[3]) + '</td><td class="val">' + esc(f[4]) + '</td><td class="val">' + esc(f[5]) + '</td></tr>'; }).join('') +
      '</tbody></table></div><div class="grid2" style="margin-top:14px"><div><b>Örnek dataLayer push</b><div class="snippet"><pre>' + esc(rec.dlExample) + '</pre></div></div><div><b>Offline verinin platformlara akışı</b><ul class="notes">' + rec.flows.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></div></div></div>';
    html += '<div class="section card" style="padding:20px"><h3>Event & marketing geliştirme senaryoları</h3><div class="tblwrap"><table><thead><tr><th>Senaryo</th><th>Kurgu</th><th>Satış / pazarlama katkısı</th></tr></thead><tbody>' +
      rec.scenarios.map(function (s) { return '<tr><td><b>' + esc(s[0]) + '</b></td><td>' + esc(s[1]) + '</td><td>' + esc(s[2]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<h3 style="margin-top:20px">sGTM Pantheon önerileri</h3><div class="tblwrap"><table><thead><tr><th>Bileşen</th><th>Domaine özel örnek</th><th>Katkı</th></tr></thead><tbody>' +
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
    var sh = $('#shareBtn'); if (sh) sh.addEventListener('click', function () { navigator.clipboard.writeText(location.href).then(function () { toast('Link kopyalandı'); }); });
  }

  function fileBase() {
    var h = ''; try { h = new URL(current.R.meta.url).hostname.replace(/^www\./, ''); } catch (e) { h = 'site'; }
    return 'tracking-qa-' + h + '-' + (current.R.meta.scannedAt || current.R.generatedAt).slice(0, 10);
  }
  function save(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function downloadXlsx() {
    if (!window.ExcelJS) { toast('Excel kütüphanesi yükleniyor, tekrar deneyin'); return; }
    var wb = window.AuditExcel.build(window.ExcelJS, current.R);
    wb.xlsx.writeBuffer().then(function (buf) { save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileBase() + '.xlsx'); });
  }

  // ---------- URL parametresi
  var qs = new URLSearchParams(location.search);
  if (qs.get('id')) { selectTab('open'); $('#oId').value = qs.get('id'); if (qs.get('id') === 'demo') loadCapture('demo/capture.json', 'demo'); else openReport(qs.get('id')); }
})();
