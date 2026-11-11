import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { localDate } from './time.ts';

export type Role = 'user' | 'assistant';

export interface Turn {
  id: number;
  threadId: string;
  role: Role;
  text: string;
  at: Date;
  localDate: string;
}

export interface NewTurn {
  threadId: string;
  role: Role;
  text: string;
  at: Date;
  timeZone: string;
}

export interface NewClaim {
  entity: string;
  attribute: string;
  value: string;
  asOf: Date;
  sourceUrl?: string | null;
  sourcePublishedAt?: Date | null;
}

export interface Claim {
  id: number;
  turnId: number;
  entity: string;
  attribute: string;
  value: string;
  asOf: Date;
  sourceUrl: string | null;
  superseded: boolean;
}

export interface NewCollection {
  name: string;
  description?: string;
  members: string[];
  turnId: number;
  createdAt?: Date;
}

export interface Collection {
  id: number;
  name: string;
  description: string;
  members: string[];
  createdAt: Date;
}

interface TurnRow {
  id: number;
  thread_id: string;
  role: Role;
  text: string;
  at: number;
  local_date: string;
}

interface ClaimRow {
  id: number;
  turn_id: number;
  entity: string;
  attribute: string;
  value: string;
  as_of: number;
  source_url: string | null;
  superseded_by: number | null;
}

/** Entities and attributes match case- and spacing-insensitively. */
export const normaliseKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const STOPWORDS = new Set(
  ('the and for with what about did you ask asked any has have been since then that this tell told from are was were how our we its ' +
    // Generic words that appear in almost every question; matching on them alone recalls unrelated chats.
    'latest new newest best top current today now price prices pricing cost costs cheap cheapest compare comparison vs much many').split(
    ' ',
  ),
);

