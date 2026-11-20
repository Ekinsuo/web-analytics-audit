// capture.json → audit result + styled Excel + issue comment (markdown)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Engine = require('../site/assets/engine.js');
const AuditExcel = require('../site/assets/excel.js');
const ExcelJS = require('exceljs');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const capture = JSON.parse(fs.readFileSync(args.in, 'utf8'));
const outdir = args.outdir || '.';
const id = args.id || 'report';
const siteBase = args.site || '';
fs.mkdirSync(outdir, { recursive: true });

const R = Engine.run(capture);
const wb = AuditExcel.build(ExcelJS, R);
await wb.xlsx.writeFile(path.join(outdir, id + '.xlsx'));

const crit = [];
R.platforms.forEach((p) => p.checks.filter((c) => c.status === 'fail' && c.severity === 1).forEach((c) => crit.push(`| ${p.name} | ${c.event} | ${c.title.replace(/\|/g, '/')} | ${String(c.observed).replace(/\|/g, '/').slice(0, 140)} |`)));
const plat = R.platforms.map((p) => `| ${p.name} | ${p.counts.pass} | ${p.counts.fail} | ${p.counts.warn} | ${p.counts.na} |`).join('\n');
const md = `## Tracking QA audit complete — ${R.meta.url}

**Score: ${R.score}/100** · ${R.totals.pass} pass · ${R.totals.fail} fail (${R.totals.critical} critical) · ${R.totals.warn} partial · ${R.totals.na} not verifiable

${siteBase ? `👉 **Full report:** ${siteBase}?id=${id}\n\n📥 **Excel:** ${process.env.GITHUB_REPOSITORY ? `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/reports/reports/${id}.xlsx` : id + '.xlsx'} (or use the “Download Excel report” button on the report page)\n` : ''}
| Platform | Pass | Fail | Partial | Not verifiable |
|---|---|---|---|---|
${plat}

${crit.length ? `### Critical (severity 1) findings\n| Platform | Event | Check | Observed |\n|---|---|---|---|\n${crit.slice(0, 15).join('\n')}\n` : '✅ No critical findings.'}
${R.meta.notes.length ? `\n<details><summary>Scan notes</summary>\n\n${R.meta.notes.map((n) => '- ' + n).join('\n')}\n</details>\n` : ''}`;
fs.writeFileSync(path.join(outdir, id + '.summary.md'), md);
console.log(`Score ${R.score}/100 · ${R.totals.fail} fail · ${R.totals.critical} critical → ${outdir}/${id}.xlsx`);
