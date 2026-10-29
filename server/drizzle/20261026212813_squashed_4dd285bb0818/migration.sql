CREATE TYPE "card_image_status" AS ENUM('pending', 'fetching', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "card_condition" AS ENUM('mint', 'near_mint', 'excellent', 'good', 'played', 'damaged');--> statement-breakpoint
CREATE TYPE "card_game" AS ENUM('one_piece', 'pokemon');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"issuer" text,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" text PRIMARY KEY,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_image" (
	"image_key" text PRIMARY KEY,
	"origin_url" text NOT NULL,
	"storage_key" text NOT NULL,
	"status" "card_image_status" DEFAULT 'pending'::"card_image_status" NOT NULL,
	"content_type" text,
	"content_length" integer,
	"checksum" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_error_code" text,
	"last_attempted_at" timestamp,
	"next_attempt_at" timestamp,
	"lease_owner" text,
	"lease_expires_at" timestamp,
	"stored_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_image_ready_metadata_check" CHECK ("status" <> 'ready' OR ("content_type" IS NOT NULL AND "content_length" IS NOT NULL AND "checksum" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "card_price" (
	"id" text PRIMARY KEY,
	"game" "card_game" NOT NULL,
	"pricing_card_id" text NOT NULL,
	"card_number" text NOT NULL,
	"name" text NOT NULL,
	"priced_on" date NOT NULL,
	"prices" jsonb NOT NULL,
	"raw" jsonb,
	"pricing_source" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_price_search" (
	"id" text PRIMARY KEY,
	"game" "card_game" NOT NULL,
	"query_key" text NOT NULL,
	"priced_on" date NOT NULL,
	"pricing_card_ids" jsonb NOT NULL,
	"pricing_source" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card" (
	"id" text PRIMARY KEY,
	"import_source_id" text,
	"user_id" text NOT NULL,
	"game" "card_game" NOT NULL,
	"name" text NOT NULL,
	"set_name" text NOT NULL,
	"card_number" text NOT NULL,
	"pricing_card_id" text,
	"pricing_source" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_pricing_identity_pair_check" CHECK (("pricing_card_id" is null and "pricing_source" is null) or ("pricing_card_id" is not null and "pricing_source" is not null))
);
--> statement-breakpoint
CREATE TABLE "card_condition_quantity" (
	"id" text PRIMARY KEY,
	"card_id" text NOT NULL,
	"condition" "card_condition" NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	CONSTRAINT "card_purchase_batch_currency_check" CHECK ("currency" in ('EUR', 'USD', 'JPY', 'CZK', 'DKK', 'GBP', 'HUF', 'PLN', 'RON', 'SEK', 'CHF', 'ISK', 'NOK', 'TRY', 'AUD', 'BRL', 'CAD', 'CNY', 'HKD', 'IDR', 'ILS', 'INR', 'KRW', 'MXN', 'MYR', 'NZD', 'PHP', 'SGD', 'THB', 'ZAR')),
	CONSTRAINT "card_purchase_batch_price_pair_check" CHECK (("purchase_price" is null) = ("currency" is null)),
	CONSTRAINT "card_purchase_batch_date_check" CHECK ("automatic_price_date" is null or "purchase_price" is not null)
);
--> statement-breakpoint
CREATE TABLE "exchange_rate" (
	"date" date PRIMARY KEY,
	"rates" jsonb NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY,
	"preferred_currency" text NOT NULL,
	CONSTRAINT "user_preferences_currency_check" CHECK ("preferred_currency" in ('EUR', 'USD', 'JPY', 'CZK', 'DKK', 'GBP', 'HUF', 'PLN', 'RON', 'SEK', 'CHF', 'ISK', 'NOK', 'TRY', 'AUD', 'BRL', 'CAD', 'CNY', 'HKD', 'IDR', 'ILS', 'INR', 'KRW', 'MXN', 'MYR', 'NZD', 'PHP', 'SGD', 'THB', 'ZAR'))
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "card_image_image_key_idx" ON "card_image" ("image_key");--> statement-breakpoint
CREATE INDEX "card_image_work_queue_idx" ON "card_image" ("status","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "card_image_claim_order_idx" ON "card_image" (coalesce("next_attempt_at", "created_at"),"image_key") WHERE "status" <> 'ready';--> statement-breakpoint
CREATE INDEX "card_image_fetching_lease_idx" ON "card_image" ("lease_expires_at") WHERE "status" = 'fetching';--> statement-breakpoint
CREATE UNIQUE INDEX "card_price_source_game_cardId_pricedOn_idx" ON "card_price" ("pricing_source","game","pricing_card_id","priced_on");--> statement-breakpoint
CREATE INDEX "card_price_source_game_cardNumber_pricedOn_idx" ON "card_price" ("pricing_source","game","card_number","priced_on");--> statement-breakpoint
CREATE UNIQUE INDEX "card_price_search_source_game_queryKey_pricedOn_idx" ON "card_price_search" ("pricing_source","game","query_key","priced_on");--> statement-breakpoint
CREATE UNIQUE INDEX "card_userId_importSourceId_idx" ON "card" ("user_id","import_source_id");--> statement-breakpoint
CREATE INDEX "card_userId_createdAt_id_idx" ON "card" ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "card_condition_quantity_cardId_condition_idx" ON "card_condition_quantity" ("card_id","condition");--> statement-breakpoint
CREATE INDEX "card_purchase_batch_cardId_idx" ON "card_purchase_batch" ("card_id");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "card_condition_quantity" ADD CONSTRAINT "card_condition_quantity_card_id_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "card_purchase_batch" ADD CONSTRAINT "card_purchase_batch_card_id_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "card_condition_quantity" DROP CONSTRAINT "card_condition_quantity_card_id_card_id_fkey";
--> statement-breakpoint
ALTER TABLE "card_purchase_batch" DROP CONSTRAINT "card_purchase_batch_card_id_card_id_fkey";
--> statement-breakpoint
CREATE TABLE "binder_page" (
	"id" uuid PRIMARY KEY,
	"collection_id" uuid NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "binder_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"page_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"row" integer NOT NULL,
	"column" integer NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "binder_slot_positive_check" CHECK ("row" > 0 and "column" > 0 and "quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "card_collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"import_source_id" uuid,
	"name" text NOT NULL,
	"is_unfiled" boolean DEFAULT false NOT NULL,
	"columns" integer DEFAULT 3 NOT NULL,
	"rows" integer DEFAULT 3 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "collection_dimensions_check" CHECK ("columns" between 1 and 20 and "rows" between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "collection_id" uuid;--> statement-breakpoint
ALTER TABLE "card" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "card" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "card" ALTER COLUMN "import_source_id" SET DATA TYPE uuid USING "import_source_id"::uuid;--> statement-breakpoint
ALTER TABLE "card_condition_quantity" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "card_condition_quantity" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "card_condition_quantity" ALTER COLUMN "card_id" SET DATA TYPE uuid USING "card_id"::uuid;--> statement-breakpoint
ALTER TABLE "card_purchase_batch" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "card_purchase_batch" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "card_purchase_batch" ALTER COLUMN "card_id" SET DATA TYPE uuid USING "card_id"::uuid;--> statement-breakpoint
DROP INDEX "card_purchase_batch_cardId_idx";--> statement-breakpoint
CREATE INDEX "card_purchase_batch_cardId_idx" ON "card_purchase_batch" ("card_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "binder_page_position_idx" ON "binder_page" ("collection_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "binder_slot_position_idx" ON "binder_slot" ("page_id","row","column");--> statement-breakpoint
CREATE INDEX "binder_slot_card_idx" ON "binder_slot" ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_id_user_idx" ON "card" ("id","user_id");--> statement-breakpoint
CREATE INDEX "card_user_collection_idx" ON "card" ("user_id","collection_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "collection_user_id_idx" ON "card_collection" ("user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_id_user_idx" ON "card_collection" ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_user_source_idx" ON "card_collection" ("user_id","import_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_user_unfiled_idx" ON "card_collection" ("user_id") WHERE "is_unfiled";--> statement-breakpoint
ALTER TABLE "binder_page" ADD CONSTRAINT "binder_page_collection_id_card_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "card_collection"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "binder_slot" ADD CONSTRAINT "binder_slot_page_id_binder_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "binder_page"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "binder_slot" ADD CONSTRAINT "binder_slot_card_id_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_collection_id_user_id_card_collection_id_user_id_fkey" FOREIGN KEY ("collection_id","user_id") REFERENCES "card_collection"("id","user_id");--> statement-breakpoint
ALTER TABLE "card_collection" ADD CONSTRAINT "card_collection_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "card_condition_quantity" ADD CONSTRAINT "card_condition_quantity_card_id_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "card_purchase_batch" ADD CONSTRAINT "card_purchase_batch_card_id_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE CASCADE;
--> statement-breakpoint
INSERT INTO "card_collection" ("user_id", "name", "is_unfiled")
SELECT "id", 'Unfiled', true FROM "user";