/** Meaningful words of a topic, lowercased. */
export function topicWords(topic: string): string[] {
  return topic
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

const CLAIM_SELECT = `SELECT c.id, c.turn_id, e.name AS entity, c.attribute, c.value, c.as_of, c.source_url, c.superseded_by
  FROM claims c JOIN entities e ON e.id = c.entity_id`;

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Opens (and migrates) the memory database. Use ':memory:' in tests. */
export function openMemory(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(schema);

  const toTurn = (r: TurnRow): Turn => ({
    id: r.id,
    threadId: r.thread_id,
    role: r.role,
    text: r.text,
    at: new Date(r.at),
    localDate: r.local_date,
  });

  const toClaim = (r: ClaimRow): Claim => ({
    id: r.id,
    turnId: r.turn_id,
    entity: r.entity,
    attribute: r.attribute,
    value: r.value,
    asOf: new Date(r.as_of),
    sourceUrl: r.source_url,
    superseded: r.superseded_by !== null,
  });

  const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

  const memory = {
    db,

    addTurn(t: NewTurn): Turn {
      const row = db
        .prepare(
          `INSERT INTO turns (thread_id, role, text, at, local_date, time_zone)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
        )
        .get(t.threadId, t.role, t.text, t.at.getTime(), localDate(t.at, t.timeZone), t.timeZone) as unknown as TurnRow;
      return toTurn(row);
    },

    turnsBetween(start: Date, end: Date): Turn[] {
      const rows = db
        .prepare('SELECT * FROM turns WHERE at BETWEEN ? AND ? ORDER BY at, id')
        .all(start.getTime(), end.getTime()) as unknown as TurnRow[];
      return rows.map(toTurn);
    },

    recentTurns(threadId: string, limit = 12): Turn[] {
      const rows = db
        .prepare(
          'SELECT * FROM (SELECT * FROM turns WHERE thread_id = ? ORDER BY at DESC, id DESC LIMIT ?) ORDER BY at, id',
        )
        .all(threadId, limit) as unknown as TurnRow[];
      return rows.map(toTurn);
    },

    /** Calendar days (user-local) that have any turns, closest to `around` first. */
    daysNear(around: Date, limit = 3): string[] {
      const rows = db
        .prepare(
          `SELECT local_date, MIN(ABS(at - ?)) AS distance FROM turns
           GROUP BY local_date ORDER BY distance LIMIT ?`,
        )
        .all(around.getTime(), limit) as unknown as { local_date: string }[];
      return rows.map((r) => r.local_date);
    },

    /** Turns matching any meaningful word of `topic`, best matches first. */
    /** Turns matching the topic's meaningful words: any of them (forgiving), or all of them (precise). */
    searchTurns(topic: string, limit = 12, match: 'any' | 'all' = 'any'): Turn[] {
      const words = topicWords(topic);
      if (words.length === 0) return [];
      const query = words.map((w) => `"${w}"`).join(match === 'all' ? ' AND ' : ' OR ');
      const rows = db
        .prepare(
          `SELECT t.* FROM turns_fts JOIN turns t ON t.id = turns_fts.rowid
           WHERE turns_fts MATCH ? ORDER BY bm25(turns_fts) LIMIT ?`,
        )
        .all(query, limit) as unknown as TurnRow[];
      return rows.map(toTurn);
    },

    /** The other half of an exchange: the reply to a user turn, or the question behind an answer. */
    partnerOf(turn: Turn): Turn | null {
      const sql =
        turn.role === 'user'
          ? `SELECT * FROM turns WHERE thread_id = ? AND role = 'assistant'
             AND (at > ? OR (at = ? AND id > ?)) ORDER BY at, id LIMIT 1`
          : `SELECT * FROM turns WHERE thread_id = ? AND role = 'user'
             AND (at < ? OR (at = ? AND id < ?)) ORDER BY at DESC, id DESC LIMIT 1`;
      const t = turn.at.getTime();
      const row = db.prepare(sql).get(turn.threadId, t, t, turn.id) as unknown as TurnRow | undefined;
      return row ? toTurn(row) : null;
    },

    entityId(name: string): number {
      const row = db
        .prepare(
          'INSERT INTO entities (name, key) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET key = excluded.key RETURNING id',
        )
        .get(name.trim(), normaliseKey(name)) as { id: number };
      return row.id;
    },

    /** Appends claims. An older claim about the same entity and attribute becomes superseded. */
    addClaims(turnId: number, claims: NewClaim[]): void {
      const insert = db.prepare(
        `INSERT INTO claims (turn_id, entity_id, attribute, value, as_of, source_url, source_published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      );
      const supersede = db.prepare(
        `UPDATE claims SET superseded_by = ?
         WHERE entity_id = ? AND attribute = ? AND id != ? AND superseded_by IS NULL AND as_of <= ?`,
      );
      db.exec('BEGIN');
      try {
        for (const c of claims) {
          const entityId = memory.entityId(c.entity);
          const attribute = normaliseKey(c.attribute);
          const { id } = insert.get(
            turnId,
            entityId,
            attribute,
            c.value.trim(),
            c.asOf.getTime(),
            c.sourceUrl ?? null,
            c.sourcePublishedAt?.getTime() ?? null,
          ) as { id: number };
          supersede.run(id, entityId, attribute, id, c.asOf.getTime());
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    claimsForTurns(turnIds: number[]): Claim[] {
      if (turnIds.length === 0) return [];
      const rows = db
        .prepare(`${CLAIM_SELECT} WHERE c.turn_id IN (${placeholders(turnIds.length)}) ORDER BY c.as_of, c.id`)
        .all(...turnIds) as unknown as ClaimRow[];
      return rows.map(toClaim);
    },

    /** The newest claim per attribute for each named entity. */
    latestClaimsFor(entityNames: string[]): Claim[] {
      if (entityNames.length === 0) return [];
      const keys = entityNames.map(normaliseKey);
      const rows = db
        .prepare(
          `${CLAIM_SELECT} WHERE c.superseded_by IS NULL AND e.key IN (${placeholders(keys.length)})
           ORDER BY e.name, c.attribute`,
        )
        .all(...keys) as unknown as ClaimRow[];
      return rows.map(toClaim);
    },

    addCollection(c: NewCollection): Collection {
      const createdAt = c.createdAt ?? new Date();
      const { id } = db
        .prepare(
          'INSERT INTO collections (name, description, created_turn_id, created_at) VALUES (?, ?, ?, ?) RETURNING id',
        )
        .get(c.name.trim(), c.description?.trim() ?? '', c.turnId, createdAt.getTime()) as { id: number };
      const member = db.prepare('INSERT OR IGNORE INTO collection_members (collection_id, entity_id) VALUES (?, ?)');
      for (const name of c.members) member.run(id, memory.entityId(name));
      return memory.collection(id)!;
    },

    collection(id: number): Collection | null {
      const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as
        | { id: number; name: string; description: string; created_at: number }
        | undefined;
      if (!row) return null;
      const members = db
        .prepare(
          `SELECT e.name FROM collection_members m JOIN entities e ON e.id = m.entity_id
           WHERE m.collection_id = ? ORDER BY m.rowid`,
        )
        .all(id) as { name: string }[];
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        members: members.map((m) => m.name),
        createdAt: new Date(row.created_at),
      };
    },

    /** Collections whose name or description mentions a topic word, or that were created in a window. */
    findCollections(opts: { topics?: string[]; windows?: { start: Date; end: Date }[] }): Collection[] {
      const ids = new Set<number>();
      const byWord = db.prepare('SELECT id FROM collections WHERE lower(name) LIKE ? OR lower(description) LIKE ?');
      for (const word of (opts.topics ?? []).flatMap(topicWords)) {
        const like = `%${word}%`;
        for (const r of byWord.all(like, like) as { id: number }[]) ids.add(r.id);
      }
      const byTime = db.prepare('SELECT id FROM collections WHERE created_at BETWEEN ? AND ?');
      for (const w of opts.windows ?? []) {
        for (const r of byTime.all(w.start.getTime(), w.end.getTime()) as { id: number }[]) ids.add(r.id);
      }
      return [...ids].sort((a, b) => b - a).map((id) => memory.collection(id)!);
    },

    /** Removes a thread and everything derived from it (claims, collections). Used to re-seed cleanly. */
    deleteThread(threadId: string): number {
      const turns = db.prepare('SELECT id, text FROM turns WHERE thread_id = ?').all(threadId) as { id: number; text: string }[];
      db.exec('BEGIN');
      try {
        for (const t of turns) {
          const claimIds = db.prepare('SELECT id FROM claims WHERE turn_id = ?').all(t.id) as { id: number }[];
          for (const c of claimIds) db.prepare('UPDATE claims SET superseded_by = NULL WHERE superseded_by = ?').run(c.id);
          db.prepare('DELETE FROM claims WHERE turn_id = ?').run(t.id);
          const cols = db.prepare('SELECT id FROM collections WHERE created_turn_id = ?').all(t.id) as { id: number }[];
          for (const c of cols) {
            db.prepare('DELETE FROM collection_members WHERE collection_id = ?').run(c.id);
            db.prepare('DELETE FROM collections WHERE id = ?').run(c.id);
          }
          db.prepare("INSERT INTO turns_fts (turns_fts, rowid, text) VALUES ('delete', ?, ?)").run(t.id, t.text);
          db.prepare('DELETE FROM turns WHERE id = ?').run(t.id);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return turns.length;
    },

    cacheGet(key: string, now = Date.now()): string | null {
      const row = db.prepare('SELECT value FROM search_cache WHERE key = ? AND expires_at > ?').get(key, now) as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    },

    cacheSet(key: string, value: string, ttlMs: number, now = Date.now()): void {
      db.prepare(
        `INSERT INTO search_cache (key, value, fetched_at, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
      ).run(key, value, now, now + ttlMs);
    },

    close() {
      db.close();
    },
  };

  return memory;
}

export type Memory = ReturnType<typeof openMemory>;
