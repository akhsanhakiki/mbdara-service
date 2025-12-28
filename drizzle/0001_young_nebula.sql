-- Add cogs column as nullable first
ALTER TABLE "product" ADD COLUMN "cogs" numeric(10, 2);--> statement-breakpoint

-- Update existing rows to have a default value of 0
UPDATE "product" SET "cogs" = 0 WHERE "cogs" IS NULL;--> statement-breakpoint

-- Now make the column NOT NULL
ALTER TABLE "product" ALTER COLUMN "cogs" SET NOT NULL;