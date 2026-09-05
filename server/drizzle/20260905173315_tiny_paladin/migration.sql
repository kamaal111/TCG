CREATE TYPE "card_image_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
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
	"last_attempted_at" timestamp,
	"stored_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_image_ready_metadata_check" CHECK ("status" <> 'ready' OR ("content_type" IS NOT NULL AND "content_length" IS NOT NULL AND "checksum" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "card_image_image_key_idx" ON "card_image" ("image_key");--> statement-breakpoint
CREATE INDEX "card_image_status_last_attempted_at_idx" ON "card_image" ("status","last_attempted_at");