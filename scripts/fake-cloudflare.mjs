// Minimal stand-ins for Cloudflare D1 (backed by node:sqlite) and KV, for offline tests.
import { DatabaseSync } from 'node:sqlite';

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args); }
  #norm() {
    // D1 supports ?1 style params; node:sqlite does too when given an object or positional array.
    return this.args.map((a) => (a === undefined ? null : a));
  }
  async first() { return this.db.prepare(this.sql).get(...this.#norm()) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.#norm()) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.#norm()); return { success: true, meta: { changes: Number(r.changes) } }; }
}

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  return {
    prepare: (sql) => new Stmt(db, sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

export function fakeKV() {
  const store = new Map();
  return {
    _store: store,
    async put(k, v, opts = {}) { store.set(k, { v: v instanceof ArrayBuffer ? v : new Uint8Array(v).buffer, metadata: opts.metadata || null }); },
    async delete(k) { store.delete(k); },
    async getWithMetadata(k) { const e = store.get(k); return e ? { value: e.v, metadata: e.metadata } : { value: null, metadata: null }; },
  };
}

export const fakeEnv = () => ({ DB: fakeD1(), COVERS: fakeKV() });
