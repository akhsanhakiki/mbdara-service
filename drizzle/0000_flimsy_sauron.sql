CREATE TABLE IF NOT EXISTS "discount" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"type" varchar(20) NOT NULL,
	"percentage" numeric(5, 2) NOT NULL,
	"product_id" integer,
	CONSTRAINT "discount_code_unique" UNIQUE("code"),
	CONSTRAINT "discount_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action
);
