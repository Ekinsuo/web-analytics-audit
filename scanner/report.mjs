// capture.json → denetim sonucu (JSON) + stillenmiş Excel + issue yorumu (markdown)
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
const md = `## Tracking QA denetimi tamamlandı — ${R.meta.url}

**Skor: ${R.score}/100** · ${R.totals.pass} doğru · ${R.totals.fail} hatalı (${R.totals.critical} kritik) · ${R.totals.warn} kısmen · ${R.totals.na} kontrol edilemedi

${siteBase ? `👉 **Raporun tamamı:** ${siteBase}?id=${id}\n\n📥 **Excel:** ${siteBase}reports/${id}.xlsx (rapor sayfasındaki “Excel indir” butonu da kullanılabilir)\n` : ''}
| Platform | Doğru | Hatalı | Kısmen | Kontrol edilemedi |
|---|---|---|---|---|
${plat}

${crit.length ? `### Kritik (önem 1) bulgular\n| Platform | Event | Kontrol | Gözlenen |\n|---|---|---|---|\n${crit.slice(0, 15).join('\n')}\n` : '✅ Kritik bulgu yok.'}
${R.meta.notes.length ? `\n<details><summary>Tarama notları</summary>\n\n${R.meta.notes.map((n) => '- ' + n).join('\n')}\n</details>\n` : ''}`;
fs.writeFileSync(path.join(outdir, id + '.summary.md'), md);
console.log(`Skor ${R.score}/100 · ${R.totals.fail} hatalı · ${R.totals.critical} kritik → ${outdir}/${id}.xlsx`);
