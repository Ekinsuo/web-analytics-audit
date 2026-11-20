// Live scan: visits the site with Playwright in 2 scenarios and produces input for the audit engine.
//  A) before consent → "Accept" → product / cart pages (funnel)
//  B) fresh session → "Reject" → page reload (post-reject requests + cookies)
// Usage: node scan.mjs --url https://site.com [--product URL] [--cart URL] [--sector ecommerce] [--currency TRY] --out capture.json
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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

const CHECKOUT_TXT = /^\s*(sepeti onayla|alışverişi tamamla|ödemeye geç|ödeme adımına geç|devam et|checkout|proceed to checkout|go to checkout|continue to checkout|kasaya git|zur kasse)\b/i;

// Fetches a text resource: via the browser context (real network), falling back to an in-page fetch (same-origin / test mode).
async function fetchText(ctx, page, u) {
  try {
    const r = await ctx.request.get(u, { timeout: 20000, maxRedirects: 5 });
    if (r.ok()) {
      let buf = await r.body();
      if (/\.gz(\?|$)/i.test(u) || (buf[0] === 0x1f && buf[1] === 0x8b)) { try { buf = zlib.gunzipSync(buf); } catch { /* not gzip */ } }
      return buf.toString('utf8', 0, Math.min(buf.length, 3000000));
    }
  } catch { /* fall back */ }
  try { return await page.evaluate(async (u) => { const r = await fetch(u); return r.ok ? (await r.text()).slice(0, 3000000) : null; }, u); } catch { return null; }
}
const locs = (xml) => Array.from(String(xml || '').matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)).map((m) => m[1].replace(/&amp;/g, '&'));

// robots.txt → sitemap(s) → product sitemap → 3 candidate URLs (start / middle / end)
async function sitemapCandidates(ctx, page, origin, notes) {
  const robots = await fetchText(ctx, page, origin + '/robots.txt');
  let maps = robots ? Array.from(robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)).map((m) => m[1]) : [];
  const trail = [maps.length ? 'robots.txt (' + maps.length + ' sitemap)' : 'robots.txt (no sitemap line)'];
  if (!maps.length) maps = [origin + '/sitemap.xml', origin + '/sitemap_index.xml'];
  const prodRe = /product|urun|item|pdp|\/p[-_]|-p-/i;
  const skipRe = /blog|news|haber|brand|marka|store|magaza|image|video|static|page|cms|campaign|kampanya/i;
  let urls = [];
  for (const m of maps.slice(0, 6)) {
    const xml = await fetchText(ctx, page, m);
    if (!xml) continue;
    let list = locs(xml);
    if (/<sitemapindex/i.test(xml)) {
      const file = (u) => { try { return new URL(u).pathname.split('/').pop(); } catch { return u; } };
      const isProd = (u) => prodRe.test(file(u)) && !skipRe.test(file(u));
      const child = list.find(isProd) || list.find((c) => /categor|kategori/i.test(file(c))) || null;
      trail.push(m.replace(origin, '') + ' (index, ' + list.length + ' sitemaps)');
      if (!child) continue;
      const cx = await fetchText(ctx, page, child);
      list = locs(cx);
      trail.push(child.replace(origin, '') + ' (' + list.length + ' URLs)');
    } else trail.push(m.replace(origin, '') + ' (' + list.length + ' URLs)');
    if (list.length) { urls = list; break; }
  }
  notes.push('Sitemap: ' + trail.join(' → '));
  urls = urls.filter((u) => { try { return new URL(u).hostname.replace(/^www\./, '') === new URL(origin).hostname.replace(/^www\./, ''); } catch { return false; } }).slice(0, 500);
  if (!urls.length) return [];
  const pick = [urls[0], urls[Math.floor(urls.length / 2)], urls[urls.length - 1]];
  return pick.filter((u, i) => pick.indexOf(u) === i);
}

// Is the current page a product detail page? (dataLayer view_item, schema.org Product, add-to-cart button)
async function productSignals(page) {
  return page.evaluate((atcSrc) => {
    const why = [];
    const dl = Array.isArray(window.dataLayer) ? window.dataLayer : [];
    if (dl.some((x) => x && (x.event === 'view_item' || x.event === 'productDetail' || (x.ecommerce && (x.ecommerce.detail || x.event === 'view_item'))))) why.push('dataLayer view_item');
    const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent).join(' ');
    if (/"@type"\s*:\s*"Product"/i.test(ld) || document.querySelector('[itemtype*="schema.org/Product"]')) why.push('schema.org Product');
    const re = new RegExp(atcSrc, 'i');
    if (Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).some((b) => re.test((b.innerText || b.value || '').trim()))) why.push('add-to-cart button');
    return { ok: why.length > 0, why };
  }, ATC_TXT.source).catch(() => ({ ok: false, why: [] }));
}

