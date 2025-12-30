import { Elysia, t } from "elysia";
import { db, pool } from "../db";
import { transactions, transactionItems, products, discounts } from "../db/schema";
import { eq, inArray, sql, desc } from "drizzle-orm";
import { TransactionCreate, TransactionRead } from "../types";

export const transactionsRouter = new Elysia({ prefix: "/transactions" })
  .model({
    TransactionCreate,
    TransactionRead,
  })
  .post(
    "/",
    async ({ body, set }) => {
      // Load all products in single query (prevent N+1)
      const productIds = body.items.map((item) => item.product_id);
      if (productIds.length === 0) {
        set.status = 400;
        return { error: "Transaction must have at least one item" };
      }

      const productsList = await db
        .select()
        .from(products)
        .where(inArray(products.id, productIds));

      const productDict = new Map(productsList.map((p) => [p.id, p]));

      // Validate all products exist
      const missingIds = productIds.filter((id) => !productDict.has(id));
      if (missingIds.length > 0) {
        set.status = 404;
        return {
          error: `Products not found: ${missingIds.join(", ")}`,
        };
      }

      // Validate and fetch discount if code provided
      let discount = null;
      if (body.discount_code) {
        const [discountData] = await db
          .select()
          .from(discounts)
          .where(eq(discounts.code, body.discount_code))
          .limit(1);

        if (!discountData) {
          set.status = 404;
          return {
            error: `Discount code '${body.discount_code}' not found`,
          };
        }

        discount = discountData;
      }

      // Validate stock and calculate total
      let totalAmount = 0;
      const itemsToCreate: Array<{
        productId: number;
        quantity: number;
        price: string;
      }> = [];

      for (const item of body.items) {
        const product = productDict.get(item.product_id)!;

        if (product.stock < item.quantity) {
          set.status = 400;
          return {
            error: `Not enough stock for product '${product.name}'. Available: ${product.stock}, Requested: ${item.quantity}`,
          };
        }

        // Calculate item price total with bundle pricing
        let itemTotal = 0;
        const individualPrice = parseFloat(product.price);
        const bundleQuantity = product.bundleQuantity;
        const bundlePrice = product.bundlePrice
          ? parseFloat(product.bundlePrice)
          : null;

        // Check if product has bundle pricing and quantity qualifies
        if (
          bundleQuantity !== null &&
          bundlePrice !== null &&
          item.quantity >= bundleQuantity
        ) {
          // Calculate bundles and remaining items
          const bundles = Math.floor(item.quantity / bundleQuantity);
          const remaining = item.quantity % bundleQuantity;

          // Bundle total (bundles × bundleQuantity × bundlePrice per item) + individual total for remaining items
          itemTotal = bundles * bundleQuantity * bundlePrice + remaining * individualPrice;
        } else {
          // Use regular pricing
          itemTotal = individualPrice * item.quantity;
        }

        // Apply discount if type is individual_item AND product matches
        if (
          discount &&
          discount.type === "individual_item" &&
          discount.productId !== null &&
          discount.productId === product.id
        ) {
          const discountAmount = itemTotal * (parseFloat(discount.percentage) / 100);
          itemTotal = itemTotal - discountAmount;
        }

        totalAmount += itemTotal;

        // Store the calculated total price (not per-unit price)
        itemsToCreate.push({
          productId: product.id,
          quantity: item.quantity,
          price: itemTotal.toString(),
        });
      }

      // Apply discount if type is for_all_item
      if (discount && discount.type === "for_all_item") {
        const discountAmount = totalAmount * (parseFloat(discount.percentage) / 100);
        totalAmount = totalAmount - discountAmount;
      }

      // Create transaction and items in a single database transaction
      const result = await db.transaction(async (tx) => {
        // Create transaction
        const [newTransaction] = await tx
          .insert(transactions)
          .values({
            totalAmount: totalAmount.toString(),
            createdAt: body.created_at || new Date(),
            discount: body.discount_code || null,
          })
          .returning();

        // Deduct stock and create transaction items
        for (const item of itemsToCreate) {
          // Update stock
          await tx
            .update(products)
            .set({
              stock: sql`${products.stock} - ${item.quantity}`,
            })
            .where(eq(products.id, item.productId));

          // Create transaction item
          await tx.insert(transactionItems).values({
            transactionId: newTransaction.id,
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
          });
        }

        // Fetch created items with product names
        const createdItems = await tx
          .select({
            id: transactionItems.id,
            quantity: transactionItems.quantity,
            price: transactionItems.price,
            product_id: transactionItems.productId,
            transaction_id: transactionItems.transactionId,
            product_name: products.name,
          })
          .from(transactionItems)
          .innerJoin(products, eq(transactionItems.productId, products.id))
          .where(eq(transactionItems.transactionId, newTransaction.id));

        return {
          transaction: newTransaction,
          items: createdItems,
        };
      });

      set.status = 201;
      return {
        id: result.transaction.id,
        total_amount: parseFloat(result.transaction.totalAmount),
        created_at: result.transaction.createdAt,
        discount: result.transaction.discount,
        items: result.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          price: parseFloat(item.price),
          product_id: item.product_id,
          transaction_id: item.transaction_id,
          product_name: item.product_name,
        })),
      };
    },
    {
      body: "TransactionCreate",
      response: {
        201: "TransactionRead",
        400: t.Object({
          error: t.String(),
        }),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Create a new transaction with items",
        tags: ["transactions"],
        description:
          "Create a transaction, validate stock, deduct inventory, and calculate total",
      },
    }
  )
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const offset = query.offset ?? 0;
        const limit = query.limit ?? 100;

        // First, get paginated transactions
        const transactionsList = await db
          .select()
          .from(transactions)
          .orderBy(desc(transactions.createdAt))
          .limit(limit)
          .offset(offset);

        if (transactionsList.length === 0) {
          return [];
        }

        const transactionIds = transactionsList
          .map((t) => t.id)
          .filter((id): id is number => typeof id === "number" && !isNaN(id));

        // Then, eager load items and products for those transactions (prevent N+1)
        // Mimicking Python's selectinload pattern: separate optimized queries
        // First get all items for these transactions
        let itemsData: (typeof transactionItems.$inferSelect)[] = [];

        if (transactionIds.length > 0) {
          // Use direct pool query to avoid Drizzle's inArray issues with nullable columns
          // This matches the Python approach of using raw SQL when needed
          const placeholders = transactionIds
            .map((_, i) => `$${i + 1}`)
            .join(", ");
          const query = `
            SELECT id, transaction_id, product_id, quantity, price
            FROM transactionitem
            WHERE transaction_id IS NOT NULL
            AND transaction_id IN (${placeholders})
            ORDER BY transaction_id, id
          `;

          const result = await pool.query(query, transactionIds);

          // Map the result to match our schema structure
          itemsData = result.rows.map((row: any) => ({
            id: row.id,
            transactionId: row.transaction_id,
            productId: row.product_id,
            quantity: row.quantity,
            price: row.price,
          })) as (typeof transactionItems.$inferSelect)[];
        }

        if (itemsData.length === 0) {
          // No items found, return transactions with empty items arrays
          return transactionsList.map((txn) => ({
            id: txn.id,
            total_amount: parseFloat(txn.totalAmount),
            created_at: txn.createdAt,
            discount: txn.discount,
            items: [],
          }));
        }

        // Get all unique product IDs from items
        const productIds = [
          ...new Set(itemsData.map((item) => item.productId)),
        ];

        // Get all products in one query (like Python's selectinload)
        const productsData = await db
          .select()
          .from(products)
          .where(inArray(products.id, productIds));

        // Create product lookup map
        const productMap = new Map(productsData.map((p) => [p.id, p]));

        // Build items with product names (mimicking Python's approach)
        const itemsWithProducts = itemsData.map((item) => {
          const product = productMap.get(item.productId);
          return {
            id: item.id,
            quantity: item.quantity,
            price: item.price,
            product_id: item.productId,
            transaction_id: item.transactionId,
            product_name: product?.name || "",
          };
        });

        // Group items by transaction (mimicking Python's approach)
        const itemsByTransaction = new Map<number, typeof itemsWithProducts>();
        for (const item of itemsWithProducts) {
          if (item.transaction_id !== null) {
            const txnId = item.transaction_id;
            if (!itemsByTransaction.has(txnId)) {
              itemsByTransaction.set(txnId, []);
            }
            itemsByTransaction.get(txnId)!.push(item);
          }
        }

        // Build response (matching Python's TransactionRead structure)
        return transactionsList.map((txn) => ({
          id: txn.id,
          total_amount: parseFloat(txn.totalAmount),
          created_at: txn.createdAt,
          discount: txn.discount,
          items: (itemsByTransaction.get(txn.id) || []).map((item) => ({
            id: item.id,
            quantity: item.quantity,
            price: parseFloat(item.price),
            product_id: item.product_id,
            transaction_id: item.transaction_id,
            product_name: item.product_name,
          })),
        }));
      } catch (error) {
        set.status = 500;
        return {
          error: "Internal server error",
          details: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        offset: t.Optional(t.Number({ default: 0 })),
        limit: t.Optional(t.Number({ default: 100 })),
      }),
      response: {
        200: t.Array(TransactionRead),
        500: t.Object({
          error: t.String(),
          details: t.String(),
        }),
      },
      detail: {
        summary: "Get a list of transactions",
        tags: ["transactions"],
        description:
          "Get a paginated list of transactions with items and product names",
      },
    }
  )
  .get(
    "/:id",
    async ({ params, set }) => {
      // First, get the transaction
      const [transaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, params.id))
        .limit(1);

      if (!transaction) {
        set.status = 404;
        return { error: "Transaction not found" };
      }

      // Then, eager load items and products (prevent N+1)
      const itemsData = await db
        .select({
          id: transactionItems.id,
          quantity: transactionItems.quantity,
          price: transactionItems.price,
          product_id: transactionItems.productId,
          transaction_id: transactionItems.transactionId,
          product_name: products.name,
        })
        .from(transactionItems)
        .innerJoin(products, eq(transactionItems.productId, products.id))
        .where(eq(transactionItems.transactionId, params.id));

      return {
        id: transaction.id,
        total_amount: parseFloat(transaction.totalAmount),
        created_at: transaction.createdAt,
        discount: transaction.discount,
        items: itemsData.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          price: parseFloat(item.price),
          product_id: item.product_id,
          transaction_id: item.transaction_id,
          product_name: item.product_name,
        })),
      };
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
      response: {
        200: "TransactionRead",
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Get a single transaction by ID",
        tags: ["transactions"],
        description: "Get transaction details with items and product names",
      },
    }
  );
