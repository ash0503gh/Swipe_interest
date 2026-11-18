// Swipe sessions: pure rules (create, join, swipe, undo, match) plus an in-memory hub
// that persists each session to the store and notifies live listeners.
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getJSON, putJSON } from './store.js';

export const MAX_MEMBERS = 10;
export const TTL_MS = 24 * 3600e3;
export const MAX_DECK = 1000;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function newCode() {
  return [...randomBytes(6)].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

const cleanName = (name) => {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!n) throw new HttpError(400, 'Name is required');
  return n;
};

// rule: 'all' (everyone swipes right: movies, shows) or 'majority' (more than half: food).
export function createSession({ deck, filters, rule = 'all', now = Date.now() }) {
  if (!deck.length) throw new HttpError(400, 'Nothing matches these filters');
  return { code: newCode(), createdAt: now, expiresAt: now + TTL_MS, filters, rule, deck: deck.slice(0, MAX_DECK), members: [], matches: [] };
}

export const likesNeeded = (s) => (s.rule === 'majority' ? Math.floor(s.members.length / 2) + 1 : s.members.length);

// Member: { id (public), token (secret), name, joinedAt, swipes: [[movieId, 1|0], ...] in deck order }
// Joining again with a name already in the session (another browser, or the Home Screen app,
// which keeps its own storage on iPhone) continues as that person instead of adding a second
// one who never swipes and so blocks every "everyone agrees" match.
export function addMember(s, name, now = Date.now()) {
  const same = s.members.find((m) => m.name.toLowerCase() === cleanName(name).toLowerCase());
  if (same) return same;
  if (s.members.length >= MAX_MEMBERS) throw new HttpError(409, `This session is full (${MAX_MEMBERS} people)`);
  const m = { id: randomUUID().slice(0, 8), token: randomUUID(), name: cleanName(name), joinedAt: now, swipes: [] };
  s.members.push(m);
  return m;
}

export const findMember = (s, token) => (token && s.members.find((m) => m.token === token)) || null;

const isMatched = (s, movieId) => s.matches.some((x) => x.id === movieId);

// Returns the new match, or null.
export function swipe(s, member, movieId, like, now = Date.now()) {
  const vote = like ? 1 : 0;
  const pos = member.swipes.length;
  const last = member.swipes[pos - 1];
  if (last && last[0] === movieId && last[1] === vote) return null; // repeated request
  if (s.deck[pos] !== movieId) throw new HttpError(409, 'Out of sync');
  member.swipes.push([movieId, vote]);
  if (!vote || isMatched(s, movieId)) return null;
  if (s.members.length < 2) return null; // a match needs at least two people agreeing
  const likes = s.members.filter((m) => m.swipes[pos]?.[1] === 1).length;
  if (likes < likesNeeded(s)) return null;
  const match = { id: movieId, at: now };
  s.matches.push(match);
  return match;
}

export function undo(s, member) {
  const last = member.swipes.at(-1);
  if (!last) throw new HttpError(409, 'Nothing to undo');
  if (isMatched(s, last[0])) throw new HttpError(409, "That one's already a match");
  member.swipes.pop();
}

// Anyone in the session can end it for everybody.
export function endSession(s, member, now = Date.now()) {
  s.expiresAt = now - 1;
  s.endedBy = member.name;
}

export function publicState(s, online = new Set()) {
  return {
    code: s.code,
    expiresAt: s.expiresAt,
    endedBy: s.endedBy || null,
    kind: s.filters?.kind || 'movie',
    rule: s.rule || 'all',
    deckSize: s.deck.length,
    members: s.members.map((m) => ({ id: m.id, name: m.name, position: m.swipes.length, online: online.has(m.id) })),
    matches: s.matches,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cloud Run pauses the CPU between requests, so a change is saved before the request that made it
// returns. Saves of one session are chained and coalesced: at most one running, one queued, and
// at least minGapMs apart (Cloud Storage allows about one write per second to the same object).
export class SessionHub extends EventEmitter {
  constructor({ minGapMs = 1000 } = {}) {
    super();
    this.setMaxListeners(0);
    this.minGapMs = minGapMs;
    this.sessions = new Map();
    this.loading = new Map(); // code -> pending load from storage
    this.writes = new Map(); // code -> { tail, queued, lastAt }
    this.online = new Map(); // code -> Map(memberId -> open connections)
  }

  async get(code) {
    code = String(code).toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new HttpError(404, 'Session not found');
    let s = this.sessions.get(code);
    if (!s) {
      // Share one load between concurrent requests so they all get the same session object.
      let load = this.loading.get(code);
      if (!load) {
        load = getJSON(`sessions/${code}.json`).finally(() => this.loading.delete(code));
        this.loading.set(code, load);
      }
      const loaded = await load;
      s = this.sessions.get(code) || loaded;
      if (s) this.sessions.set(code, s);
    }
    if (!s || s.expiresAt < Date.now()) {
      if (!this.writes.get(code)?.queued) this.sessions.delete(code); // keep it until its last save lands
      throw new HttpError(404, s?.endedBy ? `${s.endedBy} ended this session.` : 'Session not found or expired');
    }
    return s;
  }

  add(s) {
    this.sessions.set(s.code, s);
    return this.changed(s);
  }

  onlineIds(code) {
    return new Set(this.online.get(code)?.keys() || []);
  }

  state(s) {
    return publicState(s, this.onlineIds(s.code));
  }

  // Notifies listeners; unless persist is false, resolves once the change is saved.
  changed(s, { persist = true } = {}) {
    this.emit(s.code, this.state(s));
    return persist ? this.save(s.code) : Promise.resolve();
  }

  save(code) {
    const w = this.writes.get(code) || { tail: Promise.resolve(), queued: null, lastAt: 0 };
    this.writes.set(code, w);
    if (w.queued) return w.queued; // a save that hasn't started yet will include this change
    const run = async () => {
      await sleep(Math.max(0, w.lastAt + this.minGapMs - Date.now()));
      w.queued = null;
      const s = this.sessions.get(code);
      if (s) await putJSON(`sessions/${code}.json`, s).catch((err) => console.error(`save ${code}: ${err.message}`));
      w.lastAt = Date.now();
    };
    w.queued = w.tail.then(run);
    w.tail = w.queued;
    return w.queued;
  }

  async flush() {
    await Promise.all([...this.writes.values()].map((w) => w.tail));
  }

  connect(s, memberId) {
    const m = this.online.get(s.code) || new Map();
    m.set(memberId, (m.get(memberId) || 0) + 1);
    this.online.set(s.code, m);
    this.changed(s, { persist: false });
  }

  disconnect(s, memberId) {
    const m = this.online.get(s.code);
    if (!m) return;
    const n = (m.get(memberId) || 1) - 1;
    if (n > 0) m.set(memberId, n);
    else m.delete(memberId);
    if (!m.size) this.online.delete(s.code);
    this.changed(s, { persist: false });
  }

  dropExpired(now = Date.now()) {
    for (const [code, s] of this.sessions) {
      if (s.expiresAt < now && !this.writes.get(code)?.queued) {
        this.sessions.delete(code);
        this.writes.delete(code);
      }
    }
  }
}
