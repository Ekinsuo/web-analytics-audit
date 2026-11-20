/*!
 * Denetim sonucunu stillenmiş .xlsx çalışma kitabına çevirir (ExcelJS).
 * Tarayıcı: AuditExcel.build(ExcelJS, result) · Node: require('./excel.js').build(ExcelJS, result)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuditExcel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var RED = 'FFC62828', DARK = 'FF37474F', WHITE = 'FFFFFFFF', GREEN = 'FF2E7D32', AMBER = 'FFB26A00', GREY = 'FF757575', LIGHT = 'FFF5F5F5';
  var thin = { style: 'thin', color: { argb: 'FFBDBDBD' } };
  var border = { top: thin, left: thin, bottom: thin, right: thin };
  var STATUS_TR = { pass: 'Doğru', fail: 'Hatalı', warn: 'Kısmen', na: 'Kontrol edilemedi' };

  function statusColor(s) {
    if (s === 'Hatalı' || s === 'Yok' || s === 'fail') return RED;
    if (s === 'Kısmen' || s === 'warn') return AMBER;
    if (s === 'Mevcut' || s === 'pass' || s === 'Doğru') return GREEN;
    return GREY;
  }
  function header(ws, row, cols, startCol) {
    cols.forEach(function (c, i) {
      var cell = ws.getCell(row, startCol + i);
      cell.value = c; cell.font = { bold: true, color: { argb: WHITE } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; cell.border = border;
    });
  }
  function cellStyle(cell, opts) {
    cell.alignment = { vertical: 'top', wrapText: true }; cell.border = border;
    if (opts && opts.color) cell.font = { color: { argb: opts.color }, bold: !!opts.bold };
    if (opts && opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  }
  function band(ws, r1, r2, text) {
    if (r2 < r1) r2 = r1;
    if (r2 > r1) ws.mergeCells(r1, 1, r2, 1);
    var c = ws.getCell(r1, 1);
    c.value = text; c.font = { bold: true, color: { argb: WHITE }, size: 12 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
    c.alignment = { vertical: 'middle', horizontal: 'center', textRotation: r2 - r1 >= 2 ? 90 : 0, wrapText: true };
    c.border = border;
  }
  function title(ws, text, sub) {
    ws.getCell(1, 1).value = text; ws.getCell(1, 1).font = { bold: true, size: 15 };
    if (sub) { ws.getCell(2, 1).value = sub; ws.getCell(2, 1).font = { color: { argb: GREY } }; }
  }

  function build(ExcelJS, R) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'Web Analytics Audit'; wb.created = new Date();
    var sub = (R.meta.url || '') + ' · ' + (R.meta.scannedAt || R.generatedAt).slice(0, 16).replace('T', ' ') + ' · Skor ' + R.score + '/100';

    // 1) Genel Durum: envanter + bileşen-durum tabloları
    var ws = wb.addWorksheet('Genel Durum', { views: [{ state: 'frozen', ySplit: 0, showGridLines: false }] });
    ws.columns = [{ width: 16 }, { width: 30 }, { width: 14 }, { width: 55 }, { width: 55 }, { width: 50 }];
    title(ws, 'Tracking QA Denetimi — Genel Durum', sub);
    var r = 4;
    ws.getCell(r, 1).value = 'Platform envanteri'; ws.getCell(r, 1).font = { bold: true, size: 12 }; r++;
    header(ws, r, ['', 'Platform', 'Durum', 'ID / Tespit'], 1); r++;
    var r0 = r;
    R.inventory.forEach(function (i) {
      ws.getCell(r, 2).value = i.platform; cellStyle(ws.getCell(r, 2), { bold: true });
      ws.getCell(r, 3).value = i.detected ? 'Kurulu' : 'Kurulu değil'; cellStyle(ws.getCell(r, 3), { color: i.detected ? GREEN : RED, bold: true });
      ws.getCell(r, 4).value = (i.ids || []).join(', ') || '—'; cellStyle(ws.getCell(r, 4));
      r++;
    });
    band(ws, r0, r - 1, 'Envanter');
    r += 1;
    R.platforms.forEach(function (p) {
      header(ws, r, ['', 'Bileşen', 'Durum', 'Tespit', 'Risk / Eksiklik', 'Öneri'], 1); r++;
      var s = r;
      p.components.forEach(function (c) {
        ws.getCell(r, 2).value = c.component; cellStyle(ws.getCell(r, 2), { bold: true });
        ws.getCell(r, 3).value = c.status; cellStyle(ws.getCell(r, 3), { color: statusColor(c.status), bold: true });
        ws.getCell(r, 4).value = c.detection; cellStyle(ws.getCell(r, 4));
        ws.getCell(r, 5).value = c.risk; cellStyle(ws.getCell(r, 5), { color: c.risk !== '—' ? RED : undefined });
        ws.getCell(r, 6).value = c.recommendation; cellStyle(ws.getCell(r, 6));
        r++;
      });
      band(ws, s, r - 1, p.name);
      r += 1;
    });

    // 2) Platform bazlı hata tabloları
    R.platforms.forEach(function (p) {
      var w = wb.addWorksheet(p.name.replace(/[\\/?*[\]:]/g, '').slice(0, 30), { views: [{ showGridLines: false }] });
      w.columns = [{ width: 14 }, { width: 22 }, { width: 46 }, { width: 8 }, { width: 50 }, { width: 46 }, { width: 44 }, { width: 44 }];
      title(w, p.name + ' — Hata Tablosu', 'Önem: 1 = Kritik, 2 = Yüksek/Orta, 3 = Düşük/opsiyonel · ' + p.counts.pass + ' doğru, ' + p.counts.fail + ' hatalı, ' + p.counts.warn + ' kısmen, ' + p.counts.na + ' kontrol edilemedi');
      var rr = 4;
      header(w, rr, ['', 'Event Name', 'Hata Açıklaması', 'Önem', 'Hatalı Gelen Değer', 'Olması Gereken Değer', 'Etkisi', 'Öneri'], 1); rr++;
      var start = rr;
      if (!p.errors.length) {
        w.getCell(rr, 2).value = '—'; w.getCell(rr, 3).value = 'Hata bulunmadı'; cellStyle(w.getCell(rr, 3), { color: GREEN, bold: true }); rr++;
      }
      p.errors.forEach(function (g) {
        var gs = rr;
        g.rows.forEach(function (row) {
          w.getCell(rr, 3).value = row.description; cellStyle(w.getCell(rr, 3));
          w.getCell(rr, 4).value = row.severity; cellStyle(w.getCell(rr, 4), { bold: true, color: row.severity === 1 ? RED : row.severity === 2 ? AMBER : GREY });
          w.getCell(rr, 4).alignment = { horizontal: 'center', vertical: 'top' };
          w.getCell(rr, 5).value = row.wrong; cellStyle(w.getCell(rr, 5), { color: RED });
          w.getCell(rr, 6).value = row.expected; cellStyle(w.getCell(rr, 6), { color: GREEN });
          w.getCell(rr, 7).value = row.impact; cellStyle(w.getCell(rr, 7));
          w.getCell(rr, 8).value = row.recommendation; cellStyle(w.getCell(rr, 8));
          rr++;
        });
        if (rr - 1 > gs) w.mergeCells(gs, 2, rr - 1, 2);
        var ec = w.getCell(gs, 2); ec.value = g.event; cellStyle(ec, { bold: true }); ec.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
      band(w, start, rr - 1, p.name);

      // Doğru çalışanlar
      rr += 2;
      w.getCell(rr, 2).value = 'Doğru çalışan kontroller'; w.getCell(rr, 2).font = { bold: true, size: 12, color: { argb: GREEN } }; rr++;
      header(w, rr, ['', 'Event Name', 'Kontrol', 'Durum', 'Gözlenen Değer', 'Beklenen', 'Bileşen'], 1); rr++;
      var ps = rr;
      var passes = p.checks.filter(function (c) { return c.status === 'pass'; });
      if (!passes.length) { w.getCell(rr, 3).value = '—'; rr++; }
      passes.forEach(function (c) {
        w.getCell(rr, 2).value = c.event; cellStyle(w.getCell(rr, 2));
        w.getCell(rr, 3).value = c.title; cellStyle(w.getCell(rr, 3));
        w.getCell(rr, 4).value = '✓'; cellStyle(w.getCell(rr, 4), { color: GREEN, bold: true }); w.getCell(rr, 4).alignment = { horizontal: 'center' };
        w.getCell(rr, 5).value = c.observed; cellStyle(w.getCell(rr, 5), { color: GREEN });
        w.getCell(rr, 6).value = c.expected; cellStyle(w.getCell(rr, 6));
        w.getCell(rr, 7).value = c.component; cellStyle(w.getCell(rr, 7));
        rr++;
      });
      band(w, ps, rr - 1, 'Doğrular');
    });

    // 3) Tüm kontrol listesi
    var wc = wb.addWorksheet('Kontrol Listesi', { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
    wc.columns = [{ width: 16 }, { width: 26 }, { width: 22 }, { width: 50 }, { width: 18 }, { width: 8 }, { width: 55 }, { width: 46 }];
    title(wc, 'Kontrol Listesi — yapılan tüm kontroller', 'Doğru / Hatalı / Kısmen / Kontrol edilemedi');
    header(wc, 4, ['Platform', 'Bileşen', 'Event', 'Kontrol', 'Sonuç', 'Önem', 'Gözlenen Değer', 'Beklenen Değer'], 1);
    var rc = 5;
    R.platforms.forEach(function (p) {
      p.checks.forEach(function (c) {
        var vals = [p.name, c.component, c.event, c.title, STATUS_TR[c.status], c.severity || '', c.observed, c.expected];
        vals.forEach(function (v, i) { var cell = wc.getCell(rc, i + 1); cell.value = v; cellStyle(cell, i === 4 ? { color: statusColor(c.status), bold: true } : i === 6 && c.status === 'fail' ? { color: RED } : (rc % 2 ? { fill: LIGHT } : null)); });
        rc++;
      });
    });
    wc.autoFilter = { from: { row: 4, column: 1 }, to: { row: rc - 1, column: 8 } };

    // 4) DataLayer önerisi
    var rec = R.recommendations;
    var wd = wb.addWorksheet('DataLayer Önerisi', { views: [{ showGridLines: false }] });
    wd.columns = [{ width: 14 }, { width: 18 }, { width: 12 }, { width: 22 }, { width: 34 }, { width: 50 }, { width: 46 }];
    title(wd, 'Domaine özel DataLayer + GA4 event yapısı (online + offline)', sub);
    header(wd, 4, ['', 'Aşama', 'Kanal', 'GA4 Event', 'Tetikleyici', 'Kritik Parametreler', 'Örnek Değer'], 1);
    var rd = 5;
    rec.funnel.forEach(function (f) { f.forEach(function (v, i) { var cell = wd.getCell(rd, i + 2); cell.value = v; cellStyle(cell, i === 1 ? { bold: true, color: v === 'Offline' ? AMBER : GREEN } : i === 2 ? { bold: true } : null); }); rd++; });
    band(wd, 5, rd - 1, 'Funnel');
    rd += 1;
    wd.getCell(rd, 2).value = 'Örnek dataLayer push'; wd.getCell(rd, 2).font = { bold: true }; rd++;
    wd.mergeCells(rd, 2, rd, 7); wd.getCell(rd, 2).value = rec.dlExample; wd.getCell(rd, 2).font = { name: 'Consolas', size: 10 }; wd.getCell(rd, 2).alignment = { wrapText: true, vertical: 'top' }; wd.getRow(rd).height = 210; rd += 2;
    wd.getCell(rd, 2).value = 'Offline veri akışı'; wd.getCell(rd, 2).font = { bold: true }; rd++;
    rec.flows.forEach(function (f) { wd.mergeCells(rd, 2, rd, 7); wd.getCell(rd, 2).value = '• ' + f; rd++; });

    // 5) Senaryolar + Pantheon
    var wsx = wb.addWorksheet('Senaryolar & sGTM Pantheon', { views: [{ showGridLines: false }] });
    wsx.columns = [{ width: 14 }, { width: 32 }, { width: 70 }, { width: 50 }];
    title(wsx, 'Event & marketing geliştirme senaryoları', sub);
    header(wsx, 4, ['', 'Senaryo', 'Kurgu', 'Satış / pazarlama katkısı'], 1);
    var rs = 5;
    rec.scenarios.forEach(function (s) { s.forEach(function (v, i) { var cell = wsx.getCell(rs, i + 2); cell.value = v; cellStyle(cell, i === 0 ? { bold: true } : null); }); rs++; });
    band(wsx, 5, rs - 1, 'Senaryolar');
    rs += 1;
    header(wsx, rs, ['', 'Bileşen', 'Domaine özel örnek', 'Katkı'], 1); rs++;
    var ss = rs;
    rec.pantheon.forEach(function (s) { s.forEach(function (v, i) { var cell = wsx.getCell(rs, i + 2); cell.value = v; cellStyle(cell, i === 0 ? { bold: true } : null); }); rs++; });
    band(wsx, ss, rs - 1, 'sGTM Pantheon');

    // 6) Event mapping
    var wm = wb.addWorksheet('Event Eşleştirme', { views: [{ showGridLines: false }] });
    wm.columns = [{ width: 22 }, { width: 34 }, { width: 28 }, { width: 24 }];
    header(wm, 1, ['GA4', 'Meta', 'TikTok', 'Google Ads'], 1);
    R.mapping.forEach(function (m, i) { m.forEach(function (v, j) { var c = wm.getCell(i + 2, j + 1); c.value = v; cellStyle(c); }); });

    if (R.meta.notes && R.meta.notes.length) {
      var wn = wb.addWorksheet('Tarama Notları');
      wn.columns = [{ width: 120 }];
      wn.getCell(1, 1).value = 'Tarama notları (veri yetersizse kontrol edilemeyen alanlar)'; wn.getCell(1, 1).font = { bold: true };
      R.meta.notes.forEach(function (n, i) { wn.getCell(i + 2, 1).value = '• ' + n; });
    }
    return wb;
  }
  return { build: build };
});
