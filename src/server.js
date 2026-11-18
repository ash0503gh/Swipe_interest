import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { loadCatalog, getCatalog, getMovie, filterMovies, sortTopRated, catalogMeta, refreshCatalog } from './catalog.js';
import { SessionHub, HttpError, createSession, addMember, findMember, swipe, undo } from './sessions.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const hub = new SessionHub();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

// ---------- helpers ----------

const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 40) : []);

function cleanFilters(f = {}) {
  return {
    languages: strings(f.languages),
    genres: strings(f.genres),
    minRating: num(f.minRating, 0, 10),
    yearFrom: num(f.yearFrom, 1900, 2100),
    yearTo: num(f.yearTo, 1900, 2100),
    maxRuntime: num(f.maxRuntime, 30, 600),
    kidsSafe: f.kidsSafe === true,
  };
}

function requireCatalog() {
  if (!getCatalog().movies.length) throw new HttpError(503, 'Movie list is still being built. Try again in a few minutes.');
}

async function memberOf(req, token) {
  const s = await hub.get(req.params.code);
  const me = findMember(s, token);
  if (!me) throw new HttpError(401, 'Join this session first');
  return { s, me };
}
const auth = (req) => memberOf(req, req.get('x-member-token'));

const me = (m) => ({ id: m.id, name: m.name, position: m.swipes.length });

// ---------- catalogue ----------

app.get('/api/catalog', (req, res) => {
  res.json(catalogMeta());
});

app.post('/api/catalog/count', (req, res) => {
  res.json({ count: filterMovies(getCatalog().movies, cleanFilters(req.body?.filters)).length });
});

// ---------- sessions ----------

app.post('/api/sessions', (req, res) => {
  requireCatalog();
  const filters = cleanFilters(req.body?.filters);
  const deck = sortTopRated(filterMovies(getCatalog().movies, filters)).map((m) => m.id);
  const s = createSession({ deck, filters });
  const m = addMember(s, req.body?.name);
  hub.add(s);
  res.status(201).json({ code: s.code, token: m.token });
});

app.get('/api/sessions/:code', async (req, res) => {
  const s = await hub.get(req.params.code);
  const m = findMember(s, req.get('x-member-token'));
  res.json({ ...hub.state(s), me: m && me(m), host: s.members[0]?.name });
});

app.post('/api/sessions/:code/join', async (req, res) => {
  const s = await hub.get(req.params.code);
  const m = addMember(s, req.body?.name);
  hub.changed(s);
  res.status(201).json({ token: m.token });
});

app.get('/api/sessions/:code/cards', async (req, res) => {
  const { s } = await auth(req);
  const from = num(req.query.from, 0, s.deck.length) ?? 0;
  const n = num(req.query.n, 1, 30) ?? 10;
  res.json(s.deck.slice(from, from + n).map(getMovie));
});

app.post('/api/movies', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 1000) : [];
  res.json(ids.map((id) => getMovie(Number(id))));
});

app.post('/api/sessions/:code/swipe', async (req, res) => {
  const { s, me: m } = await auth(req);
  const match = swipe(s, m, Number(req.body?.movieId), req.body?.like === true);
  hub.changed(s);
  res.json({ me: me(m), match });
});

app.post('/api/sessions/:code/undo', async (req, res) => {
  const { s, me: m } = await auth(req);
  undo(s, m);
  hub.changed(s);
  res.json({ me: me(m) });
});

// Live updates (EventSource can't send headers, so the token rides in the query string).
app.get('/api/sessions/:code/events', async (req, res) => {
  const { s, me: m } = await memberOf(req, req.query.token);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (state) => res.write(`data: ${JSON.stringify(state)}\n\n`);
  hub.on(s.code, send);
  hub.connect(s, m.id);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    hub.off(s.code, send);
    hub.disconnect(s, m.id);
  });
});

// ---------- admin ----------

let refreshing = null;
app.post('/api/admin/refresh', async (req, res) => {
  const want = Buffer.from(process.env.ADMIN_TOKEN || '');
  const got = Buffer.from(req.get('x-admin-token') || '');
  if (!want.length || want.length !== got.length || !timingSafeEqual(want, got)) throw new HttpError(401, 'Unauthorized');
  refreshing ||= refreshCatalog().finally(() => (refreshing = null));
  res.json(await refreshing);
});

// ---------- static + errors ----------

app.use(express.static(PUBLIC_DIR));
app.get('/s/:code', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong' : err.message });
});

// ---------- start ----------

await loadCatalog();
console.log(`catalog: ${getCatalog().movies.length} movies (updated ${getCatalog().updatedAt ?? 'never'})`);
setInterval(() => hub.dropExpired(), 3600e3).unref();

const port = Number(process.env.PORT) || 8080;
const server = app.listen(port, () => console.log(`listening on http://localhost:${port}`));

process.on('SIGTERM', async () => {
  await hub.flush();
  server.close();
  process.exit(0);
});
