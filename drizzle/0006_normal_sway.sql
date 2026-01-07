DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'transaction' 
        AND column_name = 'payment_method'
    ) THEN
        ALTER TABLE "transaction" ADD COLUMN "payment_method" varchar(50) NOT NULL;
    END IF;
END $$;