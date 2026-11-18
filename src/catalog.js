// Netflix India movie catalogue: availability, details, cast and trailers from TMDB;
// ratings from IMDb's daily ratings file (datasets.imdbws.com, personal non-commercial use).
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import readline from 'node:readline';
import { getJSON, putJSON } from './store.js';

const TMDB = 'https://api.themoviedb.org/3';
const NETFLIX_PROVIDER_ID = 8;
const CATALOG_KEY = 'catalog.json';
const DETAILS_MAX_AGE_MS = 30 * 24 * 3600e3;
export const MIN_VOTES_FOR_RANK = 1000; // below this, a rating is too noisy to rank by

let catalog = { updatedAt: null, movies: [] };
let byId = new Map();

function setCatalog(c) {
  catalog = c;
  byId = new Map(c.movies.map((m) => [m.id, m]));
}

export const getCatalog = () => catalog;
export const getMovie = (id) => byId.get(id) || { id, title: 'No longer on Netflix', gone: true, genres: [], cast: [] };

export async function loadCatalog() {
  const c = await getJSON(CATALOG_KEY);
  if (c) setCatalog(c);
  return catalog;
}

// ---------- filtering and ordering (pure) ----------

export function filterMovies(movies, f = {}) {
  return movies.filter(
    (m) =>
      (!f.languages?.length || f.languages.includes(m.lang)) &&
      (!f.genres?.length || m.genres.some((g) => f.genres.includes(g))) &&
      (!f.minRating || (m.imdbRating ?? 0) >= f.minRating) &&
      (!f.yearFrom || (m.year ?? 0) >= f.yearFrom) &&
      (!f.yearTo || (m.year ?? Infinity) <= f.yearTo) &&
      (!f.maxRuntime || (m.runtime && m.runtime <= f.maxRuntime)) &&
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

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
const langName = (code) => {
  try {
    return languageNames.of(code) || code;
  } catch {
    return code;
  }
};

export function catalogMeta() {
  const langs = new Map();
  const genres = new Set();
  let yearMin = Infinity;
  let yearMax = -Infinity;
  for (const m of catalog.movies) {
    langs.set(m.lang, (langs.get(m.lang) || 0) + 1);
    m.genres.forEach((g) => genres.add(g));
    if (m.year) {
      yearMin = Math.min(yearMin, m.year);
      yearMax = Math.max(yearMax, m.year);
    }
  }
  return {
    updatedAt: catalog.updatedAt,
    total: catalog.movies.length,
    languages: [...langs].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, name: langName(code), count })),
    genres: [...genres].sort(),
    yearMin: Number.isFinite(yearMin) ? yearMin : null,
    yearMax: Number.isFinite(yearMax) ? yearMax : null,
  };
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
async function discoverIds(extra, ids) {
  const first = await tmdb('/discover/movie', { ...DISCOVER, ...extra, page: 1 });
  first.results.forEach((r) => ids.add(r.id));
  const pages = Array.from({ length: Math.min(first.total_pages, 500) - 1 }, (_, i) => i + 2);
  await mapLimit(pages, 8, async (page) => {
    const d = await tmdb('/discover/movie', { ...DISCOVER, ...extra, page });
    d.results.forEach((r) => ids.add(r.id));
  });
  return first.total_pages;
}

async function netflixIndiaIds() {
  const ids = new Set();
  const totalPages = await discoverIds({}, ids);
  if (totalPages > 500) {
    const thisYear = new Date().getFullYear();
    for (let y = 1900; y <= thisYear + 1; y += 5) {
      await discoverIds({ 'primary_release_date.gte': `${y}-01-01`, 'primary_release_date.lte': `${y + 4}-12-31` }, ids);
    }
  }
  return ids;
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

  const ids = [...(await netflixIndiaIds())];
  log(`Netflix India: ${ids.length} movies`);

  let fetched = 0;
  let failed = 0;
  const movies = (
    await mapLimit(ids, 8, async (id) => {
      const old = cached.get(id);
      if (old && started - old.fetchedAt < DETAILS_MAX_AGE_MS) return old;
      try {
        const d = await tmdb(`/movie/${id}`, {
          append_to_response: 'credits,videos,release_dates',
          include_video_language: 'en,hi,null',
        });
        fetched++;
        return toMovie(d, started);
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
