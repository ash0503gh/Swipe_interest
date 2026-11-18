// Netflix India catalogue of movies and shows: availability, details, cast and trailers from TMDB;
// ratings from IMDb's daily ratings file (datasets.imdbws.com, personal non-commercial use).
// Shows are stored with negative ids (-tmdbId) so they never collide with movie ids.
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import readline from 'node:readline';
import { getJSON, putJSON } from './store.js';
import { FOOD } from './food.js';
import { BOOK_LIST } from './books.js';

const TMDB = 'https://api.themoviedb.org/3';
const NETFLIX_PROVIDER_ID = 8;
const CATALOG_KEY = 'catalog.json';
const DETAILS_MAX_AGE_MS = 30 * 24 * 3600e3;
export const MIN_VOTES_FOR_RANK = 1000; // below this, a rating is too noisy to rank by

let catalog = { updatedAt: null, movies: [] };
let byId = new Map([...FOOD, ...BOOK_LIST].map((m) => [m.id, m]));

let meta = null; // catalogMeta() result for the current catalogue

function setCatalog(c) {
  catalog = c;
  meta = null;
  byId = new Map([...c.movies, ...FOOD, ...BOOK_LIST].map((m) => [m.id, m]));
}

export const getCatalog = () => catalog;
export const getMovie = (id) => byId.get(id) || { id, title: 'No longer on Netflix', gone: true, genres: [], cast: [] };

export async function loadCatalog() {
  const c = await getJSON(CATALOG_KEY);
  if (c) setCatalog(c);
  return catalog;
}

// ---------- filtering and ordering (pure) ----------

// "Cinema" is the movie's original language, grouped. World = every other language.
export const CINEMAS = [
  { id: 'bollywood', name: 'Bollywood', sub: 'Hindi', langs: ['hi'] },
  { id: 'hollywood', name: 'Hollywood', sub: 'English', langs: ['en'] },
  { id: 'south', name: 'South', sub: 'Tamil, Telugu, Malayalam, Kannada', langs: ['ta', 'te', 'ml', 'kn'] },
  { id: 'world', name: 'World', sub: 'Korean, Japanese, Spanish & more', langs: null },
];
export const cinemaOf = (lang) => CINEMAS.find((c) => c.langs?.includes(lang))?.id || 'world';

// Within a filter any choice matches (Bollywood or Hollywood; Comedy or Thriller); filters combine with AND.
export function filterMovies(movies, f = {}) {
  return movies.filter(
    (m) =>
      (f.kind === 'tv' ? m.kind === 'tv' : m.kind !== 'tv') &&
      (!f.cinemas?.length || f.cinemas.includes(cinemaOf(m.lang))) &&
      (!f.genres?.length || m.genres.some((g) => f.genres.includes(g))) &&
      (!f.minRating || (m.imdbRating ?? 0) >= f.minRating) &&
      (!f.yearFrom || (m.year ?? 0) >= f.yearFrom) &&
      (!f.yearTo || (m.year ?? Infinity) <= f.yearTo) &&
      (!f.maxRuntime || m.kind === 'tv' || (m.runtime && m.runtime <= f.maxRuntime)) &&
      (!f.kidsSafe || m.kidsSafe)
  );
}

// Top rated first: well-voted titles by IMDb rating, then thinly-voted ones, then unrated.
export function sortTopRated(movies) {
  const tier = (m) => (m.imdbRating == null ? 2 : (m.imdbVotes ?? 0) >= MIN_VOTES_FOR_RANK ? 0 : 1);
  return [...movies].sort(
    (a, b) =>
      tier(a) - tier(b) ||
      (b.imdbRating ?? 0) - (a.imdbRating ?? 0) ||
      (b.imdbVotes ?? 0) - (a.imdbVotes ?? 0)
  );
}

export function isKidsSafe(certs) {
  if (certs.IN) return certs.IN === 'U';
  return ['G', 'PG'].includes(certs.US);
}

export function isKidsSafeTv(certs) {
  if (certs.IN) return certs.IN === 'U';
  return ['TV-Y', 'TV-Y7', 'TV-G', 'TV-PG'].includes(certs.US);
}

