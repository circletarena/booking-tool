# Circle T Arena — Stall & RV Reservation Tool

Interactive booking tool for Circle T Arena with real-time availability, built on the Checkfront API.

## What It Does

- **6 bookable areas** — Barn A, Barn B, Barn C, VIP Pool, Treeline, VIP Hill
- **Real-time availability** — color-coded stall and RV maps pulled from live booking data
- **Multi-item cart** — book multiple stalls/RV sites in a single checkout session
- **Per-stall pricing** — click any available spot to see rates and total cost
- **Property map overlay** — full facility map accessible from any screen
- **Per-barn layout toggles** — detailed layout images for Barns A, B, and C
- **Admin panel** — password-protected page at `/admin` to manage the maintenance hold window (LOOKBACK_DAYS)
- **Mobile responsive** — touch-optimized with bottom-sheet info panel and pinch-to-zoom maps

## How It Works

```
Browser (index.html)          Vercel Serverless            Checkfront API
─────────────────────         ─────────────────            ──────────────
fetch('/api/bookings')  ───>  api/bookings.js      ───>   /api/4.0/booking
fetch('/api/products')  ───>  api/products.js      ───>   /api/4.0/item
fetch('/api/availability')──> api/availability.js  ───>   /api/3.0/item (rated)
fetch('/api/closures')  ───>  api/closures.js      ───>   /api/4.0/closure
```

The browser makes requests to same-origin `/api/` endpoints. Vercel serverless functions proxy these to the Checkfront API with authentication, keeping API credentials server-side.

## File Structure

```
index.html              Main application (single-page, all areas)
api/
  bookings.js           v4 bookings endpoint — returns booked stall/RV map
  products.js           v4 items endpoint — returns products by category
  availability.js       v3 rated availability — per-stall pricing + SLIP token
  closures.js           v4 closures endpoint — maintenance holds
  admin.js              Admin panel API (read/update LOOKBACK_DAYS, trigger redeploy)
  admin-page.js         Serves the admin panel HTML
barn-b/                 Legacy subfolder (Barn B layout assets)
Circle-t-logo.webp      Site logo
barn-a-layout.png       Barn A layout image (toggle)
barn-b-layout.png       Barn B layout image (toggle)
barn-c-layout.png       Barn C layout image (toggle)
property-map.png        Full property map (modal overlay)
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `CF_API_KEY` | Checkfront API key (Token auth) |
| `CF_API_SECRET` | Checkfront API secret |
| `CF_DOMAIN` | Checkfront host domain |
| `CF_SUBDOMAIN` | Checkfront account subdomain |
| `LOOKBACK_DAYS` | Maintenance hold window (days) |
| `ADMIN_PASSPHRASE` | Password for the /admin panel |
| `VERCEL_TOKEN` | Vercel API token (for admin panel redeploys) |
| `VERCEL_PROJECT_ID` | Vercel project ID (for admin panel redeploys) |
| `DEPLOY_HOOK_URL` | Vercel deploy hook URL (triggers redeploy on config change) |

## Deployment

Hosted on Vercel. Pushes to `main` auto-deploy via GitHub integration.

## Support

For questions about this tool, contact Austin Welch.
