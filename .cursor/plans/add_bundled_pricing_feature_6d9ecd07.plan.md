---
name: Add Bundled Pricing Feature
overview: Add bundled pricing functionality where products can have bundle_quantity and bundle_price fields directly in the products table. When customers purchase quantities that don't exactly match the bundle, the system will apply the best combination (e.g., 15 items = 1 bundle of 10 + 5 individual items).
todos:
  - id: update_schema
    content: Add bundle_quantity (nullable integer) and bundle_price (nullable decimal) fields to products table in schema.ts
    status: pending
  - id: create_migration
    content: Create migration file to add bundle_quantity and bundle_price columns to product table as nullable (handles existing data)
    status: pending
    dependencies:
      - update_schema
  - id: update_product_types
    content: Update ProductCreate, ProductRead, and ProductUpdate schemas in types/index.ts to include optional bundle_quantity and bundle_price fields
    status: pending
  - id: update_products_router
    content: Update products.ts router to handle bundle_quantity and bundle_price in create, read, and update operations
    status: pending
    dependencies:
      - update_product_types
      - update_schema
  - id: update_transaction_logic
    content: Update transaction creation logic to check bundle_quantity and bundle_price from product and calculate best combination (bundles + remaining individual items)
    status: pending
    dependencies:
      - update_schema
---

# Add Bundled Pricing Feature

## Overview

Implement bundled pricing by adding `bundle_quantity` and `bundle_price` fields directly to the `products` table. Products can optionally have bundle pricing (e.g., buy 10 items for IDR 90,000 instead of IDR 100,000). The system will automatically apply the best combination when quantities don't exactly match bundles.

## Database Changes

### Update `product` Table

Add two new nullable columns to the existing `product` table:
- `bundle_quantity`: integer (nullable) - The quantity required for the bundle (e.g., 10)
- `bundle_price`: decimal(10, 2) (nullable) - The total price for the bundle quantity (e.g., 90,000 for 10 items)

**Migration Strategy**: 
- Add columns as nullable to preserve existing data
- Existing products will have `NULL` values for bundle fields (no bundle pricing)
- Products can be updated later to add bundle pricing

**Migration File**: `drizzle/0002_*.sql`
```sql
-- Add bundle_quantity column as nullable
ALTER TABLE "product" ADD COLUMN "bundle_quantity" integer;

-- Add bundle_price column as nullable  
ALTER TABLE "product" ADD COLUMN "bundle_price" numeric(10, 2);
```

## Schema Updates

### Update `src/db/schema.ts`

Add to the `products` table definition:
- `bundleQuantity: integer("bundle_quantity")`
- `bundlePrice: decimal("bundle_price", { precision: 10, scale: 2 })`

No new table or relations needed.

## Type Definitions

### Update `src/types/index.ts`

Update existing product schemas:
- `ProductCreate`: Add optional `bundle_quantity?: number` and `bundle_price?: number`
- `ProductRead`: Add optional `bundle_quantity?: number | null` and `bundle_price?: number | null`
- `ProductUpdate`: Add optional `bundle_quantity?: number` and `bundle_price?: number`

## API Updates

### Update `src/routes/products.ts`

Modify existing endpoints to handle bundle fields:
- `POST /products`: Accept and store `bundle_quantity` and `bundle_price` in request body
- `GET /products` and `GET /products/:id`: Return `bundle_quantity` and `bundle_price` in response
- `PATCH /products/:id`: Allow updating `bundle_quantity` and `bundle_price`

**Validation**: 
- If `bundle_price` is provided, `bundle_quantity` should also be provided (and vice versa), or both should be null/undefined
- `bundle_quantity` should be > 0 if provided
- `bundle_price` should be > 0 if provided

## Transaction Logic Updates

### Update `src/routes/transactions.ts`

Modify the transaction creation logic in the `POST /transactions` endpoint:

1. **Check bundle pricing**: For each item, check if the product has `bundle_quantity` and `bundle_price` set (not null)
2. **Calculate bundle pricing**: For each item:
   - If product has bundle pricing AND `quantity >= bundle_quantity`:
     - Calculate number of bundles: `Math.floor(quantity / bundle_quantity)`
     - Calculate remaining items: `quantity % bundle_quantity`
     - Bundle total: `bundles * bundle_price`
     - Individual total: `remaining * individual_price`
     - Item total: `bundle_total + individual_total`
   - Otherwise (no bundle pricing OR `quantity < bundle_quantity`):
     - Use regular pricing: `quantity * individual_price`
3. **Store pricing**: Store the calculated total price in `transactionItems.price` (total price for that line item)

## Example Calculation Flow

For Product A (IDR 10,000 each, bundle: 10 for IDR 90,000):
- Customer buys 15 items:
  - Bundles: `Math.floor(15 / 10) = 1` → 1 × 90,000 = 90,000
  - Remaining: `15 % 10 = 5` → 5 × 10,000 = 50,000
  - Total: 90,000 + 50,000 = 140,000

- Customer buys 7 items:
  - No bundle applied (7 < 10)
  - Total: 7 × 10,000 = 70,000

- Customer buys 10 items:
  - Bundles: `Math.floor(10 / 10) = 1` → 1 × 90,000 = 90,000
  - Remaining: `10 % 10 = 0` → 0 × 10,000 = 0
  - Total: 90,000

## Files to Modify

1. **Modified files**:
   - `src/db/schema.ts` - Add bundle_quantity and bundle_price to products table
   - `drizzle/0002_*.sql` - Migration to add bundle columns (nullable)
   - `src/types/index.ts` - Add bundle fields to product schemas
   - `src/routes/products.ts` - Handle bundle fields in CRUD operations
   - `src/routes/transactions.ts` - Update price calculation logic to use bundle pricing

## Migration Handling for Existing Data

The migration adds nullable columns, so:
- All existing products will have `NULL` for `bundle_quantity` and `bundle_price`
- Existing products continue to work with regular pricing
- Products can be updated via PATCH endpoint to add bundle pricing
- No data loss or breaking changes
