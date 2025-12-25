import { t } from 'elysia';

// Product schemas
export const ProductCreate = t.Object({
  name: t.String(),
  price: t.Number(),
  description: t.Optional(t.String()),
  stock: t.Optional(t.Number({ default: 0 })),
});

export const ProductRead = t.Object({
  id: t.Number(),
  name: t.String(),
  price: t.Number(),
  description: t.Nullable(t.String()),
  stock: t.Number(),
});

export const ProductUpdate = t.Object({
  name: t.Optional(t.String()),
  price: t.Optional(t.Number()),
  description: t.Optional(t.String()),
  stock: t.Optional(t.Number()),
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
});

export const TransactionRead = t.Object({
  id: t.Number(),
  total_amount: t.Number(),
  created_at: t.Date(),
  items: t.Array(TransactionItemRead),
});

