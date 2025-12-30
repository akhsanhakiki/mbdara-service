import {
  pgTable,
  serial,
  varchar,
  decimal,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Product table
export const products = pgTable("product", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  cogs: decimal("cogs", { precision: 10, scale: 0 }).notNull(),
  description: varchar("description", { length: 1000 }),
  stock: integer("stock").notNull().default(0),
  bundleQuantity: integer("bundle_quantity"),
  bundlePrice: decimal("bundle_price", { precision: 10, scale: 0 }),
});

// Transaction table
export const transactions = pgTable("transaction", {
  id: serial("id").primaryKey(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  discount: varchar("discount", { length: 50 }),
  profit: decimal("profit", { precision: 10, scale: 0 }),
});

// TransactionItem table
export const transactionItems = pgTable("transactionitem", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").references(() => transactions.id),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  quantity: integer("quantity").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
});

// Discount table
export const discounts = pgTable("discount", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  type: varchar("type", { length: 20 }).notNull(), // 'individual_item' or 'for_all_item'
  percentage: decimal("percentage", { precision: 5, scale: 2 }).notNull(),
  productId: integer("product_id").references(() => products.id), // Required when type is 'individual_item'
});

// Relations
export const productsRelations = relations(products, ({ many }) => ({
  transactionItems: many(transactionItems),
}));

export const transactionsRelations = relations(transactions, ({ many }) => ({
  items: many(transactionItems),
}));

export const transactionItemsRelations = relations(
  transactionItems,
  ({ one }) => ({
    transaction: one(transactions, {
      fields: [transactionItems.transactionId],
      references: [transactions.id],
    }),
    product: one(products, {
      fields: [transactionItems.productId],
      references: [products.id],
    }),
  })
);
