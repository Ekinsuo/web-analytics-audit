/*!
 * Web Analytics Audit — denetim motoru
 * E-ticaret / lead-gen tracking QA kontrol listesini (GA4, Google Ads, Meta, TikTok,
 * LinkedIn, X, DataLayer, Altyapı, CMP) network istekleri + dataLayer + çerezler
 * üzerinden uygular. Tarayıcıda (window.AuditEngine) ve Node'da (require) çalışır.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuditEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  // ---------------------------------------------------------------------------
  // Sabitler
  // ---------------------------------------------------------------------------
  var CURRENCY_RE = /^[A-Z]{3}$/;
  var HEX64_RE = /^[a-f0-9]{64}$/i;
  var B64HASH_RE = /^[A-Za-z0-9_\-+/]{43,44}=?$/;
  var EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i;
  var PHONE_VAL_RE = /^(\+?90|0)?\s*5\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}$|^\+\d{10,14}$/;

  var FUNNEL = ['view_item_list', 'view_item', 'add_to_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'purchase'];

  var PLATFORMS = [
    { key: 'datalayer', name: 'DataLayer' },
    { key: 'infra', name: 'Altyapı' },
    { key: 'cmp', name: 'CMP / Consent' },
    { key: 'ga4', name: 'GA4' },
    { key: 'gads', name: 'Google Ads' },
    { key: 'meta', name: 'Meta Ads' },
    { key: 'tiktok', name: 'TikTok' },
    { key: 'linkedin', name: 'LinkedIn' },
    { key: 'x', name: 'X (Twitter)' }
  ];

  var MAPPING = [
    ['view_item_list', 'ViewContent (liste) / ViewCategory', 'ViewContent', '—'],
    ['view_item', 'ViewContent', 'ViewContent', '—'],
    ['add_to_cart', 'AddToCart', 'AddToCart', '—'],
    ['begin_checkout', 'InitiateCheckout', 'InitiateCheckout', '—'],
    ['add_shipping_info', 'AddShippingInfo / custom', 'custom', '—'],
    ['add_payment_info', 'AddPaymentInfo', 'AddPaymentInfo', '—'],
    ['purchase', 'Purchase', 'CompletePayment / Purchase', 'conversion (purchase)']
  ];

  // GA4 resmi recommended e-commerce event şeması
  var GA4_RULES = {
    view_item_list: { req: ['items'], rec: ['item_list_id', 'item_list_name'] },
    select_item: { req: ['items'], rec: ['item_list_id', 'item_list_name'] },
    view_item: { req: ['currency', 'value', 'items'], rec: [] },
    add_to_wishlist: { req: ['currency', 'value', 'items'], rec: [] },
    add_to_cart: { req: ['currency', 'value', 'items'], rec: [] },
    remove_from_cart: { req: ['currency', 'value', 'items'], rec: [] },
    view_cart: { req: ['currency', 'value', 'items'], rec: [] },
    begin_checkout: { req: ['currency', 'value', 'items'], rec: ['coupon'] },
    add_shipping_info: { req: ['currency', 'value', 'items'], rec: ['shipping_tier', 'coupon'] },
    add_payment_info: { req: ['currency', 'value', 'items'], rec: ['payment_type', 'coupon'] },
    purchase: { req: ['transaction_id', 'currency', 'value', 'items'], rec: ['tax', 'shipping', 'coupon'] },
    refund: { req: ['transaction_id', 'currency', 'value'], rec: ['items'] },
    generate_lead: { req: [], rec: ['currency', 'value'] }
  };
  var GA4_VALUE_EVENTS = ['view_item', 'add_to_wishlist', 'add_to_cart', 'remove_from_cart', 'view_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'purchase', 'refund', 'generate_lead'];

  var META_RULES = {
    ViewContent: { req: ['content_ids|contents', 'content_type'], rec: ['value', 'currency', 'content_name'] },
    ViewCategory: { req: [], rec: ['content_ids|contents', 'content_category'] },
    AddToCart: { req: ['content_ids|contents', 'content_type'], rec: ['value', 'currency'] },
    AddToWishlist: { req: [], rec: ['content_ids|contents', 'value', 'currency'] },
    InitiateCheckout: { req: [], rec: ['value', 'currency', 'num_items', 'content_ids|contents'] },
    AddShippingInfo: { req: [], rec: ['value', 'currency'] },
    AddPaymentInfo: { req: [], rec: ['value', 'currency', 'content_ids|contents'] },
    Purchase: { req: ['value', 'currency', 'content_ids|contents', 'content_type'], rec: ['num_items'] },
    Lead: { req: [], rec: ['value', 'currency'] },
    CompleteRegistration: { req: [], rec: ['value', 'currency'] },
    Search: { req: [], rec: ['search_string'] },
    Contact: { req: [], rec: [] },
    Subscribe: { req: ['value', 'currency'], rec: ['predicted_ltv'] },
    StartTrial: { req: ['value', 'currency'], rec: ['predicted_ltv'] }
  };
  var META_ORDER = ['ViewContent', 'ViewCategory', 'AddToCart', 'InitiateCheckout', 'AddShippingInfo', 'AddPaymentInfo', 'Purchase', 'Lead', 'CompleteRegistration'];

  var TT_RULES = {
    ViewContent: { req: ['contents|content_id', 'content_type'], rec: ['value', 'currency'] },
    AddToCart: { req: ['contents|content_id', 'content_type'], rec: ['value', 'currency'] },
    AddToWishlist: { req: [], rec: ['contents|content_id', 'value', 'currency'] },
    InitiateCheckout: { req: [], rec: ['contents|content_id', 'value', 'currency'] },
    AddPaymentInfo: { req: [], rec: ['contents|content_id', 'value', 'currency'] },
    PlaceAnOrder: { req: [], rec: ['contents|content_id', 'value', 'currency'] },
    CompletePayment: { req: ['value', 'currency', 'contents|content_id'], rec: ['content_type'] },
    Purchase: { req: ['value', 'currency', 'contents|content_id'], rec: ['content_type'] },
    SubmitForm: { req: [], rec: [] },
    Contact: { req: [], rec: [] },
    CompleteRegistration: { req: [], rec: ['value', 'currency'] },
    Lead: { req: [], rec: ['value', 'currency'] }
  };

  var MARKETING_COOKIES = [
    [/^_ga(_|$)/, 'GA4'], [/^_gid$/, 'GA'], [/^_gcl_(au|aw|dc|gb|gs)$/, 'Google Ads'], [/^_fbp$/, 'Meta'], [/^_fbc$/, 'Meta'],
    [/^_ttp$/, 'TikTok'], [/^_tt_enable_cookie$/, 'TikTok'], [/^ttcsid/, 'TikTok'], [/^li_fat_id$/, 'LinkedIn'], [/^li_sugr$/, 'LinkedIn'],
    [/^_uet(sid|vid)$/, 'Microsoft Ads'], [/^_clck$|^_clsk$/, 'Clarity'], [/^_hj/, 'Hotjar'], [/^_pin_unauth$/, 'Pinterest'],
    [/^_scid/, 'Snapchat'], [/^cto_bundle$/, 'Criteo'], [/^_twclid$|^muc_ads$/, 'X'], [/^_ym_/, 'Yandex'], [/^IDE$|^test_cookie$/, 'DoubleClick']
  ];

  var CMP_VENDORS = [
    [/cdn\.cookielaw\.org|onetrust\.com|otSDKStub|optanon/i, 'OneTrust'],
    [/consent\.cookiebot\.(com|eu)|cookiebot/i, 'Cookiebot'],
    [/usercentrics\.(eu|com)|app\.usercentrics/i, 'Usercentrics'],
    [/sdk\.privacy-center\.org|didomi/i, 'Didomi'],
    [/cookieyes\.com|cdn-cookieyes/i, 'CookieYes'],
    [/quantcast\.mgr\.consensu|cmp\.quantcast/i, 'Quantcast Choice'],
    [/consent\.trustarc\.com|truste\.com/i, 'TrustArc'],
    [/iubenda\.com/i, 'iubenda'],
    [/complianz/i, 'Complianz'],
    [/osano\.com/i, 'Osano'],
    [/axeptio/i, 'Axeptio'],
    [/termly\.io/i, 'Termly'],
    [/sourcepoint|sp-prod\.net|privacy-mgmt\.com/i, 'Sourcepoint'],
    [/cdn\.trustcommander\.net|commandersact/i, 'Commanders Act'],
    [/cookiefirst\.com/i, 'CookieFirst'],
    [/consentmanager\.net/i, 'consentmanager'],
    [/cookie-script\.com/i, 'Cookie Script'],
    [/cookiehub\.(net|eu)/i, 'CookieHub'],
    [/borlabs/i, 'Borlabs'],
    [/termsfeed\.com/i, 'TermsFeed'],
    [/klaro/i, 'Klaro'],
    [/cookieinformation\.com/i, 'Cookie Information'],
    [/civiccomputing|cookie-control/i, 'Civic Cookie Control']
  ];

  // Envanter: sadece tespit edilen diğer platformlar
  var OTHER_TAGS = [
    { name: 'Google Tag Manager', re: /googletagmanager\.com\/gtm\.js|\/gtm\.js\?id=GTM-/i, id: /[?&]id=(GTM-[A-Z0-9]+)/i },
    { name: 'Microsoft Ads (UET)', re: /bat\.bing\.com/i, id: /[?&]ti=(\d+)/ },
    { name: 'Microsoft Clarity', re: /clarity\.ms\/(tag|collect)/i, id: /clarity\.ms\/tag\/([a-z0-9]+)/i },
    { name: 'Hotjar', re: /hotjar\.com/i, id: /hotjar-(\d+)\.js|[?&]sv=|\/c\/hotjar-(\d+)/i },
    { name: 'Criteo', re: /criteo\.(net|com)/i, id: /[?&]a=(\d+)/ },
    { name: 'Pinterest', re: /ct\.pinterest\.com|s\.pinimg\.com\/ct\/core/i, id: /[?&]tid=(\d+)/ },
    { name: 'Snapchat', re: /tr\.snapchat\.com|sc-static\.net\/scevent/i, id: /[?&]pid=([a-f0-9\-]+)/i },
    { name: 'Yandex Metrica', re: /mc\.yandex\.(ru|com)/i, id: /\/watch\/(\d+)/ },
    { name: 'Floodlight (CM360)', re: /fls\.doubleclick\.net|ad\.doubleclick\.net\/activity/i, id: /src=(\d+)/ },
    { name: 'Insider', re: /useinsider\.com|api\.useinsider/i, id: null },
    { name: 'Segmentify', re: /segmentify\.com/i, id: null },
    { name: 'RTB House', re: /creativecdn\.com|rtbhouse/i, id: null },
    { name: 'Taboola', re: /taboola\.com/i, id: null },
    { name: 'Outbrain', re: /outbrain\.com/i, id: null },
    { name: 'Adform', re: /adform\.net/i, id: null },
    { name: 'Segment', re: /cdn\.segment\.com|api\.segment\.io/i, id: null },
    { name: 'Mixpanel', re: /mixpanel\.com/i, id: null },
    { name: 'Amplitude', re: /amplitude\.com/i, id: null },
    { name: 'Adobe Analytics', re: /\/b\/ss\/|omtrdc\.net|2o7\.net/i, id: null },
    { name: 'Matomo', re: /matomo\.(php|js)|piwik\.(php|js)/i, id: null },
    { name: 'HubSpot', re: /js\.hs-scripts\.com|track\.hubspot\.com|js\.hs-analytics/i, id: null },
    { name: 'Klaviyo', re: /klaviyo\.com/i, id: null },
    { name: 'Reddit Pixel', re: /alb\.reddit\.com|redditstatic\.com\/ads/i, id: null },
    { name: 'Quora Pixel', re: /q\.quora\.com/i, id: null },
    { name: 'Yahoo / Yahoo Japan', re: /sp\.analytics\.yahoo\.com|s\.yimg\.(jp|com)\/.*ytag/i, id: null },
    { name: 'Hepsiburada / Trendyol Ads', re: /hbads|trendyol.*pixel/i, id: null }
  ];

  var MARKETING_HOST_RE = /facebook\.com\/tr|connect\.facebook\.net|analytics\.tiktok\.com|googleadservices\.com|googleads\.g\.doubleclick\.net|\/pagead\/(1p-)?(conversion|user-list|viewthroughconversion)|px\.ads\.linkedin\.com|snap\.licdn\.com|analytics\.twitter\.com|static\.ads-twitter\.com|t\.co\/i\/adsct|bat\.bing\.com|criteo|ct\.pinterest\.com|tr\.snapchat\.com|doubleclick\.net|clarity\.ms|hotjar|mc\.yandex|taboola|outbrain|creativecdn/i;

  // ---------------------------------------------------------------------------
  // Yardımcılar
  // ---------------------------------------------------------------------------
  function str(v, max) {
    if (v === undefined) return 'Mevcut değil';
    var s;
    if (typeof v === 'string') s = v;
    else { try { s = JSON.stringify(v); } catch (e) { s = String(v); } }
    max = max || 300;
    return s.length > max ? s.slice(0, max) + '…' : s;
  }
  function isNum(v) { return v !== null && v !== '' && v !== undefined && !isNaN(Number(v)) && isFinite(Number(v)); }
  function uniq(a) { var o = []; a.forEach(function (x) { if (x !== undefined && x !== null && x !== '' && o.indexOf(x) < 0) o.push(x); }); return o; }
  function safeUrl(u) { try { return new URL(u); } catch (e) { return null; } }
  function parseJSON(s) { try { return JSON.parse(s); } catch (e) { return undefined; } }
  function isHashed(v) { return typeof v === 'string' && (HEX64_RE.test(v) || B64HASH_RE.test(v)); }
  function hostOf(u) { var x = safeUrl(u); return x ? x.hostname : ''; }
  function regDomain(h) { var p = (h || '').split('.'); if (p.length <= 2) return h; var tail2 = p.slice(-2).join('.'); if (/^(com|co|org|net|gov|edu|gen|web|av|bel)\.[a-z]{2}$/.test(tail2)) return p.slice(-3).join('.'); return tail2; }
  function isGoogleHost(h) { return /(^|\.)(google-analytics\.com|analytics\.google\.com|googletagmanager\.com|google\.[a-z.]+|googleadservices\.com|doubleclick\.net|googlesyndication\.com|gstatic\.com)$/.test(h); }
  function pickSev(status, sev) { return status === 'pass' || status === 'na' ? null : (sev || 2); }

  function mergeParams(u, body) {
    var p = {};
    if (u) u.searchParams.forEach(function (v, k) { p[k] = v; });
    if (body && typeof body === 'string' && body.indexOf('=') > 0 && body.charAt(0) !== '{' && body.charAt(0) !== '[') {
      try { new URLSearchParams(body).forEach(function (v, k) { p[k] = v; }); } catch (e) { /* yoksay */ }
    }
    return p;
  }

  // ---------------------------------------------------------------------------
  // Girdi normalizasyonu
  // ---------------------------------------------------------------------------
  function normReq(r, phase) {
    var u = safeUrl(r.url);
    if (!u) return null;
    return {
      url: r.url, u: u, host: u.hostname, path: u.pathname, method: (r.method || 'GET').toUpperCase(),
      body: r.postData || r.body || '', phase: r.phase || phase || 'default', t: typeof r.t === 'number' ? r.t : (r.time ? Date.parse(r.time) || 0 : 0),
      type: r.type || r.resourceType || '', page: r.page || ''
    };
  }

  /** HAR dosyasını (Chrome DevTools > Network > Export HAR) ortak girdi formatına çevirir. */
  function fromHAR(har, phase) {
    var log = har && (har.log || har);
    var entries = (log && log.entries) || [];
    var out = { requests: [], cookies: [], html: '', pageUrl: '' };
    var cookieMap = {};
    entries.forEach(function (e) {
      var rq = e.request || {};
      out.requests.push({ url: rq.url, method: rq.method, postData: rq.postData && rq.postData.text, time: e.startedDateTime, type: e._resourceType || '', phase: phase });
      (rq.cookies || []).forEach(function (c) { cookieMap[c.name] = { name: c.name, domain: hostOf(rq.url), source: 'request' }; });
      var rs = e.response || {};
      (rs.cookies || []).forEach(function (c) { cookieMap[c.name] = { name: c.name, domain: c.domain || hostOf(rq.url), source: 'set-cookie' }; });
      (rs.headers || []).forEach(function (h) {
        if (/^set-cookie$/i.test(h.name)) { var n = String(h.value).split('=')[0].trim(); if (n) cookieMap[n] = cookieMap[n] || { name: n, domain: hostOf(rq.url), source: 'set-cookie' }; }
      });
      var mime = (rs.content && rs.content.mimeType) || '';
      if (!out.html && /text\/html/.test(mime) && rs.content && rs.content.text && (e._resourceType === 'document' || !e._resourceType)) {
        out.html = rs.content.text.slice(0, 400000); out.pageUrl = rq.url;
      }
    });
    if (!out.pageUrl && entries[0]) out.pageUrl = entries[0].request.url;
    out.cookies = Object.keys(cookieMap).map(function (k) { return cookieMap[k]; });
    return out;
  }

  /**
   * Ortak girdi:
   * { meta:{url, sector, currency, mode, scannedAt},
   *   phases:{ pre_consent?:{requests,cookies}, accepted?:{...}, after_reject?:{...}, har?:{...} },
   *   dataLayer:[], html:'', cmp:{vendor, bannerFound, rejectClicked, acceptClicked, notes:[]}, pages:[] }
   */
  function normalize(input) {
    var phases = input.phases || {};
    var all = [];
    Object.keys(phases).forEach(function (ph) {
      (phases[ph].requests || []).forEach(function (r) { var n = normReq(r, ph); if (n) all.push(n); });
    });
    all.sort(function (a, b) { return a.t - b.t; });
    var phaseReq = function (ph) { return all.filter(function (r) { return r.phase === ph; }); };
    var main = all.filter(function (r) { return r.phase !== 'after_reject' && r.phase !== 'har_reject'; });
    return {
      meta: input.meta || {}, phases: phases, all: all, main: main, phaseReq: phaseReq,
      dataLayer: Array.isArray(input.dataLayer) ? input.dataLayer : [], html: input.html || '', cmp: input.cmp || {},
      pages: input.pages || [], siteHost: hostOf((input.meta && input.meta.url) || '')
    };
  }

  // ---------------------------------------------------------------------------
  // Check toplayıcı
  // ---------------------------------------------------------------------------
  function Collector(platform) {
    this.platform = platform; this.checks = [];
  }
  Collector.prototype.add = function (c) {
    var o = {
      platform: this.platform, component: c.component || 'Genel', event: c.event || 'Tüm eventler', title: c.title,
      status: c.status, severity: pickSev(c.status, c.severity), observed: c.observed === undefined ? '' : c.observed,
      expected: c.expected || '', impact: c.status === 'pass' ? (c.passNote || '') : (c.impact || ''),
      recommendation: c.status === 'pass' ? '' : (c.recommendation || '')
    };
    this.checks.push(o); return o;
  };

  /** Bir event'in hit'lerini tek tek değerlendir; hit bazlı gözlem metni üretir. */
  function perHit(col, component, event, hits, title, fn, meta) {
    if (!hits.length) return;
    var res = hits.map(function (h) { return fn(h); });
    var applicable = res.filter(function (r) { return r && r.ok !== null; });
    if (!applicable.length) return;
    var hasFail = res.some(function (r) { return r && r.ok === false; });
    var hasWarn = res.some(function (r) { return r && r.ok === 'warn'; });
    var obs = res.length > 1
      ? res.slice(0, 6).map(function (r, i) { return 'Hit #' + (i + 1) + ': ' + (r ? r.val : '—'); }).join(' / ') + (res.length > 6 ? ' / … (' + res.length + ' hit)' : '')
      : (res[0] ? res[0].val : '');
    col.add({
      component: component, event: event, title: title, status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
      severity: hasFail ? meta.severity : (meta.warnSeverity || 3), observed: obs, expected: meta.expected,
      impact: meta.impact, recommendation: meta.rec, passNote: meta.passNote
    });
  }

  // ---------------------------------------------------------------------------
  // GA4
  // ---------------------------------------------------------------------------
  var ITEM_KEYS = { id: 'item_id', nm: 'item_name', br: 'item_brand', ca: 'item_category', c2: 'item_category2', c3: 'item_category3', c4: 'item_category4', c5: 'item_category5', va: 'item_variant', pr: 'price', qt: 'quantity', cp: 'coupon', ds: 'discount', af: 'affiliation', lp: 'index', li: 'item_list_id', ln: 'item_list_name', lo: 'location_id' };
  function parseGa4Item(s) {
    var it = {}; var custom = {};
    String(s).split('~').forEach(function (seg) {
      if (!seg) return;
      var k = seg.slice(0, 2), v = seg.slice(2);
      if (/^k\d$/.test(k)) custom[k.slice(1)] = { k: v };
      else if (/^v\d$/.test(k)) { custom[k.slice(1)] = custom[k.slice(1)] || {}; custom[k.slice(1)].v = v; }
      else if (ITEM_KEYS[k]) it[ITEM_KEYS[k]] = (k === 'pr' || k === 'qt' || k === 'ds') && isNum(v) ? Number(v) : v;
    });
    Object.keys(custom).forEach(function (i) { if (custom[i].k) it[custom[i].k] = custom[i].v; });
    return it;
  }

  function ga4Hits(reqs) {
    var hits = [];
    reqs.forEach(function (r) {
      var isCollect = /\/g\/collect$/.test(r.path) || (/\/collect$/.test(r.path) && r.u.searchParams.get('v') === '2' && /^G-/.test(r.u.searchParams.get('tid') || ''));
      if (!isCollect) return;
      var lines = r.body ? String(r.body).split(/\r?\n/).filter(Boolean) : [''];
      lines.forEach(function (line, li) {
        var p = {};
        r.u.searchParams.forEach(function (v, k) { p[k] = v; });
        if (line) { try { new URLSearchParams(line).forEach(function (v, k) { p[k] = v; }); } catch (e) { /* */ } }
        if (!p.en) return;
        var params = {}, items = [], strTyped = {};
        var prKeys = Object.keys(p).filter(function (k) { return /^pr\d+$/.test(k); }).sort(function (a, b) { return Number(a.slice(2)) - Number(b.slice(2)); });
        prKeys.forEach(function (k) { items.push(parseGa4Item(p[k])); });
        Object.keys(p).forEach(function (k) {
          if (k.indexOf('ep.') === 0) { params[k.slice(3)] = p[k]; strTyped[k.slice(3)] = true; }
          else if (k.indexOf('epn.') === 0) params[k.slice(4)] = isNum(p[k]) ? Number(p[k]) : p[k];
        });
        if (p.cu) params.currency = p.cu;
        hits.push({ en: p.en, tid: p.tid, cid: p.cid, uid: p.uid, gcs: p.gcs, gcd: p.gcd, dl: p.dl || '', params: params, strTyped: strTyped, items: items, host: r.host, t: r.t + li, phase: r.phase, raw: p });
      });
    });
    return hits;
  }

  function ga4Get(h, name) {
    if (name === 'items') return h.items.length ? h.items : undefined;
    return h.params[name];
  }

  function itemsSig(items) { return (items || []).map(function (i) { return (i.item_id || i.item_name || '') + 'x' + (i.quantity || ''); }).join('|'); }

  function findDuplicates(hits, keyFn, windowMs) {
    // aynı anahtar + kısa zaman aralığı => çift tetiklenme
    var groups = {}; var dups = [];
    hits.forEach(function (h, i) { var k = keyFn(h); (groups[k] = groups[k] || []).push({ h: h, i: i }); });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      for (var j = 1; j < g.length; j++) {
        if (Math.abs(g[j].h.t - g[j - 1].h.t) <= windowMs) dups.push([g[j - 1].i, g[j].i]);
      }
    });
    return dups;
  }

  function decodeGcd(gcd) {
    // gcd: "13p3p3p2p5" → [ad_storage, analytics_storage, ad_user_data, ad_personalization]
    if (!gcd || gcd.length < 9) return null;
    var letters = [gcd.charAt(2), gcd.charAt(4), gcd.charAt(6), gcd.charAt(8)];
    var map = function (c) {
      if (c === 'l') return 'ayarlanmamış';
      if ('tnrv'.indexOf(c) >= 0) return 'granted';
      if ('pqmu'.indexOf(c) >= 0) return 'denied';
      if (c === 'e' || c === 'f') return 'denied';
      return '?(' + c + ')';
    };
    return { ad_storage: map(letters[0]), analytics_storage: map(letters[1]), ad_user_data: map(letters[2]), ad_personalization: map(letters[3]), raw: gcd };
  }

  function auditGA4(ctx, opt) {
    var col = new Collector('ga4');
    var hits = ga4Hits(ctx.main);
    var scripts = ctx.main.filter(function (r) { return /\/gtag\/js$/.test(r.path) && /^G-/.test(r.u.searchParams.get('id') || ''); });
    var tids = uniq(hits.map(function (h) { return h.tid; }).concat(scripts.map(function (r) { return r.u.searchParams.get('id'); })));
    var C1 = 'Ölçüm ID + event\'ler', C2 = 'E-ticaret parametreleri', C3 = 'User ID', C4 = 'Consent Mode sinyalleri', C5 = 'Çift tetiklenme / tutarlılık';
    var events = uniq(hits.map(function (h) { return h.en; }));

    col.add({
      component: C1, title: 'GA4 tag\'i kurulu ve hit gönderiyor mu?', status: hits.length ? 'pass' : tids.length ? 'warn' : 'fail', severity: 1,
      observed: hits.length ? 'Measurement ID: ' + tids.join(', ') + ' · ' + hits.length + ' hit · event\'ler: ' + events.join(', ') : (tids.length ? 'gtag.js yüklendi (' + tids.join(', ') + ') ama /g/collect hit\'i gözlenmedi' : 'GA4 isteği bulunamadı'),
      expected: 'G-XXXXXXX ölçüm ID\'si ile /g/collect hit\'leri', impact: 'Web analitiği verisi toplanmıyor', recommendation: 'GA4 Google tag\'ini (GTM veya gtag.js) tüm sayfalara kurun.'
    });
    if (!hits.length) return { col: col, detected: tids.length > 0, ids: tids, hits: hits };

    if (tids.length > 1) col.add({ component: C1, title: 'Birden fazla GA4 property\'si', status: 'warn', severity: 3, observed: tids.join(', '), expected: 'Bilinçli ise sorun değil (ör. roll-up property)', impact: 'Gereksiz hit maliyeti; raporlar arası tutarsızlık riski', recommendation: 'Her property\'nin amacını doğrulayın; kullanılmayanı kaldırın.' });

    var pv = hits.filter(function (h) { return h.en === 'page_view'; });
    col.add({ component: C1, event: 'page_view', title: 'page_view tetikleniyor mu?', status: pv.length ? 'pass' : 'fail', severity: 1, observed: pv.length + ' page_view hit\'i', expected: 'Her sayfa yüklemesinde 1 page_view', impact: 'Sayfa ve oturum metrikleri eksik', recommendation: 'Google tag\'inde send_page_view açık olmalı veya page_view event\'i ayrıca tetiklenmeli.' });
    var pvDup = findDuplicates(pv, function (h) { return h.tid + '|' + h.dl; }, 3000);
    col.add({ component: C5, event: 'page_view', title: 'page_view aynı sayfada çift tetikleniyor mu?', status: pvDup.length ? 'fail' : 'pass', severity: 2, observed: pvDup.length ? pvDup.length + ' çift page_view (aynı dl, <3 sn): ' + str(pv[pvDup[0][1]].dl, 120) : 'Her sayfada tek page_view', expected: 'Sayfa başına 1 page_view', impact: 'Sayfa görüntüleme 2x; bounce/engagement oranları bozuluyor', recommendation: 'GTM\'de hem Google tag (send_page_view) hem ayrı page_view tag\'i olup olmadığını kontrol edin.' });

    // Funnel kapsamı
    FUNNEL.forEach(function (ev) {
      var n = hits.filter(function (h) { return h.en === ev; }).length;
      col.add({ component: C1, event: ev, title: 'Funnel event\'i gözlendi mi?', status: n ? 'pass' : 'na', observed: n ? n + ' hit' : 'Bu kayıtta gözlenmedi (adım ziyaret edilmemiş olabilir)', expected: 'GA4 recommended event: ' + ev });
    });

    // Event bazlı parametre kontrolleri
    Object.keys(GA4_RULES).forEach(function (ev) {
      var eh = hits.filter(function (h) { return h.en === ev; });
      if (!eh.length) return;
      var rule = GA4_RULES[ev];
      rule.req.forEach(function (pn) {
        perHit(col, C2, ev, eh, 'Zorunlu parametre: ' + pn, function (h) {
          var v = ga4Get(h, pn);
          return { ok: v !== undefined && v !== '', val: pn === 'items' ? (v ? v.length + ' item' : 'Mevcut değil') : str(v, 80) };
        }, { severity: pn === 'transaction_id' || ev === 'purchase' ? 1 : 2, expected: pn + ' gönderilmeli (GA4 e-commerce şeması)', impact: pn === 'items' ? 'Ürün raporları (item-scoped) boş kalıyor' : pn === 'transaction_id' ? 'Mükerrer purchase ayıklanamıyor, gelir şişiyor' : 'Gelir/değer raporları ve value-based optimizasyon bozuluyor', rec: ev + ' event\'ine ' + pn + ' parametresini ekleyin.' });
      });
      rule.rec.forEach(function (pn) {
        perHit(col, C2, ev, eh, 'Önerilen parametre: ' + pn, function (h) { var v = ga4Get(h, pn); return { ok: v !== undefined && v !== '' ? true : 'warn', val: str(v, 80) }; },
          { severity: 3, warnSeverity: 3, expected: pn + ' (önerilen)', impact: 'Ek raporlama boyutu kayıp', rec: pn + ' parametresini ekleyin.' });
      });
      if (rule.req.indexOf('currency') >= 0 || rule.rec.indexOf('currency') >= 0) {
        perHit(col, C2, ev, eh, 'currency formatı (ISO 4217)', function (h) {
          var c = h.params.currency; if (c === undefined) return { ok: null };
          if (!CURRENCY_RE.test(c)) return { ok: false, val: str(c) };
          if (opt.currency && c !== opt.currency) return { ok: false, val: c + ' (beklenen ' + opt.currency + ')' };
          return { ok: true, val: c };
        }, { severity: 1, expected: opt.currency || 'TRY / EUR / USD (3 harf, büyük)', impact: 'Gelir dönüştürülemiyor / yanlış para biriminde raporlanıyor', rec: 'currency\'yi ISO 4217 kodu olarak gönderin.' });
      }
      if (GA4_VALUE_EVENTS.indexOf(ev) >= 0) {
        perHit(col, C2, ev, eh, 'value sayısal mı ve items toplamıyla tutarlı mı?', function (h) {
          var v = h.params.value; if (v === undefined) return { ok: null };
          if (!isNum(v)) return { ok: false, val: str(v) + ' (sayı değil)' };
          if (h.strTyped.value) return { ok: 'warn', val: 'value=' + v + ' string olarak (ep.value) gönderilmiş' };
          var sum = 0, ok = true;
          h.items.forEach(function (i) { if (isNum(i.price)) sum += Number(i.price) * (isNum(i.quantity) ? Number(i.quantity) : 1); else ok = false; });
          if (!h.items.length || !ok) return { ok: true, val: 'value=' + v };
          var diff = Math.abs(sum - Number(v));
          if (sum > 0 && diff / sum > 0.02 && ev !== 'purchase') return { ok: 'warn', val: 'value=' + v + ' · Σ(price×qty)=' + Math.round(sum * 100) / 100 };
          return { ok: true, val: 'value=' + v + (sum ? ' · Σ(price×qty)=' + Math.round(sum * 100) / 100 : '') };
        }, { severity: 1, warnSeverity: 3, expected: 'value = Σ(price × quantity) (purchase\'ta vergi/kargo dahil olabilir)', impact: 'Gelir ve ROAS raporları hatalı', rec: 'value\'yu sayı (number) olarak ve item toplamıyla tutarlı gönderin.' });
      }
      if (rule.req.indexOf('items') >= 0 || rule.rec.indexOf('items') >= 0) {
        perHit(col, C2, ev, eh, 'items: her üründe item_id veya item_name var mı?', function (h) {
          if (!h.items.length) return { ok: null };
          var bad = h.items.filter(function (i) { return !i.item_id && !i.item_name; });
          return { ok: !bad.length, val: bad.length ? bad.length + '/' + h.items.length + ' üründe id/isim yok' : h.items.length + ' ürün · ör. ' + str(h.items[0], 140) };
        }, { severity: 1, expected: '{"item_id":"SKU123","item_name":"Ürün","price":199.9,"quantity":1}', impact: 'Ürün bazlı raporlar boş', rec: 'Her item\'a item_id ve item_name ekleyin.' });
        perHit(col, C2, ev, eh, 'items: price ve quantity sayısal mı?', function (h) {
          if (!h.items.length) return { ok: null };
          var miss = h.items.filter(function (i) { return !isNum(i.price) || (i.quantity !== undefined && !isNum(i.quantity)); });
          var noQty = h.items.filter(function (i) { return i.quantity === undefined; });
          if (miss.length) return { ok: false, val: miss.length + ' üründe price/quantity eksik veya sayı değil: ' + str(miss[0], 120) };
          if (noQty.length) return { ok: 'warn', val: noQty.length + ' üründe quantity yok (varsayılan 1)' };
          return { ok: true, val: 'Tüm ürünlerde price+quantity sayısal' };
        }, { severity: 2, warnSeverity: 3, expected: 'price: number, quantity: integer', impact: 'Ürün geliri ve adet metrikleri hatalı', rec: 'price ve quantity\'yi number tipinde gönderin.' });
      }
      if (ev === 'purchase') {
        var tx = eh.map(function (h) { return h.params.transaction_id; }).filter(Boolean);
        var dupTx = tx.filter(function (t, i) { return tx.indexOf(t) !== i; });
        col.add({ component: C5, event: 'purchase', title: 'Aynı transaction_id ile mükerrer purchase var mı?', status: dupTx.length ? 'fail' : 'pass', severity: 1, observed: dupTx.length ? 'Tekrarlanan: ' + uniq(dupTx).join(', ') : 'transaction_id\'ler tekil (' + (tx.join(', ') || '—') + ')', expected: 'Her sipariş için tek purchase', impact: 'Gelir 2x raporlanıyor', recommendation: 'Teşekkür sayfası yenilemelerinde purchase\'ı engelleyin (cookie/flag) ve transaction_id gönderin.' });
      }
      // çift tetiklenme
      var d = findDuplicates(eh, function (h) { return h.tid + '|' + h.dl + '|' + itemsSig(h.items); }, 2000);
      if (ev !== 'view_item_list') col.add({ component: C5, event: ev, title: 'Event çift tetikleniyor mu?', status: d.length ? 'fail' : 'pass', severity: ev === 'purchase' ? 1 : 2, observed: d.length ? d.length + ' çift hit (aynı sayfa + aynı ürünler, <2 sn) — Hit #' + (d[0][0] + 1) + ' & Hit #' + (d[0][1] + 1) : eh.length + ' hit, çift tetiklenme yok', expected: 'Aksiyon başına 1 hit', impact: 'Event sayısı 2x; funnel ve dönüşüm oranları bozuluyor', recommendation: 'Aynı event\'i gönderen birden fazla tag/trigger olup olmadığını GTM\'de kontrol edin.' });
      // hit'ler arası format tutarlılığı
      if (eh.length > 1) {
        var shapes = uniq(eh.map(function (h) { return Object.keys(h.params).sort().join(',') + '|items:' + (h.items.length ? Object.keys(h.items[0]).sort().join(',') : '0'); }));
        col.add({ component: C5, event: ev, title: 'Hit\'ler arası parametre seti tutarlı mı?', status: shapes.length > 1 ? 'warn' : 'pass', severity: 3, observed: shapes.length > 1 ? shapes.slice(0, 3).map(function (s, i) { return 'Format ' + (i + 1) + ': ' + str(s, 120); }).join(' / ') : 'Tüm hit\'ler aynı yapıda', expected: 'Aynı event her tetiklenişte aynı yapıda', impact: 'Raporlarda kısmi boş değerler', recommendation: 'Tüm sayfa şablonlarında aynı dataLayer yapısını kullanın.' });
      }
    });

    // User ID
    var uidHits = hits.filter(function (h) { return h.uid; });
    col.add({ component: C3, title: 'user_id (uid) gönderiliyor mu?', status: uidHits.length ? 'pass' : 'warn', severity: 2, warnSeverity: 2,
      observed: uidHits.length ? 'uid gözlendi (' + uidHits.length + ' hit): ' + str(uidHits[0].uid, 40) : 'cid var (' + str(hits[0].cid, 30) + ') ama uid yok — giriş yapılmamış oturum olabilir',
      expected: 'Giriş yapmış kullanıcılarda uid=<hash\'li müşteri ID>', impact: 'Cross-device kullanıcı birleştirme yapılamıyor', recommendation: 'Login sonrası dataLayer\'a user_id ekleyip GA4 config\'ine bağlayın (PII olmayan, hash\'li ID).' });
    if (uidHits.length) {
      var piiUid = uidHits.filter(function (h) { return EMAIL_RE.test(h.uid); });
      col.add({ component: C3, title: 'user_id PII içeriyor mu?', status: piiUid.length ? 'fail' : 'pass', severity: 1, observed: piiUid.length ? 'uid e-posta içeriyor: ' + str(piiUid[0].uid, 40) : 'uid PII içermiyor', expected: 'Opak/hash\'li ID', impact: 'GA4 politikası ve KVKK/GDPR ihlali', recommendation: 'uid olarak e-posta yerine dahili müşteri ID\'si kullanın.' });
    }

    // PII in GA4 hits
    var piiHits = hits.filter(function (h) { return EMAIL_RE.test(JSON.stringify(h.params)) || EMAIL_RE.test(decodeURIComponent(h.dl || '')); });
    col.add({ component: C2, title: 'Hit\'lerde açık metin PII (e-posta) var mı?', status: piiHits.length ? 'fail' : 'pass', severity: 1, observed: piiHits.length ? piiHits.length + ' hit\'te e-posta (ör. ' + piiHits[0].en + ')' : 'PII gözlenmedi', expected: 'GA4\'e PII gönderilmez', impact: 'GA4 politikası ihlali → veri silme / hesap kapatma riski; KVKK/GDPR', recommendation: 'URL ve parametrelerden e-posta/telefonu temizleyin.' });

    // Consent mode
    var withGcs = hits.filter(function (h) { return h.gcs || h.gcd; });
    var gcdDec = hits.map(function (h) { return decodeGcd(h.gcd); }).filter(Boolean);
    col.add({ component: C4, title: 'Consent Mode sinyali (gcs/gcd) hit\'lerde var mı?', status: withGcs.length ? 'pass' : 'fail', severity: 2, observed: withGcs.length ? 'gcs=' + uniq(hits.map(function (h) { return h.gcs; })).join(',') + ' · gcd=' + uniq(hits.map(function (h) { return h.gcd; })).slice(0, 3).join(',') : 'gcs/gcd parametresi yok', expected: 'gcs=G1xx ve gcd=… (Consent Mode v2)', impact: 'EEA trafiğinde modelleme/remarketing kısıtlanır', recommendation: 'CMP ile Google Consent Mode v2 entegrasyonunu (default + update) kurun.' });
    if (gcdDec.length) {
      var v2missing = gcdDec.filter(function (g) { return g.ad_user_data === 'ayarlanmamış' || g.ad_personalization === 'ayarlanmamış'; });
      col.add({ component: C4, title: 'Consent Mode v2 sinyalleri (ad_user_data, ad_personalization) set ediliyor mu?', status: v2missing.length ? 'fail' : 'pass', severity: 2, observed: 'gcd çözümü: ' + ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'].map(function (k) { return k + '=' + gcdDec[gcdDec.length - 1][k]; }).join(', '), expected: '4 sinyalin de default + update değeri olmalı', impact: 'v2 sinyalleri eksikse Google Ads EEA kitleleri ve dönüşüm modellemesi çalışmaz', recommendation: 'consent default/update çağrılarına ad_user_data ve ad_personalization ekleyin.' });
    }
    return { col: col, detected: true, ids: tids, hits: hits };
  }

  // ---------------------------------------------------------------------------
  // Google Ads
  // ---------------------------------------------------------------------------
  function gadsHits(reqs) {
    var out = [];
    reqs.forEach(function (r) {
      var m = r.path.match(/\/pagead\/(conversion|viewthroughconversion|1p-conversion|1p-user-list)\/(\d+)\/?/);
      if (!m) return;
      var p = mergeParams(r.u, r.body);
      var kind = p.label && m[1] !== '1p-user-list' ? 'conversion' : 'remarketing';
      out.push({ kind: kind, endpoint: m[1], host: r.host, id: 'AW-' + m[2], label: p.label, value: p.value, currency: p.currency_code, oid: p.oid || p.transaction_id, fmt: p.fmt, em: p.em, ecMode: p.ec_mode, gcs: p.gcs, gcd: p.gcd, item: p.item, bttype: p.bttype, mid: p.mid, t: r.t, phase: r.phase, url: r.url });
    });
    return out;
  }

  function auditGAds(ctx, opt) {
    var col = new Collector('gads');
    var hits = gadsHits(ctx.main);
    var scriptIds = ctx.main.filter(function (r) { return /\/gtag\/js$/.test(r.path) && /^AW-/.test(r.u.searchParams.get('id') || ''); }).map(function (r) { return r.u.searchParams.get('id'); });
    var ids = uniq(hits.map(function (h) { return h.id; }).concat(scriptIds));
    var C1 = 'Conversion Tracking', C2 = 'Enhanced Conversions', C3 = 'Conversion parametreleri', C4 = 'Remarketing / Conversion Linker';
    if (!ids.length) {
      col.add({ component: C1, title: 'Google Ads tag\'i kurulu mu?', status: 'fail', severity: 2, observed: 'AW- ID\'li istek veya gtag yüklemesi bulunamadı', expected: 'AW-XXXXXXXXX conversion/remarketing istekleri', impact: 'Google Ads dönüşümleri ölçülmüyor (GA4 import kullanılıyorsa bilinçli olabilir)', recommendation: 'Google Ads conversion tag + conversion linker kurun veya GA4 dönüşüm importunu doğrulayın.' });
      return { col: col, detected: false, ids: [] };
    }
    col.add({ component: C1, title: 'Google Ads tag\'i kurulu mu?', status: 'pass', observed: ids.join(', ') + ' · ' + hits.length + ' istek (' + uniq(hits.map(function (h) { return h.endpoint + (h.fmt ? ' fmt=' + h.fmt : ''); })).join(', ') + ')', expected: 'AW-XXXXXXXXX' });

    var rm = hits.filter(function (h) { return h.kind === 'remarketing'; });
    col.add({ component: C4, title: 'Remarketing (dinamik/standart) hit\'i gidiyor mu?', status: rm.length ? 'pass' : 'warn', severity: 3, observed: rm.length ? rm.length + ' remarketing isteği (' + uniq(rm.map(function (h) { return h.endpoint; })).join(', ') + ')' : 'Remarketing isteği yok', expected: 'viewthroughconversion / 1p-user-list istekleri', impact: 'Remarketing kitleleri dolmuyor', recommendation: 'Google Ads remarketing (veya GA4 kitle paylaşımı) etkinleştirin.' });
    var cookieNames = (ctx.cookiesAll || []).map(function (c) { return c.name; });
    if (cookieNames.length) col.add({ component: C4, title: 'Conversion Linker çerezi (_gcl_au) yazılıyor mu?', status: cookieNames.indexOf('_gcl_au') >= 0 ? 'pass' : 'warn', severity: 2, observed: cookieNames.indexOf('_gcl_au') >= 0 ? '_gcl_au mevcut' : '_gcl_au bulunamadı', expected: '_gcl_au (ve gclid ile gelişte _gcl_aw)', impact: 'GCLID saklanamazsa dönüşüm atfı kaybolur', recommendation: 'GTM\'de Conversion Linker tag\'ini tüm sayfalarda tetikleyin.' });

    var conv = hits.filter(function (h) { return h.kind === 'conversion'; });
    if (!conv.length) {
      col.add({ component: C1, event: 'purchase', title: 'Conversion (purchase) hit\'i tetikleniyor mu?', status: 'na', observed: 'Bu kayıtta conversion isteği gözlenmedi (sipariş tamamlanmamış olabilir)', expected: 'label\'lı /pagead/conversion isteği' });
      return { col: col, detected: true, ids: ids };
    }
    var labels = uniq(conv.map(function (h) { return h.id + '/' + h.label; }));
    labels.forEach(function (lb) {
      var ev = 'Conversion ' + lb;
      var ch = conv.filter(function (h) { return h.id + '/' + h.label === lb; });
      var main = ch.filter(function (h) { return h.endpoint === 'conversion'; });
      var base = main.length ? main : ch;
      col.add({ component: C1, event: ev, title: 'Conversion tetikleniyor mu?', status: 'pass', observed: ch.length + ' istek: ' + uniq(ch.map(function (h) { return h.host + ' ' + h.endpoint + (h.fmt ? ' fmt=' + h.fmt : ''); })).join(' + '), expected: 'Conversion başına paralel istekler (ör. fmt=3 / 1p-conversion) normaldir' });
      var keyCount = {};
      ch.forEach(function (h) { var k = h.endpoint + '|' + h.host + '|' + (h.oid || '') + '|' + (h.fmt || ''); keyCount[k] = (keyCount[k] || 0) + 1; });
      var dupKeys = Object.keys(keyCount).filter(function (k) { return keyCount[k] > 1; });
      col.add({ component: C1, event: ev, title: 'Aynı conversion mükerrer tetikleniyor mu?', status: dupKeys.length ? 'fail' : 'pass', severity: 1, observed: dupKeys.length ? dupKeys.map(function (k) { return k.replace(/\|/g, ' ') + ' ×' + keyCount[k]; }).join(' / ') : 'Mükerrer istek yok', expected: 'Aynı endpoint\'e conversion başına 1 istek', impact: 'Dönüşüm 2x sayılır; Smart Bidding yanlış optimize eder', recommendation: 'Conversion tag\'inin tek trigger\'a bağlı olduğundan emin olun; transaction_id ile dedup yapın.' });
      perHit(col, C3, ev, base, 'value sayısal ve > 0 mı?', function (h) { return { ok: isNum(h.value) && Number(h.value) > 0, val: str(h.value) }; }, { severity: 1, expected: 'value=1499.90', impact: 'Value-based bidding / ROAS çalışmaz', rec: 'Conversion value\'yu dinamik sipariş tutarıyla gönderin.' });
      perHit(col, C3, ev, base, 'currency_code ISO 4217 mi?', function (h) { var ok = CURRENCY_RE.test(h.currency || '') && (!opt.currency || h.currency === opt.currency); return { ok: ok, val: str(h.currency) }; }, { severity: 1, expected: 'currency_code=' + (opt.currency || 'TRY'), impact: 'Değer yanlış para biriminde', rec: 'currency_code parametresini gönderin.' });
      perHit(col, C3, ev, base, 'transaction_id (oid) gönderiliyor mu?', function (h) { return { ok: !!h.oid, val: str(h.oid) }; }, { severity: 1, expected: 'oid=<sipariş no>', impact: 'Mükerrer dönüşümler ayıklanamaz', rec: 'Conversion tag\'ine transaction_id ekleyin.' });
      perHit(col, C3, ev, base, 'Item-level (cart data) parametreleri var mı?', function (h) { return { ok: h.item ? true : 'warn', val: h.item ? 'item=' + str(h.item, 100) + (h.mid ? ' · mid=' + h.mid : '') : 'Mevcut değil' }; }, { severity: 3, warnSeverity: 3, expected: 'items + aw_merchant_id (Cart data)', impact: 'Ürün bazlı dönüşüm/kâr raporlaması yapılamaz', rec: 'Merchant Center bağlıysa conversions with cart data kurun.' });
      perHit(col, C2, ev, base, 'Enhanced Conversions verisi (em) gidiyor mu, hash\'li mi?', function (h) {
        if (!h.em) return { ok: 'warn', val: 'em parametresi yok' + (h.ecMode ? ' (ec_mode=' + h.ecMode + ')' : '') };
        var parts = String(h.em).split('~'); var plain = parts.some(function (x) { return EMAIL_RE.test(x); });
        return { ok: plain ? false : true, val: (plain ? 'AÇIK METİN: ' : 'hash\'li: ') + str(h.em, 70) + (h.ecMode ? ' · ec_mode=' + h.ecMode : '') };
      }, { severity: 1, warnSeverity: 2, expected: 'em=tv.1~em.<SHA-256> (ec_mode=a/c/m)', impact: 'Enhanced Conversions yoksa çerez kaybında dönüşüm eşleşmesi düşer', rec: 'Google Ads\'te Enhanced Conversions\'ı açıp e-posta/telefonu user_provided_data ile gönderin.' });
    });
    return { col: col, detected: true, ids: ids };
  }

  // ---------------------------------------------------------------------------
  // Meta
  // ---------------------------------------------------------------------------
  function metaHits(reqs) {
    var out = [];
    reqs.forEach(function (r) {
      if (!(/(^|\.)facebook\.com$/.test(r.host) && /^\/tr\/?$/.test(r.path))) return;
      var p = mergeParams(r.u, r.body);
      if (!p.ev) return;
      var cd = {}, ud = {};
      Object.keys(p).forEach(function (k) {
        var m = k.match(/^cd\[(.+)\]$/); if (m) cd[m[1]] = p[k];
        var n = k.match(/^ud\[(.+)\]$/); if (n) ud[n[1]] = p[k];
      });
      out.push({ id: p.id, ev: p.ev, eid: p.eid, cd: cd, ud: ud, dl: p.dl || '', t: r.t, phase: r.phase });
    });
    return out;
  }

  function metaParam(h, spec) {
    var opts = spec.split('|');
    for (var i = 0; i < opts.length; i++) if (h.cd[opts[i]] !== undefined && h.cd[opts[i]] !== '') return { name: opts[i], v: h.cd[opts[i]] };
    return null;
  }

  function contentIdsFormat(v) {
    var j = parseJSON(v);
    if (Array.isArray(j)) {
      if (!j.length) return { ok: false, val: 'boş array []' };
      var nonStr = j.filter(function (x) { return typeof x !== 'string'; });
      return nonStr.length ? { ok: false, val: 'int/number array: ' + str(v, 80) } : { ok: true, val: 'string array (' + j.length + '): ' + str(v, 80) };
    }
    if (/,/.test(v)) return { ok: false, val: 'virgülle ayrılmış string: ' + str(v, 80) };
    return { ok: 'warn', val: 'tek değer string: ' + str(v, 60) };
  }

  function auditMeta(ctx, opt) {
    var col = new Collector('meta');
    var hits = metaHits(ctx.main);
    var scripts = ctx.main.filter(function (r) { return /connect\.facebook\.net/.test(r.host) && /fbevents\.js|signals\/config/.test(r.path); });
    var ids = uniq(hits.map(function (h) { return h.id; }).concat(scripts.map(function (r) { var m = r.path.match(/config\/(\d+)/); return m && m[1]; })));
    var C1 = 'Pixel (browser)', C2 = 'Advanced Matching', C3 = 'CAPI', C4 = 'Event Deduplication', C5 = 'Event & parametre/format uyumu';
    if (!hits.length && !scripts.length) {
      col.add({ component: C1, title: 'Meta Pixel kurulu mu?', status: 'fail', severity: 2, observed: 'facebook.com/tr isteği veya fbevents.js bulunamadı', expected: 'Meta Pixel + PageView', impact: 'Meta kampanyaları optimizasyon sinyali alamıyor', recommendation: 'Meta Pixel ve Conversions API kurun.' });
      return { col: col, detected: false, ids: [] };
    }
    var evs = uniq(hits.map(function (h) { return h.ev; }));
    col.add({ component: C1, title: 'Meta Pixel kurulu ve event gönderiyor mu?', status: hits.length ? 'pass' : 'warn', severity: 2, observed: 'Pixel ID: ' + (ids.join(', ') || '?') + ' · ' + hits.length + ' hit · event\'ler: ' + (evs.join(', ') || '—'), expected: 'Pixel ID + PageView ve standart event\'ler', impact: 'Script yüklü ama event gitmiyor', recommendation: 'fbq init/track çağrılarını kontrol edin.' });
    var pv = hits.filter(function (h) { return h.ev === 'PageView'; });
    col.add({ component: C1, event: 'PageView', title: 'PageView tetikleniyor mu?', status: pv.length ? 'pass' : 'fail', severity: 2, observed: pv.length + ' PageView', expected: 'Her sayfada 1 PageView', impact: 'Site ziyaretçisi kitleleri eksik', recommendation: 'PageView\'ı tüm sayfalarda tetikleyin.' });
    if (ids.length > 1) col.add({ component: C1, title: 'Birden fazla pixel var mı?', status: 'warn', severity: 3, observed: ids.join(', '), expected: 'Bilinçli değilse tek pixel', impact: 'Aynı event birden fazla pixel\'e gidiyor; ajans/eski pixel kalıntısı olabilir', recommendation: 'Kullanılmayan pixel\'leri kaldırın.' });

    // Çift tetiklenme
    var std = hits.filter(function (h) { return h.ev !== 'Microdata' && h.ev !== 'SubscribedButtonClick'; });
    var evNames = uniq(std.map(function (h) { return h.ev; }));
    evNames.forEach(function (ev) {
      var eh = std.filter(function (h) { return h.ev === ev; });
      var d = findDuplicates(eh, function (h) { return h.id + '|' + h.dl + '|' + (h.cd.content_ids || '') + '|' + (h.cd.value || ''); }, 2000);
      var sameEid = eh.filter(function (h, i) { return h.eid && eh.some(function (o, j) { return j < i && o.eid === h.eid && o.id === h.id; }); });
      col.add({ component: C5, event: ev, title: 'Event çift tetikleniyor mu?', status: d.length ? 'fail' : 'pass', severity: ev === 'Purchase' ? 1 : 2, observed: d.length ? d.length + ' çift (aynı pixel + sayfa + parametre, <2 sn)' + (sameEid.length ? ' · aynı eid ile tekrar' : ' · farklı/eksik eid') : eh.length + ' hit, çift tetiklenme yok', expected: 'Aksiyon başına 1 hit', impact: 'Event sayısı 2x; audience ve optimizasyon bozuluyor', recommendation: 'Aynı event\'i gönderen ikinci kaynağı (tema eklentisi + GTM gibi) kaldırın.' });
    });

    // Event bazlı parametreler
    Object.keys(META_RULES).forEach(function (ev) {
      var eh = std.filter(function (h) { return h.ev === ev; });
      if (!eh.length) return;
      var rule = META_RULES[ev];
      rule.req.forEach(function (spec) {
        perHit(col, C5, ev, eh, 'Zorunlu parametre: ' + spec.replace('|', ' veya '), function (h) { var p = metaParam(h, spec); return { ok: !!p, val: p ? p.name + '=' + str(p.v, 80) : 'Mevcut değil' }; },
          { severity: ev === 'Purchase' ? 1 : 2, expected: spec.split('|')[0] === 'content_ids' ? 'content_ids=["SKU123"] veya contents=[{"id":"SKU123","quantity":1}]' : spec + ' gönderilmeli', impact: /content/.test(spec) ? 'Katalog (Advantage+ catalog) eşleşmesi çalışmıyor' : 'Değer eşleştirme / ROAS yapılamıyor', rec: ev + ' event\'ine ' + spec.replace('|', ' / ') + ' ekleyin.' });
      });
      rule.rec.forEach(function (spec) {
        perHit(col, C5, ev, eh, 'Önerilen parametre: ' + spec.replace('|', ' veya '), function (h) { var p = metaParam(h, spec); return { ok: p ? true : 'warn', val: p ? p.name + '=' + str(p.v, 60) : 'Mevcut değil' }; },
          { severity: 3, warnSeverity: 3, expected: spec + ' (önerilen)', impact: 'Optimizasyon sinyali zayıf', rec: spec + ' ekleyin.' });
      });
      perHit(col, C5, ev, eh, 'content_ids formatı (string array)', function (h) { if (h.cd.content_ids === undefined) return { ok: null }; return contentIdsFormat(h.cd.content_ids); },
        { severity: 2, warnSeverity: 3, expected: '["164592","164593"]', impact: 'Katalog ürün eşleşmesi başarısız', rec: 'content_ids\'i string array olarak gönderin.' });
      perHit(col, C5, ev, eh, 'contents formatı (id + quantity)', function (h) {
        if (h.cd.contents === undefined) return { ok: null };
        var j = parseJSON(h.cd.contents);
        if (!Array.isArray(j)) return { ok: false, val: 'JSON array değil: ' + str(h.cd.contents, 80) };
        var bad = j.filter(function (x) { return !x || x.id === undefined || x.quantity === undefined; });
        return { ok: !bad.length, val: (bad.length ? bad.length + ' elemanda id/quantity yok: ' : '') + str(h.cd.contents, 100) };
      }, { severity: 2, expected: '[{"id":"164592","quantity":1,"item_price":3995}]', impact: 'Ürün bazlı eşleşme/değer eksik', rec: 'contents\'i id, quantity, item_price ile gönderin.' });
      perHit(col, C5, ev, eh, 'value sayısal mı?', function (h) { if (h.cd.value === undefined) return { ok: null }; return { ok: isNum(h.cd.value), val: str(h.cd.value) }; },
        { severity: ev === 'Purchase' ? 1 : 2, expected: 'value=3995.00', impact: 'ROAS hesaplanamıyor', rec: 'value\'yu sayı olarak gönderin (para birimi sembolü olmadan).' });
      perHit(col, C5, ev, eh, 'currency ISO 4217 mi?', function (h) { if (h.cd.currency === undefined) return { ok: null }; var ok = CURRENCY_RE.test(h.cd.currency) && (!opt.currency || h.cd.currency === opt.currency); return { ok: ok, val: str(h.cd.currency) }; },
        { severity: 1, expected: opt.currency || 'TRY', impact: 'Değer yanlış para biriminde', rec: 'currency\'yi ISO kodu olarak gönderin.' });
      perHit(col, C5, ev, eh, 'content_type geçerli mi?', function (h) { if (h.cd.content_type === undefined) return { ok: null }; return { ok: /^(product|product_group)$/.test(h.cd.content_type), val: str(h.cd.content_type) }; },
        { severity: 2, expected: 'product veya product_group', impact: 'Katalog eşleşmesi çalışmaz', rec: 'content_type=product kullanın.' });
      if (eh.length > 1) {
        var fmts = uniq(eh.map(function (h) { var c = h.cd.content_ids; if (c === undefined) return 'yok'; var j = parseJSON(c); return Array.isArray(j) ? (j.length && typeof j[0] === 'number' ? 'number array' : 'string array') : (/,/.test(c) ? 'virgüllü string' : 'string'); }));
        col.add({ component: C5, event: ev, title: 'Hit\'ler arası content_ids formatı tutarlı mı?', status: fmts.length > 1 ? 'fail' : 'pass', severity: 2, observed: fmts.length > 1 ? eh.slice(0, 4).map(function (h, i) { return 'Hit #' + (i + 1) + ': ' + str(h.cd.content_ids, 60); }).join(' / ') : 'Tüm hit\'lerde: ' + fmts[0], expected: 'Tüm hit\'lerde aynı format (string array)', impact: 'Bazı hit\'ler katalogla eşleşmiyor', recommendation: 'Tek bir kaynaktan, tek formatta gönderin.' });
      }
      // dedup hazırlığı
      perHit(col, C4, ev, eh, 'event_id (eid) gönderiliyor mu?', function (h) { return { ok: h.eid ? true : false, val: h.eid ? 'eid=' + str(h.eid, 50) : 'eid yok' }; },
        { severity: ev === 'Purchase' ? 1 : 2, expected: 'eid=<CAPI ile aynı event_id>', impact: 'Pixel + CAPI birlikte çalışırsa dedup yapılamaz → çift sayım', rec: 'fbq(\'track\', ev, data, {eventID}) ile CAPI\'deki event_id\'yi eşleyin.' });
    });

    // eid tutarlılığı: aynı eid farklı event'lerde
    var eidEv = {};
    std.forEach(function (h) { if (h.eid) (eidEv[h.eid] = eidEv[h.eid] || []).push(h.ev); });
    var crossEid = Object.keys(eidEv).filter(function (k) { return uniq(eidEv[k]).length > 1; });
    if (Object.keys(eidEv).length) col.add({ component: C4, title: 'event_id\'ler event\'ler arasında tekil/tutarlı mı?', status: crossEid.length ? 'fail' : 'pass', severity: 1, observed: crossEid.length ? 'Aynı eid farklı event\'lerde: ' + crossEid.slice(0, 2).map(function (k) { return k + ' → ' + uniq(eidEv[k]).join(','); }).join(' / ') : Object.keys(eidEv).length + ' tekil eid', expected: 'Her event örneği için benzersiz eid', impact: 'Meta yanlış event\'leri birleştirir / atar', recommendation: 'eid\'yi event başına üretin (ör. uuid + event adı).' });

    // Advanced Matching
    var udKeys = uniq([].concat.apply([], hits.map(function (h) { return Object.keys(h.ud); })));
    var plain = [];
    hits.forEach(function (h) { Object.keys(h.ud).forEach(function (k) { if (h.ud[k] && !isHashed(h.ud[k]) && ['em', 'ph', 'fn', 'ln', 'ct', 'zp', 'ge', 'db', 'st', 'country'].indexOf(k) >= 0) plain.push(k + '=' + str(h.ud[k], 40)); }); });
    var amStatus = plain.length ? 'fail' : !udKeys.length ? 'warn' : (udKeys.indexOf('em') >= 0 && (udKeys.indexOf('ph') >= 0 || udKeys.length > 2)) ? 'pass' : 'warn';
    col.add({ component: C2, title: 'Advanced Matching aktif mi; veriler SHA-256 hash\'li mi?', status: amStatus, severity: plain.length ? 1 : 2, warnSeverity: 2,
      observed: plain.length ? 'AÇIK METİN: ' + uniq(plain).slice(0, 3).join(', ') : udKeys.length ? 'ud[] alanları: ' + udKeys.join(', ') + ' (hash\'li)' + (amStatus === 'warn' ? ' — Kısmen' : '') : 'ud[] parametresi yok (giriş/checkout öncesi olabilir)',
      expected: 'ud[em], ud[ph], ud[fn], ud[ln], ud[external_id] SHA-256', impact: plain.length ? 'KVKK/GDPR ihlali (PII açık metin)' : 'Event Match Quality düşük → dönüşüm eşleşmesi zayıf', recommendation: plain.length ? 'Verileri SHA-256 ile hash\'leyin.' : 'Automatic/Manual Advanced Matching\'i açın; e-postaya ek telefon, ad-soyad ve external_id gönderin.' });

    // CAPI — tarayıcıdan görülemez
    var capig = ctx.main.filter(function (r) { return /capig|conversions-api|\/capi\b/i.test(r.host + r.path); });
    col.add({ component: C3, title: 'Conversions API (server-side) kurulu mu?', status: capig.length ? 'pass' : 'na', observed: capig.length ? 'CAPI Gateway/first-party isteği: ' + capig[0].host : 'Sunucu tarafı istekler tarayıcıdan görülemez' + (hits.some(function (h) { return h.eid; }) ? ' · eid üretildiği için CAPI\'ye hazırlık var' : ''), expected: 'Events Manager > Test Events\'te "Browser + Server" ve dedup oranı', impact: '', recommendation: 'CAPI\'yi sGTM veya CAPI Gateway ile kurup eid eşleşmesini doğrulayın.' });
    return { col: col, detected: true, ids: ids };
  }

  // ---------------------------------------------------------------------------
  // TikTok
  // ---------------------------------------------------------------------------
  function tiktokHits(reqs) {
    var out = [];
    reqs.forEach(function (r) {
      if (!/analytics(-[a-z]+)?\.tiktok\.com$/.test(r.host) || !/\/api\/v2\/pixel/.test(r.path)) return;
      var b = parseJSON(r.body);
      if (!b) return;
      var list = Array.isArray(b.batch) ? b.batch : [b];
      list.forEach(function (x) {
        if (!x || !x.event) return;
        out.push({ event: x.event, code: (x.context && x.context.pixel && x.context.pixel.code) || x.pixel_code || r.u.searchParams.get('sdkid'), eid: x.event_id, props: x.properties || {}, user: (x.context && x.context.user) || {}, t: r.t, phase: r.phase });
      });
    });
    return out;
  }
  function ttParam(h, spec) {
    var o = spec.split('|');
    for (var i = 0; i < o.length; i++) {
      var v = h.props[o[i]];
      if (v === undefined && o[i] === 'content_id' && Array.isArray(h.props.contents) && h.props.contents[0]) v = h.props.contents[0].content_id;
      if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) return { name: o[i], v: v };
    }
    return null;
  }
  function auditTikTok(ctx, opt) {
    var col = new Collector('tiktok');
    var hits = tiktokHits(ctx.main);
    var scripts = ctx.main.filter(function (r) { return /analytics\.tiktok\.com/.test(r.host) && /events\.js|main\..*\.js/.test(r.path); });
    var ids = uniq(hits.map(function (h) { return h.code; }).concat(scripts.map(function (r) { return r.u.searchParams.get('sdkid'); })));
    var C1 = 'Pixel (browser)', C2 = 'Advanced Matching', C3 = 'Events API', C4 = 'Event Deduplication', C5 = 'Event & parametre/format uyumu';
    if (!hits.length && !scripts.length) {
      col.add({ component: C1, title: 'TikTok Pixel kurulu mu?', status: 'na', observed: 'TikTok pixel isteği bulunamadı — kurulu değil', expected: 'TikTok kampanyası yürütülüyorsa pixel + Events API', recommendation: 'TikTok reklamı yapılıyorsa pixel ve Events API kurun.' });
      return { col: col, detected: false, ids: [] };
    }
    col.add({ component: C1, title: 'TikTok Pixel kurulu ve event gönderiyor mu?', status: hits.length ? 'pass' : 'warn', severity: 2, observed: 'Pixel: ' + (ids.join(', ') || '?') + ' · ' + hits.length + ' hit · ' + uniq(hits.map(function (h) { return h.event; })).join(', '), expected: 'Pixel kodu + Pageview ve standart event\'ler', impact: 'Script var ama event yok', recommendation: 'ttq.track çağrılarını kontrol edin.' });
    Object.keys(TT_RULES).forEach(function (ev) {
      var eh = hits.filter(function (h) { return h.event === ev; });
      if (!eh.length) return;
      var rule = TT_RULES[ev];
      rule.req.forEach(function (spec) {
        perHit(col, C5, ev, eh, 'Zorunlu parametre: ' + spec.replace('|', ' veya '), function (h) { var p = ttParam(h, spec); return { ok: !!p, val: p ? p.name + '=' + str(p.v, 80) : 'Mevcut değil' }; },
          { severity: ev === 'CompletePayment' || ev === 'Purchase' ? 1 : 2, expected: spec === 'contents|content_id' ? 'contents=[{"content_id":"SKU123","quantity":1,"price":99.9}]' : spec, impact: 'VSA katalog eşleşmesi / değer optimizasyonu bozuluyor', rec: spec.replace('|', ' / ') + ' ekleyin.' });
      });
      rule.rec.forEach(function (spec) {
        perHit(col, C5, ev, eh, 'Önerilen parametre: ' + spec.replace('|', ' veya '), function (h) { var p = ttParam(h, spec); return { ok: p ? true : 'warn', val: p ? p.name + '=' + str(p.v, 60) : 'Mevcut değil' }; }, { severity: 3, warnSeverity: 3, expected: spec, impact: 'Optimizasyon sinyali zayıf', rec: spec + ' ekleyin.' });
      });
      perHit(col, C5, ev, eh, 'contents[].content_id string mi?', function (h) {
        var c = h.props.contents; if (!Array.isArray(c) || !c.length) return { ok: null };
        var bad = c.filter(function (x) { return typeof x.content_id !== 'string'; });
        return { ok: !bad.length, val: str(c, 100) };
      }, { severity: 2, expected: '"content_id":"164592" (string)', impact: 'Katalog eşleşmesi başarısız', rec: 'content_id\'yi string gönderin.' });
      perHit(col, C5, ev, eh, 'value sayısal / currency ISO mu?', function (h) {
        if (h.props.value === undefined && h.props.currency === undefined) return { ok: null };
        var ok = isNum(h.props.value) && typeof h.props.value !== 'string' && CURRENCY_RE.test(h.props.currency || '');
        var warn = isNum(h.props.value) && typeof h.props.value === 'string';
        return { ok: ok ? true : (warn && CURRENCY_RE.test(h.props.currency || '') ? 'warn' : false), val: 'value=' + str(h.props.value) + ' (' + typeof h.props.value + ') · currency=' + str(h.props.currency) };
      }, { severity: 1, warnSeverity: 3, expected: 'value: number, currency: "' + (opt.currency || 'TRY') + '"', impact: 'ROAS/değer optimizasyonu yapılamaz', rec: 'value\'yu number, currency\'yi ISO kodu olarak gönderin.' });
      perHit(col, C4, ev, eh, 'event_id gönderiliyor mu?', function (h) { return { ok: !!h.eid, val: h.eid ? str(h.eid, 50) : 'event_id yok' }; }, { severity: ev === 'CompletePayment' || ev === 'Purchase' ? 1 : 2, expected: 'event_id (Events API ile aynı)', impact: 'Pixel + Events API dedup yapılamaz', rec: 'ttq.track(ev, data, {event_id}) kullanın.' });
      var d = findDuplicates(eh, function (h) { return h.code + '|' + JSON.stringify(h.props.contents || h.props.content_id || ''); }, 2000);
      col.add({ component: C5, event: ev, title: 'Event çift tetikleniyor mu?', status: d.length ? 'fail' : 'pass', severity: 2, observed: d.length ? d.length + ' çift hit' : eh.length + ' hit, çift yok', expected: 'Aksiyon başına 1 hit', impact: 'Event sayısı 2x', recommendation: 'Tekrarlayan kaynağı kaldırın.' });
    });
    var userKeys = uniq([].concat.apply([], hits.map(function (h) { return Object.keys(h.user || {}).filter(function (k) { return h.user[k]; }); })));
    var plain = [];
    hits.forEach(function (h) { ['email', 'phone_number', 'phone', 'external_id'].forEach(function (k) { var v = h.user && h.user[k]; if (v && typeof v === 'string' && !isHashed(v)) plain.push(k); }); });
    col.add({ component: C2, title: 'Advanced Matching (email/phone/external_id) hash\'li gidiyor mu?', status: plain.length ? 'fail' : userKeys.length ? 'pass' : 'warn', severity: plain.length ? 1 : 2, warnSeverity: 2, observed: plain.length ? 'AÇIK METİN: ' + uniq(plain).join(', ') : userKeys.length ? 'context.user: ' + userKeys.join(', ') : 'Kullanıcı verisi yok', expected: 'email, phone_number, external_id (SHA-256)', impact: plain.length ? 'KVKK/GDPR ihlali' : 'Eşleşme oranı düşük', recommendation: 'ttq.identify ile hash\'li veri gönderin.' });
    col.add({ component: C3, title: 'Events API (server-side) kurulu mu?', status: 'na', observed: 'Sunucu tarafı; tarayıcıdan doğrulanamaz', expected: 'Events Manager > Diagnostics\'te server event\'leri', recommendation: 'Events API\'yi sGTM üzerinden kurun ve event_id eşleşmesini doğrulayın.' });
    return { col: col, detected: true, ids: ids };
  }

  // ---------------------------------------------------------------------------
  // LinkedIn
  // ---------------------------------------------------------------------------
  function auditLinkedIn(ctx) {
    var col = new Collector('linkedin');
    var hits = ctx.main.filter(function (r) { return /px\d*\.ads\.linkedin\.com$/.test(r.host) || (/linkedin\.com$/.test(r.host) && /\/collect|\/wa\//.test(r.path)); }).map(function (r) { var p = mergeParams(r.u, r.body); return { pid: p.pid, conv: p.conversionId, eid: p.eventId || p.event_id, t: r.t }; });
    var scripts = ctx.main.filter(function (r) { return /snap\.licdn\.com/.test(r.host); });
    var ids = uniq(hits.map(function (h) { return h.pid; }));
    var C1 = 'Insight Tag', C2 = 'Conversion event\'leri', C3 = 'CAPI / Dedup';
    if (!hits.length && !scripts.length) {
      col.add({ component: C1, title: 'LinkedIn Insight Tag kurulu mu?', status: 'na', observed: 'LinkedIn isteği bulunamadı — kurulu değil', expected: 'B2B kampanya varsa Insight Tag', recommendation: 'LinkedIn reklamı yapılıyorsa Insight Tag + CAPI kurun.' });
      return { col: col, detected: false, ids: [] };
    }
    col.add({ component: C1, title: 'Insight Tag kurulu ve sayfa görüntüleme gönderiyor mu?', status: hits.length ? 'pass' : 'warn', severity: 2, observed: 'Partner ID: ' + (ids.join(', ') || '?') + ' · ' + hits.length + ' istek', expected: 'pid=XXXXXX', impact: 'Script var, istek yok', recommendation: '_linkedin_partner_id tanımını kontrol edin.' });
    var conv = hits.filter(function (h) { return h.conv; });
    col.add({ component: C2, title: 'Conversion event\'i (conversionId) tetikleniyor mu?', status: conv.length ? 'pass' : 'na', observed: conv.length ? uniq(conv.map(function (h) { return h.conv; })).join(', ') : 'Bu kayıtta conversion gözlenmedi', expected: 'conversionId=XXXX' });
    if (conv.length) col.add({ component: C3, title: 'Conversion\'larda event_id (CAPI dedup) var mı?', status: conv.every(function (h) { return h.eid; }) ? 'pass' : 'warn', severity: 2, warnSeverity: 2, observed: conv.map(function (h) { return h.eid || 'yok'; }).join(', '), expected: 'lintrk(\'track\',{conversion_id, event_id})', impact: 'CAPI ile çift sayım riski', recommendation: 'event_id ekleyin ve LinkedIn CAPI ile eşleyin.' });
    return { col: col, detected: true, ids: ids };
  }

  // ---------------------------------------------------------------------------
  // X (Twitter)
  // ---------------------------------------------------------------------------
  function auditX(ctx, opt) {
    var col = new Collector('x');
    var hits = ctx.main.filter(function (r) { return /(analytics\.twitter\.com|t\.co|ads-api\.x\.com)$/.test(r.host) && /\/i\/adsct/.test(r.path); }).map(function (r) {
      var p = mergeParams(r.u, r.body); var ev = parseJSON(p.event || p.events || '') || {};
      return { txn: p.txn_id, eventId: p.event_id, ev: ev, t: r.t };
    });
    var scripts = ctx.main.filter(function (r) { return /static\.ads-twitter\.com/.test(r.host); });
    var ids = uniq(hits.map(function (h) { return h.txn; }));
    var C1 = 'Pixel (base code)', C2 = 'Conversion event\'leri';
    if (!hits.length && !scripts.length) {
      col.add({ component: C1, title: 'X Pixel kurulu mu?', status: 'na', observed: 'X pixel isteği bulunamadı — kurulu değil', expected: 'X kampanyası varsa uwt.js + event\'ler', recommendation: 'X reklamı yapılıyorsa pixel + CAPI kurun.' });
      return { col: col, detected: false, ids: [] };
    }
    col.add({ component: C1, title: 'X Pixel kurulu ve istek gönderiyor mu?', status: hits.length ? 'pass' : 'warn', severity: 2, observed: 'Pixel: ' + (ids.join(', ') || '?') + ' · ' + hits.length + ' istek', expected: 'txn_id=<pixel id>', impact: 'Script var istek yok', recommendation: 'twq(\'config\') çağrısını kontrol edin.' });
    var ce = hits.filter(function (h) { return h.eventId && /^tw-/.test(h.eventId); });
    col.add({ component: C2, title: 'Conversion event\'i tetikleniyor mu?', status: ce.length ? 'pass' : 'na', observed: ce.length ? uniq(ce.map(function (h) { return h.eventId; })).join(', ') : 'Bu kayıtta conversion event\'i gözlenmedi', expected: 'twq(\'event\',\'tw-xxxx-yyyy\',{...})' });
    ce.forEach(function (h) {
      col.add({ component: C2, event: h.eventId, title: 'value/currency/conversion_id gönderiliyor mu?', status: isNum(h.ev.value) && CURRENCY_RE.test(h.ev.currency || '') && h.ev.conversion_id ? 'pass' : 'warn', severity: 2, warnSeverity: 2, observed: str(h.ev, 150), expected: '{"value":1499.9,"currency":"' + (opt.currency || 'TRY') + '","conversion_id":"<sipariş no>"}', impact: 'Değer optimizasyonu ve dedup yapılamaz', recommendation: 'value, currency ve conversion_id ekleyin.' });
    });
    return { col: col, detected: true, ids: ids };
  }

  // ---------------------------------------------------------------------------
  // DataLayer
  // ---------------------------------------------------------------------------
  function argsToArray(x) {
    if (x && typeof x === 'object' && !Array.isArray(x) && (x.__args || ('0' in x && !('event' in x)))) {
      var a = []; for (var i = 0; i < 6; i++) { if (i in x) a.push(x[i]); else if (String(i) in x) a.push(x[String(i)]); else break; } return a;
    }
    return null;
  }
  function walk(obj, path, cb, depth) {
    if (depth > 8 || obj === null || obj === undefined) return;
    if (typeof obj !== 'object') { cb(path, obj); return; }
    Object.keys(obj).forEach(function (k) { walk(obj[k], path ? path + '.' + k : k, cb, (depth || 0) + 1); });
  }
  var PII_KEY_RE = /(^|[._])(e-?mail|email_address|phone|phone_number|telephone|tel|gsm|mobile|first_?name|last_?name|surname|full_?name|firstname|lastname|address|street|tckn|tc_?kimlik|birth|dob)($|[._])/i;

  function auditDataLayer(ctx, opt) {
    var col = new Collector('datalayer');
    var dl = ctx.dataLayer;
    var C1 = 'Event/şema uyumu', C2 = 'Kullanıcı bilgileri (PII)', C3 = 'user_id', C4 = 'Consent sinyalleri';
    if (!dl.length) {
      col.add({ component: C1, title: 'dataLayer mevcut mu?', status: ctx.meta.mode === 'har' ? 'na' : 'fail', severity: 2, observed: ctx.meta.mode === 'har' ? 'dataLayer yüklenmedi (HAR modunda opsiyonel)' : 'window.dataLayer boş / yok', expected: 'window.dataLayer dizisi ve GA4 e-commerce push\'ları', impact: 'Tag\'ler DOM scraping\'e bağımlı; kırılgan ölçüm', recommendation: 'GA4 e-commerce şemasına uygun dataLayer push\'ları ekleyin.' });
      return { col: col, detected: false };
    }
    var objs = dl.filter(function (x) { return x && typeof x === 'object' && !argsToArray(x); });
    var evNames = uniq(objs.map(function (x) { return x.event; }));
    col.add({ component: C1, title: 'dataLayer mevcut mu?', status: 'pass', observed: dl.length + ' push · event\'ler: ' + str(evNames.join(', '), 250), expected: 'window.dataLayer' });

    // UA (eski) şema
    var ua = objs.filter(function (x) { return x.ecommerce && (x.ecommerce.detail || x.ecommerce.add || x.ecommerce.checkout || x.ecommerce.purchase || x.ecommerce.impressions); });
    col.add({ component: C1, title: 'Eski UA (Enhanced Ecommerce) şeması kullanılıyor mu?', status: ua.length ? 'fail' : 'pass', severity: 2, observed: ua.length ? ua.length + ' push UA formatında (ör. ' + Object.keys(ua[0].ecommerce).join(',') + ')' : 'UA şeması yok', expected: 'ecommerce.items[] (GA4)', impact: 'GA4 tag\'leri ürün verisini okuyamaz / dönüşüm gerekir', recommendation: 'dataLayer\'ı GA4 e-commerce şemasına taşıyın.' });

    var ecomm = objs.filter(function (x) { return x.event && GA4_RULES[x.event]; });
    FUNNEL.forEach(function (ev) {
      var n = ecomm.filter(function (x) { return x.event === ev; }).length;
      col.add({ component: C1, event: ev, title: 'dataLayer push\'u var mı?', status: n ? 'pass' : 'na', observed: n ? n + ' push' : 'Bu kayıtta gözlenmedi', expected: '{event:"' + ev + '", ecommerce:{…}}' });
    });
    Object.keys(GA4_RULES).forEach(function (ev) {
      var pushes = ecomm.filter(function (x) { return x.event === ev; });
      if (!pushes.length) return;
      var hitsLike = pushes.map(function (x) { return { x: x, e: x.ecommerce || {} }; });
      perHit(col, C1, ev, hitsLike, 'ecommerce objesi ve items array\'i var mı?', function (h) {
        if (!h.x.ecommerce) return { ok: false, val: 'ecommerce objesi yok' };
        if (GA4_RULES[ev].req.indexOf('items') >= 0 && !Array.isArray(h.e.items)) return { ok: false, val: 'items array değil: ' + str(h.e.items, 60) };
        return { ok: true, val: 'ecommerce ✓ · ' + (Array.isArray(h.e.items) ? h.e.items.length + ' item' : '') };
      }, { severity: 1, expected: '{event, ecommerce:{currency, value, items:[…]}}', impact: 'Tag\'ler ürün verisini okuyamaz', rec: 'Push\'u GA4 şemasına göre düzenleyin.' });
      GA4_RULES[ev].req.forEach(function (pn) {
        if (pn === 'items') return;
        perHit(col, C1, ev, hitsLike, 'Zorunlu alan: ecommerce.' + pn, function (h) { var v = h.e[pn]; return { ok: v !== undefined && v !== '' && v !== null, val: str(v, 60) }; },
          { severity: pn === 'transaction_id' ? 1 : 2, expected: pn, impact: 'Platformlara eksik veri gider', rec: 'ecommerce.' + pn + ' ekleyin.' });
      });
      perHit(col, C1, ev, hitsLike, 'Tip kontrolü: value number, currency ISO', function (h) {
        if (h.e.value === undefined && h.e.currency === undefined) return { ok: null };
        var errs = [];
        if (h.e.value !== undefined && typeof h.e.value !== 'number') errs.push('value ' + typeof h.e.value + ' (' + str(h.e.value, 20) + ')');
        if (h.e.currency !== undefined && !CURRENCY_RE.test(h.e.currency)) errs.push('currency=' + str(h.e.currency));
        return { ok: errs.length ? (errs.every(function (x) { return /^value string/.test(x) && isNum(h.e.value); }) ? 'warn' : false) : true, val: errs.length ? errs.join(', ') : 'value=' + h.e.value + ' (number) · currency=' + h.e.currency };
      }, { severity: 2, warnSeverity: 3, expected: 'value: 1499.9 (number), currency: "' + (opt.currency || 'TRY') + '"', impact: 'String değerler bazı platformlarda 0 / hatalı okunur', rec: 'value\'yu number tipinde push edin.' });
      perHit(col, C1, ev, hitsLike, 'items: item_id/item_name + price(number) + quantity', function (h) {
        if (!Array.isArray(h.e.items) || !h.e.items.length) return { ok: null };
        var bad = h.e.items.filter(function (i) { return !(i.item_id || i.item_name) || (i.price !== undefined && typeof i.price !== 'number'); });
        return { ok: !bad.length, val: bad.length ? bad.length + '/' + h.e.items.length + ' item hatalı: ' + str(bad[0], 120) : 'ör. ' + str(h.e.items[0], 140) };
      }, { severity: 2, expected: '{"item_id":"SKU","item_name":"…","price":199.9,"quantity":1}', impact: 'Ürün raporları ve katalog eşleşmesi bozuluyor', rec: 'items alanlarını şemaya uygun ve doğru tipte gönderin.' });
    });
    // ecommerce: null temizliği
    if (ecomm.length) {
      var idxs = []; dl.forEach(function (x, i) { if (x && x.event && GA4_RULES[x.event]) idxs.push(i); });
      var cleared = idxs.filter(function (i) { var p = dl[i - 1]; return p && p.ecommerce === null; });
      col.add({ component: C1, title: 'Her e-commerce push\'undan önce ecommerce: null temizliği yapılıyor mu?', status: cleared.length === idxs.length ? 'pass' : 'warn', severity: 3, warnSeverity: 3, observed: cleared.length + '/' + idxs.length + ' push öncesinde ecommerce:null', expected: 'dataLayer.push({ecommerce:null}) ardından event push', impact: 'Önceki event\'in ürünleri sonrakine taşınabilir (veri karışması)', recommendation: 'Her e-commerce push\'undan önce ecommerce objesini temizleyin.' });
    }
    // PII
    var pii = [];
    dl.forEach(function (x, i) {
      walk(x, '', function (path, v) {
        if (typeof v !== 'string' && typeof v !== 'number') return;
        var s = String(v);
        if (isHashed(s)) return;
        if (EMAIL_RE.test(s) && !/^https?:/.test(s)) pii.push('#' + i + ' ' + path + '=' + str(s, 40));
        else if (PII_KEY_RE.test(path) && s.length > 1 && !/^(true|false|null|undefined)$/i.test(s) && !/^gtm\./.test(path)) pii.push('#' + i + ' ' + path + '=' + str(s, 30));
        else if (/phone|tel|gsm|mobile/i.test(path) && PHONE_VAL_RE.test(s)) pii.push('#' + i + ' ' + path + '=' + str(s, 20));
      });
    });
    col.add({ component: C2, title: 'Kullanıcı bilgileri (e-posta, telefon, ad-soyad) açık metin mi?', status: pii.length ? 'fail' : 'pass', severity: 1, observed: pii.length ? uniq(pii).slice(0, 5).join(' · ') : 'Açık metin PII bulunmadı', expected: 'Yok veya SHA-256 hash\'li (ör. user_data.sha256_email_address)', impact: 'KVKK/GDPR ihlali; dataLayer\'ı okuyan tüm 3. parti script\'ler PII\'ye erişebilir', recommendation: 'PII\'yi dataLayer\'a hash\'li ekleyin ya da hiç eklemeyin.' });
    // user_id
    var uid = []; dl.forEach(function (x) { walk(x, '', function (p, v) { if (/(^|\.)(user_?id|userid|customer_?id|uid|member_?id)$/i.test(p) && v !== '' && v !== null && v !== undefined) uid.push(p + '=' + str(v, 30)); }); });
    col.add({ component: C3, title: 'dataLayer\'da user_id tanımlı mı?', status: uid.length ? 'pass' : 'warn', severity: 2, warnSeverity: 2, observed: uid.length ? uniq(uid).slice(0, 3).join(', ') : 'user_id / customer_id değişkeni yok (misafir oturum olabilir)', expected: 'Login sonrası {user_id:"<hash\'li ID>"}', impact: 'Cross-device birleştirme yapılamıyor', recommendation: 'user_id\'yi dataLayer\'a ekleyip GA4 / Ads / Meta (external_id) tag\'lerine bağlayın.' });
    // Consent
    var cons = []; dl.forEach(function (x, i) { var a = argsToArray(x) || (Array.isArray(x) ? x : null); if (a && a[0] === 'consent') cons.push({ i: i, type: a[1], st: a[2] || {} }); });
    var def = cons.filter(function (c) { return c.type === 'default'; });
    var upd = cons.filter(function (c) { return c.type === 'update'; });
    var gtmJs = -1; dl.forEach(function (x, i) { if (gtmJs < 0 && x && x.event === 'gtm.js') gtmJs = i; });
    col.add({ component: C4, title: 'Consent Mode default komutu var mı ve GTM\'den önce mi?', status: !def.length ? 'fail' : (gtmJs >= 0 && def[0].i > gtmJs ? 'warn' : 'pass'), severity: 2, warnSeverity: 2, observed: def.length ? 'consent default @#' + def[0].i + ': ' + str(def[0].st, 160) + (gtmJs >= 0 ? ' · gtm.js @#' + gtmJs : '') : 'consent default bulunamadı', expected: 'gtag(\'consent\',\'default\',{ad_storage:\'denied\',analytics_storage:\'denied\',ad_user_data:\'denied\',ad_personalization:\'denied\'}) gtm.js\'ten önce', impact: 'Onay öncesi tag\'ler varsayılan olarak çerez yazabilir', recommendation: 'CMP\'nin Consent Mode default\'unu GTM container\'ından önce çağırın.' });
    if (def.length) {
      var missing = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'].filter(function (k) { return !(k in def[0].st); });
      col.add({ component: C4, title: 'Default komutunda 4 Consent Mode v2 sinyali var mı?', status: missing.length ? 'fail' : 'pass', severity: 2, observed: missing.length ? 'Eksik: ' + missing.join(', ') : '4 sinyal mevcut', expected: 'ad_storage, analytics_storage, ad_user_data, ad_personalization', impact: 'v2 eksikse EEA kitleleri/ölçüm kısıtlanır', recommendation: 'Eksik sinyalleri ekleyin.' });
    }
    col.add({ component: C4, title: 'Consent update komutu tetikleniyor mu?', status: upd.length ? 'pass' : 'na', observed: upd.length ? upd.length + ' update · son: ' + str(upd[upd.length - 1].st, 160) : 'Bu kayıtta consent update gözlenmedi (banner etkileşimi olmamış olabilir)', expected: 'Kullanıcı seçiminden sonra consent update' });
    // dataLayer → GA4 karşılaştırması
    var gaEvents = (ctx.ga4Hits || []).map(function (h) { return h.en; });
    if (ctx.ga4Hits && ctx.ga4Hits.length) {
      uniq(ecomm.map(function (x) { return x.event; })).forEach(function (ev) {
        var sent = gaEvents.indexOf(ev) >= 0;
        col.add({ component: C1, event: ev, title: 'dataLayer event\'i GA4\'e iletiliyor mu?', status: sent ? 'pass' : 'fail', severity: ev === 'purchase' ? 1 : 2, observed: sent ? 'dataLayer ✓ → GA4 hit ✓' : 'dataLayer\'da var, GA4 hit\'i yok', expected: 'dataLayer push\'u → GA4 event tag', impact: 'Funnel adımı GA4\'te eksik', recommendation: 'GTM\'de bu event için GA4 event tag\'i ve trigger ekleyin.' });
      });
    }
    return { col: col, detected: true };
  }

  // ---------------------------------------------------------------------------
  // Altyapı
  // ---------------------------------------------------------------------------
  function auditInfra(ctx, found) {
    var col = new Collector('infra');
    var site = ctx.siteHost; var siteReg = regDomain(site);
    var gtm = ctx.main.filter(function (r) { return /\/gtm\.js$/.test(r.path) && /GTM-/.test(r.u.searchParams.get('id') || ''); });
    var gtmIds = uniq(gtm.map(function (r) { return r.u.searchParams.get('id'); }));
    var gtagFP = ctx.main.filter(function (r) { return (/\/gtm\.js$|\/gtag\/js$/.test(r.path) || /[?&]id=(GTM|G|AW)-/.test(r.u.search)) && !isGoogleHost(r.host) && r.host; });
    var collectFP = (ctx.ga4Hits || []).filter(function (h) { return !isGoogleHost(h.host); });
    var C0 = 'Google Tag Manager', C1 = 'Google Tag Gateway', C2 = 'sGTM (Server-side GTM)', C3 = 'Server-side API\'ler (CAPI)', C4 = 'Event ID tutarlılığı';
    col.add({ component: C0, title: 'GTM container kurulu mu?', status: gtmIds.length ? (gtmIds.length > 1 ? 'warn' : 'pass') : 'warn', severity: 3, warnSeverity: 3, observed: gtmIds.length ? gtmIds.join(', ') + ' (' + uniq(gtm.map(function (r) { return r.host; })).join(', ') + ')' : 'GTM gözlenmedi (gtag.js veya hardcoded olabilir)', expected: 'Tek GTM web container', impact: gtmIds.length > 1 ? 'Birden fazla container → çift tetiklenme ve yönetim karmaşası' : 'Tag yönetimi merkezi değil', recommendation: gtmIds.length > 1 ? 'Container\'ları birleştirin veya sorumluluklarını ayırın.' : 'Tag\'leri GTM altında toplayın.' });
    var sameHost = gtagFP.concat(collectFP.map(function (h) { return { host: h.host }; })).filter(function (r) { return r.host === site || regDomain(r.host) === siteReg && /^(www\.)?/.test(r.host) && r.host.replace(/^www\./, '') === site.replace(/^www\./, ''); });
    col.add({ component: C1, title: 'Google Tag Gateway (first-party path) kullanılıyor mu?', status: sameHost.length ? 'pass' : 'warn', severity: 3, warnSeverity: 3, observed: sameHost.length ? 'Google tag/collect site domain\'inden servis ediliyor: ' + uniq(sameHost.map(function (r) { return r.host; })).join(', ') : 'Tag\'ler googletagmanager.com / google-analytics.com üzerinden yükleniyor', expected: 'example.com/<path>/gtag/js… (CDN/Load balancer üzerinden)', impact: 'Ad-blocker / ITP kaynaklı veri kaybı', recommendation: 'Cloudflare/GCP Load Balancer ile Google Tag Gateway\'i etkinleştirin.' });
    var sgtmHosts = uniq(collectFP.map(function (h) { return h.host; }).concat(gtagFP.map(function (r) { return r.host; })).filter(function (h) { return h !== site; }));
    col.add({ component: C2, title: 'sGTM (server container) kullanılıyor mu?', status: collectFP.length ? 'pass' : 'warn', severity: 2, warnSeverity: 2, observed: collectFP.length ? 'GA4 hit\'leri first-party sunucuya gidiyor: ' + uniq(collectFP.map(function (h) { return h.host; })).join(', ') : (sgtmHosts.length ? 'Custom loader: ' + sgtmHosts.join(', ') + ' (collect Google\'a gidiyor)' : 'GA4 hit\'leri doğrudan Google\'a gidiyor — sGTM yok'), expected: 'transport_url ile ss.' + (siteReg || 'example.com') + '/g/collect', impact: 'CAPI/Events API, veri zenginleştirme ve first-party çerez avantajları yok', recommendation: 'sGTM (Cloud Run / Stape) kurup GA4 transport_url ve CAPI\'leri sunucuya taşıyın.' });
    var eidPlats = [];
    if (found.metaEid) eidPlats.push('Meta eid');
    if (found.ttEid) eidPlats.push('TikTok event_id');
    col.add({ component: C3, title: 'Meta CAPI / TikTok Events API / LinkedIn & X CAPI', status: 'na', observed: 'Sunucu tarafı istekler tarayıcıdan görülemez' + (eidPlats.length ? ' · Dedup ID üretenler: ' + eidPlats.join(', ') : ''), expected: 'Her platformun Events Manager / test araçlarında Browser+Server event\'leri', recommendation: 'Platform test araçlarında (Meta Test Events, TikTok Diagnostics) server event\'lerini ve dedup oranını doğrulayın.' });
    if (found.metaEids && found.metaEids.length) {
      var reused = found.metaEids.filter(function (e, i) { return found.metaEids.indexOf(e) !== i; });
      col.add({ component: C4, title: 'Gönderilen event ID\'ler tekil mi?', status: reused.length ? 'warn' : 'pass', severity: 2, warnSeverity: 2, observed: reused.length ? 'Tekrarlanan event ID\'ler: ' + uniq(reused).slice(0, 3).join(', ') : found.metaEids.length + ' event ID, hepsi tekil', expected: 'Her event için benzersiz ID; pixel & CAPI\'de aynı', impact: 'Tutarsız ID → dedup başarısız, çift sayım', recommendation: 'Event ID\'yi dataLayer push\'unda üretip tüm platformlara aynı değeri gönderin.' });
    }
    return { col: col, gtmIds: gtmIds };
  }

  // ---------------------------------------------------------------------------
  // CMP / Consent
  // ---------------------------------------------------------------------------
  function marketingReqs(reqs) {
    return reqs.filter(function (r) { return MARKETING_HOST_RE.test(r.host + r.path); });
  }
  function platformOf(r) {
    var s = r.host + r.path;
    if (/facebook/.test(s)) return 'Meta';
    if (/tiktok/.test(s)) return 'TikTok';
    if (/linkedin|licdn/.test(s)) return 'LinkedIn';
    if (/twitter|t\.co/.test(s)) return 'X';
    if (/googleadservices|pagead|doubleclick/.test(s)) return 'Google Ads/DoubleClick';
    if (/bing/.test(s)) return 'Microsoft Ads';
    if (/clarity/.test(s)) return 'Clarity';
    if (/hotjar/.test(s)) return 'Hotjar';
    if (/criteo/.test(s)) return 'Criteo';
    if (/pinterest/.test(s)) return 'Pinterest';
    if (/snapchat/.test(s)) return 'Snapchat';
    return r.host;
  }
  function summarizeReqs(list) {
    var c = {}; list.forEach(function (r) { var k = platformOf(r); c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).map(function (k) { return k + ' (' + c[k] + ')'; }).join(', ');
  }
  function cookieHits(cookies) {
    var out = [];
    (cookies || []).forEach(function (c) { MARKETING_COOKIES.forEach(function (m) { if (m[0].test(c.name)) out.push(c.name + ' [' + m[1] + ']'); }); });
    return uniq(out);
  }

  function auditCMP(ctx) {
    var col = new Collector('cmp');
    var C1 = 'CMP varlığı', C2 = 'Onay öncesi davranış', C3 = 'Reddet davranışı', C4 = 'Consent Mode sinyalleri';
    var blob = ctx.all.map(function (r) { return r.url; }).join(' ') + ' ' + (ctx.html || '').slice(0, 300000);
    var vendor = ctx.cmp.vendor || null;
    if (!vendor) CMP_VENDORS.some(function (v) { if (v[0].test(blob)) { vendor = v[1]; return true; } return false; });
    var banner = ctx.cmp.bannerFound;
    var detected = !!(vendor || banner);
    col.add({ component: C1, title: 'Sitede CMP (çerez onay yönetimi) var mı?', status: detected ? 'pass' : 'fail', severity: 1, observed: detected ? (vendor ? 'CMP: ' + vendor : 'Özel (custom) çerez banner\'ı') + (ctx.cmp.bannerText ? ' · "' + str(ctx.cmp.bannerText, 80) + '"' : '') : 'Bilinen CMP veya çerez banner\'ı tespit edilmedi', expected: 'KVKK/GDPR uyumlu CMP (OneTrust, Cookiebot, Usercentrics…)', impact: 'KVKK/GDPR riski; onaysız çerez/tag', recommendation: 'Google sertifikalı bir CMP kurun ve Consent Mode v2 ile entegre edin.' });

    // Onay öncesi
    var pre = ctx.phaseReq('pre_consent');
    if (ctx.phases.pre_consent) {
      var preHits = marketingReqs(pre).filter(function (r) {
        if (/\.js(\?|$)/.test(r.path)) return false; // kütüphane yüklemesi değil, veri gönderen hit'ler
        var g = r.u.searchParams.get('gcs');
        return !(/google|doubleclick/.test(r.host) && g === 'G100'); // Consent Mode advanced çerezsiz ping'i
      });
      col.add({ component: C2, title: 'Onay verilmeden marketing tag\'leri tetikleniyor mu?', status: preHits.length ? 'fail' : 'pass', severity: 1, observed: preHits.length ? 'Banner etkileşimi olmadan: ' + summarizeReqs(preHits) : 'Onay öncesi marketing hit\'i yok', expected: 'Onay öncesi sadece zorunlu + (Consent Mode advanced ise) çerezsiz Google ping\'leri', impact: 'KVKK/GDPR ihlali (açık rıza olmadan işleme)', recommendation: 'Marketing tag\'lerini CMP onayı / consent trigger\'ı ile bloklayın.' });
      var preCk = cookieHits(ctx.phases.pre_consent.cookies);
      if (ctx.phases.pre_consent.cookies) col.add({ component: C2, title: 'Onay öncesi ölçüm/marketing çerezi yazılıyor mu?', status: preCk.length ? 'fail' : 'pass', severity: 1, observed: preCk.length ? preCk.join(', ') : 'Ölçüm çerezi yok', expected: 'Sadece zorunlu çerezler', impact: 'KVKK/GDPR ihlali', recommendation: 'Consent default=denied ve tag blocking ile çerezleri engelleyin.' });
      var preGa = ga4Hits(pre);
      if (preGa.length) {
        var granted = preGa.filter(function (h) { return h.gcs && h.gcs !== 'G100' && h.gcs.charAt(3) === '1'; });
        col.add({ component: C4, title: 'Onay öncesi GA4 hit\'leri denied (gcs=G100) mi?', status: granted.length ? 'fail' : 'pass', severity: 1, observed: 'gcs=' + uniq(preGa.map(function (h) { return h.gcs || 'yok'; })).join(','), expected: 'gcs=G100 (çerezsiz ping) veya hiç hit yok', impact: 'Onay öncesi analytics çerezi kullanımı', recommendation: 'Consent default\'u denied yapın.' });
      }
    } else {
      col.add({ component: C2, title: 'Onay öncesi davranış', status: 'na', observed: ctx.meta.mode === 'har' ? 'HAR kaydında onay anı ayrıştırılamaz — canlı taramayı kullanın' : 'Kontrol edilemedi', expected: 'Onay öncesi marketing hit\'i olmamalı' });
    }

    // Reddet
    var rej = ctx.phases.after_reject || ctx.phases.har_reject;
    if (rej) {
      var rejReq = ctx.all.filter(function (r) { return r.phase === 'after_reject' || r.phase === 'har_reject'; });
      var rejClicked = ctx.cmp.rejectClicked !== false;
      col.add({ component: C3, title: '"Reddet" butonu bulundu ve tıklandı mı?', status: rejClicked ? 'pass' : 'na', observed: rejClicked ? (ctx.cmp.rejectSelector ? 'Tıklanan: ' + ctx.cmp.rejectSelector : 'Kullanıcı reddet sonrası HAR yükledi') : 'Reddet butonu otomatik bulunamadı', expected: 'İlk katmanda "Tümünü Reddet" butonu' });
      if (rejClicked) {
        var rM = marketingReqs(rejReq).filter(function (r) { return !/\.js(\?|$)/.test(r.path); });
        var rGa = ga4Hits(rejReq);
        var rGaGranted = rGa.filter(function (h) { return !h.gcs || h.gcs.charAt(3) === '1'; });
        var googleCookieless = rM.filter(function (r) { var g = r.u.searchParams.get('gcs'); return /google|doubleclick/.test(r.host) && g && /^G1?00$|^G100$/.test(g); });
        var realM = rM.filter(function (r) { return googleCookieless.indexOf(r) < 0; });
        col.add({ component: C3, title: 'Reddet sonrası marketing tag\'leri engelleniyor mu?', status: realM.length ? 'fail' : 'pass', severity: 1, observed: realM.length ? 'Reddet sonrası ateşlenen istekler: ' + summarizeReqs(realM) + ' · ör. ' + str(realM[0].url, 140) : 'Reddet sonrası marketing hit\'i yok' + (googleCookieless.length ? ' (yalnızca ' + googleCookieless.length + ' çerezsiz Google ping, gcs=G100)' : ''), expected: 'Hiç marketing isteği yok (Consent Mode advanced ise yalnızca gcs=G100 çerezsiz ping)', impact: 'KVKK/GDPR ihlali — kullanıcı reddetmesine rağmen veri işleniyor', recommendation: 'Tüm marketing tag\'lerine consent kontrolü (Additional consent checks / blocking trigger) ekleyin.' });
        col.add({ component: C3, title: 'Reddet sonrası GA4 hit\'leri denied mı?', status: rGaGranted.length ? 'fail' : 'pass', severity: 1, observed: rGa.length ? rGa.length + ' GA4 hit · gcs=' + uniq(rGa.map(function (h) { return h.gcs || 'yok'; })).join(',') : 'GA4 hit\'i yok', expected: 'gcs=G100 veya hit yok', impact: 'Reddedilen analytics çerezi kullanılıyor', recommendation: 'consent update\'in reddet seçiminde analytics_storage=denied gönderdiğini doğrulayın.' });
        if (rej.cookies) {
          var ck = cookieHits(rej.cookies);
          col.add({ component: C3, title: 'Reddet sonrası ölçüm/marketing çerezi var mı?', status: ck.length ? 'fail' : 'pass', severity: 1, observed: ck.length ? ck.join(', ') : 'Ölçüm çerezi yok', expected: 'Yalnızca zorunlu çerezler', impact: 'KVKK/GDPR ihlali', recommendation: 'Reddet sonrası çerez yazan tag\'leri bloklayın; önceden yazılan çerezleri silin.' });
        }
        var rGcd = rGa.map(function (h) { return decodeGcd(h.gcd); }).filter(Boolean);
        if (rGcd.length) {
          var g = rGcd[rGcd.length - 1];
          var bad = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'].filter(function (k) { return g[k] === 'granted'; });
          col.add({ component: C4, title: 'Reddet sonrası Consent Mode sinyalleri denied mı?', status: bad.length ? 'fail' : 'pass', severity: 1, observed: 'gcd=' + g.raw + ' → ' + ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'].map(function (k) { return k + '=' + g[k]; }).join(', '), expected: '4 sinyal de denied', impact: 'Reddedilen izinler Google\'a granted iletiliyor', recommendation: 'CMP → Consent Mode update eşlemesini düzeltin.' });
        }
      }
    } else {
      col.add({ component: C3, title: 'Reddet sonrası davranış', status: 'na', observed: ctx.meta.mode === 'har' ? '"Reddet sonrası HAR" yüklenmedi' : 'Reddet testi yapılamadı', expected: 'Reddet sonrası marketing tag/çerez olmamalı' });
    }
    // Kabul sonrası consent update granted?
    if (ctx.cmp.acceptClicked) {
      var acc = ga4Hits(ctx.phaseReq('accepted'));
      if (acc.length) col.add({ component: C4, title: 'Kabul sonrası sinyaller granted\'a güncelleniyor mu?', status: acc.some(function (h) { return h.gcs === 'G111'; }) ? 'pass' : 'warn', severity: 2, warnSeverity: 2, observed: 'gcs=' + uniq(acc.map(function (h) { return h.gcs || 'yok'; })).join(','), expected: 'gcs=G111', impact: 'Onay veren kullanıcıların verisi eksik ölçülüyor', recommendation: 'Accept butonunun consent update(granted) gönderdiğini doğrulayın.' });
    }
    return { col: col, vendor: vendor, detected: detected };
  }

  // ---------------------------------------------------------------------------
  // Envanter
  // ---------------------------------------------------------------------------
  function inventory(ctx, res) {
    var inv = [
      { platform: 'GA4', detected: res.ga4.detected, ids: res.ga4.ids },
      { platform: 'Google Ads', detected: res.gads.detected, ids: res.gads.ids },
      { platform: 'Meta', detected: res.meta.detected, ids: res.meta.ids },
      { platform: 'TikTok', detected: res.tiktok.detected, ids: res.tiktok.ids },
      { platform: 'LinkedIn', detected: res.linkedin.detected, ids: res.linkedin.ids },
      { platform: 'X (Twitter)', detected: res.x.detected, ids: res.x.ids },
      { platform: 'CMP', detected: res.cmp.detected, ids: res.cmp.vendor ? [res.cmp.vendor] : [] }
    ];
    OTHER_TAGS.forEach(function (t) {
      var m = ctx.all.filter(function (r) { return t.re.test(r.url); });
      if (!m.length) return;
      var ids = t.id ? uniq(m.map(function (r) { var x = r.url.match(t.id); return x && (x[1] || x[2]); })) : [];
      inv.push({ platform: t.name, detected: true, ids: ids, other: true });
    });
    return inv;
  }

  // ---------------------------------------------------------------------------
  // Bileşen-durum tablosu
  // ---------------------------------------------------------------------------
  function componentTable(checks) {
    var comps = [];
    checks.forEach(function (c) { if (comps.indexOf(c.component) < 0) comps.push(c.component); });
    return comps.map(function (comp) {
      var cs = checks.filter(function (c) { return c.component === comp; });
      var fails = cs.filter(function (c) { return c.status === 'fail'; });
      var warns = cs.filter(function (c) { return c.status === 'warn'; });
      var pass = cs.filter(function (c) { return c.status === 'pass'; });
      var notInstalled = cs.length === 1 && cs[0].status === 'fail' && /kurulu mu|var mı\?$/.test(cs[0].title) && /bulunamadı|yok|tespit edilmedi/i.test(cs[0].observed);
      var status = notInstalled ? 'Yok' : fails.length ? 'Hatalı' : warns.length ? (pass.length ? 'Kısmen' : (/yok|bulunamadı|gözlenmedi/i.test(warns[0].observed) ? 'Yok' : 'Kısmen')) : pass.length ? 'Mevcut' : (cs.some(function (c) { return /kurulu değil/.test(c.observed); }) ? 'Yok' : 'Doğrulanamadı');
      var evidence = (pass.length ? pass : cs).slice(0, 2).map(function (c) { return c.observed; }).join(' · ');
      var problems = fails.concat(warns).sort(function (a, b) { return (a.severity || 9) - (b.severity || 9); });
      return {
        component: comp, status: status, detection: str(evidence, 260),
        risk: problems.length ? problems.slice(0, 3).map(function (c) { return (c.event !== 'Tüm eventler' ? c.event + ': ' : '') + c.title.replace(/\?$/, '') + ' → ' + str(c.observed, 90); }).join(' | ') : '—',
        recommendation: problems.length ? uniq(problems.map(function (c) { return c.recommendation; })).slice(0, 2).join(' ') : '—',
        counts: { pass: pass.length, fail: fails.length, warn: warns.length, na: cs.length - pass.length - fails.length - warns.length }
      };
    });
  }

  // Hata tablosu (event bazlı gruplanmış) — skill formatı
  function errorTable(checks) {
    var bad = checks.filter(function (c) { return c.status === 'fail' || c.status === 'warn'; });
    var groups = {};
    bad.forEach(function (c) { (groups[c.event] = groups[c.event] || []).push(c); });
    var names = Object.keys(groups).sort(function (a, b) {
      if (a === 'Tüm eventler') return 1; if (b === 'Tüm eventler') return -1;
      var sa = Math.min.apply(null, groups[a].map(function (c) { return c.severity || 9; }));
      var sb = Math.min.apply(null, groups[b].map(function (c) { return c.severity || 9; }));
      return sa - sb;
    });
    return names.map(function (n) {
      return { event: n, rows: groups[n].sort(function (a, b) { return (a.severity || 9) - (b.severity || 9); }).map(function (c) {
        return { description: c.title.replace(/\?$/, '') + (c.status === 'warn' ? ' (Kısmen)' : ''), severity: c.severity, wrong: c.observed || 'Mevcut değil', expected: c.expected, impact: c.impact, recommendation: c.recommendation, status: c.status, component: c.component };
      }) };
    });
  }

  // ---------------------------------------------------------------------------
  // Domaine özel öneriler (Çıktı 3, 4, 5)
  // ---------------------------------------------------------------------------
  function recommendations(meta) {
    var d = regDomain(hostOf(meta.url || '')) || 'example.com';
    var slug = d.split('.')[0];
    var cur = meta.currency || 'TRY';
    var sector = meta.sector || 'ecommerce';
    var funnel, scenarios, pantheon, flows;
    if (sector === 'leadgen') {
      funnel = [
        ['1. İlgi', 'Online', 'view_item', 'Hizmet/proje sayfası görüntülendiğinde', 'item_id, item_name, item_category, currency, value', 'item_id: ' + slug + '-hizmet-1 · value: 0 | currency: ' + cur],
        ['2. Etkileşim', 'Online', 'form_start', 'Form ilk alana odaklanıldığında', 'form_id, form_name, item_id', 'form_id: teklif-formu'],
        ['3. Lead', 'Online', 'generate_lead', 'Form submit (başarılı yanıt)', 'lead_id, value, currency, item_id, gclid, fbclid, user_data (hash)', 'lead_id: lead_2026_a4f2 · value: 100 | currency: ' + cur],
        ['4. Kalifiye', 'Offline', 'qualify_lead', 'CRM: "qualified" statüsü', 'lead_id, value, client_id, gclid', 'value: 1.000 | currency: ' + cur],
        ['5. Görüşme/Teklif', 'Offline', 'begin_checkout', 'CRM: "proposal sent"', 'lead_id, value, items', 'value: 10.000 | currency: ' + cur],
        ['6. Satış', 'Offline', 'purchase', 'CRM: "won" / sözleşme imzalandı', 'transaction_id, value, items, gclid, email_sha256', 'transaction_id: deal_4471 · value: 85.000 | currency: ' + cur]
      ];
      scenarios = [
        ['Kalifiye lead değer ataması', 'Form → CRM skoruna göre değer (A:1000, B:300, C:50) Google Ads/Meta\'ya offline geri besleme', 'Smart Bidding düşük kaliteli lead yerine satışa dönen lead\'e optimize olur'],
        ['Mikro-dönüşümler', 'Telefon tıklama, WhatsApp, broşür indirme, fiyat hesaplayıcı kullanımı event\'leri', 'Düşük hacimli hesaplarda öğrenme süresi kısalır'],
        ['Randevu/Calendly entegrasyonu', 'schedule_meeting event\'i + CRM randevu statüsü', 'Satış ekibine kalifiye görüşme sinyali'],
        ['Remarketing segmentleri', 'Formu başlatıp bitirmeyenler (form_start − generate_lead), 2+ hizmet sayfası gezenler', 'Daha düşük CPL ile geri kazanım'],
        ['Enhanced Conversions for Leads', 'Form e-postasını hash\'leyip CRM satışını gclid/email ile geri yükleme', 'Offline satışların reklama atfedilmesi']
      ];
    } else if (sector === 'subscription') {
      funnel = [
        ['1. Keşif', 'Online', 'view_item', 'Plan/fiyat sayfası', 'item_id (plan), price, currency', 'item_id: plan-pro · value: 299 | currency: ' + cur],
        ['2. Kayıt', 'Online', 'sign_up', 'Hesap oluşturuldu', 'method, user_id', 'method: email'],
        ['3. Deneme', 'Online', 'start_trial', 'Trial başladı', 'value (pLTV), currency, plan', 'value: 900 | currency: ' + cur],
        ['4. Abonelik', 'Online', 'purchase', 'İlk ödeme', 'transaction_id, value, items, user_id', 'transaction_id: sub_9921 · value: 299'],
        ['5. Yenileme', 'Offline', 'renewal (custom)', 'Billing: yenileme', 'transaction_id, value, user_id', 'value: 299 | currency: ' + cur],
        ['6. Churn', 'Offline', 'churn (custom)', 'Billing: iptal', 'user_id, reason', 'reason: price']
      ];
      scenarios = [
        ['pLTV ile değer optimizasyonu', 'Trial başlangıcında tahmini LTV\'yi value olarak gönderme', 'Uzun ömürlü abonelere bidding'],
        ['Trial → Paid offline geri besleme', 'Trial dönüşümünü Measurement Protocol / CAPI ile gönderme', 'Gerçek gelire optimize'],
        ['Churn riskli kitle', 'Kullanım düşen kullanıcıları remarketing\'den çıkar / win-back kampanyası', 'Bütçe verimliliği']
      ];
    } else {
      funnel = [
        ['1. Liste', 'Online', 'view_item_list', 'Kategori/arama sonuç sayfası', 'item_list_id, item_list_name, items[]', 'item_list_name: kategori-' + slug],
        ['2. Ürün', 'Online', 'view_item', 'Ürün detay sayfası', 'currency, value, items[item_id, item_name, price, item_brand, item_category]', 'item_id: SKU-164592 · value: 3995 | currency: ' + cur],
        ['3. Sepet', 'Online', 'add_to_cart', 'Sepete ekle başarılı yanıtı', 'currency, value, items[quantity]', 'value: 3995 | currency: ' + cur],
        ['4. Checkout', 'Online', 'begin_checkout', 'Ödeme adımına geçiş', 'currency, value, coupon, items', 'value: 3995 | currency: ' + cur],
        ['5. Teslimat', 'Online', 'add_shipping_info', 'Kargo seçimi', 'shipping_tier, value, items', 'shipping_tier: standart'],
        ['6. Ödeme', 'Online', 'add_payment_info', 'Ödeme yöntemi seçimi', 'payment_type, value, items', 'payment_type: kredi_karti'],
        ['7. Satın alma', 'Online', 'purchase', 'Sipariş onay sayfası (tek sefer)', 'transaction_id, value, tax, shipping, currency, items, user_data (hash)', 'transaction_id: ' + slug.toUpperCase() + '-100245 · value: 4.120 | currency: ' + cur],
        ['8. İade/İptal', 'Offline', 'refund', 'ERP/OMS: iade onaylandı', 'transaction_id, value, items', 'transaction_id: ' + slug.toUpperCase() + '-100245 · value: 3995'],
        ['9. Tekrar satış', 'Offline', 'purchase (repeat)', 'CRM: 2. sipariş', 'transaction_id, value, customer_type: returning', 'customer_type: returning']
      ];
      scenarios = [
        ['Kâr bazlı (POAS) bidding', 'purchase value yerine brüt kâr gönderme (sGTM\'de maliyet zenginleştirme)', 'Düşük marjlı ürünlere aşırı harcamayı önler'],
        ['Yeni vs. mevcut müşteri', 'new_customer parametresi + Google Ads New Customer Acquisition hedefi', 'Yeni müşteri kazanımına ek değer'],
        ['İade düzeltmesi', 'refund event\'i ile GA4 ve Ads conversion adjustment', 'Gerçek gelir ve ROAS'],
        ['Sepet terk kitleleri', 'add_to_cart − purchase (7 gün) dinamik remarketing (Meta catalog + Google DR)', 'Kayıp sepetlerin geri kazanımı'],
        ['Mikro-dönüşümler', 'add_to_wishlist, stok bildirimi, beden tablosu, ürün karşılaştırma event\'leri', 'Ürün ilgi sinyali ve kitle zenginliği'],
        ['Offline/mağaza satışları', 'Mağaza POS satışlarını hash\'li e-posta/telefonla offline conversion olarak yükleme', 'Omnichannel ROAS']
      ];
    }
    pantheon = [
      ['Phoebe (tahmine dayalı değer)', sector === 'leadgen' ? 'generate_lead anında ML modelinin kalifiye olma olasılığı × ortalama sözleşme değeri (ör. 0.18 × 85.000 = 15.300 ' + cur + ') value olarak Ads/Meta\'ya gider.' : 'İlk purchase\'ta müşterinin 12 aylık pLTV tahmini (ör. sepet 4.120 → pLTV 11.800 ' + cur + ') conversion value olarak Google Ads\'e gönderilir.', 'Smart Bidding gerçek uzun vadeli değere optimize olur.'],
      ['Artemis (offline + online aktivasyon)', sector === 'leadgen' ? 'CRM "qualified" → Google Ads offline conversion + GA4 qualify_lead; CRM "won" → Ads purchase + Floodlight sales tag (gclid/email_sha256 ile).' : 'OMS "delivered" ve "returned" statüleri → sGTM → GA4 refund/purchase düzeltmesi + Google Ads conversion adjustment + Floodlight.', 'CRM/OMS verisi gerçek zamanlı reklam sinyaline döner.'],
      ['Zeus (tag monitoring)', 'Kritik event\'ler (' + (sector === 'leadgen' ? 'generate_lead, qualify_lead' : 'purchase, add_to_cart') + ') için sGTM\'de her tag yanıtı Cloud Logging/BigQuery\'ye yazılır; Meta CAPI 4xx oranı >%2 veya purchase sayısı 1 saatte %50 düşerse Slack/e-posta alarmı.', 'Kırık tag\'ler gelir kaybına dönüşmeden yakalanır.']
    ];
    flows = [
      'CRM/OMS → (webhook) → sGTM → GA4 Measurement Protocol (client_id/user_id + transaction_id)',
      'CRM/OMS → sGTM → Meta Conversions API (action_source: system_generated / physical_store, event_id, hash\'li user_data)',
      'CRM → Google Ads offline conversion import / Data Manager (gclid veya hash\'li e-posta/telefon)'
    ];
    var dlExample = sector === 'leadgen'
      ? "dataLayer.push({ ecommerce: null });\ndataLayer.push({\n  event: 'generate_lead',\n  event_id: 'lead_2026_a4f2',\n  lead_id: 'lead_2026_a4f2',\n  user_id: 'u_8f3a2c',\n  user_data: { sha256_email_address: '<sha256>', sha256_phone_number: '<sha256>' },\n  ecommerce: { currency: '" + cur + "', value: 100, items: [{ item_id: '" + slug + "-hizmet-1', item_name: 'Hizmet 1' }] }\n});"
      : "dataLayer.push({ ecommerce: null });\ndataLayer.push({\n  event: 'purchase',\n  event_id: 'purchase_" + slug + "_100245',\n  user_id: 'u_8f3a2c',\n  user_data: { sha256_email_address: '<sha256>', sha256_phone_number: '<sha256>' },\n  ecommerce: {\n    transaction_id: '" + slug.toUpperCase() + "-100245',\n    currency: '" + cur + "', value: 4120, tax: 686.67, shipping: 125,\n    items: [{ item_id: 'SKU-164592', item_name: 'Ürün', item_brand: 'Marka', item_category: 'Kategori', price: 3995, quantity: 1 }]\n  }\n});";
    return { funnel: funnel, scenarios: scenarios, pantheon: pantheon, flows: flows, dlExample: dlExample, sector: sector };
  }

  // ---------------------------------------------------------------------------
  // Ana fonksiyon
  // ---------------------------------------------------------------------------
  function run(input) {
    var ctx = normalize(input);
    var opt = { currency: (ctx.meta.currency || '').toUpperCase() || null };
    var cookiesAll = [];
    Object.keys(ctx.phases).forEach(function (ph) { if (ph !== 'after_reject' && ph !== 'har_reject') cookiesAll = cookiesAll.concat(ctx.phases[ph].cookies || []); });
    ctx.cookiesAll = cookiesAll;

    var ga4 = auditGA4(ctx, opt); ctx.ga4Hits = ga4.hits;
    var gads = auditGAds(ctx, opt);
    var meta = auditMeta(ctx, opt);
    var tiktok = auditTikTok(ctx, opt);
    var linkedin = auditLinkedIn(ctx, opt);
    var x = auditX(ctx, opt);
    var dl = auditDataLayer(ctx, opt);
    var mh = metaHits(ctx.main);
    var found = { metaEid: mh.some(function (h) { return h.eid; }), ttEid: tiktokHits(ctx.main).some(function (h) { return h.eid; }), metaEids: mh.filter(function (h) { return h.eid; }).map(function (h) { return h.ev + ':' + h.eid; }) };
    var infra = auditInfra(ctx, found);
    var cmp = auditCMP(ctx);
    var res = { ga4: ga4, gads: gads, meta: meta, tiktok: tiktok, linkedin: linkedin, x: x, datalayer: dl, infra: infra, cmp: cmp };

    var platforms = PLATFORMS.map(function (p) {
      var checks = res[p.key].col.checks;
      var counts = { pass: 0, fail: 0, warn: 0, na: 0 };
      checks.forEach(function (c) { counts[c.status]++; });
      return { key: p.key, name: p.name, detected: res[p.key].detected !== false, checks: checks, counts: counts, components: componentTable(checks), errors: errorTable(checks) };
    });
    var tot = { pass: 0, fail: 0, warn: 0, na: 0, critical: 0 };
    platforms.forEach(function (p) { Object.keys(p.counts).forEach(function (k) { tot[k] += p.counts[k]; }); p.checks.forEach(function (c) { if (c.status === 'fail' && c.severity === 1) tot.critical++; }); });
    var denom = tot.pass + tot.fail + tot.warn;
    var score = denom ? Math.round(100 * (tot.pass + tot.warn * 0.5) / denom) : 0;

    return {
      version: VERSION, generatedAt: new Date().toISOString(),
      meta: { url: ctx.meta.url || '', sector: ctx.meta.sector || 'ecommerce', currency: opt.currency || '', mode: ctx.meta.mode || '', scannedAt: ctx.meta.scannedAt || '', pages: ctx.pages, requestCount: ctx.all.length, notes: ctx.meta.notes || [] },
      inventory: inventory(ctx, res), platforms: platforms, totals: tot, score: score,
      mapping: MAPPING, recommendations: recommendations(ctx.meta)
    };
  }

  // Kontrol kataloğu (metodoloji sayfası)
  var CATALOG = [
    { area: 'DataLayer', items: ['dataLayer varlığı ve push edilen event listesi', 'GA4 e-commerce şeması (event adı, ecommerce objesi, items[])', 'Zorunlu alanlar: currency, value, transaction_id', 'Tip kontrolü: value/price number, currency ISO 4217', 'Eski UA Enhanced Ecommerce şeması kalıntısı', 'ecommerce:null temizliği', 'Açık metin PII (e-posta, telefon, ad-soyad, adres)', 'user_id / customer_id varlığı', 'Consent Mode default (GTM öncesi) + 4 v2 sinyali + update', 'dataLayer event\'i → GA4 hit\'ine dönüşüyor mu'] },
    { area: 'GA4', items: ['Measurement ID ve /g/collect hit\'leri', 'page_view varlığı ve çift tetiklenme', '7 funnel event\'inin varlığı (view_item_list → purchase)', 'Event bazlı zorunlu + önerilen parametreler (resmi şema)', 'currency formatı / beklenen para birimi', 'value sayısal + Σ(price×qty) tutarlılığı', 'items: item_id/item_name, price, quantity', 'Hit bazlı çift tetiklenme ve hit\'ler arası format tutarlılığı', 'purchase transaction_id tekilliği', 'user_id (uid) ve PII içeriği', 'Consent Mode gcs/gcd + v2 sinyalleri'] },
    { area: 'Google Ads', items: ['AW- Conversion ID ve istek tipleri (conversion, 1p-conversion, fmt)', 'Remarketing hit\'i', 'Conversion Linker (_gcl_au)', 'Conversion mükerrer tetiklenme', 'value, currency_code, transaction_id (oid)', 'Cart data (item-level) parametreleri', 'Enhanced Conversions (em, ec_mode) ve hash kontrolü'] },
    { area: 'Meta', items: ['Pixel ID, PageView, çoklu pixel', 'Standart event\'ler ve zorunlu/önerilen parametreler', 'content_ids string array, contents (id+quantity), content_type', 'value sayısal, currency ISO', 'Hit bazlı çift tetiklenme + hit\'ler arası format tutarlılığı', 'event_id (eid) varlığı ve tekilliği (CAPI dedup)', 'Advanced Matching alanları ve SHA-256 hash', 'CAPI / Gateway izleri'] },
    { area: 'TikTok', items: ['Pixel kodu ve event\'ler', 'contents[].content_id (string), content_type', 'value number + currency ISO', 'event_id (Events API dedup)', 'Advanced Matching (email/phone/external_id) hash', 'Çift tetiklenme'] },
    { area: 'LinkedIn & X', items: ['Insight Tag partner ID / X pixel ID', 'Conversion event\'leri', 'event_id / conversion_id (CAPI dedup)', 'value + currency (X)'] },
    { area: 'Altyapı', items: ['GTM container sayısı ve kaynağı', 'Google Tag Gateway (first-party path)', 'sGTM (first-party collect endpoint)', 'Server-side API\'ler (CAPI/Events API) — tarayıcıdan doğrulanamaz notu', 'Event ID tekilliği'] },
    { area: 'CMP / Consent', items: ['CMP sağlayıcı / banner tespiti', 'Onay öncesi marketing istekleri ve çerezleri', '"Reddet" sonrası ateşlenen istekler (tek tek)', 'Reddet sonrası çerezler', 'Reddet sonrası gcs/gcd sinyalleri', 'Kabul sonrası granted güncellemesi'] }
  ];

  return { run: run, fromHAR: fromHAR, VERSION: VERSION, CATALOG: CATALOG, PLATFORMS: PLATFORMS, MAPPING: MAPPING, _internal: { ga4Hits: ga4Hits, decodeGcd: decodeGcd, metaHits: metaHits } };
});
