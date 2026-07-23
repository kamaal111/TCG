ALTER TABLE "card_price" RENAME COLUMN "tcggo_card_id" TO "pricing_card_id";--> statement-breakpoint
ALTER TABLE "card_price" RENAME COLUMN "source" TO "pricing_source";--> statement-breakpoint
ALTER TABLE "card_price_search" RENAME COLUMN "tcggo_card_ids" TO "pricing_card_ids";--> statement-breakpoint
ALTER TABLE "card" RENAME COLUMN "tcggo_card_id" TO "pricing_card_id";--> statement-breakpoint
UPDATE "card_price"
SET "pricing_source" = CASE "pricing_source"
	WHEN 'static' THEN 'tcggo_static'
	WHEN 'real' THEN 'tcggo_real'
	ELSE 'tcggo_legacy'
END;--> statement-breakpoint
DROP INDEX "card_price_game_tcggoCardId_pricedOn_idx";--> statement-breakpoint
DROP INDEX "card_price_game_cardNumber_pricedOn_idx";--> statement-breakpoint
DROP INDEX "card_price_search_game_queryKey_pricedOn_idx";--> statement-breakpoint
ALTER TABLE "card_price_search" ADD COLUMN "pricing_source" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "pricing_source" text;--> statement-breakpoint
UPDATE "card_price_search" SET "pricing_source" = 'tcggo_legacy';--> statement-breakpoint
ALTER TABLE "card_price_search" ALTER COLUMN "pricing_source" SET NOT NULL;--> statement-breakpoint
UPDATE "card" SET "pricing_source" = 'tcggo_legacy' WHERE "pricing_card_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "card_price_source_game_cardId_pricedOn_idx" ON "card_price" ("pricing_source","game","pricing_card_id","priced_on");--> statement-breakpoint
CREATE INDEX "card_price_source_game_cardNumber_pricedOn_idx" ON "card_price" ("pricing_source","game","card_number","priced_on");--> statement-breakpoint
CREATE UNIQUE INDEX "card_price_search_source_game_queryKey_pricedOn_idx" ON "card_price_search" ("pricing_source","game","query_key","priced_on");--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_pricing_identity_pair_check" CHECK (("pricing_card_id" is null and "pricing_source" is null) or ("pricing_card_id" is not null and "pricing_source" is not null));
