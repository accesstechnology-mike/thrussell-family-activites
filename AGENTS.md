<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Single Next.js 16 (Turbopack) app. Scripts live in `package.json`; commands are the standard ones in `README.md` (`npm run dev`/`lint`/`build`/`start`/`sync`/`verify`).

- The app serves from the committed cache `data/activities.json` (189 outings), so `npm run dev` works immediately without running `npm run sync` first.
- `npm run sync` polls many live external sites (some Cloudflare-protected) and rewrites `data/activities.json` + `data/source-cache/`; it is only needed to refresh data, not to run/test the app.
- Detail pages and `/api/activities/[id]` make live outbound calls (postcodes.io geocode, OSRM drive times, open-meteo weather); `npm run verify` exercises this end-to-end and confirms egress works.
- `npm run lint` currently reports a pre-existing error in `src/components/ActivityDetailClient.tsx` plus two warnings — these are in-repo code issues, not environment problems.
