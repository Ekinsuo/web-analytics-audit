# Web Analytics Audit

**Site:** https://ekinsuo.github.io/web-analytics-audit/

An open-source tool that audits a site's tracking setup — GA4, Google Ads, Meta, TikTok, LinkedIn, X, DataLayer, sGTM / Google Tag Gateway, CMP + Consent Mode v2 — against the same standard. It automates an e-commerce / lead-gen tracking QA checklist.

## Report contents
For every platform:
- **Component status** — `Component | Status (Present/Partial/Faulty/Missing) | Detection | Risk / Gap | Recommendation`
- **Error table** — grouped by event: `Event Name | Error Description | Severity (1-3) | Observed (Wrong) Value | Expected Value | Impact`
- **Checks that passed** — every passing check with the observed (correct) value
- **All checks performed** — filterable by Pass / Fail / Partial / Not verifiable

Plus a platform inventory, event mapping table, a domain-specific DataLayer + online/offline funnel plan, growth scenarios and sGTM Pantheon (Phoebe / Artemis / Zeus) recommendations. Everything can be downloaded as a styled **Excel** workbook.

## Modes
1. **Live scan** — enter a URL on the site → a pre-filled GitHub issue opens → the `audit.yml` workflow visits the site with Playwright in 3 scenarios (before consent · "Accept" + product / add to cart · "Reject") → the report is written to the `reports` branch and the link is posted on the issue.
2. **Deep audit with HAR** — a HAR recorded in DevTools (+ optional post-"Reject" HAR and dataLayer JSON) is analysed entirely in the browser; covers the full funnel including purchase.
3. **Open a report** — via `?id=<issue number>`.

## Structure
```
site/                 GitHub Pages (static)
  assets/engine.js    Audit engine (browser + Node, UMD)
  assets/excel.js     Styled report via ExcelJS
  assets/app.js       UI
scanner/
  scan.mjs            Playwright scanner (produces capture.json)
  report.mjs          capture → xlsx + issue summary
  test/fixture.mjs    Synthetic store with deliberate errors (npm test)
.github/workflows/    pages.yml (deploy), audit.yml (scan)
```

## Limits
- Server-side setups (Meta CAPI, TikTok Events API, …) are not visible from the browser → reported as "Not verifiable".
- The automated scan cannot complete checkout/purchase; use HAR mode for that.
- Findings are automated analysis; verify with GTM Preview / Tag Assistant / Events Manager.

## Local test
```bash
cd scanner && npm install && npm test
```
