ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account"
SET "issuer" = 'local:credential'
WHERE "provider_id" = 'credential';--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" ("issuer","account_id");
