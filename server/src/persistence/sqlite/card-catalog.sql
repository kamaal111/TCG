CREATE TABLE catalog_version (id TEXT NOT NULL PRIMARY KEY);
CREATE TABLE printing (
  id INTEGER PRIMARY KEY, game TEXT NOT NULL, pricing_id TEXT NOT NULL, provider_id TEXT NOT NULL,
  language TEXT NOT NULL, names TEXT NOT NULL, name_tokens TEXT NOT NULL, set_tokens TEXT NOT NULL,
  set_ids TEXT NOT NULL, set_key TEXT NOT NULL, set_name TEXT, primary_set INTEGER NOT NULL,
  collector_number TEXT NOT NULL, printed_number TEXT NOT NULL,
  UNIQUE(game, pricing_id, set_key)
) STRICT;
CREATE INDEX printing_provider ON printing(game, provider_id);
CREATE INDEX printing_collector ON printing(game, collector_number);
CREATE INDEX printing_number ON printing(game, printed_number);
CREATE VIRTUAL TABLE catalog_fts USING fts5(name_tokens, set_tokens, content='printing',
  content_rowid='id', tokenize='ascii', prefix='2 3');