export function catalogMeta() {
  if (meta) return meta;
  const cinemas = new Map(CINEMAS.map((c) => [c.id, 0]));
  const genres = { movie: new Map(), tv: new Map() };
  for (const m of catalog.movies) {
    const c = cinemaOf(m.lang);
    cinemas.set(c, cinemas.get(c) + 1);
    const g = genres[m.kind === 'tv' ? 'tv' : 'movie'];
    m.genres.forEach((name) => g.set(name, (g.get(name) || 0) + 1));
  }
  const byCount = (map) => [...map].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  // Most-voted posters, for the start screen backdrop.
  const posters = [...catalog.movies]
    .filter((m) => m.poster)
    .sort((a, b) => (b.imdbVotes ?? 0) - (a.imdbVotes ?? 0))
    .slice(0, 24)
    .map((m) => m.poster);
  meta = {
    updatedAt: catalog.updatedAt,
    total: catalog.movies.length,
    cinemas: CINEMAS.map(({ id, name, sub }) => ({ id, name, sub, count: cinemas.get(id) })),
    genres: { movie: byCount(genres.movie), tv: byCount(genres.tv) },
    posters,
  };
  return meta;
}

// ---------- refresh from TMDB + IMDb ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Accepts either TMDB credential: the short v3 API key or the long v4 read access token.
async function tmdb(pathname, params = {}) {
  const key = process.env.TMDB_API_KEY.trim();
  const url = new URL(TMDB + pathname);
  const headers = {};
  if (key.length > 40) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`TMDB ${pathname} failed: HTTP ${res.status}`); // no URL: it holds the key
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const DISCOVER = {
  watch_region: 'IN',
  with_watch_providers: NETFLIX_PROVIDER_ID,
  with_watch_monetization_types: 'flatrate',
  include_adult: 'false',
  sort_by: 'popularity.desc',
};

// TMDB serves at most 500 pages (10,000 results) per query, so split by release year if needed.
async function discoverIds(kind, extra, ids) {
  const first = await tmdb(`/discover/${kind}`, { ...DISCOVER, ...extra, page: 1 });
  first.results.forEach((r) => ids.add(r.id));
  const pages = Array.from({ length: Math.min(first.total_pages, 500) - 1 }, (_, i) => i + 2);
  await mapLimit(pages, 8, async (page) => {
    const d = await tmdb(`/discover/${kind}`, { ...DISCOVER, ...extra, page });
    d.results.forEach((r) => ids.add(r.id));
  });
  return first.total_pages;
}

async function netflixIndiaIds(kind) {
  const ids = new Set();
  const totalPages = await discoverIds(kind, {}, ids);
  if (totalPages > 500) {
    const date = kind === 'tv' ? 'first_air_date' : 'primary_release_date';
    const thisYear = new Date().getFullYear();
    for (let y = 1900; y <= thisYear + 1; y += 5) {
      await discoverIds(kind, { [`${date}.gte`]: `${y}-01-01`, [`${date}.lte`]: `${y + 4}-12-31` }, ids);
    }
  }
  return [...ids];
}

function pickTrailer(videos) {
  const yt = videos.filter((v) => v.site === 'YouTube');
  return (
    yt.find((v) => v.type === 'Trailer' && v.official) ||
    yt.find((v) => v.type === 'Trailer') ||
    yt.find((v) => v.type === 'Teaser') ||
    null
  );
}

export function toMovie(d, now = Date.now()) {
  const certs = {};
  for (const r of d.release_dates?.results || []) {
    certs[r.iso_3166_1] = r.release_dates.map((x) => x.certification).find(Boolean) || '';
  }
  return {
    id: d.id,
    title: d.title,
    year: d.release_date ? Number(d.release_date.slice(0, 4)) : null,
    overview: d.overview || '',
    poster: d.poster_path || null,
    runtime: d.runtime || null,
    genres: (d.genres || []).map((g) => g.name),
    lang: d.original_language,
    imdbId: d.imdb_id || null,
    cast: (d.credits?.cast || []).slice(0, 6).map((c) => c.name),
    director: (d.credits?.crew || []).find((c) => c.job === 'Director')?.name || null,
    trailer: pickTrailer(d.videos?.results || [])?.key || null,
    cert: certs.IN || certs.US || null,
    kidsSafe: isKidsSafe(certs),
    tmdbRating: d.vote_average || null,
    fetchedAt: now,
  };
}

