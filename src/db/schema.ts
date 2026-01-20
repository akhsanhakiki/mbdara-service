import {
  pgTable,
  pgSchema,
  serial,
  varchar,
  text,
  uuid,
  boolean,
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
  organizationId: text("organization_id"), // UUID from neon_auth.organization
});

// Transaction table
export const transactions = pgTable("transaction", {
  id: serial("id").primaryKey(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  discount: varchar("discount", { length: 50 }),
  profit: decimal("profit", { precision: 10, scale: 0 }),
  paymentMethod: varchar("payment_method", { length: 50 }),
  organizationId: text("organization_id"), // UUID from neon_auth.organization
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
  organizationId: text("organization_id"), // UUID from neon_auth.organization
});

// Expense table
export const expenses = pgTable("expense", {
  id: serial("id").primaryKey(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  description: varchar("description", { length: 1000 }),
  date: timestamp("date").notNull().defaultNow(),
  category: varchar("category", { length: 255 }),
  paymentMethod: varchar("payment_method", { length: 50 }),
  organizationId: text("organization_id"), // UUID from neon_auth.organization
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

// Neon Auth schema - user table from neon_auth schema
export const neonAuthSchema = pgSchema("neon_auth");

export const user = neonAuthSchema.table("user", {
  id: uuid("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: boolean("emailVerified"), // Keep camelCase as shown in UI
  image: text("image"),
});

// Organization table
export const organization = neonAuthSchema.table("organization", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  metadata: text("metadata"),
});

// Member table - links users to organizations
export const member = neonAuthSchema.table("member", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organizationId").notNull().references(() => organization.id, { onDelete: "cascade" }),
  userId: uuid("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 50 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
});

// Session table - for authentication and active organization
export const session = neonAuthSchema.table("session", {
  id: uuid("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: uuid("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("activeOrganizationId"),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
});
