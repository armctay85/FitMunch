# Catalogue source

The shopper prices from `lib/public-specials-catalogue.js`. That module reads `data/catalogue/current.json` when a refresh has committed one, and otherwise uses the embedded snapshot dated 2026-08-25 to 2026-08-31.

`scripts/refresh-catalogue.js` is the weekly writer. It does not call Woolworths, Coles, or Aldi trolley, cart, checkout, or product APIs. It does not claim FitMunch pays for a shop or fills a retailer trolley.

Checked 2 October 2026 from the agent environment. No source below is permitted for an automated commercial catalogue, so the script exits before requesting prices and does not write a file.

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
4. Reject the file unless every ingredient is priced at two or more stores, every price is above 0, no price is more than 3 times the previous week unless that quote has `priceMoveFlag: true`, and `validFrom`, `validTo`, and `updatedAt` are set.

The GitHub workflow `.github/workflows/catalogue-refresh.yml` runs at 21:00 UTC Tuesday (07:00 AEST Wednesday, 08:00 during AEDT) and on `workflow_dispatch`. A valid file opens or updates a pull request titled `Catalogue <validFrom> to <validTo>` with the diff summary. It does not merge. A failed source opens or comments on an issue titled `Catalogue refresh failed`.

## Freshness gate

`scripts/check-catalogue-freshness.js` fails when `validTo` is more than 8 days before today in Australia/Sydney.

It runs in the required `test` job (`.github/workflows/web-quality.yml`) and as `npm run build` / `npm run vercel-build`, which is the Vercel build step.

The embedded catalogue ends 2026-08-31. On 2 October 2026 that is more than 8 days ago, so the gate fails until a real catalogue is committed. That failure is the gate working. Do not paper over it with made-up prices.

### Escape hatch

`CATALOGUE_STALE_OK=1` skips the process exit for an emergency hotfix deploy. The shopper, Coach share page, and PDF still show the catalogue dates either way. Do not set it on the weekly refresh, and do not set it to make a stale catalogue look current.