// Selects the first available size/colour variant (if any) before adding to cart.
async function selectVariant(page) {
  const sels = ['[class*="size" i] button:not([disabled]):not([class*="disabled" i])', '[class*="beden" i] button:not([disabled]):not([class*="disabled" i])', '[class*="variant" i] button:not([disabled]):not([class*="disabled" i])', '[class*="size" i] li:not([class*="disabled" i]) a', '[class*="beden" i] li:not([class*="disabled" i])', '[class*="variant" i] [class*="item" i]:not([class*="disabled" i])'];
  for (const sel of sels) {
    try { const l = page.locator(sel).first(); if (await l.isVisible({ timeout: 300 })) { await l.click({ timeout: 3000 }); await page.waitForTimeout(800); return sel; } } catch { /* next */ }
  }
  try {
    const sel = page.locator('select').first();
    if (await sel.isVisible({ timeout: 300 })) {
      const v = await sel.evaluate((s) => { const o = Array.from(s.options).find((x) => x.value && !x.disabled && x.index > 0); return o ? o.value : null; });
      if (v) { await sel.selectOption(v); return 'select=' + v; }
    }
  } catch { /* none */ }
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

  // ---------------- Funnel: product → variant → add to cart → cart → checkout (no payment)
  const origin = new URL(page.url() || url).origin;
  let productUrl = extra[0];
  let onProduct = false;
  const visit = async (u, label) => {
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await settle(page, 3500);
    await scrollPage(page);
    capture.pages.push({ url: page.url(), phase: 'accepted', title: await page.title().catch(() => ''), step: label });
    dlPages.push(await snapshotDL(page));
  };
  if (productUrl) {
    try { await visit(productUrl, 'product (given)'); onProduct = (await productSignals(page)).ok; } catch (e) { notes.push('Product page failed to load: ' + e.message.split('\n')[0]); }
  }
  // 1) Sitemap
  if (!onProduct) {
    const sm = await sitemapCandidates(ctxA, page, origin, notes);
    for (const [i, cand] of sm.entries()) {
      try {
        await visit(cand, 'product (sitemap)');
        const sig = await productSignals(page);
        notes.push('Candidate ' + (i + 1) + ': ' + new URL(cand).pathname + ' → ' + (sig.ok ? 'product page ✓ (' + sig.why.join(', ') + ')' : 'not a product page'));
        if (sig.ok) { productUrl = cand; onProduct = true; break; }
      } catch (e) { notes.push('Candidate ' + (i + 1) + ' failed to load: ' + e.message.split('\n')[0]); }
    }
  }
  // 2) Links on the home page, then deeper category pages
  if (!onProduct) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await settle(page, 2500); } catch { /* */ }
    productUrl = await findProduct(page, origin);
    if (!productUrl) {
      const cats = await page.evaluate((origin) => Array.from(document.querySelectorAll('nav a[href], header a[href], a[href]'))
        .map((a) => a.href).filter((h) => h.startsWith(origin) && new URL(h).pathname.length > 1 && !/(login|giris|uye|account|hesap|sepet|cart|blog|iletisim|contact|yardim|help|sss|faq|magaza|store-locator|kvkk|privacy|gizlilik|cookie|cerez)/i.test(h))
        .filter((h, i, arr) => arr.indexOf(h) === i).slice(0, 150), origin).catch(() => []);
      const score = (h) => { const p = new URL(h).pathname.replace(/\/$/, ''); const last = p.split('/').pop(); return (/-/.test(last) ? 2 : 0) + (p.split('/').length > 2 ? 1 : 0) - (/\d{4,}/.test(p) ? 3 : 0); };
      cats.sort((x, y) => score(y) - score(x));
      for (const c of cats.slice(0, 4)) {
        try { await visit(c, 'listing'); productUrl = await findProduct(page, origin); if (productUrl) { notes.push('Listing page visited: ' + c); break; } } catch { /* next */ }
      }
    }
    if (productUrl) {
      try { await visit(productUrl, 'product (links)'); onProduct = (await productSignals(page)).ok; notes.push('Product page from links: ' + productUrl + (onProduct ? ' ✓' : ' (no product signals)')); } catch (e) { notes.push('Product page failed to load: ' + e.message.split('\n')[0]); }
    }
  }
  if (onProduct) {
    const v = await selectVariant(page);
    if (v) notes.push('Variant selected: ' + v);
    const atc = await findAndClick(page, ['[data-testid*="add-to-cart" i]', '[data-testid*="addToBasket" i]', 'button[name="add"]', '#add-to-cart', '.add-to-cart', 'button.add_to_cart_button', '#addToCart', '[class*="addToCart" i]', '[class*="add-to-basket" i]', '[class*="add-to-bs" i]', '[class*="sepete" i]'], ATC_TXT);
    if (atc) { notes.push('Add-to-cart clicked: ' + atc); await page.waitForTimeout(5000); }
    else notes.push('No "Add to cart" button found on the product page.');
    dlPages.push(await snapshotDL(page));
    // Cart
    let cartUrl = extra[1];
    if (!cartUrl) cartUrl = await page.evaluate((origin) => { const a = Array.from(document.querySelectorAll('a[href]')).find((x) => x.href.startsWith(origin) && /\/(sepet|sepetim|cart|basket|bag)(\/|\?|$)/i.test(new URL(x.href).pathname)); return a ? a.href : null; }, origin).catch(() => null);
    if (!cartUrl) cartUrl = origin + '/sepet';
    try {
      await visit(cartUrl, 'cart');
      notes.push('Cart page visited: ' + page.url());
      // Checkout (never pays, never fills forms)
      const co = await findAndClick(page, ['[data-testid*="checkout" i]', 'a[href*="checkout" i]', 'a[href*="odeme" i]'], CHECKOUT_TXT);
      if (co) {
        await settle(page, 4000);
        capture.pages.push({ url: page.url(), phase: 'accepted', title: await page.title().catch(() => ''), step: 'checkout' });
        dlPages.push(await snapshotDL(page));
        notes.push('Checkout button clicked: ' + co + ' → ' + page.url() + (/login|giris|uye|signin/i.test(page.url()) ? ' (login required — stopped here)' : ''));
      } else notes.push('No checkout button found on the cart page.');
    } catch (e) { notes.push('Cart page failed to load: ' + e.message.split('\n')[0]); }
  } else notes.push('No product page found (sitemap, links and category pages tried); the funnel was audited from the home page only. Enter a product URL or use HAR mode.');
  if (extra[2]) { try { await visit(extra[2], 'checkout (given)'); } catch (e) { notes.push('Checkout page failed to load: ' + e.message.split('\n')[0]); } }
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
