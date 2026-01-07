CREATE TABLE "expense" (
	"id" serial PRIMARY KEY NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"description" varchar(1000),
	"date" timestamp DEFAULT now() NOT NULL,
	"category" varchar(255),
	"payment_method" varchar(50)
);
--> statement-breakpoint
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'transaction' 
        AND column_name = 'payment_method'
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "transaction" ALTER COLUMN "payment_method" DROP NOT NULL;
    END IF;
END $$;