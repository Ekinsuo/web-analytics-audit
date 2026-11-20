/*!
 * Web Analytics Audit — audit engine
 * Applies an e-commerce / lead-gen tracking QA checklist (GA4, Google Ads, Meta, TikTok,
 * LinkedIn, X, DataLayer, Infrastructure, CMP) to captured network requests, the dataLayer
 * and cookies. Runs in the browser (window.AuditEngine) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuditEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.1.0';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  var CURRENCY_RE = /^[A-Z]{3}$/;
  var HEX64_RE = /^[a-f0-9]{64}$/i;
  var B64HASH_RE = /^[A-Za-z0-9_\-+/]{43,44}=?$/;
  var EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i;
  var PHONE_VAL_RE = /^(\+?90|0)?\s*5\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}$|^\+\d{10,14}$/;
  var ALL = 'All events';
  var MISSING = 'Not present';

  var FUNNEL = ['view_item_list', 'view_item', 'add_to_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'purchase'];

  var PLATFORMS = [
    { key: 'datalayer', name: 'DataLayer' },
    { key: 'infra', name: 'Infrastructure' },
    { key: 'cmp', name: 'CMP / Consent' },
    { key: 'ga4', name: 'GA4' },
    { key: 'gads', name: 'Google Ads' },
    { key: 'meta', name: 'Meta Ads' },
    { key: 'tiktok', name: 'TikTok' },
    { key: 'linkedin', name: 'LinkedIn' },
    { key: 'x', name: 'X (Twitter)' }
  ];

  var MAPPING = [
    ['view_item_list', 'ViewContent (list) / ViewCategory', 'ViewContent', '—'],
    ['view_item', 'ViewContent', 'ViewContent', '—'],
    ['add_to_cart', 'AddToCart', 'AddToCart', '—'],
    ['begin_checkout', 'InitiateCheckout', 'InitiateCheckout', '—'],
    ['add_shipping_info', 'AddShippingInfo / custom', 'custom', '—'],
    ['add_payment_info', 'AddPaymentInfo', 'AddPaymentInfo', '—'],
    ['purchase', 'Purchase', 'CompletePayment / Purchase', 'conversion (purchase)']
  ];

  // Official GA4 recommended e-commerce event schema
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

  // Inventory only: other detected platforms
  var OTHER_TAGS = [
    { name: 'Google Tag Manager', re: /googletagmanager\.com\/gtm\.js|\/gtm\.js\?id=GTM-/i, id: /[?&]id=(GTM-[A-Z0-9]+)/i },
    { name: 'Microsoft Ads (UET)', re: /bat\.bing\.com/i, id: /[?&]ti=(\d+)/ },
    { name: 'Microsoft Clarity', re: /clarity\.ms\/(tag|collect)/i, id: /clarity\.ms\/tag\/([a-z0-9]+)/i },
    { name: 'Hotjar', re: /hotjar\.com/i, id: /hotjar-(\d+)\.js|\/c\/hotjar-(\d+)/i },
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
    { name: 'Yahoo', re: /sp\.analytics\.yahoo\.com|s\.yimg\.(jp|com)\/.*ytag/i, id: null }
  ];

  var MARKETING_HOST_RE = /facebook\.com\/tr|connect\.facebook\.net|analytics\.tiktok\.com|googleadservices\.com|googleads\.g\.doubleclick\.net|\/pagead\/(1p-)?(conversion|user-list|viewthroughconversion)|px\.ads\.linkedin\.com|snap\.licdn\.com|analytics\.twitter\.com|static\.ads-twitter\.com|t\.co\/i\/adsct|bat\.bing\.com|criteo|ct\.pinterest\.com|tr\.snapchat\.com|doubleclick\.net|clarity\.ms|hotjar|mc\.yandex|taboola|outbrain|creativecdn/i;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function str(v, max) {
    if (v === undefined) return MISSING;
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
      try { new URLSearchParams(body).forEach(function (v, k) { p[k] = v; }); } catch (e) { /* ignore */ }
    }
    return p;
  }

  // ---------------------------------------------------------------------------
  // Input normalisation
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

  /** Converts a HAR file (Chrome DevTools > Network > Save all as HAR) into the common input format. */
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
   * Common input:
   * { meta:{url, sector, currency, mode, scannedAt},
   *   phases:{ pre_consent?:{requests,cookies}, accepted?:{...}, after_reject?:{...}, har?:{...}, har_reject?:{...} },
   *   dataLayer:[], html:'', cmp:{vendor, bannerFound, rejectClicked, acceptClicked}, pages:[] }
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
  // Check collector
  // ---------------------------------------------------------------------------
  function Collector(platform) { this.platform = platform; this.checks = []; }
  Collector.prototype.add = function (c) {
    var o = {
      platform: this.platform, component: c.component || 'General', event: c.event || ALL, title: c.title,
      status: c.status, severity: pickSev(c.status, c.severity), observed: c.observed === undefined ? '' : c.observed,
      expected: c.expected || '', impact: c.status === 'pass' ? (c.passNote || '') : (c.impact || ''),
      recommendation: c.status === 'pass' ? '' : (c.recommendation || '')
    };
    this.checks.push(o); return o;
  };

  /** Evaluates every hit of an event separately and produces a hit-by-hit observation. */
  function perHit(col, component, event, hits, title, fn, meta) {
    if (!hits.length) return;
    var res = hits.map(function (h) { return fn(h); });
    var applicable = res.filter(function (r) { return r && r.ok !== null; });
    if (!applicable.length) return;
    var hasFail = res.some(function (r) { return r && r.ok === false; });
    var hasWarn = res.some(function (r) { return r && r.ok === 'warn'; });
    var obs = res.length > 1
      ? res.slice(0, 6).map(function (r, i) { return 'Hit #' + (i + 1) + ': ' + (r ? r.val : '—'); }).join(' / ') + (res.length > 6 ? ' / … (' + res.length + ' hits)' : '')
      : (res[0] ? res[0].val : '');
    col.add({
      component: component, event: event, title: title, status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
      severity: hasFail ? meta.severity : (meta.warnSeverity || 3), observed: obs, expected: meta.expected,
      impact: meta.impact, recommendation: meta.rec, passNote: meta.passNote
    });
  }

  function findDuplicates(hits, keyFn, windowMs) {
    // same key within a short time window => double firing
    var groups = {}; var dups = [];
    hits.forEach(function (h, i) { var k = keyFn(h); (groups[k] = groups[k] || []).push({ h: h, i: i }); });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      for (var j = 1; j < g.length; j++) if (Math.abs(g[j].h.t - g[j - 1].h.t) <= windowMs) dups.push([g[j - 1].i, g[j].i]);
    });
    return dups;
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
        hits.push({ en: p.en, tid: p.tid, cid: p.cid, uid: p.uid, gcs: p.gcs, gcd: p.gcd, dl: p.dl || '', params: params, strTyped: strTyped, items: items, host: r.host, t: r.t + li, phase: r.phase });
      });
    });
    return hits;
  }
  function ga4Get(h, name) { return name === 'items' ? (h.items.length ? h.items : undefined) : h.params[name]; }
  function itemsSig(items) { return (items || []).map(function (i) { return (i.item_id || i.item_name || '') + 'x' + (i.quantity || ''); }).join('|'); }

  function decodeGcd(gcd) {
    // gcd: "13p3p3p2p5" → [ad_storage, analytics_storage, ad_user_data, ad_personalization]
    if (!gcd || gcd.length < 9) return null;
    var letters = [gcd.charAt(2), gcd.charAt(4), gcd.charAt(6), gcd.charAt(8)];
    var map = function (c) {
      if (c === 'l') return 'not set';
      if ('tnrv'.indexOf(c) >= 0) return 'granted';
      if ('pqmuef'.indexOf(c) >= 0) return 'denied';
      return '?(' + c + ')';
    };
    return { ad_storage: map(letters[0]), analytics_storage: map(letters[1]), ad_user_data: map(letters[2]), ad_personalization: map(letters[3]), raw: gcd };
  }
  var SIGNALS = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'];

  function auditGA4(ctx, opt) {
    var col = new Collector('ga4');
    var hits = ga4Hits(ctx.main);
    var scripts = ctx.main.filter(function (r) { return /\/gtag\/js$/.test(r.path) && /^G-/.test(r.u.searchParams.get('id') || ''); });
    var tids = uniq(hits.map(function (h) { return h.tid; }).concat(scripts.map(function (r) { return r.u.searchParams.get('id'); })));
    var C1 = 'Measurement ID + events', C2 = 'E-commerce parameters', C3 = 'User ID', C4 = 'Consent Mode signals', C5 = 'Double firing / consistency';
    var events = uniq(hits.map(function (h) { return h.en; }));

    col.add({
      component: C1, title: 'Is the GA4 tag installed and sending hits?', status: hits.length ? 'pass' : tids.length ? 'warn' : 'fail', severity: 1,
      observed: hits.length ? 'Measurement ID: ' + tids.join(', ') + ' · ' + hits.length + ' hits · events: ' + events.join(', ') : (tids.length ? 'gtag.js loaded (' + tids.join(', ') + ') but no /g/collect hit observed' : 'No GA4 request found'),
      expected: '/g/collect hits with a G-XXXXXXX measurement ID', impact: 'Web analytics data is not being collected', recommendation: 'Install the GA4 Google tag (via GTM or gtag.js) on all pages.'
    });
    if (!hits.length) return { col: col, detected: tids.length > 0, ids: tids, hits: hits };

    if (tids.length > 1) col.add({ component: C1, title: 'Multiple GA4 properties', status: 'warn', severity: 3, observed: tids.join(', '), expected: 'Fine if intentional (e.g. roll-up property)', impact: 'Unnecessary hit volume; risk of inconsistent reports', recommendation: 'Confirm the purpose of each property; remove unused ones.' });

    var pv = hits.filter(function (h) { return h.en === 'page_view'; });
    col.add({ component: C1, event: 'page_view', title: 'Does page_view fire?', status: pv.length ? 'pass' : 'fail', severity: 1, observed: pv.length + ' page_view hits', expected: '1 page_view per page load', impact: 'Page and session metrics are missing', recommendation: 'Keep send_page_view enabled on the Google tag or fire a page_view event.' });
    var pvDup = findDuplicates(pv, function (h) { return h.tid + '|' + h.dl; }, 3000);
    col.add({ component: C5, event: 'page_view', title: 'Does page_view fire twice on the same page?', status: pvDup.length ? 'fail' : 'pass', severity: 2, observed: pvDup.length ? pvDup.length + ' duplicate page_view (same dl, <3 s): ' + str(pv[pvDup[0][1]].dl, 120) : 'Single page_view per page', expected: '1 page_view per page', impact: 'Page views doubled; bounce/engagement rates distorted', recommendation: 'Check GTM for both a Google tag (send_page_view) and a separate page_view tag.' });

    FUNNEL.forEach(function (ev) {
      var n = hits.filter(function (h) { return h.en === ev; }).length;
      col.add({ component: C1, event: ev, title: 'Was the funnel event observed?', status: n ? 'pass' : 'na', observed: n ? n + ' hits' : 'Not observed in this capture (step may not have been visited)', expected: 'GA4 recommended event: ' + ev });
    });

    Object.keys(GA4_RULES).forEach(function (ev) {
      var eh = hits.filter(function (h) { return h.en === ev; });
      if (!eh.length) return;
      var rule = GA4_RULES[ev];
      rule.req.forEach(function (pn) {
        perHit(col, C2, ev, eh, 'Required parameter: ' + pn, function (h) {
          var v = ga4Get(h, pn);
          return { ok: v !== undefined && v !== '', val: pn === 'items' ? (v ? v.length + ' items' : MISSING) : str(v, 80) };
        }, { severity: pn === 'transaction_id' || ev === 'purchase' ? 1 : 2, expected: pn + ' must be sent (GA4 e-commerce schema)', impact: pn === 'items' ? 'Item-scoped reports stay empty' : pn === 'transaction_id' ? 'Duplicate purchases cannot be de-duplicated; revenue inflated' : 'Revenue/value reports and value-based optimisation break', rec: 'Add the ' + pn + ' parameter to ' + ev + '.' });
      });
      rule.rec.forEach(function (pn) {
        perHit(col, C2, ev, eh, 'Recommended parameter: ' + pn, function (h) { var v = ga4Get(h, pn); return { ok: v !== undefined && v !== '' ? true : 'warn', val: str(v, 80) }; },
          { severity: 3, warnSeverity: 3, expected: pn + ' (recommended)', impact: 'Extra reporting dimension lost', rec: 'Add the ' + pn + ' parameter.' });
      });
      if (rule.req.indexOf('currency') >= 0 || rule.rec.indexOf('currency') >= 0) {
        perHit(col, C2, ev, eh, 'currency format (ISO 4217)', function (h) {
          var c = h.params.currency; if (c === undefined) return { ok: null };
          if (!CURRENCY_RE.test(c)) return { ok: false, val: str(c) };
          if (opt.currency && c !== opt.currency) return { ok: false, val: c + ' (expected ' + opt.currency + ')' };
          return { ok: true, val: c };
        }, { severity: 1, expected: opt.currency || 'TRY / EUR / USD (3 upper-case letters)', impact: 'Revenue cannot be converted / reported in the wrong currency', rec: 'Send currency as an ISO 4217 code.' });
      }
      if (GA4_VALUE_EVENTS.indexOf(ev) >= 0) {
        perHit(col, C2, ev, eh, 'Is value numeric and consistent with the items total?', function (h) {
          var v = h.params.value; if (v === undefined) return { ok: null };
          if (!isNum(v)) return { ok: false, val: str(v) + ' (not a number)' };
          if (h.strTyped.value) return { ok: 'warn', val: 'value=' + v + ' sent as a string (ep.value)' };
          var sum = 0, ok = true;
          h.items.forEach(function (i) { if (isNum(i.price)) sum += Number(i.price) * (isNum(i.quantity) ? Number(i.quantity) : 1); else ok = false; });
          if (!h.items.length || !ok) return { ok: true, val: 'value=' + v };
          var diff = Math.abs(sum - Number(v));
          if (sum > 0 && diff / sum > 0.02 && ev !== 'purchase') return { ok: 'warn', val: 'value=' + v + ' · Σ(price×qty)=' + Math.round(sum * 100) / 100 };
          return { ok: true, val: 'value=' + v + (sum ? ' · Σ(price×qty)=' + Math.round(sum * 100) / 100 : '') };
        }, { severity: 1, warnSeverity: 3, expected: 'value = Σ(price × quantity) (purchase may include tax/shipping)', impact: 'Revenue and ROAS reports are wrong', rec: 'Send value as a number, consistent with the items total.' });
      }
      if (rule.req.indexOf('items') >= 0 || rule.rec.indexOf('items') >= 0) {
        perHit(col, C2, ev, eh, 'items: does every item have item_id or item_name?', function (h) {
          if (!h.items.length) return { ok: null };
          var bad = h.items.filter(function (i) { return !i.item_id && !i.item_name; });
          return { ok: !bad.length, val: bad.length ? bad.length + '/' + h.items.length + ' items without id/name' : h.items.length + ' items · e.g. ' + str(h.items[0], 140) };
        }, { severity: 1, expected: '{"item_id":"SKU123","item_name":"Product","price":199.9,"quantity":1}', impact: 'Item reports stay empty', rec: 'Add item_id and item_name to every item.' });
        perHit(col, C2, ev, eh, 'items: are price and quantity numeric?', function (h) {
          if (!h.items.length) return { ok: null };
          var miss = h.items.filter(function (i) { return !isNum(i.price) || (i.quantity !== undefined && !isNum(i.quantity)); });
          var noQty = h.items.filter(function (i) { return i.quantity === undefined; });
          if (miss.length) return { ok: false, val: miss.length + ' items with missing or non-numeric price/quantity: ' + str(miss[0], 120) };
          if (noQty.length) return { ok: 'warn', val: noQty.length + ' items without quantity (defaults to 1)' };
          return { ok: true, val: 'price + quantity numeric on all items' };
        }, { severity: 2, warnSeverity: 3, expected: 'price: number, quantity: integer', impact: 'Item revenue and quantity metrics are wrong', rec: 'Send price and quantity as numbers.' });
      }
      if (ev === 'purchase') {
        var tx = eh.map(function (h) { return h.params.transaction_id; }).filter(Boolean);
        var dupTx = tx.filter(function (t, i) { return tx.indexOf(t) !== i; });
        col.add({ component: C5, event: 'purchase', title: 'Are there duplicate purchases with the same transaction_id?', status: dupTx.length ? 'fail' : 'pass', severity: 1, observed: dupTx.length ? 'Repeated: ' + uniq(dupTx).join(', ') : 'transaction_ids are unique (' + (tx.join(', ') || '—') + ')', expected: 'One purchase per order', impact: 'Revenue reported twice', recommendation: 'Block purchase on thank-you page reloads (cookie/flag) and always send transaction_id.' });
      }
      var d = findDuplicates(eh, function (h) { return h.tid + '|' + h.dl + '|' + itemsSig(h.items); }, 2000);
      if (ev !== 'view_item_list') col.add({ component: C5, event: ev, title: 'Does the event fire twice?', status: d.length ? 'fail' : 'pass', severity: ev === 'purchase' ? 1 : 2, observed: d.length ? d.length + ' duplicate hits (same page + same items, <2 s) — Hit #' + (d[0][0] + 1) + ' & Hit #' + (d[0][1] + 1) : eh.length + ' hits, no double firing', expected: '1 hit per action', impact: 'Event count 2x; funnel and conversion rates distorted', recommendation: 'Check GTM for multiple tags/triggers sending the same event.' });
      if (eh.length > 1) {
        var shapes = uniq(eh.map(function (h) { return Object.keys(h.params).sort().join(',') + '|items:' + (h.items.length ? Object.keys(h.items[0]).sort().join(',') : '0'); }));
        col.add({ component: C5, event: ev, title: 'Is the parameter set consistent across hits?', status: shapes.length > 1 ? 'warn' : 'pass', severity: 3, observed: shapes.length > 1 ? shapes.slice(0, 3).map(function (s, i) { return 'Format ' + (i + 1) + ': ' + str(s, 120); }).join(' / ') : 'All hits share the same structure', expected: 'Same structure every time the event fires', impact: 'Partially empty values in reports', recommendation: 'Use the same dataLayer structure on all page templates.' });
      }
    });

    var uidHits = hits.filter(function (h) { return h.uid; });
    col.add({ component: C3, title: 'Is user_id (uid) sent?', status: uidHits.length ? 'pass' : 'warn', severity: 2, warnSeverity: 2,
      observed: uidHits.length ? 'uid observed (' + uidHits.length + ' hits): ' + str(uidHits[0].uid, 40) : 'cid present (' + str(hits[0].cid, 30) + ') but no uid — session may be logged out',
      expected: 'uid=<hashed customer ID> for logged-in users', impact: 'Cross-device user stitching is not possible', recommendation: 'Push user_id to the dataLayer after login and map it in the GA4 config (non-PII, hashed ID).' });
    if (uidHits.length) {
      var piiUid = uidHits.filter(function (h) { return EMAIL_RE.test(h.uid); });
      col.add({ component: C3, title: 'Does user_id contain PII?', status: piiUid.length ? 'fail' : 'pass', severity: 1, observed: piiUid.length ? 'uid contains an email: ' + str(piiUid[0].uid, 40) : 'uid contains no PII', expected: 'Opaque / hashed ID', impact: 'Violates GA4 policy and GDPR/KVKK', recommendation: 'Use an internal customer ID instead of an email as uid.' });
    }

    var piiHits = hits.filter(function (h) { return EMAIL_RE.test(JSON.stringify(h.params)) || EMAIL_RE.test(decodeURIComponent(h.dl || '')); });
    col.add({ component: C2, title: 'Do hits contain plain-text PII (email)?', status: piiHits.length ? 'fail' : 'pass', severity: 1, observed: piiHits.length ? piiHits.length + ' hits contain an email (e.g. ' + piiHits[0].en + ')' : 'No PII observed', expected: 'No PII is sent to GA4', impact: 'GA4 policy violation → data deletion / account termination risk; GDPR/KVKK', recommendation: 'Strip emails/phone numbers from URLs and parameters.' });

    var withGcs = hits.filter(function (h) { return h.gcs || h.gcd; });
    var gcdDec = hits.map(function (h) { return decodeGcd(h.gcd); }).filter(Boolean);
    col.add({ component: C4, title: 'Are Consent Mode signals (gcs/gcd) present on hits?', status: withGcs.length ? 'pass' : 'fail', severity: 2, observed: withGcs.length ? 'gcs=' + uniq(hits.map(function (h) { return h.gcs; })).join(',') + ' · gcd=' + uniq(hits.map(function (h) { return h.gcd; })).slice(0, 3).join(',') : 'No gcs/gcd parameter', expected: 'gcs=G1xx and gcd=… (Consent Mode v2)', impact: 'Modelling/remarketing restricted for EEA traffic', recommendation: 'Integrate the CMP with Google Consent Mode v2 (default + update).' });
    if (gcdDec.length) {
      var v2missing = gcdDec.filter(function (g) { return g.ad_user_data === 'not set' || g.ad_personalization === 'not set'; });
      col.add({ component: C4, title: 'Are the Consent Mode v2 signals (ad_user_data, ad_personalization) set?', status: v2missing.length ? 'fail' : 'pass', severity: 2, observed: 'gcd decoded: ' + SIGNALS.map(function (k) { return k + '=' + gcdDec[gcdDec.length - 1][k]; }).join(', '), expected: 'All 4 signals have a default + update value', impact: 'Without v2 signals, Google Ads EEA audiences and conversion modelling do not work', recommendation: 'Add ad_user_data and ad_personalization to the consent default/update calls.' });
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
      out.push({ kind: kind, endpoint: m[1], host: r.host, id: 'AW-' + m[2], label: p.label, value: p.value, currency: p.currency_code, oid: p.oid || p.transaction_id, fmt: p.fmt, em: p.em, ecMode: p.ec_mode, gcs: p.gcs, gcd: p.gcd, item: p.item, mid: p.mid, t: r.t, phase: r.phase });
    });
    return out;
  }

  function auditGAds(ctx, opt) {
    var col = new Collector('gads');
    var hits = gadsHits(ctx.main);
    var scriptIds = ctx.main.filter(function (r) { return /\/gtag\/js$/.test(r.path) && /^AW-/.test(r.u.searchParams.get('id') || ''); }).map(function (r) { return r.u.searchParams.get('id'); });
    var ids = uniq(hits.map(function (h) { return h.id; }).concat(scriptIds));
    var C1 = 'Conversion Tracking', C2 = 'Enhanced Conversions', C3 = 'Conversion parameters', C4 = 'Remarketing / Conversion Linker';
    if (!ids.length) {
      col.add({ component: C1, title: 'Is the Google Ads tag installed?', status: 'fail', severity: 2, observed: 'No AW- request or gtag load found', expected: 'AW-XXXXXXXXX conversion/remarketing requests', impact: 'Google Ads conversions are not measured (may be intentional if GA4 import is used)', recommendation: 'Install the Google Ads conversion tag + conversion linker, or verify the GA4 conversion import.' });
      return { col: col, detected: false, ids: [] };
    }
    col.add({ component: C1, title: 'Is the Google Ads tag installed?', status: 'pass', observed: ids.join(', ') + ' · ' + hits.length + ' requests (' + uniq(hits.map(function (h) { return h.endpoint + (h.fmt ? ' fmt=' + h.fmt : ''); })).join(', ') + ')', expected: 'AW-XXXXXXXXX' });

    var rm = hits.filter(function (h) { return h.kind === 'remarketing'; });
    col.add({ component: C4, title: 'Is a remarketing hit sent?', status: rm.length ? 'pass' : 'warn', severity: 3, observed: rm.length ? rm.length + ' remarketing requests (' + uniq(rm.map(function (h) { return h.endpoint; })).join(', ') + ')' : 'No remarketing request', expected: 'viewthroughconversion / 1p-user-list requests', impact: 'Remarketing audiences are not populated', recommendation: 'Enable Google Ads remarketing (or GA4 audience sharing).' });
    var cookieNames = (ctx.cookiesAll || []).map(function (c) { return c.name; });
    if (cookieNames.length) col.add({ component: C4, title: 'Is the Conversion Linker cookie (_gcl_au) written?', status: cookieNames.indexOf('_gcl_au') >= 0 ? 'pass' : 'warn', severity: 2, observed: cookieNames.indexOf('_gcl_au') >= 0 ? '_gcl_au present' : '_gcl_au not found', expected: '_gcl_au (and _gcl_aw when arriving with a gclid)', impact: 'Without the stored GCLID, conversion attribution is lost', recommendation: 'Fire the Conversion Linker tag on all pages in GTM.' });

    var conv = hits.filter(function (h) { return h.kind === 'conversion'; });
    if (!conv.length) {
      col.add({ component: C1, event: 'purchase', title: 'Does the conversion (purchase) hit fire?', status: 'na', observed: 'No conversion request observed in this capture (order may not have been completed)', expected: '/pagead/conversion request with a label' });
      return { col: col, detected: true, ids: ids };
    }
    uniq(conv.map(function (h) { return h.id + '/' + h.label; })).forEach(function (lb) {
      var ev = 'Conversion ' + lb;
      var ch = conv.filter(function (h) { return h.id + '/' + h.label === lb; });
      var main = ch.filter(function (h) { return h.endpoint === 'conversion'; });
      var base = main.length ? main : ch;
      col.add({ component: C1, event: ev, title: 'Does the conversion fire?', status: 'pass', observed: ch.length + ' requests: ' + uniq(ch.map(function (h) { return h.host + ' ' + h.endpoint + (h.fmt ? ' fmt=' + h.fmt : ''); })).join(' + '), expected: 'Parallel requests per conversion (e.g. fmt=3 / 1p-conversion) are normal' });
      var keyCount = {};
      ch.forEach(function (h) { var k = h.endpoint + '|' + h.host + '|' + (h.oid || '') + '|' + (h.fmt || ''); keyCount[k] = (keyCount[k] || 0) + 1; });
      var dupKeys = Object.keys(keyCount).filter(function (k) { return keyCount[k] > 1; });
      col.add({ component: C1, event: ev, title: 'Is the same conversion fired more than once?', status: dupKeys.length ? 'fail' : 'pass', severity: 1, observed: dupKeys.length ? dupKeys.map(function (k) { return k.replace(/\|/g, ' ') + ' ×' + keyCount[k]; }).join(' / ') : 'No duplicate requests', expected: '1 request per conversion per endpoint', impact: 'Conversions counted twice; Smart Bidding optimises on wrong data', recommendation: 'Make sure the conversion tag has a single trigger; de-duplicate with transaction_id.' });
      perHit(col, C3, ev, base, 'Is value numeric and > 0?', function (h) { return { ok: isNum(h.value) && Number(h.value) > 0, val: str(h.value) }; }, { severity: 1, expected: 'value=1499.90', impact: 'Value-based bidding / ROAS does not work', rec: 'Send the dynamic order value as conversion value.' });
      perHit(col, C3, ev, base, 'Is currency_code ISO 4217?', function (h) { var ok = CURRENCY_RE.test(h.currency || '') && (!opt.currency || h.currency === opt.currency); return { ok: ok, val: str(h.currency) }; }, { severity: 1, expected: 'currency_code=' + (opt.currency || 'TRY'), impact: 'Value in the wrong currency', rec: 'Send the currency_code parameter.' });
      perHit(col, C3, ev, base, 'Is transaction_id (oid) sent?', function (h) { return { ok: !!h.oid, val: str(h.oid) }; }, { severity: 1, expected: 'oid=<order ID>', impact: 'Duplicate conversions cannot be filtered out', rec: 'Add transaction_id to the conversion tag.' });
      perHit(col, C3, ev, base, 'Are item-level (cart data) parameters sent?', function (h) { return { ok: h.item ? true : 'warn', val: h.item ? 'item=' + str(h.item, 100) + (h.mid ? ' · mid=' + h.mid : '') : MISSING }; }, { severity: 3, warnSeverity: 3, expected: 'items + aw_merchant_id (cart data)', impact: 'No product-level conversion/profit reporting', rec: 'If Merchant Center is linked, set up conversions with cart data.' });
      perHit(col, C2, ev, base, 'Is Enhanced Conversions data (em) sent, and is it hashed?', function (h) {
        if (!h.em) return { ok: 'warn', val: 'No em parameter' + (h.ecMode ? ' (ec_mode=' + h.ecMode + ')' : '') };
        var plain = String(h.em).split('~').some(function (x) { return EMAIL_RE.test(x); });
        return { ok: plain ? false : true, val: (plain ? 'PLAIN TEXT: ' : 'hashed: ') + str(h.em, 70) + (h.ecMode ? ' · ec_mode=' + h.ecMode : '') };
      }, { severity: 1, warnSeverity: 2, expected: 'em=tv.1~em.<SHA-256> (ec_mode=a/c/m)', impact: 'Without Enhanced Conversions, conversion matching drops as cookies are lost', rec: 'Enable Enhanced Conversions in Google Ads and send email/phone via user_provided_data.' });
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
      if (!j.length) return { ok: false, val: 'empty array []' };
      var nonStr = j.filter(function (x) { return typeof x !== 'string'; });
      return nonStr.length ? { ok: false, val: 'int/number array: ' + str(v, 80) } : { ok: true, val: 'string array (' + j.length + '): ' + str(v, 80) };
    }
    if (/,/.test(v)) return { ok: false, val: 'comma-separated string: ' + str(v, 80) };
    return { ok: 'warn', val: 'single string value: ' + str(v, 60) };
  }

  function auditMeta(ctx, opt) {
    var col = new Collector('meta');
    var hits = metaHits(ctx.main);
    var scripts = ctx.main.filter(function (r) { return /connect\.facebook\.net/.test(r.host) && /fbevents\.js|signals\/config/.test(r.path); });
    var ids = uniq(hits.map(function (h) { return h.id; }).concat(scripts.map(function (r) { var m = r.path.match(/config\/(\d+)/); return m && m[1]; })));
    var C1 = 'Pixel (browser)', C2 = 'Advanced Matching', C3 = 'CAPI', C4 = 'Event Deduplication', C5 = 'Events & parameter/format compliance';
    if (!hits.length && !scripts.length) {
      col.add({ component: C1, title: 'Is the Meta Pixel installed?', status: 'fail', severity: 2, observed: 'No facebook.com/tr request or fbevents.js found', expected: 'Meta Pixel + PageView', impact: 'Meta campaigns receive no optimisation signal', recommendation: 'Install the Meta Pixel and the Conversions API.' });
      return { col: col, detected: false, ids: [] };
    }
    var evs = uniq(hits.map(function (h) { return h.ev; }));
    col.add({ component: C1, title: 'Is the Meta Pixel installed and sending events?', status: hits.length ? 'pass' : 'warn', severity: 2, observed: 'Pixel ID: ' + (ids.join(', ') || '?') + ' · ' + hits.length + ' hits · events: ' + (evs.join(', ') || '—'), expected: 'Pixel ID + PageView and standard events', impact: 'Script loaded but no events sent', recommendation: 'Check the fbq init/track calls.' });
    var pv = hits.filter(function (h) { return h.ev === 'PageView'; });
    col.add({ component: C1, event: 'PageView', title: 'Does PageView fire?', status: pv.length ? 'pass' : 'fail', severity: 2, observed: pv.length + ' PageView', expected: '1 PageView per page', impact: 'Website visitor audiences are incomplete', recommendation: 'Fire PageView on all pages.' });
    if (ids.length > 1) col.add({ component: C1, title: 'Are there multiple pixels?', status: 'warn', severity: 3, observed: ids.join(', '), expected: 'A single pixel unless intentional', impact: 'The same event goes to several pixels; may be a leftover agency/old pixel', recommendation: 'Remove unused pixels.' });

    var std = hits.filter(function (h) { return h.ev !== 'Microdata' && h.ev !== 'SubscribedButtonClick'; });
    uniq(std.map(function (h) { return h.ev; })).forEach(function (ev) {
      var eh = std.filter(function (h) { return h.ev === ev; });
      var d = findDuplicates(eh, function (h) { return h.id + '|' + h.dl + '|' + (h.cd.content_ids || '') + '|' + (h.cd.value || ''); }, 2000);
      var sameEid = eh.filter(function (h, i) { return h.eid && eh.some(function (o, j) { return j < i && o.eid === h.eid && o.id === h.id; }); });
      col.add({ component: C5, event: ev, title: 'Does the event fire twice?', status: d.length ? 'fail' : 'pass', severity: ev === 'Purchase' ? 1 : 2, observed: d.length ? d.length + ' duplicate (same pixel + page + parameters, <2 s)' + (sameEid.length ? ' · repeated with the same eid' : ' · different/missing eid') : eh.length + ' hits, no double firing', expected: '1 hit per action', impact: 'Event count 2x; audiences and optimisation distorted', recommendation: 'Remove the second source sending the same event (e.g. theme plugin + GTM).' });
    });

    Object.keys(META_RULES).forEach(function (ev) {
      var eh = std.filter(function (h) { return h.ev === ev; });
      if (!eh.length) return;
      var rule = META_RULES[ev];
      rule.req.forEach(function (spec) {
        perHit(col, C5, ev, eh, 'Required parameter: ' + spec.replace('|', ' or '), function (h) { var p = metaParam(h, spec); return { ok: !!p, val: p ? p.name + '=' + str(p.v, 80) : MISSING }; },
          { severity: ev === 'Purchase' ? 1 : 2, expected: spec.split('|')[0] === 'content_ids' ? 'content_ids=["SKU123"] or contents=[{"id":"SKU123","quantity":1}]' : spec + ' must be sent', impact: /content/.test(spec) ? 'Catalog (Advantage+ catalog ads) matching does not work' : 'Value matching / ROAS not possible', rec: 'Add ' + spec.replace('|', ' / ') + ' to ' + ev + '.' });
      });
      rule.rec.forEach(function (spec) {
        perHit(col, C5, ev, eh, 'Recommended parameter: ' + spec.replace('|', ' or '), function (h) { var p = metaParam(h, spec); return { ok: p ? true : 'warn', val: p ? p.name + '=' + str(p.v, 60) : MISSING }; },
          { severity: 3, warnSeverity: 3, expected: spec + ' (recommended)', impact: 'Weaker optimisation signal', rec: 'Add ' + spec + '.' });
      });
      perHit(col, C5, ev, eh, 'content_ids format (string array)', function (h) { if (h.cd.content_ids === undefined) return { ok: null }; return contentIdsFormat(h.cd.content_ids); },
        { severity: 2, warnSeverity: 3, expected: '["164592","164593"]', impact: 'Catalog product matching fails', rec: 'Send content_ids as an array of strings.' });
      perHit(col, C5, ev, eh, 'contents format (id + quantity)', function (h) {
        if (h.cd.contents === undefined) return { ok: null };
        var j = parseJSON(h.cd.contents);
        if (!Array.isArray(j)) return { ok: false, val: 'not a JSON array: ' + str(h.cd.contents, 80) };
        var bad = j.filter(function (x) { return !x || x.id === undefined || x.quantity === undefined; });
        return { ok: !bad.length, val: (bad.length ? bad.length + ' elements missing id/quantity: ' : '') + str(h.cd.contents, 100) };
      }, { severity: 2, expected: '[{"id":"164592","quantity":1,"item_price":3995}]', impact: 'Product-level matching/value is missing', rec: 'Send contents with id, quantity and item_price.' });
      perHit(col, C5, ev, eh, 'Is value numeric?', function (h) { if (h.cd.value === undefined) return { ok: null }; return { ok: isNum(h.cd.value), val: str(h.cd.value) }; },
        { severity: ev === 'Purchase' ? 1 : 2, expected: 'value=3995.00', impact: 'ROAS cannot be calculated', rec: 'Send value as a number (without currency symbols).' });
      perHit(col, C5, ev, eh, 'Is currency ISO 4217?', function (h) { if (h.cd.currency === undefined) return { ok: null }; var ok = CURRENCY_RE.test(h.cd.currency) && (!opt.currency || h.cd.currency === opt.currency); return { ok: ok, val: str(h.cd.currency) }; },
        { severity: 1, expected: opt.currency || 'TRY', impact: 'Value in the wrong currency', rec: 'Send currency as an ISO code.' });
      perHit(col, C5, ev, eh, 'Is content_type valid?', function (h) { if (h.cd.content_type === undefined) return { ok: null }; return { ok: /^(product|product_group)$/.test(h.cd.content_type), val: str(h.cd.content_type) }; },
        { severity: 2, expected: 'product or product_group', impact: 'Catalog matching does not work', rec: 'Use content_type=product.' });
      if (eh.length > 1) {
        var fmts = uniq(eh.map(function (h) { var c = h.cd.content_ids; if (c === undefined) return 'none'; var j = parseJSON(c); return Array.isArray(j) ? (j.length && typeof j[0] === 'number' ? 'number array' : 'string array') : (/,/.test(c) ? 'comma-separated string' : 'string'); }));
        col.add({ component: C5, event: ev, title: 'Is the content_ids format consistent across hits?', status: fmts.length > 1 ? 'fail' : 'pass', severity: 2, observed: fmts.length > 1 ? eh.slice(0, 4).map(function (h, i) { return 'Hit #' + (i + 1) + ': ' + str(h.cd.content_ids, 60); }).join(' / ') : 'All hits: ' + fmts[0], expected: 'Same format on all hits (string array)', impact: 'Some hits do not match the catalog', recommendation: 'Send from a single source, in a single format.' });
      }
      perHit(col, C4, ev, eh, 'Is event_id (eid) sent?', function (h) { return { ok: h.eid ? true : false, val: h.eid ? 'eid=' + str(h.eid, 50) : 'no eid' }; },
        { severity: ev === 'Purchase' ? 1 : 2, expected: 'eid=<same event_id as CAPI>', impact: 'If Pixel + CAPI run together, deduplication fails → double counting', rec: 'Use fbq(\'track\', ev, data, {eventID}) and match the event_id sent via CAPI.' });
    });

    var eidEv = {};
    std.forEach(function (h) { if (h.eid) (eidEv[h.eid] = eidEv[h.eid] || []).push(h.ev); });
    var crossEid = Object.keys(eidEv).filter(function (k) { return uniq(eidEv[k]).length > 1; });
    if (Object.keys(eidEv).length) col.add({ component: C4, title: 'Are event_ids unique and consistent across events?', status: crossEid.length ? 'fail' : 'pass', severity: 1, observed: crossEid.length ? 'Same eid on different events: ' + crossEid.slice(0, 2).map(function (k) { return k + ' → ' + uniq(eidEv[k]).join(','); }).join(' / ') : Object.keys(eidEv).length + ' unique eids', expected: 'A unique eid per event instance', impact: 'Meta merges or drops the wrong events', recommendation: 'Generate eid per event (e.g. uuid + event name).' });

    var udKeys = uniq([].concat.apply([], hits.map(function (h) { return Object.keys(h.ud); })));
    var plain = [];
    hits.forEach(function (h) { Object.keys(h.ud).forEach(function (k) { if (h.ud[k] && !isHashed(h.ud[k]) && ['em', 'ph', 'fn', 'ln', 'ct', 'zp', 'ge', 'db', 'st', 'country'].indexOf(k) >= 0) plain.push(k + '=' + str(h.ud[k], 40)); }); });
    var amStatus = plain.length ? 'fail' : !udKeys.length ? 'warn' : (udKeys.indexOf('em') >= 0 && (udKeys.indexOf('ph') >= 0 || udKeys.length > 2)) ? 'pass' : 'warn';
    col.add({ component: C2, title: 'Is Advanced Matching active and is the data SHA-256 hashed?', status: amStatus, severity: plain.length ? 1 : 2, warnSeverity: 2,
      observed: plain.length ? 'PLAIN TEXT: ' + uniq(plain).slice(0, 3).join(', ') : udKeys.length ? 'ud[] fields: ' + udKeys.join(', ') + ' (hashed)' + (amStatus === 'warn' ? ' — partial' : '') : 'No ud[] parameters (may be before login/checkout)',
      expected: 'ud[em], ud[ph], ud[fn], ud[ln], ud[external_id] SHA-256', impact: plain.length ? 'GDPR/KVKK violation (plain-text PII)' : 'Low Event Match Quality → weak conversion matching', recommendation: plain.length ? 'Hash the values with SHA-256.' : 'Enable automatic/manual Advanced Matching; send phone, first/last name and external_id in addition to email.' });

    var capig = ctx.main.filter(function (r) { return /capig|conversions-api|\/capi\b/i.test(r.host + r.path); });
    col.add({ component: C3, title: 'Is the Conversions API (server-side) installed?', status: capig.length ? 'pass' : 'na', observed: capig.length ? 'CAPI Gateway / first-party request: ' + capig[0].host : 'Server-side requests are not visible from the browser' + (hits.some(function (h) { return h.eid; }) ? ' · eid is generated, so the setup is CAPI-ready' : ''), expected: '"Browser + Server" and dedup rate in Events Manager > Test Events', recommendation: 'Set up CAPI via sGTM or the CAPI Gateway and verify eid matching.' });
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
      (Array.isArray(b.batch) ? b.batch : [b]).forEach(function (x) {
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
    var C1 = 'Pixel (browser)', C2 = 'Advanced Matching', C3 = 'Events API', C4 = 'Event Deduplication', C5 = 'Events & parameter/format compliance';
    if (!hits.length && !scripts.length) {
      col.add({ component: C1, title: 'Is the TikTok Pixel installed?', status: 'na', observed: 'No TikTok pixel request found — not installed', expected: 'Pixel + Events API if TikTok campaigns run', recommendation: 'If you advertise on TikTok, install the pixel and the Events API.' });
      return { col: col, detected: false, ids: [] };
    }
    col.add({ component: C1, title: 'Is the TikTok Pixel installed and sending events?', status: hits.length ? 'pass' : 'warn', severity: 2, observed: 'Pixel: ' + (ids.join(', ') || '?') + ' · ' + hits.length + ' hits · ' + uniq(hits.map(function (h) { return h.event; })).join(', '), expected: 'Pixel code + Pageview and standard events', impact: 'Script loaded but no events', recommendation: 'Check the ttq.track calls.' });
    Object.keys(TT_RULES).forEach(function (ev) {
      var eh = hits.filter(function (h) { return h.event === ev; });
      if (!eh.length) return;
      var rule = TT_RULES[ev];
      var isPurchase = ev === 'CompletePayment' || ev === 'Purchase';
      rule.req.forEach(function (spec) {
        perHit(col, C5, ev, eh, 'Required parameter: ' + spec.replace('|', ' or '), function (h) { var p = ttParam(h, spec); return { ok: !!p, val: p ? p.name + '=' + str(p.v, 80) : MISSING }; },
          { severity: isPurchase ? 1 : 2, expected: spec === 'contents|content_id' ? 'contents=[{"content_id":"SKU123","quantity":1,"price":99.9}]' : spec, impact: 'Catalog (VSA) matching / value optimisation breaks', rec: 'Add ' + spec.replace('|', ' / ') + '.' });
      });
      rule.rec.forEach(function (spec) {
        perHit(col, C5, ev, eh, 'Recommended parameter: ' + spec.replace('|', ' or '), function (h) { var p = ttParam(h, spec); return { ok: p ? true : 'warn', val: p ? p.name + '=' + str(p.v, 60) : MISSING }; }, { severity: 3, warnSeverity: 3, expected: spec, impact: 'Weaker optimisation signal', rec: 'Add ' + spec + '.' });
      });
      perHit(col, C5, ev, eh, 'Is contents[].content_id a string?', function (h) {
        var c = h.props.contents; if (!Array.isArray(c) || !c.length) return { ok: null };
        var bad = c.filter(function (x) { return typeof x.content_id !== 'string'; });
        return { ok: !bad.length, val: str(c, 100) };
      }, { severity: 2, expected: '"content_id":"164592" (string)', impact: 'Catalog matching fails', rec: 'Send content_id as a string.' });
      perHit(col, C5, ev, eh, 'Is value numeric and currency ISO?', function (h) {
        if (h.props.value === undefined && h.props.currency === undefined) return { ok: null };
        var curOk = CURRENCY_RE.test(h.props.currency || '');
        var ok = isNum(h.props.value) && typeof h.props.value !== 'string' && curOk;
        var warn = isNum(h.props.value) && typeof h.props.value === 'string' && curOk;
        return { ok: ok ? true : (warn ? 'warn' : false), val: 'value=' + str(h.props.value) + ' (' + typeof h.props.value + ') · currency=' + str(h.props.currency) };
      }, { severity: 1, warnSeverity: 3, expected: 'value: number, currency: "' + (opt.currency || 'TRY') + '"', impact: 'ROAS/value optimisation not possible', rec: 'Send value as a number and currency as an ISO code.' });
      perHit(col, C4, ev, eh, 'Is event_id sent?', function (h) { return { ok: !!h.eid, val: h.eid ? str(h.eid, 50) : 'no event_id' }; }, { severity: isPurchase ? 1 : 2, expected: 'event_id (same as Events API)', impact: 'Pixel + Events API cannot be de-duplicated', rec: 'Use ttq.track(ev, data, {event_id}).' });
      var d = findDuplicates(eh, function (h) { return h.code + '|' + JSON.stringify(h.props.contents || h.props.content_id || ''); }, 2000);
      col.add({ component: C5, event: ev, title: 'Does the event fire twice?', status: d.length ? 'fail' : 'pass', severity: 2, observed: d.length ? d.length + ' duplicate hits' : eh.length + ' hits, no duplicates', expected: '1 hit per action', impact: 'Event count 2x', recommendation: 'Remove the duplicate source.' });
    });
    var userKeys = uniq([].concat.apply([], hits.map(function (h) { return Object.keys(h.user || {}).filter(function (k) { return h.user[k]; }); })));
    var plain = [];
    hits.forEach(function (h) { ['email', 'phone_number', 'phone', 'external_id'].forEach(function (k) { var v = h.user && h.user[k]; if (v && typeof v === 'string' && !isHashed(v)) plain.push(k); }); });
    col.add({ component: C2, title: 'Is Advanced Matching (email/phone/external_id) sent hashed?', status: plain.length ? 'fail' : userKeys.length ? 'pass' : 'warn', severity: plain.length ? 1 : 2, warnSeverity: 2, observed: plain.length ? 'PLAIN TEXT: ' + uniq(plain).join(', ') : userKeys.length ? 'context.user: ' + userKeys.join(', ') : 'No user data', expected: 'email, phone_number, external_id (SHA-256)', impact: plain.length ? 'GDPR/KVKK violation' : 'Low match rate', recommendation: 'Send hashed data via ttq.identify.' });
    col.add({ component: C3, title: 'Is the Events API (server-side) installed?', status: 'na', observed: 'Server-side; cannot be verified from the browser', expected: 'Server events in Events Manager > Diagnostics', recommendation: 'Set up the Events API via sGTM and verify event_id matching.' });
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
    var C1 = 'Insight Tag', C2 = 'Conversion events', C3 = 'CAPI / Dedup';
    if (!hits.length && !scripts.length) {
      col.add({ component: C1, title: 'Is the LinkedIn Insight Tag installed?', status: 'na', observed: 'No LinkedIn request found — not installed', expected: 'Insight Tag if B2B campaigns run', recommendation: 'If you advertise on LinkedIn, install the Insight Tag + CAPI.' });
      return { col: col, detected: false, ids: [] };
    }
    col.add({ component: C1, title: 'Is the Insight Tag installed and sending page views?', status: hits.length ? 'pass' : 'warn', severity: 2, observed: 'Partner ID: ' + (ids.join(', ') || '?') + ' · ' + hits.length + ' requests', expected: 'pid=XXXXXX', impact: 'Script loaded, no requests', recommendation: 'Check the _linkedin_partner_id definition.' });
    var conv = hits.filter(function (h) { return h.conv; });
    col.add({ component: C2, title: 'Does a conversion event (conversionId) fire?', status: conv.length ? 'pass' : 'na', observed: conv.length ? uniq(conv.map(function (h) { return h.conv; })).join(', ') : 'No conversion observed in this capture', expected: 'conversionId=XXXX' });
    if (conv.length) col.add({ component: C3, title: 'Do conversions carry an event_id (CAPI dedup)?', status: conv.every(function (h) { return h.eid; }) ? 'pass' : 'warn', severity: 2, warnSeverity: 2, observed: conv.map(function (h) { return h.eid || 'none'; }).join(', '), expected: 'lintrk(\'track\',{conversion_id, event_id})', impact: 'Double counting risk with CAPI', recommendation: 'Add event_id and match it with LinkedIn CAPI.' });
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
    var C1 = 'Pixel (base code)', C2 = 'Conversion events';
    if (!hits.length && !scripts.length) {
      col.add({ component: C1, title: 'Is the X Pixel installed?', status: 'na', observed: 'No X pixel request found — not installed', expected: 'uwt.js + events if X campaigns run', recommendation: 'If you advertise on X, install the pixel + CAPI.' });
      return { col: col, detected: false, ids: [] };
    }
    col.add({ component: C1, title: 'Is the X Pixel installed and sending requests?', status: hits.length ? 'pass' : 'warn', severity: 2, observed: 'Pixel: ' + (ids.join(', ') || '?') + ' · ' + hits.length + ' requests', expected: 'txn_id=<pixel id>', impact: 'Script loaded, no requests', recommendation: 'Check the twq(\'config\') call.' });
    var ce = hits.filter(function (h) { return h.eventId && /^tw-/.test(h.eventId); });
    col.add({ component: C2, title: 'Does a conversion event fire?', status: ce.length ? 'pass' : 'na', observed: ce.length ? uniq(ce.map(function (h) { return h.eventId; })).join(', ') : 'No conversion event observed in this capture', expected: 'twq(\'event\',\'tw-xxxx-yyyy\',{...})' });
    ce.forEach(function (h) {
      col.add({ component: C2, event: h.eventId, title: 'Are value / currency / conversion_id sent?', status: isNum(h.ev.value) && CURRENCY_RE.test(h.ev.currency || '') && h.ev.conversion_id ? 'pass' : 'warn', severity: 2, warnSeverity: 2, observed: str(h.ev, 150), expected: '{"value":1499.9,"currency":"' + (opt.currency || 'TRY') + '","conversion_id":"<order ID>"}', impact: 'Value optimisation and dedup not possible', recommendation: 'Add value, currency and conversion_id.' });
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
    var C1 = 'Event / schema compliance', C2 = 'User data (PII)', C3 = 'user_id', C4 = 'Consent signals';
    if (!dl.length) {
      col.add({ component: C1, title: 'Does a dataLayer exist?', status: ctx.meta.mode === 'har' ? 'na' : 'fail', severity: 2, observed: ctx.meta.mode === 'har' ? 'No dataLayer uploaded (optional in HAR mode)' : 'window.dataLayer empty / missing', expected: 'window.dataLayer array with GA4 e-commerce pushes', impact: 'Tags rely on DOM scraping; fragile measurement', recommendation: 'Add dataLayer pushes following the GA4 e-commerce schema.' });
      return { col: col, detected: false };
    }
    var objs = dl.filter(function (x) { return x && typeof x === 'object' && !argsToArray(x); });
    var evNames = uniq(objs.map(function (x) { return x.event; }));
    col.add({ component: C1, title: 'Does a dataLayer exist?', status: 'pass', observed: dl.length + ' pushes · events: ' + str(evNames.join(', '), 250), expected: 'window.dataLayer' });

    var ua = objs.filter(function (x) { return x.ecommerce && (x.ecommerce.detail || x.ecommerce.add || x.ecommerce.checkout || x.ecommerce.purchase || x.ecommerce.impressions); });
    col.add({ component: C1, title: 'Is the legacy UA (Enhanced Ecommerce) schema used?', status: ua.length ? 'fail' : 'pass', severity: 2, observed: ua.length ? ua.length + ' pushes in UA format (e.g. ' + Object.keys(ua[0].ecommerce).join(',') + ')' : 'No UA schema', expected: 'ecommerce.items[] (GA4)', impact: 'GA4 tags cannot read item data / conversion needed', recommendation: 'Migrate the dataLayer to the GA4 e-commerce schema.' });

    var ecomm = objs.filter(function (x) { return x.event && GA4_RULES[x.event]; });
    FUNNEL.forEach(function (ev) {
      var n = ecomm.filter(function (x) { return x.event === ev; }).length;
      col.add({ component: C1, event: ev, title: 'Is there a dataLayer push?', status: n ? 'pass' : 'na', observed: n ? n + ' pushes' : 'Not observed in this capture', expected: '{event:"' + ev + '", ecommerce:{…}}' });
    });
    Object.keys(GA4_RULES).forEach(function (ev) {
      var pushes = ecomm.filter(function (x) { return x.event === ev; });
      if (!pushes.length) return;
      var hl = pushes.map(function (x) { return { x: x, e: x.ecommerce || {} }; });
      perHit(col, C1, ev, hl, 'Are the ecommerce object and items array present?', function (h) {
        if (!h.x.ecommerce) return { ok: false, val: 'no ecommerce object' };
        if (GA4_RULES[ev].req.indexOf('items') >= 0 && !Array.isArray(h.e.items)) return { ok: false, val: 'items is not an array: ' + str(h.e.items, 60) };
        return { ok: true, val: 'ecommerce ✓ · ' + (Array.isArray(h.e.items) ? h.e.items.length + ' items' : '') };
      }, { severity: 1, expected: '{event, ecommerce:{currency, value, items:[…]}}', impact: 'Tags cannot read item data', rec: 'Restructure the push according to the GA4 schema.' });
      GA4_RULES[ev].req.forEach(function (pn) {
        if (pn === 'items') return;
        perHit(col, C1, ev, hl, 'Required field: ecommerce.' + pn, function (h) { var v = h.e[pn]; return { ok: v !== undefined && v !== '' && v !== null, val: str(v, 60) }; },
          { severity: pn === 'transaction_id' ? 1 : 2, expected: pn, impact: 'Platforms receive incomplete data', rec: 'Add ecommerce.' + pn + '.' });
      });
      perHit(col, C1, ev, hl, 'Type check: value is a number, currency is ISO', function (h) {
        if (h.e.value === undefined && h.e.currency === undefined) return { ok: null };
        var errs = [];
        if (h.e.value !== undefined && typeof h.e.value !== 'number') errs.push('value ' + typeof h.e.value + ' (' + str(h.e.value, 20) + ')');
        if (h.e.currency !== undefined && !CURRENCY_RE.test(h.e.currency)) errs.push('currency=' + str(h.e.currency));
        return { ok: errs.length ? (errs.every(function (x) { return /^value string/.test(x) && isNum(h.e.value); }) ? 'warn' : false) : true, val: errs.length ? errs.join(', ') : 'value=' + h.e.value + ' (number) · currency=' + h.e.currency };
      }, { severity: 2, warnSeverity: 3, expected: 'value: 1499.9 (number), currency: "' + (opt.currency || 'TRY') + '"', impact: 'String values are read as 0 / wrongly by some platforms', rec: 'Push value as a number.' });
      perHit(col, C1, ev, hl, 'items: item_id/item_name + price (number) + quantity', function (h) {
        if (!Array.isArray(h.e.items) || !h.e.items.length) return { ok: null };
        var bad = h.e.items.filter(function (i) { return !(i.item_id || i.item_name) || (i.price !== undefined && typeof i.price !== 'number'); });
        return { ok: !bad.length, val: bad.length ? bad.length + '/' + h.e.items.length + ' items invalid: ' + str(bad[0], 120) : 'e.g. ' + str(h.e.items[0], 140) };
      }, { severity: 2, expected: '{"item_id":"SKU","item_name":"…","price":199.9,"quantity":1}', impact: 'Item reports and catalog matching break', rec: 'Send item fields per the schema with the correct types.' });
    });
    if (ecomm.length) {
      var idxs = []; dl.forEach(function (x, i) { if (x && x.event && GA4_RULES[x.event]) idxs.push(i); });
      var cleared = idxs.filter(function (i) { var p = dl[i - 1]; return p && p.ecommerce === null; });
      col.add({ component: C1, title: 'Is ecommerce cleared (ecommerce: null) before every e-commerce push?', status: cleared.length === idxs.length ? 'pass' : 'warn', severity: 3, warnSeverity: 3, observed: cleared.length + '/' + idxs.length + ' pushes preceded by ecommerce:null', expected: 'dataLayer.push({ecommerce:null}) followed by the event push', impact: 'Items of the previous event may leak into the next one', recommendation: 'Clear the ecommerce object before every e-commerce push.' });
    }
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
    col.add({ component: C2, title: 'Is user data (email, phone, name) pushed in plain text?', status: pii.length ? 'fail' : 'pass', severity: 1, observed: pii.length ? uniq(pii).slice(0, 5).join(' · ') : 'No plain-text PII found', expected: 'None, or SHA-256 hashed (e.g. user_data.sha256_email_address)', impact: 'GDPR/KVKK violation; every third-party script reading the dataLayer can access PII', recommendation: 'Push PII hashed, or not at all.' });
    var uid = []; dl.forEach(function (x) { walk(x, '', function (p, v) { if (/(^|\.)(user_?id|userid|customer_?id|uid|member_?id)$/i.test(p) && v !== '' && v !== null && v !== undefined) uid.push(p + '=' + str(v, 30)); }); });
    col.add({ component: C3, title: 'Is user_id defined in the dataLayer?', status: uid.length ? 'pass' : 'warn', severity: 2, warnSeverity: 2, observed: uid.length ? uniq(uid).slice(0, 3).join(', ') : 'No user_id / customer_id variable (may be a guest session)', expected: '{user_id:"<hashed ID>"} after login', impact: 'Cross-device stitching not possible', recommendation: 'Add user_id to the dataLayer and map it to the GA4 / Ads / Meta (external_id) tags.' });
    var cons = []; dl.forEach(function (x, i) { var a = argsToArray(x) || (Array.isArray(x) ? x : null); if (a && a[0] === 'consent') cons.push({ i: i, type: a[1], st: a[2] || {} }); });
    var def = cons.filter(function (c) { return c.type === 'default'; });
    var upd = cons.filter(function (c) { return c.type === 'update'; });
    var gtmJs = -1; dl.forEach(function (x, i) { if (gtmJs < 0 && x && x.event === 'gtm.js') gtmJs = i; });
    col.add({ component: C4, title: 'Is there a Consent Mode default command, and does it run before GTM?', status: !def.length ? 'fail' : (gtmJs >= 0 && def[0].i > gtmJs ? 'warn' : 'pass'), severity: 2, warnSeverity: 2, observed: def.length ? 'consent default @#' + def[0].i + ': ' + str(def[0].st, 160) + (gtmJs >= 0 ? ' · gtm.js @#' + gtmJs : '') : 'No consent default found', expected: 'gtag(\'consent\',\'default\',{ad_storage:\'denied\',analytics_storage:\'denied\',ad_user_data:\'denied\',ad_personalization:\'denied\'}) before gtm.js', impact: 'Tags may write cookies by default before consent', recommendation: 'Call the CMP\'s Consent Mode default before the GTM container.' });
    if (def.length) {
      var missing = SIGNALS.filter(function (k) { return !(k in def[0].st); });
      col.add({ component: C4, title: 'Does the default command contain all 4 Consent Mode v2 signals?', status: missing.length ? 'fail' : 'pass', severity: 2, observed: missing.length ? 'Missing: ' + missing.join(', ') : 'All 4 signals present', expected: SIGNALS.join(', '), impact: 'Without v2, EEA audiences/measurement are restricted', recommendation: 'Add the missing signals.' });
    }
    col.add({ component: C4, title: 'Does a consent update command fire?', status: upd.length ? 'pass' : 'na', observed: upd.length ? upd.length + ' updates · last: ' + str(upd[upd.length - 1].st, 160) : 'No consent update observed in this capture (banner may not have been used)', expected: 'consent update after the user\'s choice' });
    if (ctx.ga4Hits && ctx.ga4Hits.length) {
      var gaEvents = ctx.ga4Hits.map(function (h) { return h.en; });
      uniq(ecomm.map(function (x) { return x.event; })).forEach(function (ev) {
        var sent = gaEvents.indexOf(ev) >= 0;
        col.add({ component: C1, event: ev, title: 'Is the dataLayer event forwarded to GA4?', status: sent ? 'pass' : 'fail', severity: ev === 'purchase' ? 1 : 2, observed: sent ? 'dataLayer ✓ → GA4 hit ✓' : 'In dataLayer, but no GA4 hit', expected: 'dataLayer push → GA4 event tag', impact: 'Funnel step missing in GA4', recommendation: 'Add a GA4 event tag + trigger for this event in GTM.' });
      });
    }
    return { col: col, detected: true };
  }

  // ---------------------------------------------------------------------------
  // Infrastructure
  // ---------------------------------------------------------------------------
  function auditInfra(ctx, found) {
    var col = new Collector('infra');
    var site = ctx.siteHost; var siteReg = regDomain(site);
    var gtm = ctx.main.filter(function (r) { return /\/gtm\.js$/.test(r.path) && /GTM-/.test(r.u.searchParams.get('id') || ''); });
    var gtmIds = uniq(gtm.map(function (r) { return r.u.searchParams.get('id'); }));
    var gtagFP = ctx.main.filter(function (r) { return (/\/gtm\.js$|\/gtag\/js$/.test(r.path) || /[?&]id=(GTM|G|AW)-/.test(r.u.search)) && !isGoogleHost(r.host) && r.host; });
    var collectFP = (ctx.ga4Hits || []).filter(function (h) { return !isGoogleHost(h.host); });
    var C0 = 'Google Tag Manager', C1 = 'Google Tag Gateway', C2 = 'sGTM (server-side GTM)', C3 = 'Server-side APIs (CAPI)', C4 = 'Event ID consistency';
    col.add({ component: C0, title: 'Is a GTM container installed?', status: gtmIds.length ? (gtmIds.length > 1 ? 'warn' : 'pass') : 'warn', severity: 3, warnSeverity: 3, observed: gtmIds.length ? gtmIds.join(', ') + ' (' + uniq(gtm.map(function (r) { return r.host; })).join(', ') + ')' : 'GTM not observed (may be gtag.js or hard-coded)', expected: 'A single GTM web container', impact: gtmIds.length > 1 ? 'Multiple containers → double firing and management overhead' : 'Tag management is not centralised', recommendation: gtmIds.length > 1 ? 'Merge the containers or separate their responsibilities.' : 'Consolidate tags under GTM.' });
    var sameHost = gtagFP.concat(collectFP.map(function (h) { return { host: h.host }; })).filter(function (r) { return r.host.replace(/^www\./, '') === site.replace(/^www\./, ''); });
    col.add({ component: C1, title: 'Is Google Tag Gateway (first-party path) used?', status: sameHost.length ? 'pass' : 'warn', severity: 3, warnSeverity: 3, observed: sameHost.length ? 'Google tag/collect served from the site domain: ' + uniq(sameHost.map(function (r) { return r.host; })).join(', ') : 'Tags load from googletagmanager.com / google-analytics.com', expected: 'example.com/<path>/gtag/js… (via CDN / load balancer)', impact: 'Data loss from ad blockers / ITP', recommendation: 'Enable Google Tag Gateway via Cloudflare or a GCP load balancer.' });
    var sgtmHosts = uniq(collectFP.map(function (h) { return h.host; }).concat(gtagFP.map(function (r) { return r.host; })).filter(function (h) { return h !== site; }));
    col.add({ component: C2, title: 'Is sGTM (a server container) used?', status: collectFP.length ? 'pass' : 'warn', severity: 2, warnSeverity: 2, observed: collectFP.length ? 'GA4 hits go to a first-party server: ' + uniq(collectFP.map(function (h) { return h.host; })).join(', ') : (sgtmHosts.length ? 'Custom loader: ' + sgtmHosts.join(', ') + ' (collect still goes to Google)' : 'GA4 hits go directly to Google — no sGTM'), expected: 'ss.' + (siteReg || 'example.com') + '/g/collect via transport_url', impact: 'No CAPI/Events API, data enrichment or first-party cookie benefits', recommendation: 'Set up sGTM (Cloud Run / Stape) and move the GA4 transport_url and CAPIs server-side.' });
    var eidPlats = [];
    if (found.metaEid) eidPlats.push('Meta eid');
    if (found.ttEid) eidPlats.push('TikTok event_id');
    col.add({ component: C3, title: 'Meta CAPI / TikTok Events API / LinkedIn & X CAPI', status: 'na', observed: 'Server-side requests are not visible from the browser' + (eidPlats.length ? ' · Dedup IDs generated by: ' + eidPlats.join(', ') : ''), expected: 'Browser + Server events in each platform\'s Events Manager / test tools', recommendation: 'Verify server events and dedup rates in the platform test tools (Meta Test Events, TikTok Diagnostics).' });
    if (found.metaEids && found.metaEids.length) {
      var reused = found.metaEids.filter(function (e, i) { return found.metaEids.indexOf(e) !== i; });
      col.add({ component: C4, title: 'Are the event IDs sent unique?', status: reused.length ? 'warn' : 'pass', severity: 2, warnSeverity: 2, observed: reused.length ? 'Repeated event IDs: ' + uniq(reused).slice(0, 3).join(', ') : found.metaEids.length + ' event IDs, all unique', expected: 'A unique ID per event; identical in pixel and CAPI', impact: 'Inconsistent IDs → dedup fails, double counting', recommendation: 'Generate the event ID in the dataLayer push and send the same value to all platforms.' });
    }
    return { col: col, gtmIds: gtmIds };
  }

  // ---------------------------------------------------------------------------
  // CMP / Consent
  // ---------------------------------------------------------------------------
  function marketingReqs(reqs) { return reqs.filter(function (r) { return MARKETING_HOST_RE.test(r.host + r.path); }); }
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
    var C1 = 'CMP presence', C2 = 'Pre-consent behaviour', C3 = 'Reject behaviour', C4 = 'Consent Mode signals';
    var blob = ctx.all.map(function (r) { return r.url; }).join(' ') + ' ' + (ctx.html || '').slice(0, 300000);
    var vendor = ctx.cmp.vendor || null;
    if (!vendor) CMP_VENDORS.some(function (v) { if (v[0].test(blob)) { vendor = v[1]; return true; } return false; });
    var detected = !!(vendor || ctx.cmp.bannerFound);
    col.add({ component: C1, title: 'Does the site have a CMP (cookie consent management)?', status: detected ? 'pass' : 'fail', severity: 1, observed: detected ? (vendor ? 'CMP: ' + vendor : 'Custom cookie banner') + (ctx.cmp.bannerText ? ' · "' + str(ctx.cmp.bannerText, 80) + '"' : '') : 'No known CMP or cookie banner detected', expected: 'A GDPR/KVKK compliant CMP (OneTrust, Cookiebot, Usercentrics…)', impact: 'GDPR/KVKK risk; cookies/tags without consent', recommendation: 'Install a Google-certified CMP and integrate it with Consent Mode v2.' });

    var pre = ctx.phaseReq('pre_consent');
    if (ctx.phases.pre_consent) {
      var preHits = marketingReqs(pre).filter(function (r) {
        if (/\.js(\?|$)/.test(r.path)) return false; // library loads are not data hits
        var g = r.u.searchParams.get('gcs');
        return !(/google|doubleclick/.test(r.host) && g === 'G100'); // Consent Mode advanced cookieless ping
      });
      col.add({ component: C2, title: 'Do marketing tags fire before consent is given?', status: preHits.length ? 'fail' : 'pass', severity: 1, observed: preHits.length ? 'Without any banner interaction: ' + summarizeReqs(preHits) : 'No marketing hits before consent', expected: 'Before consent only essential requests + (with Consent Mode advanced) cookieless Google pings', impact: 'GDPR/KVKK violation (processing without explicit consent)', recommendation: 'Block marketing tags with CMP consent / consent triggers.' });
      var preCk = cookieHits(ctx.phases.pre_consent.cookies);
      if (ctx.phases.pre_consent.cookies) col.add({ component: C2, title: 'Are analytics/marketing cookies written before consent?', status: preCk.length ? 'fail' : 'pass', severity: 1, observed: preCk.length ? preCk.join(', ') : 'No measurement cookies', expected: 'Essential cookies only', impact: 'GDPR/KVKK violation', recommendation: 'Block cookies with consent default=denied and tag blocking.' });
      var preGa = ga4Hits(pre);
      if (preGa.length) {
        var granted = preGa.filter(function (h) { return h.gcs && h.gcs !== 'G100' && h.gcs.charAt(3) === '1'; });
        col.add({ component: C4, title: 'Are pre-consent GA4 hits denied (gcs=G100)?', status: granted.length ? 'fail' : 'pass', severity: 1, observed: 'gcs=' + uniq(preGa.map(function (h) { return h.gcs || 'none'; })).join(','), expected: 'gcs=G100 (cookieless ping) or no hits at all', impact: 'Analytics cookies used before consent', recommendation: 'Set the consent default to denied.' });
      }
    } else {
      col.add({ component: C2, title: 'Pre-consent behaviour', status: 'na', observed: ctx.meta.mode === 'har' ? 'The moment of consent cannot be isolated in a HAR — use the live scan' : 'Could not be checked', expected: 'No marketing hits before consent' });
    }

    var rej = ctx.phases.after_reject || ctx.phases.har_reject;
    if (rej) {
      var rejReq = ctx.all.filter(function (r) { return r.phase === 'after_reject' || r.phase === 'har_reject'; });
      var rejClicked = ctx.cmp.rejectClicked !== false;
      col.add({ component: C3, title: 'Was a "Reject" button found and clicked?', status: rejClicked ? 'pass' : 'na', observed: rejClicked ? (ctx.cmp.rejectSelector ? 'Clicked: ' + ctx.cmp.rejectSelector : 'User uploaded a post-reject HAR') : 'Reject button could not be found automatically', expected: 'A "Reject all" button on the first layer' });
      if (rejClicked) {
        var rM = marketingReqs(rejReq).filter(function (r) { return !/\.js(\?|$)/.test(r.path); });
        var rGa = ga4Hits(rejReq);
        var rGaGranted = rGa.filter(function (h) { return !h.gcs || h.gcs.charAt(3) === '1'; });
        var googleCookieless = rM.filter(function (r) { var g = r.u.searchParams.get('gcs'); return /google|doubleclick/.test(r.host) && g === 'G100'; });
        var realM = rM.filter(function (r) { return googleCookieless.indexOf(r) < 0; });
        col.add({ component: C3, title: 'Are marketing tags blocked after "Reject"?', status: realM.length ? 'fail' : 'pass', severity: 1, observed: realM.length ? 'Requests fired after reject: ' + summarizeReqs(realM) + ' · e.g. ' + str(realM[0].url, 140) : 'No marketing hits after reject' + (googleCookieless.length ? ' (only ' + googleCookieless.length + ' cookieless Google pings, gcs=G100)' : ''), expected: 'No marketing requests at all (with Consent Mode advanced only gcs=G100 cookieless pings)', impact: 'GDPR/KVKK violation — data processed although the user refused', recommendation: 'Add consent checks (additional consent checks / blocking triggers) to every marketing tag.' });
        col.add({ component: C3, title: 'Are GA4 hits denied after "Reject"?', status: rGaGranted.length ? 'fail' : 'pass', severity: 1, observed: rGa.length ? rGa.length + ' GA4 hits · gcs=' + uniq(rGa.map(function (h) { return h.gcs || 'none'; })).join(',') : 'No GA4 hits', expected: 'gcs=G100 or no hits', impact: 'Refused analytics cookies are used', recommendation: 'Make sure the consent update sends analytics_storage=denied on reject.' });
        if (rej.cookies) {
          var ck = cookieHits(rej.cookies);
          col.add({ component: C3, title: 'Are there analytics/marketing cookies after "Reject"?', status: ck.length ? 'fail' : 'pass', severity: 1, observed: ck.length ? ck.join(', ') : 'No measurement cookies', expected: 'Essential cookies only', impact: 'GDPR/KVKK violation', recommendation: 'Block tags that write cookies after reject; delete cookies written earlier.' });
        }
        var rGcd = rGa.map(function (h) { return decodeGcd(h.gcd); }).filter(Boolean);
        if (rGcd.length) {
          var g = rGcd[rGcd.length - 1];
          var bad = SIGNALS.filter(function (k) { return g[k] === 'granted'; });
          col.add({ component: C4, title: 'Are Consent Mode signals denied after "Reject"?', status: bad.length ? 'fail' : 'pass', severity: 1, observed: 'gcd=' + g.raw + ' → ' + SIGNALS.map(function (k) { return k + '=' + g[k]; }).join(', '), expected: 'All 4 signals denied', impact: 'Refused permissions are passed to Google as granted', recommendation: 'Fix the CMP → Consent Mode update mapping.' });
        }
      }
    } else {
      col.add({ component: C3, title: 'Behaviour after "Reject"', status: 'na', observed: ctx.meta.mode === 'har' ? 'No "after reject" HAR uploaded' : 'Reject test could not be run', expected: 'No marketing tags/cookies after reject' });
    }
    if (ctx.cmp.acceptClicked) {
      var acc = ga4Hits(ctx.phaseReq('accepted'));
      if (acc.length) col.add({ component: C4, title: 'Are signals updated to granted after "Accept"?', status: acc.some(function (h) { return h.gcs === 'G111'; }) ? 'pass' : 'warn', severity: 2, warnSeverity: 2, observed: 'gcs=' + uniq(acc.map(function (h) { return h.gcs || 'none'; })).join(','), expected: 'gcs=G111', impact: 'Data of consenting users is under-measured', recommendation: 'Make sure the accept button sends a consent update (granted).' });
    }
    return { col: col, vendor: vendor, detected: detected };
  }

  // ---------------------------------------------------------------------------
  // Inventory
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
  // Component status table
  // ---------------------------------------------------------------------------
  var ABSENT_RE = /not found|not installed|not detected|not observed|^no |— no /i;
  function componentTable(checks) {
    var comps = [];
    checks.forEach(function (c) { if (comps.indexOf(c.component) < 0) comps.push(c.component); });
    return comps.map(function (comp) {
      var cs = checks.filter(function (c) { return c.component === comp; });
      var fails = cs.filter(function (c) { return c.status === 'fail'; });
      var warns = cs.filter(function (c) { return c.status === 'warn'; });
      var pass = cs.filter(function (c) { return c.status === 'pass'; });
      var notInstalled = cs.length === 1 && cs[0].status === 'fail' && /installed\?$|exist\?$/.test(cs[0].title) && ABSENT_RE.test(cs[0].observed);
      var status = notInstalled ? 'Missing'
        : fails.length ? 'Faulty'
        : warns.length ? (pass.length ? 'Partial' : (ABSENT_RE.test(warns[0].observed) ? 'Missing' : 'Partial'))
        : pass.length ? 'Present'
        : (cs.some(function (c) { return /not installed/.test(c.observed); }) ? 'Missing' : 'Unverified');
      var evidence = (pass.length ? pass : cs).slice(0, 2).map(function (c) { return c.observed; }).join(' · ');
      var problems = fails.concat(warns).sort(function (a, b) { return (a.severity || 9) - (b.severity || 9); });
      return {
        component: comp, status: status, detection: str(evidence, 260),
        risk: problems.length ? problems.slice(0, 3).map(function (c) { return (c.event !== ALL ? c.event + ': ' : '') + c.title.replace(/\?$/, '') + ' → ' + str(c.observed, 90); }).join(' | ') : '—',
        recommendation: problems.length ? uniq(problems.map(function (c) { return c.recommendation; })).slice(0, 2).join(' ') : '—',
        counts: { pass: pass.length, fail: fails.length, warn: warns.length, na: cs.length - pass.length - fails.length - warns.length }
      };
    });
  }

  // Error table grouped by event (skill format)
  function errorTable(checks) {
    var bad = checks.filter(function (c) { return c.status === 'fail' || c.status === 'warn'; });
    var groups = {};
    bad.forEach(function (c) { (groups[c.event] = groups[c.event] || []).push(c); });
    var names = Object.keys(groups).sort(function (a, b) {
      if (a === ALL) return 1; if (b === ALL) return -1;
      var sa = Math.min.apply(null, groups[a].map(function (c) { return c.severity || 9; }));
      var sb = Math.min.apply(null, groups[b].map(function (c) { return c.severity || 9; }));
      return sa - sb;
    });
    return names.map(function (n) {
      return { event: n, rows: groups[n].sort(function (a, b) { return (a.severity || 9) - (b.severity || 9); }).map(function (c) {
        return { description: c.title.replace(/\?$/, '') + (c.status === 'warn' ? ' (partial)' : ''), severity: c.severity, wrong: c.observed || MISSING, expected: c.expected, impact: c.impact, recommendation: c.recommendation, status: c.status, component: c.component };
      }) };
    });
  }

  // ---------------------------------------------------------------------------
  // Domain-specific recommendations (outputs 3, 4, 5)
  // ---------------------------------------------------------------------------
  function recommendations(meta) {
    var d = regDomain(hostOf(meta.url || '')) || 'example.com';
    var slug = d.split('.')[0];
    var cur = meta.currency || 'TRY';
    var sector = meta.sector || 'ecommerce';
    var funnel, scenarios;
    if (sector === 'leadgen') {
      funnel = [
        ['1. Interest', 'Online', 'view_item', 'Service/project page viewed', 'item_id, item_name, item_category, currency, value', 'item_id: ' + slug + '-service-1 · value: 0 | currency: ' + cur],
        ['2. Engagement', 'Online', 'form_start', 'First form field focused', 'form_id, form_name, item_id', 'form_id: quote-form'],
        ['3. Lead', 'Online', 'generate_lead', 'Form submit (successful response)', 'lead_id, value, currency, item_id, gclid, fbclid, user_data (hashed)', 'lead_id: lead_2026_a4f2 · value: 100 | currency: ' + cur],
        ['4. Qualified', 'Offline', 'qualify_lead', 'CRM: "qualified" status', 'lead_id, value, client_id, gclid', 'value: 1,000 | currency: ' + cur],
        ['5. Meeting / proposal', 'Offline', 'begin_checkout', 'CRM: "proposal sent"', 'lead_id, value, items', 'value: 10,000 | currency: ' + cur],
        ['6. Sale', 'Offline', 'purchase', 'CRM: "won" / contract signed', 'transaction_id, value, items, gclid, email_sha256', 'transaction_id: deal_4471 · value: 85,000 | currency: ' + cur]
      ];
      scenarios = [
        ['Qualified lead values', 'Assign values from the CRM score (A:1000, B:300, C:50) and feed them back offline to Google Ads/Meta', 'Smart Bidding optimises for leads that turn into sales, not low-quality leads'],
        ['Micro-conversions', 'Phone click, WhatsApp, brochure download and price-calculator events', 'Shorter learning phase on low-volume accounts'],
        ['Appointment / Calendly integration', 'schedule_meeting event + CRM appointment status', 'Qualified meeting signal for the sales team'],
        ['Remarketing segments', 'Started but did not finish the form (form_start − generate_lead), viewed 2+ service pages', 'Recovery at a lower CPL'],
        ['Enhanced Conversions for Leads', 'Hash the form email and upload CRM sales back via gclid/email', 'Offline sales attributed to ads']
      ];
    } else if (sector === 'subscription') {
      funnel = [
        ['1. Discovery', 'Online', 'view_item', 'Plan / pricing page', 'item_id (plan), price, currency', 'item_id: plan-pro · value: 299 | currency: ' + cur],
        ['2. Sign-up', 'Online', 'sign_up', 'Account created', 'method, user_id', 'method: email'],
        ['3. Trial', 'Online', 'start_trial', 'Trial started', 'value (pLTV), currency, plan', 'value: 900 | currency: ' + cur],
        ['4. Subscription', 'Online', 'purchase', 'First payment', 'transaction_id, value, items, user_id', 'transaction_id: sub_9921 · value: 299'],
        ['5. Renewal', 'Offline', 'renewal (custom)', 'Billing: renewal', 'transaction_id, value, user_id', 'value: 299 | currency: ' + cur],
        ['6. Churn', 'Offline', 'churn (custom)', 'Billing: cancellation', 'user_id, reason', 'reason: price']
      ];
      scenarios = [
        ['pLTV value optimisation', 'Send predicted LTV as value at trial start', 'Bidding towards long-lived subscribers'],
        ['Trial → paid offline feedback', 'Send the trial conversion via Measurement Protocol / CAPI', 'Optimisation on real revenue'],
        ['Churn-risk audience', 'Exclude declining-usage users from remarketing / run win-back campaigns', 'Budget efficiency']
      ];
    } else {
      funnel = [
        ['1. List', 'Online', 'view_item_list', 'Category / search results page', 'item_list_id, item_list_name, items[]', 'item_list_name: category-' + slug],
        ['2. Product', 'Online', 'view_item', 'Product detail page', 'currency, value, items[item_id, item_name, price, item_brand, item_category]', 'item_id: SKU-164592 · value: 3995 | currency: ' + cur],
        ['3. Cart', 'Online', 'add_to_cart', 'Add-to-cart success response', 'currency, value, items[quantity]', 'value: 3995 | currency: ' + cur],
        ['4. Checkout', 'Online', 'begin_checkout', 'Checkout step entered', 'currency, value, coupon, items', 'value: 3995 | currency: ' + cur],
        ['5. Shipping', 'Online', 'add_shipping_info', 'Shipping option selected', 'shipping_tier, value, items', 'shipping_tier: standard'],
        ['6. Payment', 'Online', 'add_payment_info', 'Payment method selected', 'payment_type, value, items', 'payment_type: credit_card'],
        ['7. Purchase', 'Online', 'purchase', 'Order confirmation page (once)', 'transaction_id, value, tax, shipping, currency, items, user_data (hashed)', 'transaction_id: ' + slug.toUpperCase() + '-100245 · value: 4,120 | currency: ' + cur],
        ['8. Refund / cancel', 'Offline', 'refund', 'ERP/OMS: refund approved', 'transaction_id, value, items', 'transaction_id: ' + slug.toUpperCase() + '-100245 · value: 3995'],
        ['9. Repeat purchase', 'Offline', 'purchase (repeat)', 'CRM: 2nd order', 'transaction_id, value, customer_type: returning', 'customer_type: returning']
      ];
      scenarios = [
        ['Profit-based (POAS) bidding', 'Send gross profit instead of revenue as purchase value (cost enrichment in sGTM)', 'Prevents overspending on low-margin products'],
        ['New vs. returning customers', 'new_customer parameter + Google Ads New Customer Acquisition goal', 'Extra value for acquiring new customers'],
        ['Refund correction', 'refund event + GA4 and Ads conversion adjustments', 'True revenue and ROAS'],
        ['Cart abandonment audiences', 'add_to_cart − purchase (7 days) dynamic remarketing (Meta catalog + Google DR)', 'Recover abandoned carts'],
        ['Micro-conversions', 'add_to_wishlist, back-in-stock alert, size chart, product comparison events', 'Product interest signal and richer audiences'],
        ['Offline / store sales', 'Upload store POS sales as offline conversions with hashed email/phone', 'Omnichannel ROAS']
      ];
    }
    var pantheon = [
      ['Phoebe (predictive value)', sector === 'leadgen' ? 'At generate_lead, the ML model\'s qualification probability × average contract value (e.g. 0.18 × 85,000 = 15,300 ' + cur + ') is sent as value to Ads/Meta.' : 'On the first purchase, the customer\'s 12-month pLTV prediction (e.g. basket 4,120 → pLTV 11,800 ' + cur + ') is sent to Google Ads as conversion value.', 'Smart Bidding optimises for real long-term value.'],
      ['Artemis (offline + online activation)', sector === 'leadgen' ? 'CRM "qualified" → Google Ads offline conversion + GA4 qualify_lead; CRM "won" → Ads purchase + Floodlight sales tag (via gclid/email_sha256).' : 'OMS "delivered" and "returned" statuses → sGTM → GA4 refund/purchase correction + Google Ads conversion adjustment + Floodlight.', 'CRM/OMS data becomes a real-time ad signal.'],
      ['Zeus (tag monitoring)', 'For critical events (' + (sector === 'leadgen' ? 'generate_lead, qualify_lead' : 'purchase, add_to_cart') + ') every tag response in sGTM is logged to Cloud Logging/BigQuery; alert via Slack/email if the Meta CAPI 4xx rate exceeds 2% or purchase volume drops 50% within an hour.', 'Broken tags are caught before they turn into lost revenue.']
    ];
    var flows = [
      'CRM/OMS → (webhook) → sGTM → GA4 Measurement Protocol (client_id/user_id + transaction_id)',
      'CRM/OMS → sGTM → Meta Conversions API (action_source: system_generated / physical_store, event_id, hashed user_data)',
      'CRM → Google Ads offline conversion import / Data Manager (gclid or hashed email/phone)'
    ];
    var dlExample = sector === 'leadgen'
      ? "dataLayer.push({ ecommerce: null });\ndataLayer.push({\n  event: 'generate_lead',\n  event_id: 'lead_2026_a4f2',\n  lead_id: 'lead_2026_a4f2',\n  user_id: 'u_8f3a2c',\n  user_data: { sha256_email_address: '<sha256>', sha256_phone_number: '<sha256>' },\n  ecommerce: { currency: '" + cur + "', value: 100, items: [{ item_id: '" + slug + "-service-1', item_name: 'Service 1' }] }\n});"
      : "dataLayer.push({ ecommerce: null });\ndataLayer.push({\n  event: 'purchase',\n  event_id: 'purchase_" + slug + "_100245',\n  user_id: 'u_8f3a2c',\n  user_data: { sha256_email_address: '<sha256>', sha256_phone_number: '<sha256>' },\n  ecommerce: {\n    transaction_id: '" + slug.toUpperCase() + "-100245',\n    currency: '" + cur + "', value: 4120, tax: 686.67, shipping: 125,\n    items: [{ item_id: 'SKU-164592', item_name: 'Product', item_brand: 'Brand', item_category: 'Category', price: 3995, quantity: 1 }]\n  }\n});";
    return { funnel: funnel, scenarios: scenarios, pantheon: pantheon, flows: flows, dlExample: dlExample, sector: sector };
  }

  // ---------------------------------------------------------------------------
  // Main
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

  // Check catalogue (methodology section)
  var CATALOG = [
    { area: 'DataLayer', items: ['dataLayer presence and list of pushed events', 'GA4 e-commerce schema (event name, ecommerce object, items[])', 'Required fields: currency, value, transaction_id', 'Type checks: value/price numeric, currency ISO 4217', 'Leftover legacy UA Enhanced Ecommerce schema', 'ecommerce:null clearing', 'Plain-text PII (email, phone, name, address)', 'Presence of user_id / customer_id', 'Consent Mode default (before GTM) + 4 v2 signals + update', 'Does each dataLayer event become a GA4 hit?'] },
    { area: 'GA4', items: ['Measurement ID and /g/collect hits', 'page_view presence and double firing', 'All 7 funnel events (view_item_list → purchase)', 'Required + recommended parameters per event (official schema)', 'currency format / expected currency', 'value numeric + consistent with Σ(price×qty)', 'items: item_id/item_name, price, quantity', 'Hit-level double firing and format consistency across hits', 'purchase transaction_id uniqueness', 'user_id (uid) and PII content', 'Consent Mode gcs/gcd + v2 signals'] },
    { area: 'Google Ads', items: ['AW- conversion ID and request types (conversion, 1p-conversion, fmt)', 'Remarketing hit', 'Conversion Linker (_gcl_au)', 'Duplicate conversion firing', 'value, currency_code, transaction_id (oid)', 'Cart data (item-level) parameters', 'Enhanced Conversions (em, ec_mode) and hashing'] },
    { area: 'Meta', items: ['Pixel ID, PageView, multiple pixels', 'Standard events and required/recommended parameters', 'content_ids string array, contents (id+quantity), content_type', 'value numeric, currency ISO', 'Hit-level double firing + format consistency across hits', 'event_id (eid) presence and uniqueness (CAPI dedup)', 'Advanced Matching fields and SHA-256 hashing', 'CAPI / Gateway traces'] },
    { area: 'TikTok', items: ['Pixel code and events', 'contents[].content_id (string), content_type', 'value number + currency ISO', 'event_id (Events API dedup)', 'Advanced Matching (email/phone/external_id) hashing', 'Double firing'] },
    { area: 'LinkedIn & X', items: ['Insight Tag partner ID / X pixel ID', 'Conversion events', 'event_id / conversion_id (CAPI dedup)', 'value + currency (X)'] },
    { area: 'Infrastructure', items: ['Number and source of GTM containers', 'Google Tag Gateway (first-party path)', 'sGTM (first-party collect endpoint)', 'Server-side APIs (CAPI / Events API) — flagged as not verifiable from the browser', 'Event ID uniqueness'] },
    { area: 'CMP / Consent', items: ['CMP vendor / banner detection', 'Marketing requests and cookies before consent', 'Requests fired after "Reject" (listed one by one)', 'Cookies after "Reject"', 'gcs/gcd signals after "Reject"', 'granted update after "Accept"'] }
  ];

  return { run: run, fromHAR: fromHAR, VERSION: VERSION, CATALOG: CATALOG, PLATFORMS: PLATFORMS, MAPPING: MAPPING, _internal: { ga4Hits: ga4Hits, decodeGcd: decodeGcd, metaHits: metaHits } };
});
