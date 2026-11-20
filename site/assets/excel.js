/*!
 * Turns an audit result into a styled .xlsx workbook (ExcelJS).
 * Browser: AuditExcel.build(ExcelJS, result) · Node: require('./excel.js').build(ExcelJS, result)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuditExcel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var RED = 'FFC62828', DARK = 'FF37474F', WHITE = 'FFFFFFFF', GREEN = 'FF2E7D32', AMBER = 'FFB26A00', GREY = 'FF757575', LIGHT = 'FFF5F5F5';
  var thin = { style: 'thin', color: { argb: 'FFBDBDBD' } };
  var border = { top: thin, left: thin, bottom: thin, right: thin };
  var STATUS_TR = { pass: 'Pass', fail: 'Fail', warn: 'Partial', na: 'Not verifiable' };

  function statusColor(s) {
    if (s === 'Faulty' || s === 'Missing' || s === 'fail') return RED;
    if (s === 'Partial' || s === 'warn') return AMBER;
    if (s === 'Present' || s === 'pass') return GREEN;
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
    var sub = (R.meta.url || '') + ' · ' + (R.meta.scannedAt || R.generatedAt).slice(0, 16).replace('T', ' ') + ' · Score ' + R.score + '/100';

    // 1) Overview: inventory + component status tables
    var ws = wb.addWorksheet('Overview', { views: [{ state: 'frozen', ySplit: 0, showGridLines: false }] });
    ws.columns = [{ width: 16 }, { width: 30 }, { width: 14 }, { width: 55 }, { width: 55 }, { width: 50 }];
    title(ws, 'Tracking QA Audit — Overview', sub);
    var r = 4;
    ws.getCell(r, 1).value = 'Platform inventory'; ws.getCell(r, 1).font = { bold: true, size: 12 }; r++;
    header(ws, r, ['', 'Platform', 'Status', 'ID / Detection'], 1); r++;
    var r0 = r;
    R.inventory.forEach(function (i) {
      ws.getCell(r, 2).value = i.platform; cellStyle(ws.getCell(r, 2), { bold: true });
      ws.getCell(r, 3).value = i.detected ? 'Installed' : 'Not installed'; cellStyle(ws.getCell(r, 3), { color: i.detected ? GREEN : RED, bold: true });
      ws.getCell(r, 4).value = (i.ids || []).join(', ') || '—'; cellStyle(ws.getCell(r, 4));
      r++;
    });
    band(ws, r0, r - 1, 'Inventory');
    r += 1;
    R.platforms.forEach(function (p) {
      header(ws, r, ['', 'Component', 'Status', 'Detection', 'Risk / Gap', 'Recommendation'], 1); r++;
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

    // 2) Error tables per platform
    R.platforms.forEach(function (p) {
      var w = wb.addWorksheet(p.name.replace(/[\\/?*[\]:]/g, '').slice(0, 30), { views: [{ showGridLines: false }] });
      w.columns = [{ width: 14 }, { width: 22 }, { width: 46 }, { width: 8 }, { width: 50 }, { width: 46 }, { width: 44 }, { width: 44 }];
      title(w, p.name + ' — Error Table', 'Severity: 1 = Critical, 2 = High/Medium, 3 = Low/optional · ' + p.counts.pass + ' pass, ' + p.counts.fail + ' fail, ' + p.counts.warn + ' partial, ' + p.counts.na + ' not verifiable');
      var rr = 4;
      header(w, rr, ['', 'Event Name', 'Error Description', 'Severity', 'Observed (Wrong) Value', 'Expected Value', 'Impact', 'Recommendation'], 1); rr++;
      var start = rr;
      if (!p.errors.length) {
        w.getCell(rr, 2).value = '—'; w.getCell(rr, 3).value = 'No errors found'; cellStyle(w.getCell(rr, 3), { color: GREEN, bold: true }); rr++;
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

      // Passing checks
      rr += 2;
      w.getCell(rr, 2).value = 'Checks that passed'; w.getCell(rr, 2).font = { bold: true, size: 12, color: { argb: GREEN } }; rr++;
      header(w, rr, ['', 'Event Name', 'Check', 'Result', 'Observed Value', 'Expected', 'Component'], 1); rr++;
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
      band(w, ps, rr - 1, 'Passed');
    });

    // 3) Full checklist
    var wc = wb.addWorksheet('Checklist', { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
    wc.columns = [{ width: 16 }, { width: 26 }, { width: 22 }, { width: 50 }, { width: 18 }, { width: 8 }, { width: 55 }, { width: 46 }];
    title(wc, 'Checklist — every check performed', 'Pass / Fail / Partial / Not verifiable');
    header(wc, 4, ['Platform', 'Component', 'Event', 'Check', 'Result', 'Severity', 'Observed Value', 'Expected Value'], 1);
    var rc = 5;
    R.platforms.forEach(function (p) {
      p.checks.forEach(function (c) {
        var vals = [p.name, c.component, c.event, c.title, STATUS_TR[c.status], c.severity || '', c.observed, c.expected];
        vals.forEach(function (v, i) { var cell = wc.getCell(rc, i + 1); cell.value = v; cellStyle(cell, i === 4 ? { color: statusColor(c.status), bold: true } : i === 6 && c.status === 'fail' ? { color: RED } : (rc % 2 ? { fill: LIGHT } : null)); });
        rc++;
      });
    });
    wc.autoFilter = { from: { row: 4, column: 1 }, to: { row: rc - 1, column: 8 } };

    // 4) DataLayer recommendation
    var rec = R.recommendations;
    var wd = wb.addWorksheet('DataLayer Plan', { views: [{ showGridLines: false }] });
    wd.columns = [{ width: 14 }, { width: 18 }, { width: 12 }, { width: 22 }, { width: 34 }, { width: 50 }, { width: 46 }];
    title(wd, 'Domain-specific DataLayer + GA4 event structure (online + offline)', sub);
    header(wd, 4, ['', 'Stage', 'Channel', 'GA4 Event', 'Trigger', 'Key Parameters', 'Example Value'], 1);
    var rd = 5;
    rec.funnel.forEach(function (f) { f.forEach(function (v, i) { var cell = wd.getCell(rd, i + 2); cell.value = v; cellStyle(cell, i === 1 ? { bold: true, color: v === 'Offline' ? AMBER : GREEN } : i === 2 ? { bold: true } : null); }); rd++; });
    band(wd, 5, rd - 1, 'Funnel');
    rd += 1;
    wd.getCell(rd, 2).value = 'Example dataLayer push'; wd.getCell(rd, 2).font = { bold: true }; rd++;
    wd.mergeCells(rd, 2, rd, 7); wd.getCell(rd, 2).value = rec.dlExample; wd.getCell(rd, 2).font = { name: 'Consolas', size: 10 }; wd.getCell(rd, 2).alignment = { wrapText: true, vertical: 'top' }; wd.getRow(rd).height = 210; rd += 2;
    wd.getCell(rd, 2).value = 'Offline data flow'; wd.getCell(rd, 2).font = { bold: true }; rd++;
    rec.flows.forEach(function (f) { wd.mergeCells(rd, 2, rd, 7); wd.getCell(rd, 2).value = '• ' + f; rd++; });

    // 5) Scenarios + Pantheon
    var wsx = wb.addWorksheet('Scenarios & sGTM Pantheon', { views: [{ showGridLines: false }] });
    wsx.columns = [{ width: 14 }, { width: 32 }, { width: 70 }, { width: 50 }];
    title(wsx, 'Event & marketing growth scenarios', sub);
    header(wsx, 4, ['', 'Scenario', 'Setup', 'Sales / marketing impact'], 1);
    var rs = 5;
    rec.scenarios.forEach(function (s) { s.forEach(function (v, i) { var cell = wsx.getCell(rs, i + 2); cell.value = v; cellStyle(cell, i === 0 ? { bold: true } : null); }); rs++; });
    band(wsx, 5, rs - 1, 'Scenarios');
    rs += 1;
    header(wsx, rs, ['', 'Component', 'Domain-specific example', 'Impact'], 1); rs++;
    var ss = rs;
    rec.pantheon.forEach(function (s) { s.forEach(function (v, i) { var cell = wsx.getCell(rs, i + 2); cell.value = v; cellStyle(cell, i === 0 ? { bold: true } : null); }); rs++; });
    band(wsx, ss, rs - 1, 'sGTM Pantheon');

    // 6) Event mapping
    var wm = wb.addWorksheet('Event Mapping', { views: [{ showGridLines: false }] });
    wm.columns = [{ width: 22 }, { width: 34 }, { width: 28 }, { width: 24 }];
    header(wm, 1, ['GA4', 'Meta', 'TikTok', 'Google Ads'], 1);
    R.mapping.forEach(function (m, i) { m.forEach(function (v, j) { var c = wm.getCell(i + 2, j + 1); c.value = v; cellStyle(c); }); });

    if (R.meta.notes && R.meta.notes.length) {
      var wn = wb.addWorksheet('Scan Notes');
      wn.columns = [{ width: 120 }];
      wn.getCell(1, 1).value = 'Scan notes (areas that could not be checked with the available data)'; wn.getCell(1, 1).font = { bold: true };
      R.meta.notes.forEach(function (n, i) { wn.getCell(i + 2, 1).value = '• ' + n; });
    }
    return wb;
  }
  return { build: build };
});
