# Thrussell Outings

Family activity picker for outings within **~1.5 hours** of **Catton (`YO7 4SQ`)**.

Kids browse big picture cards (fun bits, terrain, drive time). Grown-ups open the same outing on a phone for **Google Maps**, **Tesla postcode/coords**, parking, cost, and live weather.

## Agent / Hermes access

Prefer JSON over the HTML UI. Discovery:

| URL | Purpose |
|-----|---------|
| [`/llms.txt`](./public/llms.txt) | Agent instructions |
| `/api` | Live catalogue + endpoint docs |
| `/api/openapi.json` | OpenAPI 3.1 |
| `/api/suggest?q=...` | Natural-language ask / suggest |
| `/api/activities` | Structured list + filters |
| `/api/activities/[id]` | Detail + maps + Tesla + weather |

Typical Hermes flow — one call:

```bash
curl -sS 'http://localhost:3000/api/suggest?q=stepping%20stones%20under%2045%20minutes&limit=5'
```

Response includes ranked `suggestions[]` with `why`, logistics fields, Maps links, and Tesla destination. Use `/api/activities/{id}` only when you need live weather or a refined what3words pin.

Structured filters on `/api/activities`: `q`, `feature`, `features`, `source`, `sources`, `terrain`, `terrains`, `maxDrive`, `minDrive`, `maxDistanceMiles`, `free`, `ids`, `sort`, `limit`, `offset`, `view=card|full`.

## Sources (polled, stored locally)

- **The Reluctant Explorers** — Google My Maps KML + walk page enrichment
- **Yorkshire Tots to Teens** — family walk posts from Yorkshire walks hubs
- **Teesside Family Life** — North Yorkshire outdoor guides via WordPress API
- **Muddy Boots Mummy** — Yorkshire family walks roundup
- **Little Vikings** — York & Yorkshire family walks guide
- **AllTrails** — North Yorkshire child-friendly trails
- **National Trust** / **English Heritage** — places near home

Cross-source duplicates are collapsed by normalised place name + proximity (richer records win; Reluctant Explorers preferred when tied).

Results are filtered by real **OSRM** drive time from the live geocode of `YO7 4SQ` (via postcodes.io). Activity cache: `data/activities.json`. Cloudflare-prone pages also keep a last-good HTML snapshot under `data/source-cache/` (`npm run sync:refresh-cache`).

## Develop

```bash
npm install
npm run sync          # poll sources → data/activities.json
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Other endpoints

- `GET|POST /api/sync` — refresh from sources (also on a daily Vercel cron)
- `GET /api/weather?activityId=` or `lat`/`lng` — weather only

## Directions

Destination pins use source coordinates. When a Reluctant Explorers walk includes a **what3words** parking address, we resolve it with the same public-page approach as [what3words-convert](https://github.com/accesstechnology-mike/what3words-convert) for a more precise Maps pin. Tesla gets the postcode when known, otherwise lat/lng.

## Verify

```bash
npm run build && npm run start
npm run verify
```
