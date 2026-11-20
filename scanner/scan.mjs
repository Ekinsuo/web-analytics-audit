// Live scan: visits the site with Playwright in 2 scenarios and produces input for the audit engine.
//  A) before consent → "Accept" → product / cart pages (funnel)
//  B) fresh session → "Reject" → page reload (post-reject requests + cookies)
// Usage: node scan.mjs --url https://site.com [--product URL] [--cart URL] [--sector ecommerce] [--currency TRY] --out capture.json
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']] : a), []));
const OUT = args.out || 'capture.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function normUrl(u) {
  if (!u) return null;
  u = String(u).trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const x = new URL(u);
  if (!/^https?:$/.test(x.protocol)) throw new Error('Only http/https URLs are supported');
  return x.toString();
}
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return /^(::1|fc|fd|fe80|::ffff:(10|127|192\.168))/i.test(ip);
}
async function assertPublic(u) {
  const h = new URL(u).hostname;
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(h)) throw new Error('Local/private addresses cannot be scanned: ' + h);
  let addrs;
  try { addrs = await dns.lookup(h, { all: true }); } catch (e) {
    if (process.env.HTTPS_PROXY) return; // local development behind a proxy only
    throw new Error('Could not resolve host: ' + h);
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Hosts resolving to private IPs cannot be scanned: ' + h);
}

const TRACK_RE = /collect|\/tr\/?|pixel|pagead|conversion|analytics|tag|gtm|gtag|track|event|adsct|insight|licdn|tiktok|facebook|doubleclick|bing|clarity|hotjar|criteo|pinterest|snapchat|consent|cookie|onetrust|usercentrics|didomi|yandex|segment|insider/i;

const REJECT_SEL = ['#onetrust-reject-all-handler', '#CybotCookiebotDialogBodyButtonDecline', '#didomi-notice-disagree-button', '[data-testid="uc-deny-all-button"]', '.cky-btn-reject', '#truste-consent-required', '#iubenda-cs-reject', '.iubenda-cs-reject-btn', '.cmplz-deny', '.cmplz-btn.cmplz-deny', 'button.sp_choice_type_13', '#cookiescript_reject', '.cc-deny', '[data-cookiefirst-action="reject"]', '#axeptio_btn_dismiss', '.qc-cmp2-summary-buttons button[mode="secondary"]'];
const ACCEPT_SEL = ['#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept', '#didomi-notice-agree-button', '[data-testid="uc-accept-all-button"]', '.cky-btn-accept', '#truste-consent-button', '.iubenda-cs-accept-btn', '.cmplz-accept', 'button.sp_choice_type_11', '#cookiescript_accept', '.cc-allow', '.cc-accept', '[data-cookiefirst-action="accept"]', '#axeptio_btn_acceptAll', '.qc-cmp2-summary-buttons button[mode="primary"]'];
const REJECT_TXT = /^\s*(tümünü reddet|hepsini reddet|reddet|tümünü reddedin|kabul etmiyorum|reject all|reject|decline all|decline|deny all|deny|refuse all|refuse|only necessary|necessary only|use necessary cookies only|sadece (gerekli|zorunlu)|yalnızca (gerekli|zorunlu)|zorunlu çerezler|alle ablehnen|ablehnen|nur notwendige)\b/i;
const ACCEPT_TXT = /^\s*(tümünü kabul et|tümünü kabul ediyorum|tüm çerezleri kabul et|tümüne i̇zin ver|tümüne izin ver|çerezleri kabul et|hepsini kabul et|tümüne izin ver|kabul et|kabul ediyorum|onayla|izin ver|accept all|accept all cookies|accept cookies|accept|allow all|allow cookies|i agree|agree|got it|ok|tamam|anladım|alle akzeptieren|akzeptieren)\b/i;
const ATC_TXT = /(sepete ekle|sepete at|add to (cart|bag|basket)|in den warenkorb|satın al|buy now|hemen al)/i;
const PRODUCT_HREF = /(\/(p|product|products|urun|urunler|item|dp)\/|-p-\d+|-p\d+|\/[a-z0-9-]+-\d{4,}(\.html)?$|\.html$)/i;

