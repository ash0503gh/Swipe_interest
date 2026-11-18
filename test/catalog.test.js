import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterMovies, sortTopRated, isKidsSafe, isKidsSafeTv, toMovie, toShow, cinemaOf } from '../src/catalog.js';

const movies = [
  { id: 1, lang: 'hi', genres: ['Drama'], imdbRating: 8.4, imdbVotes: 50000, year: 2019, runtime: 150, kidsSafe: false },
  { id: 2, lang: 'en', genres: ['Comedy', 'Family'], imdbRating: 6.1, imdbVotes: 9000, year: 2022, runtime: 95, kidsSafe: true },
  { id: 3, lang: 'ta', genres: ['Action'], imdbRating: 9.6, imdbVotes: 40, year: 2024, runtime: 120, kidsSafe: false },
  { id: 4, lang: 'hi', genres: ['Comedy'], imdbRating: null, imdbVotes: null, year: 1998, runtime: null, kidsSafe: false },
  { id: 5, lang: 'en', genres: ['Thriller'], imdbRating: 8.4, imdbVotes: 900000, year: 2010, runtime: 148, kidsSafe: false },
  { id: 6, lang: 'ko', genres: ['Thriller', 'Drama'], imdbRating: 8.5, imdbVotes: 1000000, year: 2019, runtime: 132, kidsSafe: false },
];
const ids = (list) => list.map((m) => m.id);

test('filters combine', () => {
  assert.deepEqual(ids(filterMovies(movies, { cinemas: ['bollywood'] })), [1, 4]);
  assert.deepEqual(ids(filterMovies(movies, { cinemas: ['bollywood', 'hollywood'] })), [1, 2, 4, 5]);
  assert.deepEqual(ids(filterMovies(movies, { cinemas: ['south', 'world'] })), [3, 6]);
  assert.deepEqual(ids(filterMovies(movies, { genres: ['Comedy', 'Action'] })), [2, 3, 4]);
  assert.deepEqual(ids(filterMovies(movies, { cinemas: ['hollywood'], genres: ['Thriller'] })), [5]);
  assert.deepEqual(ids(filterMovies(movies, { minRating: 8 })), [1, 3, 5, 6]);
  assert.deepEqual(ids(filterMovies(movies, { yearFrom: 2015, yearTo: 2022 })), [1, 2, 6]);
  assert.deepEqual(ids(filterMovies(movies, { yearTo: 1999 })), [4]);
  assert.deepEqual(ids(filterMovies(movies, { maxRuntime: 120 })), [2, 3]);
  assert.deepEqual(ids(filterMovies(movies, { kidsSafe: true })), [2]);
  assert.deepEqual(ids(filterMovies(movies, { cinemas: ['hollywood'], minRating: 7 })), [5]);
  assert.equal(filterMovies(movies, {}).length, 6);
});

test('cinema groups', () => {
  assert.equal(cinemaOf('hi'), 'bollywood');
  assert.equal(cinemaOf('en'), 'hollywood');
  assert.equal(cinemaOf('kn'), 'south');
  assert.equal(cinemaOf('ko'), 'world');
});

test('top rated first, thin vote counts after, unrated last', () => {
  assert.deepEqual(ids(sortTopRated(movies)), [6, 5, 1, 2, 3, 4]);
});

test('kids-safe uses Indian certificate, else US', () => {
  assert.equal(isKidsSafe({ IN: 'U', US: 'R' }), true);
  assert.equal(isKidsSafe({ IN: 'UA', US: 'G' }), false);
  assert.equal(isKidsSafe({ US: 'PG' }), true);
  assert.equal(isKidsSafe({}), false);
});

test('toMovie maps TMDB details', () => {
  const m = toMovie(
    {
      id: 7, title: 'Test', release_date: '2021-05-01', overview: 'o', poster_path: '/p.jpg', runtime: 130,
      genres: [{ name: 'Drama' }], original_language: 'hi', imdb_id: 'tt1', vote_average: 7.2,
      credits: { cast: [{ name: 'A' }, { name: 'B' }], crew: [{ job: 'Writer', name: 'W' }, { job: 'Director', name: 'D' }] },
      videos: { results: [{ site: 'YouTube', type: 'Teaser', key: 't' }, { site: 'YouTube', type: 'Trailer', key: 'k' }] },
      release_dates: { results: [{ iso_3166_1: 'IN', release_dates: [{ certification: '' }, { certification: 'U' }] }] },
    },
    42
  );
  assert.equal(m.year, 2021);
  assert.equal(m.director, 'D');
  assert.equal(m.trailer, 'k');
  assert.equal(m.cert, 'U');
  assert.equal(m.kidsSafe, true);
  assert.deepEqual(m.cast, ['A', 'B']);
  assert.equal(m.fetchedAt, 42);
});

const mixed = [
  { id: 1, lang: 'hi', genres: ['Drama'], runtime: 150 },
  { id: 2, kind: 'movie', lang: 'en', genres: ['Comedy'], runtime: 95 },
  { id: -3, kind: 'tv', lang: 'ko', genres: ['Drama'], runtime: null, seasons: 2 },
  { id: -4, kind: 'tv', lang: 'hi', genres: ['Crime'], runtime: null, seasons: 1 },
];

test('sessions are movies or shows, never mixed', () => {
  assert.deepEqual(ids(filterMovies(mixed, {})), [1, 2]); // default and old sessions: movies
  assert.deepEqual(ids(filterMovies(mixed, { kind: 'movie' })), [1, 2]);
  assert.deepEqual(ids(filterMovies(mixed, { kind: 'tv' })), [-3, -4]);
  assert.deepEqual(ids(filterMovies(mixed, { kind: 'tv', cinemas: ['bollywood'] })), [-4]);
  assert.deepEqual(ids(filterMovies(mixed, { kind: 'tv', maxRuntime: 90 })), [-3, -4]); // length ignored for shows
});

test('toShow maps TMDB TV details with a negative id', () => {
  const m = toShow({
    id: 99, name: 'Show', first_air_date: '2019-03-01', number_of_seasons: 3, original_language: 'ko',
    genres: [{ name: 'Drama' }], created_by: [{ name: 'C1' }, { name: 'C2' }, { name: 'C3' }],
    external_ids: { imdb_id: 'tt9' }, credits: { cast: [{ name: 'A' }] },
    videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'k' }] },
    content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-14' }] },
  }, 5);
  assert.equal(m.id, -99);
  assert.equal(m.kind, 'tv');
  assert.equal(m.year, 2019);
  assert.equal(m.seasons, 3);
  assert.equal(m.director, 'C1, C2');
  assert.equal(m.imdbId, 'tt9');
  assert.equal(m.cert, 'TV-14');
  assert.equal(m.kidsSafe, false);
  assert.equal(isKidsSafeTv({ US: 'TV-PG' }), true);
  assert.equal(isKidsSafeTv({ IN: 'U/A 13+', US: 'TV-G' }), false);
});
