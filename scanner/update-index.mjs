// reports/index.json: list of recent audits ("Recent audits" on the site)
import fs from 'node:fs';
import { createRequire } from 'node:module';
const Engine = createRequire(import.meta.url)('../site/assets/engine.js');
const [file, id, url, capture] = process.argv.slice(2);
let list = [];
try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new */ }
const R = Engine.run(JSON.parse(fs.readFileSync(capture, 'utf8')));
list = list.filter((x) => x.id !== id);
list.unshift({ id, url, date: new Date().toISOString(), score: R.score, critical: R.totals.critical });
fs.writeFileSync(file, JSON.stringify(list.slice(0, 200), null, 1));
