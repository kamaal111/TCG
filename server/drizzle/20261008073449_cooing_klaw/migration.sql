CREATE TABLE "card_purchase_batch" (
	"id" text PRIMARY KEY,
	"card_id" text NOT NULL,
	"condition" "card_condition" NOT NULL,
	"quantity" integer NOT NULL,
	"purchase_price" numeric(20,6),
	"currency" text,
	"automatic_price_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_purchase_batch_quantity_check" CHECK ("quantity" between 1 and 999),
	CONSTRAINT "card_purchase_batch_price_check" CHECK ("purchase_price" >= 0 and "purchase_price" < 'Infinity'::numeric),
	CONSTRAINT "card_purchase_batch_currency_check" CHECK ("currency" in ('USD', 'JPY')),
	CONSTRAINT "card_purchase_batch_price_pair_check" CHECK (("purchase_price" is null) = ("currency" is null)),
	CONSTRAINT "card_purchase_batch_date_check" CHECK ("automatic_price_date" is null or "purchase_price" is not null)
);
--> statement-breakpoint
CREATE INDEX "card_purchase_batch_cardId_idx" ON "card_purchase_batch" ("card_id");--> statement-breakpoint
ALTER TABLE "card_purchase_batch" ADD CONSTRAINT "card_purchase_batch_card_id_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "card_purchase_batch" ("id", "card_id", "condition", "quantity", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "card_id", "condition", "quantity", "created_at", "updated_at"
FROM "card_condition_quantity";
