import { Elysia, t } from 'elysia';
import { db } from '../db';
import { transactions, transactionItems, products } from '../db/schema';
import { eq, inArray, sql, desc } from 'drizzle-orm';
import { TransactionCreate, TransactionRead } from '../types';

export const transactionsRouter = new Elysia({ prefix: '/transactions' })
  .model({
    TransactionCreate,
    TransactionRead,
  })
  .post(
    '/',
    async ({ body, set }) => {
      // Load all products in single query (prevent N+1)
      const productIds = body.items.map((item) => item.product_id);
      if (productIds.length === 0) {
        set.status = 400;
        return { error: 'Transaction must have at least one item' };
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
          error: `Products not found: ${missingIds.join(', ')}`,
        };
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

        // Calculate item price total
        const itemTotal = parseFloat(product.price) * item.quantity;
        totalAmount += itemTotal;

        itemsToCreate.push({
          productId: product.id,
          quantity: item.quantity,
          price: product.price,
        });
      }

      // Create transaction and items in a single database transaction
      const result = await db.transaction(async (tx) => {
        // Create transaction
        const [newTransaction] = await tx
          .insert(transactions)
          .values({
            totalAmount: totalAmount.toString(),
            createdAt: body.created_at || new Date(),
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
      body: 'TransactionCreate',
      response: {
        201: 'TransactionRead',
        400: t.Object({
          error: t.String(),
        }),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: 'Create a new transaction with items',
        tags: ['transactions'],
        description: 'Create a transaction, validate stock, deduct inventory, and calculate total',
      },
    }
  )
  .get(
    '/',
    async ({ query }) => {
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

      const transactionIds = transactionsList.map((t) => t.id);

      // Then, eager load items and products for those transactions (prevent N+1)
      const itemsWithProducts = await db
        .select({
          item: transactionItems,
          product: products,
        })
        .from(transactionItems)
        .innerJoin(products, eq(transactionItems.productId, products.id))
        .where(inArray(transactionItems.transactionId, transactionIds));

      // Group items by transaction
      const itemsByTransaction = new Map<number, typeof itemsWithProducts>();
      for (const row of itemsWithProducts) {
        const txnId = row.item.transactionId!;
        if (!itemsByTransaction.has(txnId)) {
          itemsByTransaction.set(txnId, []);
        }
        itemsByTransaction.get(txnId)!.push(row);
      }

      // Build response
      return transactionsList.map((txn) => ({
        id: txn.id,
        total_amount: parseFloat(txn.totalAmount),
        created_at: txn.createdAt,
        items: (itemsByTransaction.get(txn.id) || []).map((row) => ({
          id: row.item.id,
          quantity: row.item.quantity,
          price: parseFloat(row.item.price),
          product_id: row.item.productId,
          transaction_id: row.item.transactionId,
          product_name: row.product.name,
        })),
      }));
    },
    {
      query: t.Object({
        offset: t.Optional(t.Number({ default: 0 })),
        limit: t.Optional(t.Number({ default: 100 })),
      }),
      response: {
        200: t.Array(TransactionRead),
      },
      detail: {
        summary: 'Get a list of transactions',
        tags: ['transactions'],
        description: 'Get a paginated list of transactions with items and product names',
      },
    }
  )
  .get(
    '/:id',
    async ({ params, set }) => {
      // Eager load transaction with items and products (prevent N+1)
      const transactionData = await db
        .select({
          transaction: transactions,
          item: transactionItems,
          product: products,
        })
        .from(transactions)
        .leftJoin(transactionItems, eq(transactions.id, transactionItems.transactionId))
        .leftJoin(products, eq(transactionItems.productId, products.id))
        .where(eq(transactions.id, params.id));

      if (transactionData.length === 0) {
        set.status = 404;
        return { error: 'Transaction not found' };
      }

      const firstRow = transactionData[0];
      const transaction = firstRow.transaction;

      const items = transactionData
        .filter((row) => row.item && row.product)
        .map((row) => ({
          id: row.item!.id,
          quantity: row.item!.quantity,
          price: parseFloat(row.item!.price),
          product_id: row.item!.productId,
          transaction_id: row.item!.transactionId,
          product_name: row.product!.name,
        }));

      return {
        id: transaction.id,
        total_amount: parseFloat(transaction.totalAmount),
        created_at: transaction.createdAt,
        items,
      };
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
      response: {
        200: 'TransactionRead',
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: 'Get a single transaction by ID',
        tags: ['transactions'],
        description: 'Get transaction details with items and product names',
      },
    }
  );

