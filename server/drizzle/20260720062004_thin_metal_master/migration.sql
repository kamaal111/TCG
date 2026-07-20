CREATE TYPE "card_condition" AS ENUM('mint', 'near_mint', 'excellent', 'good', 'played', 'damaged');--> statement-breakpoint
CREATE TYPE "card_game" AS ENUM('one_piece', 'pokemon');--> statement-breakpoint
CREATE TABLE "card" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"game" "card_game" NOT NULL,
	"name" text NOT NULL,
	"set_name" text NOT NULL,
	"card_number" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE INDEX "card_userId_createdAt_idx" ON "card" ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "card_condition_quantity_cardId_condition_idx" ON "card_condition_quantity" ("card_id","condition");--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "card_condition_quantity" ADD CONSTRAINT "card_condition_quantity_card_id_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE CASCADE;