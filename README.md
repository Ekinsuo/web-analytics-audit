# Web Analytics Audit

**Site:** https://ekinsuo.github.io/web-analytics-audit/

Bir sitenin tracking kurulumunu (GA4, Google Ads, Meta, TikTok, LinkedIn, X, DataLayer, sGTM / Google Tag Gateway, CMP + Consent Mode v2) aynı standartta denetleyen açık kaynak araç. E-ticaret / lead-gen tracking QA kontrol listesini otomatik uygular.

## Rapor içeriği
Her platform için:
- **Bileşen durumu** — `Bileşen | Durum (Mevcut/Kısmen/Hatalı/Yok) | Tespit | Risk / Eksiklik | Öneri`
- **Hata tablosu** — event bazlı gruplanmış: `Event Name | Hata Açıklaması | Önem (1-3) | Hatalı Gelen Değer | Olması Gereken Değer | Etkisi`
- **Doğru çalışan kontroller** — geçen her kontrol ve gözlenen (doğru) değer
- **Yapılan tüm kontroller** — Doğru / Hatalı / Kısmen / Kontrol edilemedi filtresiyle

Ayrıca platform envanteri, event eşleştirme tablosu, domaine özel DataLayer + online/offline funnel önerisi, geliştirme senaryoları ve sGTM Pantheon (Phoebe / Artemis / Zeus) önerileri. Tamamı stillenmiş **Excel** olarak indirilebilir.

## Kullanım modları
1. **Canlı tarama** — sitede URL girilir → önceden doldurulmuş GitHub issue açılır → `audit.yml` workflow'u Playwright ile siteyi 3 senaryoda gezer (onay öncesi · "Kabul et" + ürün/sepete ekle · "Reddet") → rapor `reports` dalına yazılır, issue'ya link yorumlanır.
2. **HAR ile derin denetim** — DevTools'tan kaydedilen HAR (+ opsiyonel "Reddet sonrası" HAR ve dataLayer JSON) tamamen tarayıcıda analiz edilir; purchase dahil tam funnel.
3. **Rapor aç** — `?id=<issue no>` ile.

## Yapı
```
site/                 GitHub Pages (statik)
  assets/engine.js    Denetim motoru (tarayıcı + Node, UMD)
  assets/excel.js     ExcelJS ile stillenmiş rapor
  assets/app.js       Arayüz
scanner/
  scan.mjs            Playwright tarayıcı (capture.json üretir)
  report.mjs          capture → xlsx + issue özeti
  test/fixture.mjs    Kasıtlı hatalı sentetik mağaza (npm test)
.github/workflows/    pages.yml (yayın), audit.yml (tarama)
```

## Sınırlar
- Sunucu tarafı (Meta CAPI, TikTok Events API vb.) tarayıcıdan görülemez → "Kontrol edilemedi" olarak raporlanır.
- Otomatik tarama checkout/purchase adımına giremez; bunun için HAR modu kullanılır.
- Bulgular otomatik analizdir; GTM Preview / Tag Assistant / Events Manager ile doğrulayın.

## Yerel test
```bash
cd scanner && npm install && npm test
```