async function findAndClick(page, selectors, textRe) {
  for (const frame of page.frames()) {
    for (const sel of selectors) {
      try {
        const loc = frame.locator(sel).first();
        if (await loc.isVisible({ timeout: 300 })) { await loc.click({ timeout: 3000 }); return sel; }
      } catch { /* next */ }
    }
  }
  for (const frame of page.frames()) {
    try {
      const btns = frame.locator('button, a[role="button"], [role="button"], input[type="button"], input[type="submit"], a, [class*="cookie" i] div, [class*="cookie" i] span, [id*="cookie" i] div, [id*="cookie" i] span');
      const n = Math.min(await btns.count(), 400);
      for (let i = 0; i < n; i++) {
        const b = btns.nth(i);
        let t = '';
        try { t = ((await b.innerText({ timeout: 200 })) || (await b.getAttribute('value')) || '').trim(); } catch { continue; }
        const tn = t.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
        if (t && t.length < 40 && (textRe.test(t) || textRe.test(tn) || textRe.test(t.toLowerCase()))) {
          try { if (await b.isVisible()) { await b.click({ timeout: 3000 }); return 'text:"' + t + '"'; } } catch { /* */ }
        }
      }
    } catch { /* */ }
  }
  return null;
}

// Finds a product detail link on the current page: product-card containers first, then URL patterns.
async function findProduct(page, origin) {
  return page.evaluate(([origin, src]) => {
    const re = new RegExp(src, 'i');
    const here = location.pathname;
    const ok = (h) => { try { const u = new URL(h); return u.origin === origin && u.pathname !== here && u.pathname.length > 1 && !/(login|giris|uye|account|hesap|sepet|cart|blog|kampanya|iletisim|contact|yardim|help|sss|faq)/i.test(h); } catch { return false; } };
    const inCards = Array.from(document.querySelectorAll('[class*="product" i] a[href], [class*="urun" i] a[href], [data-product-id] a[href], [data-sku] a[href], [itemtype*="Product"] a[href]')).map((a) => a.href).filter(ok);
    const byPattern = Array.from(document.querySelectorAll('a[href]')).map((a) => a.href).filter((h) => ok(h) && re.test(new URL(h).pathname));
    const pick = (l) => l[Math.floor(l.length / 3)] || l[0] || null;
    return pick(byPattern) || pick(inCards.filter((h) => /\d{4,}|-p-|\/p\//.test(h))) || pick(inCards);
  }, [origin, PRODUCT_HREF.source]).catch(() => null);
}

async function bannerInfo(page) {
  return page.evaluate(() => {
    const re = /(çerez|cookie|kvkk|gdpr|consent|gizlilik)/i;
    const cands = Array.from(document.querySelectorAll('div,section,aside,dialog,form')).filter((el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const pos = s.position === 'fixed' || s.position === 'sticky' || el.getAttribute('role') === 'dialog' || /cookie|consent|cmp|gdpr|kvkk/i.test(el.id + ' ' + el.className);
      return pos && re.test((el.innerText || '').slice(0, 600)) && el.querySelector('button,a');
    });
    const el = cands[0];
    return el ? { found: true, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 200) } : { found: false };
  }).catch(() => ({ found: false }));
}

async function snapshotDL(page) {
  return page.evaluate(() => {
    const seen = new WeakSet();
    const ser = (v, d) => {
      if (d > 8) return '[depth]';
      if (v === null || typeof v !== 'object') return typeof v === 'function' ? '[function]' : v;
      if (typeof Node !== 'undefined' && v instanceof Node) return '[DOM]';
      if (seen.has(v)) return '[circular]';
      seen.add(v);
      if (Object.prototype.toString.call(v) === '[object Arguments]') { const o = { __args: true }; Array.from(v).forEach((x, i) => { o[i] = ser(x, d + 1); }); return o; }
      if (Array.isArray(v)) return v.slice(0, 200).map((x) => ser(x, d + 1));
      const o = {}; Object.keys(v).slice(0, 200).forEach((k) => { try { o[k] = ser(v[k], d + 1); } catch { o[k] = '[err]'; } }); return o;
    };
    return Array.isArray(window.dataLayer) ? window.dataLayer.map((x) => ser(x, 0)) : [];
  }).catch(() => []);
}

async function settle(page, ms = 4000) {
  try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch { /* */ }
  await page.waitForTimeout(ms);
}
async function scrollPage(page) {
  try { await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight && y < 8000; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)); } }); } catch { /* */ }
}

