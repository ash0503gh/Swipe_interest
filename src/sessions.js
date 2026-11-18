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

export function createSession({ deck, filters, now = Date.now() }) {
  if (!deck.length) throw new HttpError(400, 'No movies match these filters');
  return { code: newCode(), createdAt: now, expiresAt: now + TTL_MS, filters, deck: deck.slice(0, MAX_DECK), members: [], matches: [] };
}

// Member: { id (public), token (secret), name, joinedAt, swipes: [[movieId, 1|0], ...] in deck order }
export function addMember(s, name, now = Date.now()) {
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
  if (!s.members.every((m) => m.swipes[pos]?.[1] === 1)) return null;
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

export function publicState(s, online = new Set()) {
  return {
    code: s.code,
    expiresAt: s.expiresAt,
    deckSize: s.deck.length,
    members: s.members.map((m) => ({ id: m.id, name: m.name, position: m.swipes.length, online: online.has(m.id) })),
    matches: s.matches,
  };
}

export class SessionHub extends EventEmitter {
  constructor({ saveDelayMs = 5000 } = {}) {
    super();
    this.setMaxListeners(0);
    this.saveDelayMs = saveDelayMs;
    this.sessions = new Map();
    this.saveTimers = new Map();
    this.online = new Map(); // code -> Map(memberId -> open connections)
  }

  async get(code) {
    code = String(code).toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new HttpError(404, 'Session not found');
    let s = this.sessions.get(code);
    if (!s) {
      s = await getJSON(`sessions/${code}.json`);
      if (s) this.sessions.set(code, s);
    }
    if (!s || s.expiresAt < Date.now()) {
      this.sessions.delete(code);
      throw new HttpError(404, 'Session not found or expired');
    }
    return s;
  }

  add(s) {
    this.sessions.set(s.code, s);
    this.changed(s);
  }

  onlineIds(code) {
    return new Set(this.online.get(code)?.keys() || []);
  }

  state(s) {
    return publicState(s, this.onlineIds(s.code));
  }

  changed(s, { persist = true } = {}) {
    this.emit(s.code, this.state(s));
    if (!persist) return;
    clearTimeout(this.saveTimers.get(s.code));
    this.saveTimers.set(s.code, setTimeout(() => this.save(s.code), this.saveDelayMs));
  }

  async save(code) {
    this.saveTimers.delete(code);
    const s = this.sessions.get(code);
    if (s) await putJSON(`sessions/${code}.json`, s).catch((err) => console.error(`save ${code}: ${err.message}`));
  }

  async flush() {
    for (const [code, t] of this.saveTimers) clearTimeout(t);
    await Promise.all([...this.saveTimers.keys()].map((code) => this.save(code)));
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
    for (const [code, s] of this.sessions) if (s.expiresAt < now && !this.saveTimers.has(code)) this.sessions.delete(code);
  }
}
