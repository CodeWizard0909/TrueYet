-- One local SQLite file holds all memory. See docs/adr/0002 and 0003.

CREATE TABLE IF NOT EXISTS turns (
  id          INTEGER PRIMARY KEY,
  thread_id   TEXT    NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  text        TEXT    NOT NULL,
  at          INTEGER NOT NULL,  -- epoch ms, UTC
  local_date  TEXT    NOT NULL,  -- YYYY-MM-DD in the user's timezone when sent
  time_zone   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS turns_at ON turns (at);
CREATE INDEX IF NOT EXISTS turns_thread ON turns (thread_id, at);

CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5 (
  text, content = 'turns', content_rowid = 'id', tokenize = 'porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns BEGIN
  INSERT INTO turns_fts (rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS entities (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  key      TEXT NOT NULL UNIQUE,  -- normalised name for matching
  kind     TEXT NOT NULL DEFAULT 'thing',
  aliases  TEXT NOT NULL DEFAULT '[]'  -- JSON array
);

CREATE TABLE IF NOT EXISTS claims (
  id                   INTEGER PRIMARY KEY,
  turn_id              INTEGER NOT NULL REFERENCES turns (id),
  entity_id            INTEGER NOT NULL REFERENCES entities (id),
  attribute            TEXT    NOT NULL,
  value                TEXT    NOT NULL,
  as_of                INTEGER NOT NULL,  -- epoch ms: when this was observed true
  source_url           TEXT,
  source_published_at  INTEGER,
  superseded_by        INTEGER REFERENCES claims (id)
);
CREATE INDEX IF NOT EXISTS claims_entity ON claims (entity_id, attribute, as_of);
CREATE INDEX IF NOT EXISTS claims_turn ON claims (turn_id);

CREATE TABLE IF NOT EXISTS collections (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  created_turn_id  INTEGER NOT NULL REFERENCES turns (id),
  created_at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_members (
  collection_id  INTEGER NOT NULL REFERENCES collections (id),
  entity_id      INTEGER NOT NULL REFERENCES entities (id),
  PRIMARY KEY (collection_id, entity_id)
);

CREATE TABLE IF NOT EXISTS search_cache (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL,
  fetched_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
