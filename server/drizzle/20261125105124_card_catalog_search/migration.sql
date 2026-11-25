CREATE TABLE "card_catalog_generation" (
	"id" uuid PRIMARY KEY,
	"source" text NOT NULL,
	"game" "card_game" NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"printing_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_catalog_printing" (
	"generation" uuid,
	"pricing_id" text,
	"provider_id" text NOT NULL,
	"language" text NOT NULL,
	"names" text[] NOT NULL,
	"name_tokens" text[] NOT NULL,
	"set_tokens" text[] NOT NULL,
	"set_key" text,
	"set_name" text,
	"primary_set" boolean NOT NULL,
	"set_ids" text[] NOT NULL,
	"collector_number" text NOT NULL,
	"printed_number" text NOT NULL,
	CONSTRAINT "card_catalog_printing_pkey" PRIMARY KEY("generation","pricing_id","set_key")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "card_catalog_active_idx" ON "card_catalog_generation" ("source","game") WHERE "superseded_at" is null;--> statement-breakpoint
CREATE INDEX "card_catalog_terms_idx" ON "card_catalog_printing" USING gin (array_to_tsvector("name_tokens" || "set_tokens"));--> statement-breakpoint
CREATE INDEX "card_catalog_provider_idx" ON "card_catalog_printing" ("generation","provider_id");--> statement-breakpoint
CREATE INDEX "card_catalog_collector_idx" ON "card_catalog_printing" ("generation","collector_number");--> statement-breakpoint
CREATE INDEX "card_catalog_printed_idx" ON "card_catalog_printing" ("generation","printed_number");--> statement-breakpoint
ALTER TABLE "card_catalog_printing" ADD CONSTRAINT "card_catalog_printing_HCDU71IWzA0J_fkey" FOREIGN KEY ("generation") REFERENCES "card_catalog_generation"("id") ON DELETE CASCADE;