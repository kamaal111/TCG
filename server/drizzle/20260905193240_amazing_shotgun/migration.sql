ALTER TYPE "card_image_status" ADD VALUE 'fetching' BEFORE 'ready';--> statement-breakpoint
DROP INDEX "card_image_status_last_attempted_at_idx";--> statement-breakpoint
ALTER TABLE "card_image" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "card_image" ADD COLUMN "next_attempt_at" timestamp;--> statement-breakpoint
UPDATE "card_image" SET "next_attempt_at" = now() WHERE "status" = 'failed';--> statement-breakpoint
ALTER TABLE "card_image" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "card_image" ADD COLUMN "lease_expires_at" timestamp;--> statement-breakpoint
CREATE INDEX "card_image_work_queue_idx" ON "card_image" ("status","next_attempt_at","lease_expires_at");
