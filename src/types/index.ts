import { t } from "elysia";

// Product schemas
export const ProductCreate = t.Object({
  name: t.String(),
  price: t.Number(),
  cogs: t.Number(),
  description: t.Optional(t.String()),
  stock: t.Optional(t.Number({ default: 0 })),
  bundle_quantity: t.Optional(t.Number({ minimum: 1 })),
  bundle_price: t.Optional(t.Number({ minimum: 0 })),
});

export const ProductRead = t.Object({
  id: t.Number(),
  name: t.String(),
  price: t.Number(),
  cogs: t.Number(),
  description: t.Nullable(t.String()),
  stock: t.Number(),
  bundle_quantity: t.Nullable(t.Number()),
  bundle_price: t.Nullable(t.Number()),
});

export const ProductUpdate = t.Object({
  name: t.Optional(t.String()),
  price: t.Optional(t.Number()),
  cogs: t.Optional(t.Number()),
  description: t.Optional(t.String()),
  stock: t.Optional(t.Number()),
  bundle_quantity: t.Optional(t.Number({ minimum: 1 })),
  bundle_price: t.Optional(t.Number({ minimum: 0 })),
});

// TransactionItem schemas
export const TransactionItemCreate = t.Object({
  product_id: t.Number(),
  quantity: t.Number(),
});

export const TransactionItemRead = t.Object({
  id: t.Number(),
  quantity: t.Number(),
  price: t.Number(),
  product_id: t.Number(),
  transaction_id: t.Nullable(t.Number()),
  product_name: t.String(),
});

// Transaction schemas
export const TransactionCreate = t.Object({
  items: t.Array(TransactionItemCreate),
  created_at: t.Optional(t.Date()),
  discount_code: t.Optional(t.String()),
});

export const TransactionRead = t.Object({
  id: t.Number(),
  total_amount: t.Number(),
  created_at: t.Date(),
  items: t.Array(TransactionItemRead),
});

// Discount schemas
export const DiscountCreate = t.Object({
  name: t.String(),
  code: t.String(),
  type: t.Union([t.Literal("individual_item"), t.Literal("for_all_item")]),
  percentage: t.Number({ minimum: 0, maximum: 100 }),
  product_id: t.Optional(t.Number()), // Required when type is 'individual_item'
});

export const DiscountRead = t.Object({
  id: t.Number(),
  name: t.String(),
  code: t.String(),
  type: t.String(),
  percentage: t.Number(),
  product_id: t.Nullable(t.Number()),
});

export const DiscountUpdate = t.Object({
  name: t.Optional(t.String()),
  code: t.Optional(t.String()),
  type: t.Optional(
    t.Union([t.Literal("individual_item"), t.Literal("for_all_item")])
  ),
  percentage: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
  product_id: t.Optional(t.Number()),
});
