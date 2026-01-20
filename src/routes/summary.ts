import { Elysia, t } from "elysia";
import { db, pool } from "../db";
import {
  transactions,
  transactionItems,
  products,
  expenses,
} from "../db/schema";
import { eq, and, gte, lte, sql, desc, asc } from "drizzle-orm";
import { SummaryResponse } from "../types";
import { getOrganizationIdFromHeaders } from "../utils/auth";

export const summaryRouter = new Elysia({ prefix: "/summary" })
  .model({
    SummaryResponse,
  })
  .get(
    "/",
    async ({ query, set, request }) => {
      try {
        const authResult = await getOrganizationIdFromHeaders(request.headers);
        if (!authResult.organizationId) {
          set.status = 401;
          return {
            error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
          };
        }
        const organizationId = authResult.organizationId;

        // Build date range conditions
        const transactionConditions = [eq(transactions.organizationId, organizationId)];
        const expenseConditions = [eq(expenses.organizationId, organizationId)];

        // Date range conditions for transactions
        if (query.start_date) {
          const startDate = new Date(query.start_date);
          if (isNaN(startDate.getTime())) {
            set.status = 400;
            return {
              error:
                "Invalid start_date format. Use ISO 8601 format (e.g., 2026-01-01T00:00:00Z)",
            };
          }
          transactionConditions.push(gte(transactions.createdAt, startDate));
        }

        if (query.end_date) {
          const endDate = new Date(query.end_date);
          if (isNaN(endDate.getTime())) {
            set.status = 400;
            return {
              error:
                "Invalid end_date format. Use ISO 8601 format (e.g., 2026-01-31T23:59:59Z)",
            };
          }
          transactionConditions.push(lte(transactions.createdAt, endDate));
        }

        // Validate date range
        if (query.start_date && query.end_date) {
          const startDate = new Date(query.start_date);
          const endDate = new Date(query.end_date);
          if (startDate > endDate) {
            set.status = 400;
            return {
              error: "start_date must be before or equal to end_date",
            };
          }
        }

        // Date range conditions for expenses (using same dates)
        if (query.start_date) {
          const startDate = new Date(query.start_date);
          expenseConditions.push(gte(expenses.date, startDate));
        }

        if (query.end_date) {
          const endDate = new Date(query.end_date);
          expenseConditions.push(lte(expenses.date, endDate));
        }

        // 1. Calculate total revenue, total profit, and transaction count
        const transactionWhere =
          transactionConditions.length > 0
            ? transactionConditions.length === 1
              ? transactionConditions[0]
              : and(...transactionConditions)
            : undefined;

        const transactionStats = await db
          .select({
            total_revenue: sql<number>`COALESCE(SUM(${transactions.totalAmount}::numeric), 0)::float`,
            total_profit: sql<number>`COALESCE(SUM(${transactions.profit}::numeric), 0)::float`,
            transaction_count: sql<number>`COUNT(*)::int`,
          })
          .from(transactions)
          .where(transactionWhere);

        const stats = transactionStats[0] || {
          total_revenue: 0,
          total_profit: 0,
          transaction_count: 0,
        };

        const totalRevenue = parseFloat(stats.total_revenue.toString());
        const totalProfit = parseFloat(stats.total_profit.toString());
        const transactionCount = parseInt(stats.transaction_count.toString());
        const averageTransaction =
          transactionCount > 0 ? totalRevenue / transactionCount : 0;

        // 2. Calculate total expenses
        const expenseWhere =
          expenseConditions.length > 0
            ? expenseConditions.length === 1
              ? expenseConditions[0]
              : and(...expenseConditions)
            : undefined;

        const expenseStats = await db
          .select({
            total_expenses: sql<number>`COALESCE(SUM(${expenses.amount}::numeric), 0)::float`,
          })
          .from(expenses)
          .where(expenseWhere);

        const totalExpenses = parseFloat(
          (expenseStats[0]?.total_expenses || 0).toString()
        );

        // 3. Get chart data (daily aggregation)
        // Group transactions by date and calculate daily totals
        const chartDataTransactions = await db
          .select({
            date: sql<string>`DATE(${transactions.createdAt})::text`,
            revenue: sql<number>`COALESCE(SUM(${transactions.totalAmount}::numeric), 0)::float`,
            profit: sql<number>`COALESCE(SUM(${transactions.profit}::numeric), 0)::float`,
          })
          .from(transactions)
          .where(transactionWhere)
          .groupBy(sql`DATE(${transactions.createdAt})`)
          .orderBy(sql`DATE(${transactions.createdAt}) ASC`);

        // Get daily expenses
        const chartDataExpenses = await db
          .select({
            date: sql<string>`DATE(${expenses.date})::text`,
            expenses: sql<number>`COALESCE(SUM(${expenses.amount}::numeric), 0)::float`,
          })
          .from(expenses)
          .where(expenseWhere)
          .groupBy(sql`DATE(${expenses.date})`)
          .orderBy(sql`DATE(${expenses.date}) ASC`);

        // Merge transaction and expense data by date
        // Convert date strings to Date objects (PostgreSQL DATE() returns string)
        const expenseMap = new Map<string, number>();
        chartDataExpenses.forEach((item) => {
          const dateObj = new Date(item.date);
          const dateKey = dateObj.toISOString().split("T")[0];
          expenseMap.set(dateKey, parseFloat(item.expenses.toString()));
        });

        const chartData = chartDataTransactions.map((item) => {
          const dateObj = new Date(item.date);
          const dateKey = dateObj.toISOString().split("T")[0];
          return {
            date: dateObj,
            revenue: parseFloat(item.revenue.toString()),
            profit: parseFloat(item.profit.toString()),
            expenses: expenseMap.get(dateKey) || 0,
          };
        });

        // Add dates that only have expenses (no transactions)
        chartDataExpenses.forEach((item) => {
          const dateObj = new Date(item.date);
          const dateKey = dateObj.toISOString().split("T")[0];
          const exists = chartData.some(
            (cd) => cd.date.toISOString().split("T")[0] === dateKey
          );
          if (!exists) {
            chartData.push({
              date: dateObj,
              revenue: 0,
              profit: 0,
              expenses: parseFloat(item.expenses.toString()),
            });
          }
        });

        // Sort chart data by date
        chartData.sort((a, b) => a.date.getTime() - b.date.getTime());

        // 4. Get top 5 products by revenue
        const topProductsBaseQuery = db
          .select({
            product_id: products.id,
            product_name: products.name,
            total_revenue: sql<number>`COALESCE(SUM(${transactionItems.price}::numeric), 0)::float`,
            quantity_sold: sql<number>`COALESCE(SUM(${transactionItems.quantity}), 0)::int`,
          })
          .from(transactionItems)
          .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
          .innerJoin(products, eq(transactionItems.productId, products.id))
          .where(
            and(
              eq(transactions.organizationId, organizationId),
              eq(products.organizationId, organizationId)
            )
          )
          .groupBy(products.id, products.name)
          .orderBy(desc(sql`COALESCE(SUM(${transactionItems.price}::numeric), 0)::float`))
          .limit(5);

        const top5Products = transactionWhere
          ? await topProductsBaseQuery.where(transactionWhere)
          : await topProductsBaseQuery;

        // 5. Get underperforming products (bottom 5 by revenue, excluding zero revenue)
        const allProductsPerformanceBaseQuery = db
          .select({
            product_id: products.id,
            product_name: products.name,
            total_revenue: sql<number>`COALESCE(SUM(${transactionItems.price}::numeric), 0)::float`,
            quantity_sold: sql<number>`COALESCE(SUM(${transactionItems.quantity}), 0)::int`,
          })
          .from(transactionItems)
          .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
          .innerJoin(products, eq(transactionItems.productId, products.id))
          .where(
            and(
              eq(transactions.organizationId, organizationId),
              eq(products.organizationId, organizationId)
            )
          )
          .groupBy(products.id, products.name);

        const allProductsPerformance = transactionWhere
          ? await allProductsPerformanceBaseQuery.where(transactionWhere)
          : await allProductsPerformanceBaseQuery;

        // Filter out zero revenue and get bottom 5
        const underperformingProducts = allProductsPerformance
          .filter((p) => parseFloat(p.total_revenue.toString()) > 0)
          .sort((a, b) => parseFloat(a.total_revenue.toString()) - parseFloat(b.total_revenue.toString()))
          .slice(0, 5);

        return {
          total_revenue: totalRevenue,
          total_profit: totalProfit,
          average_transaction: averageTransaction,
          total_expenses: totalExpenses,
          chart_data: chartData,
          top_5_products: top5Products.map((p) => ({
            product_id: p.product_id,
            product_name: p.product_name,
            total_revenue: parseFloat(p.total_revenue.toString()),
            quantity_sold: parseInt(p.quantity_sold.toString()),
          })),
          underperforming_products: underperformingProducts.map((p) => ({
            product_id: p.product_id,
            product_name: p.product_name,
            total_revenue: parseFloat(p.total_revenue.toString()),
            quantity_sold: parseInt(p.quantity_sold.toString()),
          })),
        };
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
        start_date: t.Optional(t.String()),
        end_date: t.Optional(t.String()),
      }),
      response: {
        200: "SummaryResponse",
        400: t.Object({
          error: t.String(),
        }),
        401: t.Object({
          error: t.String(),
        }),
        500: t.Object({
          error: t.String(),
          details: t.String(),
        }),
      },
      detail: {
        summary: "Get summary statistics with metrics, chart data, and product performance",
        tags: ["summary"],
        description:
          "Get aggregated financial metrics (revenue, profit, expenses, average transaction), daily chart data, top 5 products by revenue, and underperforming products. Supports optional date range filtering. Requires bearer token authentication and returns only data belonging to the active organization from the session.",
        security: [{ bearerAuth: [] }],
      },
    }
  );
