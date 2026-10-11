DROP INDEX "card_userId_createdAt_idx";--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "import_source_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "card_userId_importSourceId_idx" ON "card" ("user_id","import_source_id");--> statement-breakpoint
CREATE INDEX "card_userId_createdAt_id_idx" ON "card" ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);