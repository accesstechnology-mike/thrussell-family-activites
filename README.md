# Thrussell Outings

Family activity picker for outings within **~1 hour 45 minutes** of **Catton (`YO7 4SQ`)**.

Kids browse big picture cards (fun bits, terrain, drive time). Grown-ups open the same outing on a phone for **Google Maps**, **Tesla postcode/coords**, parking, cost, weather, and a link back to the **original source**.

## Sources (polled, stored locally)

- **The Reluctant Explorers** — Google My Maps KML + walk page enrichment
- **Yorkshire Tots to Teens** — family walk posts from Yorkshire walks hubs
- **Teesside Family Life** — North Yorkshire outdoor guides via WordPress API
- **Muddy Boots Mummy** — Yorkshire family walks roundup
- **Little Vikings** — York & Yorkshire family walks guide
- **AllTrails** — North Yorkshire child-friendly trails
- **National Trust** / **English Heritage** — places near home
- **OpenStreetMap** — zoos, attractions, museums, nature reserves near home (fills gaps walk blogs miss, e.g. Thirsk Birds of Prey Centre)

Cross-source duplicates are collapsed by normalised place name + proximity (richer records win; Reluctant Explorers preferred when tied).

Results are filtered by real **OSRM** drive time from the live geocode of `YO7 4SQ` (via postcodes.io). Activity cache: `data/activities.json`. Cloudflare-prone pages also keep a last-good HTML snapshot under `data/source-cache/` (`npm run sync:refresh-cache`).

Photos are looked up from source pages / Wikipedia / Wikimedia when missing, then resized with **sharp** into local webp files under `public/media/` (card ~720px + detail ~1200px) so the browse grid stays fast.

## When data refreshes

1. **Daily cron** — Vercel hits `GET /api/sync` at **06:00 UTC** (`vercel.json`)
2. **Manual** — `npm run sync` locally, or `GET|POST /api/sync`
3. The UI footer shows the last successful `syncedAt` timestamp

Sync re-polls every source, re-geocodes as needed (with `data/geocode-cache.json`), re-filters by drive time, refreshes image cache, and rewrites `data/activities.json`.

## Develop

```bash
npm install
npm run sync          # poll sources → data/activities.json + public/media
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Useful endpoints

- `GET /api/activities` — list cached outings (`?free=1` for free-only)
- `GET /api/activities/[id]` — detail + maps + weather
- `GET|POST /api/sync` — refresh from sources (also on a daily Vercel cron)

## Directions

Destination pins use source coordinates. When a Reluctant Explorers walk includes a **what3words** parking address, we resolve it with the same public-page approach as [what3words-convert](https://github.com/accesstechnology-mike/what3words-convert) for a more precise Maps pin. Tesla gets the postcode when known, otherwise lat/lng.

## Verify

```bash
npm run build && npm run start
npm run verify
```
