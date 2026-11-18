import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterMovies, sortTopRated, isKidsSafe, toMovie } from '../src/catalog.js';

const movies = [
  { id: 1, lang: 'hi', genres: ['Drama'], imdbRating: 8.4, imdbVotes: 50000, year: 2019, runtime: 150, kidsSafe: false },
  { id: 2, lang: 'en', genres: ['Comedy', 'Family'], imdbRating: 6.1, imdbVotes: 9000, year: 2022, runtime: 95, kidsSafe: true },
  { id: 3, lang: 'ta', genres: ['Action'], imdbRating: 9.6, imdbVotes: 40, year: 2024, runtime: 120, kidsSafe: false },
  { id: 4, lang: 'hi', genres: ['Comedy'], imdbRating: null, imdbVotes: null, year: 1998, runtime: null, kidsSafe: false },
  { id: 5, lang: 'en', genres: ['Thriller'], imdbRating: 8.4, imdbVotes: 900000, year: 2010, runtime: 148, kidsSafe: false },
];
const ids = (list) => list.map((m) => m.id);

test('filters combine', () => {
  assert.deepEqual(ids(filterMovies(movies, { languages: ['hi'] })), [1, 4]);
  assert.deepEqual(ids(filterMovies(movies, { genres: ['Comedy', 'Action'] })), [2, 3, 4]);
  assert.deepEqual(ids(filterMovies(movies, { minRating: 8 })), [1, 3, 5]);
  assert.deepEqual(ids(filterMovies(movies, { yearFrom: 2015, yearTo: 2022 })), [1, 2]);
  assert.deepEqual(ids(filterMovies(movies, { yearTo: 1999 })), [4]);
  assert.deepEqual(ids(filterMovies(movies, { maxRuntime: 120 })), [2, 3]);
  assert.deepEqual(ids(filterMovies(movies, { kidsSafe: true })), [2]);
  assert.deepEqual(ids(filterMovies(movies, { languages: ['en'], minRating: 7 })), [5]);
  assert.equal(filterMovies(movies, {}).length, 5);
});

test('top rated first, thin vote counts after, unrated last', () => {
  assert.deepEqual(ids(sortTopRated(movies)), [5, 1, 2, 3, 4]);
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
