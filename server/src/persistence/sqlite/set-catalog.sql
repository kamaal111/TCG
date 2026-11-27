CREATE TABLE expansion (
  game TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, aliases TEXT NOT NULL,
  code TEXT, language TEXT, release_date TEXT, logo TEXT, symbol TEXT,
  PRIMARY KEY (game, id)
) STRICT;
CREATE TABLE set_printing (
  game TEXT NOT NULL, set_id TEXT NOT NULL, pricing_id TEXT NOT NULL,
  number TEXT NOT NULL, name TEXT NOT NULL, printed_number TEXT NOT NULL, image TEXT,
  PRIMARY KEY (game, set_id, pricing_id),
  FOREIGN KEY (game, set_id) REFERENCES expansion(game, id)
) STRICT;
CREATE INDEX set_printing_number ON set_printing(game, set_id, number);
CREATE INDEX set_printing_identity ON set_printing(game, pricing_id, set_id);
