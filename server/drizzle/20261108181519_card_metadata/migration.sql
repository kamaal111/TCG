CREATE TABLE "card_metadata" (
	"pricing_source" text,
	"game" "card_game",
	"pricing_card_id" text,
	"illustrator" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_metadata_pkey" PRIMARY KEY("pricing_source","game","pricing_card_id")
);

--> statement-breakpoint
INSERT INTO "card_metadata" ("pricing_source", "game", "pricing_card_id", "illustrator", "updated_at")
SELECT DISTINCT ON (pricing_source, game, pricing_card_id)
  pricing_source, game, pricing_card_id, illustrator, fetched_at
FROM (
  SELECT pricing_source, game, pricing_card_id, priced_on, fetched_at,
    coalesce(
      CASE WHEN jsonb_typeof(prices->'illustrator') = 'string'
        THEN nullif(btrim(prices->>'illustrator'), '') END,
      CASE WHEN jsonb_typeof(raw->'artist') = 'string'
        THEN nullif(btrim(raw->>'artist'), '') END
    ) AS illustrator
  FROM card_price
) AS cached_metadata
WHERE illustrator IS NOT NULL
ORDER BY pricing_source, game, pricing_card_id, priced_on DESC, fetched_at DESC;
