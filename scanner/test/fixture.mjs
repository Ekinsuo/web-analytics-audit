// Fake store for tests/demo (demo-store.test). Contains deliberate errors:
//  - Meta Pixel fires before consent and after "Reject" (GDPR)
//  - plain-text email in the dataLayer
//  - Meta ViewContent content_ids as number array, AddToCart fires twice, no eid
//  - GA4 add_to_cart value as string / currency missing; no user_id
//  - TikTok AddToCart content_id is a number
// Every request is answered by this module instead of the network.
const SITE = 'demo-store.test';

const TAGS = `
<script>
(function(){
  var cid='1234567890.1700000000';
  function consent(){ return (document.cookie.match(/demo_consent=(\\w+)/)||[])[1]||'none'; }
  function gcs(){ var c=consent(); return c==='all'?'G111':'G100'; }
  function gcd(){ var c=consent(); return c==='all'?'13r3r3r3r5':c==='denied'?'13q3q3q3q5':'13p3p3p3p5'; }
  function send(u,body){ try{ fetch(u,{method: body?'POST':'GET', body: body||undefined, mode:'no-cors', keepalive:true}); }catch(e){} }
  function enc(o){ return Object.keys(o).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(o[k]);}).join('&'); }
  window.ga4=function(en,p,items){
    var q={v:2,tid:'G-DEMO12345',cid:cid,en:en,dl:location.href,gcs:gcs(),gcd:gcd()};
    Object.keys(p||{}).forEach(function(k){ if(k==='currency') q.cu=p[k]; else if(typeof p[k]==='number') q['epn.'+k]=p[k]; else q['ep.'+k]=p[k]; });
    (items||[]).forEach(function(it,i){ q['pr'+(i+1)]='id'+it.item_id+'~nm'+it.item_name+(it.price!==undefined?'~pr'+it.price:'')+(it.quantity?'~qt'+it.quantity:''); });
    send('https://region1.google-analytics.com/g/collect?'+enc(q));
  };
  window.fbq=function(ev,cd,eid){
    var q={id:'987654321012345',ev:ev,dl:location.href,rl:'',if:'false',ts:Date.now()};
    Object.keys(cd||{}).forEach(function(k){ q['cd['+k+']']=typeof cd[k]==='object'?JSON.stringify(cd[k]):cd[k]; });
    if(eid) q.eid=eid;
    q['ud[em]']='4a6f1f8b2c0c3b1e9a4a1d8e5b4c3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b';
    send('https://www.facebook.com/tr/?'+enc(q));
  };
  window.ttq=function(ev,props){
    send('https://analytics.tiktok.com/api/v2/pixel',JSON.stringify({event:ev,event_id:'',context:{pixel:{code:'CDEMO0TIKTOK'},page:{url:location.href},user:{}},properties:props||{}}));
  };
  var s=document.createElement('script'); s.src='https://www.googletagmanager.com/gtm.js?id=GTM-DEMO01'; document.head.appendChild(s);
  var f=document.createElement('script'); f.src='https://connect.facebook.net/en_US/fbevents.js'; document.head.appendChild(f);
  // BUG: Meta PageView fires without waiting for consent
  fbq('PageView');
  document.cookie='_fbp=fb.1.1700000000.123;path=/';
  window.afterConsent=function(){
    if(consent()==='all'){ document.cookie='_ga=GA1.1.'+cid+';path=/'; document.cookie='_gcl_au=1.1.111.222;path=/'; ttq('Pageview'); }
    ga4('page_view',{});
    if(window.pageType==='product'){
      dataLayer.push({ecommerce:null});
      dataLayer.push({event:'view_item',ecommerce:{currency:'TRY',value:3995,items:[{item_id:'164592',item_name:'Wool Sweater',price:3995,quantity:1}]}});
      ga4('view_item',{currency:'TRY',value:3995},[{item_id:'164592',item_name:'Wool Sweater',price:3995,quantity:1}]);
      fbq('ViewContent',{content_ids:[164592],content_type:'product',value:'3995',currency:'TRY'});
      if(consent()==='all') ttq('ViewContent',{contents:[{content_id:'164592',quantity:1,price:3995}],content_type:'product',value:3995,currency:'TRY'});
      if(consent()==='all') send('https://googleads.g.doubleclick.net/pagead/viewthroughconversion/701234567/?random=1&cv=11&fst=1&value=0&gcs='+gcs()+'&gcd='+gcd()+'&data=event%3Dview_item');
    }
  };
  if(consent()!=='none') afterConsent();
  window.addToCart=function(){
    dataLayer.push({event:'add_to_cart',ecommerce:{currency:'TRY',value:'3995',items:[{item_id:'164592',item_name:'Wool Sweater',price:'3995',quantity:1}]}});
    ga4('add_to_cart',{value:'3995'},[{item_id:'164592',item_name:'Wool Sweater',price:3995}]);
    fbq('AddToCart',{content_ids:'164592,164593',content_type:'product',value:3995,currency:'TRY'});
    fbq('AddToCart',{content_ids:'164592,164593',content_type:'product',value:3995,currency:'TRY'});
    ttq('AddToCart',{contents:[{content_id:164592,quantity:1}],value:'3995',currency:'TRY'});
  };
})();
</script>`;

