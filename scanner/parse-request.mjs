// Reads the issue-form body (### Heading\n\nvalue) or workflow_dispatch inputs and prints GITHUB_OUTPUT lines.
const body = process.env.BODY || '';
const sections = {};
body.split(/^###\s+/m).slice(1).forEach((s) => {
  const [head, ...rest] = s.split('\n');
  const v = rest.join('\n').trim();
  sections[head.trim().toLowerCase()] = v === '_No response_' ? '' : v;
});
const get = (re) => { const k = Object.keys(sections).find((x) => re.test(x)); return k ? sections[k].split('\n')[0].trim() : ''; };
const clean = (u) => {
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.toString().replace(/["'`$\\\s]/g, '') : ''; } catch { return ''; }
};
const url = clean(process.env.IN_URL || get(/site url/));
if (!url) { console.error('No valid Site URL found'); process.exit(1); }
const sector = (process.env.IN_SECTOR || get(/business model|modeli/) || 'ecommerce').toLowerCase();
const cur = (process.env.IN_CUR || get(/currency|para birimi/) || 'TRY').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
const out = {
  id: process.env.ISSUE || 'run-' + process.env.RUN,
  url,
  sector: /lead/.test(sector) ? 'leadgen' : /sub|abon/.test(sector) ? 'subscription' : 'ecommerce',
  currency: cur || 'TRY',
  product: clean(process.env.IN_PRODUCT || get(/product|ürün/)),
  cart: clean(get(/cart|sepet/)),
  checkout: clean(get(/checkout/))
};
Object.entries(out).forEach(([k, v]) => console.log(`${k}=${v}`));