export function toShow(d, now = Date.now()) {
  const certs = {};
  for (const r of d.content_ratings?.results || []) certs[r.iso_3166_1] = r.rating || '';
  return {
    id: -d.id,
    kind: 'tv',
    title: d.name,
    year: d.first_air_date ? Number(d.first_air_date.slice(0, 4)) : null,
    overview: d.overview || '',
    poster: d.poster_path || null,
    runtime: null,
    seasons: d.number_of_seasons || null,
    genres: (d.genres || []).map((g) => g.name),
    lang: d.original_language,
    imdbId: d.external_ids?.imdb_id || null,
    cast: (d.credits?.cast || []).slice(0, 6).map((c) => c.name),
    director: (d.created_by || []).slice(0, 2).map((c) => c.name).join(', ') || null, // "Created by"
    trailer: pickTrailer(d.videos?.results || [])?.key || null,
    cert: certs.IN || certs.US || null,
    kidsSafe: isKidsSafeTv(certs),
    tmdbRating: d.vote_average || null,
    fetchedAt: now,
  };
}

async function imdbRatings(wanted) {
  const res = await fetch('https://datasets.imdbws.com/title.ratings.tsv.gz');
  if (!res.ok) throw new Error(`IMDb ratings download failed: HTTP ${res.status}`);
  const lines = readline.createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });
  const out = new Map();
  for await (const line of lines) {
    const id = line.slice(0, line.indexOf('\t'));
    if (!wanted.has(id)) continue;
    const [, rating, votes] = line.split('\t');
    out.set(id, { rating: Number(rating), votes: Number(votes) });
  }
  return out;
}

export async function refreshCatalog(log = console.log) {
  if (!process.env.TMDB_API_KEY) throw new Error('TMDB_API_KEY is not set');
  const started = Date.now();
  const cached = new Map(((await getJSON(CATALOG_KEY))?.movies || []).map((m) => [m.id, m]));

  const movieIds = await netflixIndiaIds('movie');
  const showIds = await netflixIndiaIds('tv');
  log(`Netflix India: ${movieIds.length} movies, ${showIds.length} shows`);
  const ids = [...movieIds, ...showIds.map((id) => -id)];

  let fetched = 0;
  let failed = 0;
  const movies = (
    await mapLimit(ids, 8, async (id) => {
      const old = cached.get(id);
      if (old && started - old.fetchedAt < DETAILS_MAX_AGE_MS) return old;
      try {
        const d =
          id > 0
            ? await tmdb(`/movie/${id}`, { append_to_response: 'credits,videos,release_dates', include_video_language: 'en,hi,null' })
            : await tmdb(`/tv/${-id}`, { append_to_response: 'credits,videos,content_ratings,external_ids', include_video_language: 'en,hi,null' });
        fetched++;
        return id > 0 ? toMovie(d, started) : toShow(d, started);
      } catch (err) {
        failed++;
        log(`skip ${id}: ${err.message}`);
        return old || null;
      }
    })
  ).filter(Boolean);
  log(`details: ${fetched} fetched, ${movies.length - fetched} cached, ${failed} failed`);

  const ratings = await imdbRatings(new Set(movies.map((m) => m.imdbId).filter(Boolean)));
  for (const m of movies) {
    const r = ratings.get(m.imdbId);
    m.imdbRating = r?.rating ?? null;
    m.imdbVotes = r?.votes ?? null;
  }
  log(`IMDb ratings: ${ratings.size}/${movies.length}`);

  const next = { updatedAt: new Date().toISOString(), movies };
  await putJSON(CATALOG_KEY, next);
  setCatalog(next);
  log(`catalog saved in ${Math.round((Date.now() - started) / 1000)}s`);
  return { count: movies.length, fetched, failed };
}
