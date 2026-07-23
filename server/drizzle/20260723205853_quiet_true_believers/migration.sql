CREATE TABLE "card_price" (
	"id" text PRIMARY KEY,
	"game" "card_game" NOT NULL,
	"tcggo_card_id" text NOT NULL,
	"card_number" text NOT NULL,
	"name" text NOT NULL,
	"priced_on" date NOT NULL,
	"prices" jsonb NOT NULL,
	"raw" jsonb,
	"source" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_price_search" (
	"id" text PRIMARY KEY,
	"game" "card_game" NOT NULL,
	"query_key" text NOT NULL,
	"priced_on" date NOT NULL,
	"tcggo_card_ids" jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "tcggo_card_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "card_price_game_tcggoCardId_pricedOn_idx" ON "card_price" ("game","tcggo_card_id","priced_on");--> statement-breakpoint
CREATE INDEX "card_price_game_cardNumber_pricedOn_idx" ON "card_price" ("game","card_number","priced_on");--> statement-breakpoint
CREATE UNIQUE INDEX "card_price_search_game_queryKey_pricedOn_idx" ON "card_price_search" ("game","query_key","priced_on");