function page(title, body, pageType) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<script>
window.dataLayer=window.dataLayer||[]; function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{ad_storage:'denied',analytics_storage:'denied',wait_for_update:500});
dataLayer.push({event:'gtm.js','gtm.start':Date.now()});
dataLayer.push({event:'user_info',user:{email:'jane.doe@example.com',segment:'vip'}});
window.pageType='${pageType}';
</script>${TAGS}</head><body style="font-family:sans-serif">
<header><a href="/">Demo Store</a> · <a href="/cart">Cart</a></header>
${body}
<div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;background:#222;color:#fff;padding:16px">
 This site uses cookies. Privacy notice.
 <button id="acc" onclick="document.cookie='demo_consent=all;path=/';dataLayer.push({0:'consent',1:'update',2:{ad_storage:'granted',analytics_storage:'granted',ad_user_data:'granted',ad_personalization:'granted'},__args:true});afterConsent();this.parentNode.remove()">Accept all</button>
 <button id="rej" onclick="document.cookie='demo_consent=denied;path=/';this.parentNode.remove()">Reject all</button>
</div>
<script>if((document.cookie.match(/demo_consent=(\\w+)/)||[])[1]) document.getElementById('cookie-banner').remove();</script>
</body></html>`;
}

const HOME = page('Demo Store', `<h1>New season</h1><ul><li><a href="/product/wool-sweater-164592">Wool Sweater</a></li><li><a href="/product/linen-shirt-164593">Linen Shirt</a></li><li><a href="/product/denim-jeans-164594">Denim Jeans</a></li></ul>`, 'home');
const PRODUCT = page('Wool Sweater', `<h1>Wool Sweater</h1><p>3,995 TRY</p><button class="add-to-cart" onclick="addToCart()">Add to cart</button>`, 'product');

export default async function handler(route) {
  const url = new URL(route.request().url());
  if (url.hostname === SITE) {
    const o = 'https://' + SITE;
    if (url.pathname === '/robots.txt') return route.fulfill({ status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /cart\nSitemap: ' + o + '/sitemap_index.xml\n' });
    if (url.pathname === '/sitemap_index.xml') return route.fulfill({ status: 200, contentType: 'application/xml', body: '<?xml version="1.0"?><sitemapindex><sitemap><loc>' + o + '/sitemap-blog.xml</loc></sitemap><sitemap><loc>' + o + '/sitemap-products-1.xml</loc></sitemap></sitemapindex>' });
    if (url.pathname === '/sitemap-products-1.xml') return route.fulfill({ status: 200, contentType: 'application/xml', body: '<?xml version="1.0"?><urlset>' + ['wool-sweater-164592', 'linen-shirt-164593', 'denim-jeans-164594', 'oversize-tee-164595'].map((x) => '<url><loc>' + o + '/product/' + x + '</loc></url>').join('') + '</urlset>' });
    if (url.pathname === '/cart') return route.fulfill({ status: 200, contentType: 'text/html', body: page('Cart', '<h1>Your cart</h1><button onclick="dataLayer.push({event:\'begin_checkout\',ecommerce:{currency:\'TRY\',value:3995,items:[{item_id:\'164592\',item_name:\'Wool Sweater\',price:3995,quantity:1}]}});ga4(\'begin_checkout\',{currency:\'TRY\',value:3995},[{item_id:\'164592\',item_name:\'Wool Sweater\',price:3995,quantity:1}]);fbq(\'InitiateCheckout\',{value:3995,currency:\'TRY\',num_items:1});location.href=\'/login?return=checkout\'">Proceed to checkout</button>', 'cart') });
    if (url.pathname === '/login') return route.fulfill({ status: 200, contentType: 'text/html', body: page('Login', '<h1>Sign in</h1>', 'login') });
    const body = url.pathname.startsWith('/product/') ? PRODUCT : HOME;
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  }
  if (/\.js(\?|$)/.test(url.pathname) || url.pathname.endsWith('/gtm.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mock */' });
  return route.fulfill({ status: 204, body: '' });
}
