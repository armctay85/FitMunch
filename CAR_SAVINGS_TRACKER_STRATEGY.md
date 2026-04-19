# Car Savings Tracker Strategy (Carsales AU, personal buyer focus)

## 1. EXECUTIVE SUMMARY

You should **stop trying to “beat” bot protection** and instead design around it. The winning approach is a **user-assisted capture system**: a browser extension that runs in the buyer’s own logged-in browser session, captures listing metadata while the user browses naturally, and syncs only the structured fields needed for tracking and scoring. This dramatically lowers account-risk versus centralized scraping, removes proxy/captcha arms-race costs, and still gives you near-daily market intelligence.

For your 30–90 day buying window, the highest ROI is not full automation; it is **decision quality + alert discipline**. Build a lightweight web dashboard with historical price deltas, confidence-scored “fair value” bands, and a weighted decision matrix you can tune weekly. You’ll make better buy/hold/walk decisions even with partial data, provided your ingestion is consistent and your normalization is solid.

If you later productize, monetize the **workflow and intelligence layer**, not scraped raw inventory. The durable moat is: (a) buyer-specific scoring + negotiation guidance, (b) rare-spec detection workflows (like tan-interior G63), and (c) human-in-the-loop trust.

## 2. TECHNICAL STRATEGY

### 2.1 Data Collection Strategy (evaluate options)

1. **Server-side scraping (current failed path)**
   - Pros: central control, one pipeline.
   - Cons: blocked by DataDome/PerimeterX, legal/ToS risk at scale, high ops overhead.
   - Verdict: **Reject** for this project.

2. **Local headless browser automation**
   - Pros: runs on user device/session.
   - Cons: still bot-signature prone; brittle maintenance; poor UX for non-technical users.
   - Verdict: **Weak fallback only**.

3. **Mobile app scraping**
   - Pros: potentially richer user context.
   - Cons: reverse engineering risk, fragile, app updates break pipelines.
   - Verdict: **Reject**.

4. **API/data partnerships**
   - Pros: legally safer, stable long-term.
   - Cons: slow to secure, can be costly, limited coverage early.
   - Verdict: **Pursue in parallel**, not Day 1 dependency.

5. **Manual entry + automation assist (recommended winner)**
   - Pros: compliant posture, reliable now, no credential storage, fast to deploy.
   - Cons: not zero-effort; requires user behavior.
   - Verdict: **Primary approach for Phase 1/2**.

### 2.2 Recommended Architecture

**Fastest time-to-value stack**
- **Frontend:** Next.js (App Router) + Tailwind (mobile-friendly dashboard).
- **Extension:** Manifest V3 Chrome extension (and Edge-compatible) for one-click capture from listing pages.
- **Backend API:** Python FastAPI (you already have Python logic; reuse scoring/depreciation code).
- **Jobs:** APScheduler/Celery-lite cron for daily re-checks and alerts.
- **Database:** PostgreSQL (start with Supabase/Neon managed).
- **Queue/Events (optional):** lightweight Redis only when alert volume grows.

**Why not SQLite now?**
SQLite is fine for personal-only local mode, but you’ll quickly want multi-device sync, audit history, and tenant isolation if monetizing. PostgreSQL gives you cleaner growth without an early migration tax.

### 2.3 Data Model (minimum viable)
- `users` (minimal profile, auth metadata)
- `vehicles` (canonical model/gen/trim normalization)
- `listings` (source URL, seller type, asking price, km, year, color fields, text blob)
- `listing_snapshots` (timestamped price/status changes)
- `saved_targets` (user intent + must-have attributes)
- `scores` (criterion-level + total weighted score, versioned)
- `alerts` (type, trigger, delivery status)
- `notes` (inspection log, dealer interactions)

### 2.4 Batch vs real-time
- **Batch daily** is enough for this use case (price changes within 24h target).
- Use event-triggered recalculation only when new capture arrives.
- Real-time websockets are unnecessary until you exceed ~1k active users.

### 2.5 Tan Interior Detection (rare spec detection)
Use a **three-layer confidence pipeline**:
1. **Rule/NLP extraction** from title + description (tan, beige, saddle, cognac, macchiato, designo brown, etc., with typo dictionary).
2. **Image-assisted classification** on interior photos (small vision model/API) returning probability for tan/brown interior.
3. **Human verification queue** for medium-confidence cases (fast checkbox workflow).

