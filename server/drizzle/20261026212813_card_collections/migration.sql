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