// Test mode: AUDIT_MOCK=<fixture.mjs> → every request is answered by the fixture (no network)
const mock = process.env.AUDIT_MOCK ? (await import(new URL(process.env.AUDIT_MOCK, 'file://' + process.cwd() + '/').href)).default : null;
async function prepare(context) { if (mock) await context.route('**/*', mock); }

function recorder(context, store) {
  store.phase = 'pre_consent';
  context.on('request', (req) => {
    const url = req.url();
    const type = req.resourceType();
    if (!/^https?:/.test(url)) return;
    const keep = type === 'document' || type === 'script' || TRACK_RE.test(url) || ['xhr', 'fetch', 'ping', 'beacon', 'other'].includes(type) && !/\.(png|jpe?g|webp|gif|svg|woff2?|css)(\?|$)/i.test(url);
    if (!keep) return;
    let body = '';
    try { body = req.postData() || ''; } catch { /* binary */ }
    store.requests.push({ url: url.slice(0, 8000), method: req.method(), postData: body.slice(0, 60000), t: Date.now(), type, phase: store.phase, page: req.frame()?.url?.() || '' });
  });
}

async function main() {
  const url = normUrl(args.url);
  await assertPublic(url);
  const extra = ['product', 'cart', 'checkout'].map((k) => (args[k] && args[k] !== 'true' ? normUrl(args[k]) : null));
  for (const e of extra) if (e) await assertPublic(e);
  const notes = [];
  const proxy = mock ? null : (process.env.HTTPS_PROXY || process.env.https_proxy);
  const launchOpts = proxy ? { proxy: { server: proxy } } : {};
  if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launchOpts);
  const capture = {
    meta: { url, sector: args.sector || 'ecommerce', currency: (args.currency || '').toUpperCase(), mode: 'live', scannedAt: new Date().toISOString(), notes },
    phases: {}, dataLayer: [], html: '', cmp: {}, pages: []
  };

  // ---------------- Scenario A: before consent → accept → funnel
  const ctxA = await browser.newContext({ userAgent: UA, locale: 'tr-TR', viewport: { width: 1366, height: 900 } });
  const A = { requests: [] };
  await prepare(ctxA);
  recorder(ctxA, A);
  const page = await ctxA.newPage();
  const dlPages = [];
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) { notes.push('Home page failed to load: ' + e.message.split('\n')[0]); }
  await settle(page, 5000);
  capture.html = (await page.content().catch(() => '')).slice(0, 400000);
  const bi = await bannerInfo(page);
  capture.cmp.bannerFound = bi.found; capture.cmp.bannerText = bi.text || '';
  const preCookies = (await ctxA.cookies()).map((c) => ({ name: c.name, domain: c.domain }));
  capture.pages.push({ url: page.url(), phase: 'pre_consent', title: await page.title().catch(() => '') });

  A.phase = 'accepted';
  const acc = await findAndClick(page, ACCEPT_SEL, ACCEPT_TXT);
  capture.cmp.acceptClicked = !!acc; capture.cmp.acceptSelector = acc || '';
  if (!acc) notes.push('"Accept" button could not be found automatically; the funnel was browsed without consent.');
  await settle(page, 3000);
  await scrollPage(page);
  await page.waitForTimeout(1500);
  dlPages.push(await snapshotDL(page));

  // Product page
  let productUrl = extra[0];
  if (!productUrl) {
    const origin = new URL(page.url() || url).origin;
    productUrl = await findProduct(page, origin);
    if (!productUrl) {
      // Fallback: open a category/listing page from the navigation and look for products there
      const cats = await page.evaluate((origin) => Array.from(document.querySelectorAll('nav a[href], header a[href], a[href]'))
        .map((a) => a.href).filter((h) => h.startsWith(origin) && new URL(h).pathname.length > 1 && !/(login|giris|uye|account|hesap|sepet|cart|blog|iletisim|contact|yardim|help|sss|faq|magaza|store-locator|kvkk|privacy|gizlilik|cookie|cerez)/i.test(h))
        .filter((h, i, arr) => arr.indexOf(h) === i).slice(0, 150), origin).catch(() => []);
      const score = (h) => { const p = new URL(h).pathname.replace(/\/$/, ''); const last = p.split('/').pop(); return (/-/.test(last) ? 2 : 0) + (p.split('/').length > 2 ? 1 : 0) - (/\d{4,}/.test(p) ? 3 : 0); };
      cats.sort((a, b) => score(b) - score(a));
      for (const c of cats.slice(0, 4)) {
        try {
          await page.goto(c, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await settle(page, 2500);
          await scrollPage(page);
          dlPages.push(await snapshotDL(page));
          capture.pages.push({ url: page.url(), phase: 'accepted', title: await page.title().catch(() => '') });
          productUrl = await findProduct(page, origin);
          if (productUrl) { notes.push('Listing page visited: ' + c); break; }
        } catch { /* next */ }
      }
    }
    if (productUrl) notes.push('Product page auto-selected: ' + productUrl);
  }
  if (productUrl) {
    try {
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await settle(page, 4000);
      await scrollPage(page);
      capture.pages.push({ url: page.url(), phase: 'accepted', title: await page.title().catch(() => '') });
      const atc = await findAndClick(page, ['[data-testid*="add-to-cart" i]', 'button[name="add"]', '#add-to-cart', '.add-to-cart', 'button.add_to_cart_button', '#addToCart', '[class*="addToCart" i]', '[class*="add-to-basket" i]', '[class*="sepete" i]'], ATC_TXT);
      if (atc) { notes.push('Add-to-cart clicked: ' + atc); await page.waitForTimeout(5000); }
      else notes.push('No "Add to cart" button found on the product page (a variant may need to be selected).');
      dlPages.push(await snapshotDL(page));
    } catch (e) { notes.push('Product page failed to load: ' + e.message.split('\n')[0]); }
  } else notes.push('No product page found; the funnel was audited from the home page only. Enter a product URL or use HAR mode for fuller results.');

  for (const [i, u] of [[1, extra[1]], [2, extra[2]]]) {
    if (!u) continue;
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await settle(page, 4000);
      capture.pages.push({ url: page.url(), phase: 'accepted', title: await page.title().catch(() => '') });
      dlPages.push(await snapshotDL(page));
    } catch (e) { notes.push((i === 1 ? 'Cart' : 'Checkout') + ' page failed to load: ' + e.message.split('\n')[0]); }
  }
  const accCookies = (await ctxA.cookies()).map((c) => ({ name: c.name, domain: c.domain }));
  capture.phases.pre_consent = { requests: A.requests.filter((r) => r.phase === 'pre_consent'), cookies: preCookies };
  capture.phases.accepted = { requests: A.requests.filter((r) => r.phase === 'accepted'), cookies: accCookies };
  capture.dataLayer = [].concat(...dlPages);
  await ctxA.close();

  // ---------------- Scenario B: fresh session → reject
  const ctxB = await browser.newContext({ userAgent: UA, locale: 'tr-TR', viewport: { width: 1366, height: 900 } });
  const B = { requests: [] };
  await prepare(ctxB);
  recorder(ctxB, B);
  const pb = await ctxB.newPage();
  try {
    await pb.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await settle(pb, 5000);
    const rej = await findAndClick(pb, REJECT_SEL, REJECT_TXT);
    capture.cmp.rejectClicked = !!rej; capture.cmp.rejectSelector = rej || '';
    if (rej) {
      await pb.waitForTimeout(1500);
      B.phase = 'after_reject';
      await pb.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
      await settle(pb, 5000);
      await scrollPage(pb);
      if (productUrl) { try { await pb.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); await settle(pb, 4000); } catch { /* */ } }
      capture.phases.after_reject = { requests: B.requests.filter((r) => r.phase === 'after_reject'), cookies: (await ctxB.cookies()).map((c) => ({ name: c.name, domain: c.domain })) };
    } else notes.push('"Reject" button could not be found automatically; reject test skipped (the CMP may have two layers).');
  } catch (e) { notes.push('Reject scenario failed: ' + e.message.split('\n')[0]); }
  await ctxB.close();
  await browser.close();

  capture.meta.requestCount = Object.values(capture.phases).reduce((a, p) => a + p.requests.length, 0);
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(capture));
  console.log(`Scan complete: ${capture.meta.requestCount} requests, ${capture.dataLayer.length} dataLayer pushes → ${OUT}`);
  notes.forEach((n) => console.log(' - ' + n));
}

main().catch((e) => { console.error('ERROR:', e.message); fs.writeFileSync(OUT + '.error', e.message); process.exit(1); });
