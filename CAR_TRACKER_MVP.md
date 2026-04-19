# Car Savings Tracker MVP (Implemented)

## What is now live

- **Secure capture flow with 30-day authorization token**:
  - `POST /api/car-tracker/auth/token` to issue capture token (max 30 days)
  - `GET /api/car-tracker/auth/status` for expiry status
  - `POST /api/car-tracker/capture` for extension ingestion (requires bearer token)
- **Core tracking APIs**:
  - listing creation, snapshots, comparison ranking, alerts, and CSV export
- **Decision support insights**:
  - `POST /api/car-tracker/insights/depreciation`
  - `POST /api/car-tracker/insights/ownership-cost`
- **Monetization baseline**:
  - `GET /api/car-tracker/monetization/plans` (Free + Premium Intelligence)

## UI delivered at `/car-tracker`

- Token generation and status panel.
- Manual listing capture form.
- Ranked comparison table with score.
- Price-drop alert feed.
- Ownership/depreciation calculator.
- CSV export link.

## Chrome extension upgrades

- Configurable API base URL.
- Capture token input + local storage.
- Bearer-authenticated capture to `/api/car-tracker/capture`.

## Security posture

- No Carsales credentials stored.
- User-initiated capture only.
- Time-boxed authorization token (30-day max).

## Quick start

1. `npm run dev`
2. Open `http://localhost:5000/car-tracker`
3. Generate token, then paste it into extension settings.
4. Load extension from `car-tracker-extension/` in Chrome developer mode.
5. Capture Carsales listing pages and review ranking + alerts in dashboard.
