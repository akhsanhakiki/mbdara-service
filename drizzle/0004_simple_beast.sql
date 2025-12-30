-- Round existing cogs values
UPDATE "product" SET "cogs" = ROUND("cogs");--> statement-breakpoint

-- Round existing bundle_price values
UPDATE "product" SET "bundle_price" = ROUND("bundle_price") WHERE "bundle_price" IS NOT NULL;--> statement-breakpoint

-- Alter column types from numeric(10, 2) to numeric(10, 0)
ALTER TABLE "product" ALTER COLUMN "cogs" SET DATA TYPE numeric(10, 0);--> statement-breakpoint
ALTER TABLE "product" ALTER COLUMN "bundle_price" SET DATA TYPE numeric(10, 0);