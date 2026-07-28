# Thrussell Outings

Family activity picker for outings within **~1.5 hours** of **Catton (`YO7 4SQ`)**.

Kids browse big picture cards (fun bits, terrain, drive time). Grown-ups open the same outing on a phone for **Google Maps**, **Tesla postcode/coords**, parking, cost, and live weather.

## Sources (polled, stored locally)

- **The Reluctant Explorers** — Google My Maps KML + walk page enrichment (distance, terrain, parking, what3words, amenities)
- **Yorkshire Tots to Teens** — family walk posts from their Yorkshire walks hubs
- **Teesside Family Life** — North Yorkshire outdoor guides via WordPress API
- **National Trust** — public places search near home
- **English Heritage** — public places listing near home

Results are filtered by real **OSRM** drive time from the live geocode of `YO7 4SQ` (via postcodes.io). The local cache lives at `data/activities.json`.

## Develop

```bash
npm install
npm run sync          # poll sources → data/activities.json
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Useful endpoints

- `GET /api/activities` — list cached outings
- `GET /api/activities/[id]` — detail + maps + weather
- `GET|POST /api/sync` — refresh from sources (also on a daily Vercel cron)

## Directions

Destination pins use source coordinates. When a Reluctant Explorers walk includes a **what3words** parking address, we resolve it with the same public-page approach as [what3words-convert](https://github.com/accesstechnology-mike/what3words-convert) for a more precise Maps pin. Tesla gets the postcode when known, otherwise lat/lng.

## Verify

```bash
npm run build && npm run start
npm run verify
```
