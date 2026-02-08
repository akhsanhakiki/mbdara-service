CREATE TABLE "product_variation" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"name" varchar(255),
	"description" varchar(1000),
	"price" numeric(10, 2) NOT NULL,
	"cogs" numeric(10, 0) NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"bundle_quantity" integer,
	"bundle_price" numeric(10, 0)
);
--> statement-breakpoint
ALTER TABLE "transactionitem" ADD COLUMN "product_variation_id" integer;--> statement-breakpoint
ALTER TABLE "product_variation" ADD CONSTRAINT "product_variation_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactionitem" ADD CONSTRAINT "transactionitem_product_variation_id_product_variation_id_fk" FOREIGN KEY ("product_variation_id") REFERENCES "public"."product_variation"("id") ON DELETE no action ON UPDATE no action;