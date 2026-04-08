# Legacy HTML (not served in production)

Express only serves `public/`. These pages lived at the repo root for old experiments; they are **not** deployed with the live site.

They reference `/script.js` and related assets as if a dev server were running with `public` as the web root (e.g. `http://localhost:5000/script.js`).

Other `.html` files still at the repository root are likewise **not** wired into `server.js`; treat them as scratch or historical unless moved under `public/`.
