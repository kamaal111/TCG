CREATE TABLE "wishlist" (
	"user_id" text,
	"printing_key" text,
	"card" jsonb NOT NULL,
	"saved_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_pkey" PRIMARY KEY("user_id","printing_key")
);
--> statement-breakpoint
CREATE INDEX "wishlist_user_saved_at_idx" ON "wishlist" ("user_id","saved_at" DESC NULLS LAST,"printing_key" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "wishlist" ADD CONSTRAINT "wishlist_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;