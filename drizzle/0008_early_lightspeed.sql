-- Only add the organization_id column to transaction table
-- The neon_auth schema and tables already exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'transaction' 
        AND column_name = 'organization_id'
    ) THEN
        ALTER TABLE "transaction" ADD COLUMN "organization_id" text;
    END IF;
END $$;