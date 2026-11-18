# SwipeTogether

Swipe on Netflix India movies or shows with family and friends. When everyone in a session swipes right on a movie, it's a match.

- Host optionally picks a cinema (Bollywood, Hollywood, South, World) and genres, plus more filters (IMDb rating, release years, length, family-friendly), and shares a 6-letter code or link.
- Works as an iPhone Home Screen app (full screen, own icon).
- Food mode: 154 pure-veg home-style dishes (North Indian household focus), each with a hand-checked photo, for breakfast or lunch/dinner, a fresh shuffle each session, and a match when most of the group agrees. Dish list in `src/dishes.js` (each names a Wikimedia Commons photo); run `npm run food` to rebuild `src/food.json` with image URLs and credits.
- Everyone gets the same deck, top IMDb rated first. Up to 10 people; sessions last 24 hours.
- Cards show poster, cast, IMDb rating and a YouTube trailer, with a "Watch on Netflix" link.

## How it works

- `src/catalog.js` builds the Netflix India movie list from TMDB (watch providers, region IN) and adds IMDb ratings from IMDb's daily ratings file. Details are cached for 30 days; the list itself is refreshed whenever `/api/admin/refresh` is called.
- `src/sessions.js` holds the session rules (join, swipe, undo, unanimous match) and keeps live sessions in memory, saving each one to storage.
- `src/store.js` saves JSON to a Cloud Storage bucket when `BUCKET` is set, otherwise to `./data`.
- `public/` is a plain HTML/CSS/JS front end. Live updates use Server-Sent Events, so the service runs as a single Cloud Run instance.

## Local

```bash
npm install
# put TMDB_API_KEY in .env
npm run catalog   # build the movie list into ./data (a few minutes the first time)
npm run dev       # http://localhost:8080
npm test
```

## Deploy (Cloud Run, asia-south1)

Environment: `BUCKET` (Cloud Storage bucket for the catalogue and sessions), `TMDB_API_KEY` and `ADMIN_TOKEN` (from Secret Manager). Keep `--max-instances 1`: sessions live in that instance's memory.

Refresh the catalogue after deploying, and daily after that:

```bash
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" https://<service-url>/api/admin/refresh
```

This product uses the TMDB API but is not endorsed or certified by TMDB. Not affiliated with Netflix.