Final label = `confirmed / likely / unknown` with confidence score. This prevents false certainty and lets you prioritize inspections.

### 2.6 Price Intelligence without RedBook API
Build a blended “Fair Value Band” from:
- Active listing comps (normalized by year/km/trim/options)
- Historical asking-price trajectory of same VIN/listing URL
- Auction/sold proxies where legally available (public results, dealer disclosures)
- Manual expert overrides (e.g., rare interior premium)

Use a transparent model first (hedonic linear/GBM with explainable feature impacts) before fancy ML. For this buyer, trust > complexity.

## 3. THE BOT PROTECTION PROBLEM

**Real solution:** Stop automating access to protected pages from server infrastructure.

Design principle:
- User browses normally in first-party context.
- Extension captures DOM fields user can already see.
- Optional explicit user click (“Save to Tracker”) to keep consent/audit trail.
- No password storage; no session token exfiltration.

This reframes the system from “scraper” to “personal research assistant.” It is more resilient, lower risk, and better aligned with your security must-haves.

## 4. MONETIZATION RECOMMENDATION ★

### Pick one model: **F. Freemium + Premium Intelligence**

Why this wins over pure SaaS scraping:
- You can offer a compliant free layer (manual/extension-assisted tracking).
- Premium can be legally cleaner value-add: valuation confidence, depreciation scenarios, negotiation script generator, rare-spec alerts, ownership-cost forecasting.
- You avoid promising guaranteed ingestion from protected sites (the legal and support nightmare).

### Risk assessment
- **Legal risk:** Medium if positioned as user-assisted capture; high if marketed as automated scraping.
- **Technical risk:** Medium (extension stability, parsing drift).
- **Market risk:** Medium-high (niche audience), but premium willingness is stronger in high-value purchases.

### Revenue potential (practical estimate)
- 6 months realistic: 40 paid users x AUD $19/month ≈ **AUD $760 MRR**.
- Stretch with better onboarding + buyer communities: 75 users x AUD $19 ≈ **AUD $1,425 MRR**.
- Hitting $1k MRR is plausible only with disciplined niche positioning (enthusiast/spec hunters), not broad “all car buyers.”

### Implementation complexity
- Moderate.
- You need: auth, tenant-safe data model, billing (Stripe), alert infrastructure, and clear compliance messaging.
- Still lower complexity than running anti-bot infra.

### Recommended pivot if growth stalls
Pivot to **concierge-assisted buying intelligence** (tool + human review package) at higher ARPU instead of low-ticket mass SaaS.

## 5. 48-HOUR BUILD PLAN

### Day 1
1. Stand up Postgres schema + migration scripts.
2. Port existing Python scoring engine into FastAPI service endpoints.
3. Build CSV import + URL paste parser endpoint.
4. Build minimal dashboard: tracked cars table, price history sparkline, scorecard comparison view.

### Day 2
1. Ship Chrome extension MVP:
   - Detect listing page
   - Extract core fields
   - One-click save to tracker API
2. Add alert rules:
   - Price drop threshold
   - New listing match for saved criteria
   - Rare-spec probable match (tan interior likely/confirmed)
3. Deliver notifications to Discord + email.
4. Add weekly “winner drift” report (which candidate is improving/worsening vs value band).

## 6. OPEN QUESTIONS

1. Are you willing to use a Chrome extension as the primary workflow, or do you want strict no-extension operation?
2. For legal posture, should we intentionally support only “user-initiated capture” and avoid passive background crawling?
3. Do you want model outputs to be conservative (fewer alerts, higher confidence) or aggressive (more leads, more noise)?
4. How much manual review can you tolerate weekly (e.g., 10–20 uncertain rare-spec listings)?
5. Do you want monetization in 2026, or should we optimize only for your own purchase decision first?
6. Should negotiation support (offer-price recommendation + script) be included as a core feature from Phase 1?

## Direct answers to your five explicit questions

1. **Bot protection blocker — real solution:** user-assisted first-party capture via extension + manual workflows, not proxy escalation.
2. **First 48 hours:** data model, API, dashboard, extension capture MVP, and alerts.
3. **Competitive advantage:** buyer decision intelligence + rare-spec workflow + trustable human-in-loop outputs.
4. **Is monetization realistic?** Yes, but only as a narrow premium intelligence product; broad scraping SaaS is not realistic/safe.
5. **Fastest stack today:** Next.js + FastAPI + PostgreSQL + Chrome extension + scheduled alerts.
