# Catalogue source

The shopper prices from `lib/public-specials-catalogue.js`. That module reads `data/catalogue/current.json` when a refresh has committed one, and otherwise uses the embedded snapshot dated 2026-08-25 to 2026-08-31.

`scripts/refresh-catalogue.js` is the weekly writer. It does not call Woolworths, Coles, or Aldi trolley, cart, checkout, or product APIs. It does not claim FitMunch pays for a shop or fills a retailer trolley.

Checked 3 October 2026 from the agent environment, for the NSW metro week of 30 September to 6 October 2026. No source below is permitted for an automated commercial catalogue, so the script exits before requesting prices and does not write a file. No NSW catalogue HTML was downloaded.

## Rejected for 30 September to 6 October 2026

- Woolworths: `robots.txt` returned HTTP 403, so the weekly catalogue page was not opened.
- Coles: website terms forbid copying, reproducing, or distributing any part of the site. Not used.
- Aldi: the legal notice forbids scripts and web crawlers, and forbids reproducing site data. `catalogues.aldi.com.au/api/` stays disallowed. Not used.
- weeklyshop.au: `robots.txt` allows `/prices` and disallows `/api/`, but the terms limit accounts to personal household planning. Not used, and `/prices/eggs` was not opened.
- 1001catalogues.com: terms limit use to personal, non-commercial purposes and forbid harvesting and commercial databases. Not used.
- mailerdesk.com: terms allow personal, non-commercial use only and forbid bots, data mining, and compiling a database. Not used.
- kimbino.com.au: terms allow browsing only and protect the databases on the platform. `robots.txt` also disallows the leaflet deals API and offers paths. Not used.
- currentspecials.com.au: terms say the services are strictly for personal use. Not used.
- catalogue-au.com: terms describe a consumer brochure viewer and do not grant a licence to copy offers into another product. Not used.
- au-catalogues.com: `/terms`, `/privacy`, `/legal`, and `/disclaimer` are HTTP 404, and the footer disclaimer is empty. No licence to copy. Not used.
- yapik.com: the Australia page says the site is for information only, `/terms` publishes no copy licence, and `robots.txt` disallows PDF catalogues. Not used.
- SaleFinder: no `robots.txt`, and the terms forbid harvesting and a commercial database. Not used.
- Shopfully: terms forbid robots and spiders, and forbid copying the site into a derived product. Not used.

## What was checked

| Source | robots.txt | Terms | Decision |
| --- | --- | --- | --- |
| Woolworths public site | `https://www.woolworths.com.au/robots.txt` returned HTTP 403 | Not read, because robots.txt itself was blocked | Do not fetch. No product, trolley, cart, or checkout call. |
| Coles public catalogue page | `https://www.coles.com.au/robots.txt` allows `/catalogues`. It disallows checkout, search, account, and several specials filter URLs. | Website terms (page last updated 13 December 2024) allow personal use only and say you must not copy, reproduce, or distribute any part of the site or its content. | Not permitted. The catalogues HTML does not contain the weekly prices. No product API was called. |
| Aldi site and catalogue viewer | `https://www.aldi.com.au/robots.txt` allows the site except results, brands, and tools. `https://catalogues.aldi.com.au/robots.txt` allows `/` and disallows `/api/`, `/studio/`, `/design-system/`, and `/docs/`. | Website terms (legal notice, last updated 18 May 2026) forbid access by scripts or web crawlers. Internet search engines are the stated exception. They also forbid reproducing or exploiting site data. | Not permitted. `/api/` stays disallowed even for a later reader. |
| SaleFinder | `https://www.salefinder.com.au/robots.txt` returned HTTP 404, so there is no robots file. | Terms at `/cms/termsofuse` limit the licence to internal, personal, non-commercial use. They forbid harvesting, and they forbid using the site to build a database that is distributed commercially. | Not permitted. |
| Shopfully (Lasoo-style listings) | `https://www.shopfully.com.au/robots.txt` allows most paths and disallows account, subscription, and redirect paths. | Australian terms forbid robots, spiders, and similar processes aimed at the site, and forbid copying the site to make a derived product. | Not permitted. |

A public catalogue page that a person can open is not the same as permission to copy it into FitMunch on a schedule.

## What the script does when a source is allowed later

1. Map offer titles onto the existing ingredient SKUs.
2. Where a line is not on special, keep the last known non-special shelf price and set `estimate: true`.
3. Write `data/catalogue/<validFrom>.json`, `data/catalogue/current.json` (a pointer at that file), and `data/catalogue/SUMMARY.md`.
4. Reject the file unless every ingredient is priced at two or more stores, every price is above 0, no price is more than 3 times the previous week unless that quote has `priceMoveFlag: true`, `validFrom`, `validTo`, and `updatedAt` are set, and every item has `source.name`, `source.url`, `date.validFrom`, and `date.validTo`. Each store quote keeps the same fields. The reels video footer reads them.

The GitHub workflow `.github/workflows/catalogue-refresh.yml` runs at 21:00 UTC Tuesday (07:00 AEST Wednesday, 08:00 during AEDT) and on `workflow_dispatch`. A valid file opens or updates a pull request titled `Catalogue <validFrom> to <validTo>` with the diff summary. It does not merge. A failed source opens or comments on an issue titled `Catalogue refresh failed`.

## Freshness gate

`scripts/check-catalogue-freshness.js` fails when `validTo` is more than 8 days before today in Australia/Sydney.

It runs at the end of `npm test`, in the required `test` job (`.github/workflows/web-quality.yml`), and as `npm run build` / `npm run vercel-build`, which is the Vercel build step.

The embedded catalogue ends 2026-08-31. On 2 October 2026 that is more than 8 days ago, so the gate fails until a real catalogue is committed. That failure is the gate working. Do not paper over it with made-up prices.

### Escape hatch

`CATALOGUE_STALE_OK=1` skips the process exit for an emergency hotfix deploy. The shopper, Coach share page, and PDF still show the catalogue dates either way. Do not set it on the weekly refresh, and do not set it to make a stale catalogue look current.

Every use of that hatch leaves a trail:

1. The script prints one line: `CATALOGUE_STALE_OVERRIDE used: validTo=<date>, age=<n>d, commit=<sha>`.
2. In GitHub Actions, where `GITHUB_TOKEN` is set, the same line opens a GitHub issue labelled `catalogue-stale-override`, or comments on the open issue with that label. The `test` job has `issues: write`. If filing the issue fails, the job fails.
3. Vercel builds have no `GITHUB_TOKEN`. `GET /api/health/catalogue` returns `{ validFrom, validTo, ageDays, staleOverride }`. `staleOverride` is true while `CATALOGUE_STALE_OK=1` is set on the running app. A monitor can poll that path.
