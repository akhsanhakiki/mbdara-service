import { Elysia, t } from "elysia";
import { db } from "../db";
import { expenses } from "../db/schema";
import { eq, or, ilike, and, gte, lte } from "drizzle-orm";
import { ExpenseCreate, ExpenseRead, ExpenseUpdate } from "../types";

export const expensesRouter = new Elysia({ prefix: "/expenses" })
  .model({
    ExpenseCreate,
    ExpenseRead,
    ExpenseUpdate,
  })
  .post(
    "/",
    async ({ body, set }) => {
      const [expense] = await db
        .insert(expenses)
        .values({
          amount: body.amount.toString(),
          description: body.description || null,
          date: body.date || new Date(),
          category: body.category || null,
          paymentMethod: body.payment_method || null,
        })
        .returning();

      set.status = 201;
      return {
        id: expense.id,
        amount: parseFloat(expense.amount),
        description: expense.description,
        date: expense.date,
        category: expense.category,
        payment_method: expense.paymentMethod,
      };
    },
    {
      body: "ExpenseCreate",
      response: {
        201: "ExpenseRead",
        400: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Create a new expense",
        tags: ["expenses"],
        description: "Create a new expense with amount, description, date, category, and payment method",
      },
    }
  )
  .get(
    "/",
    async ({ query, set }) => {
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 100;

      // Build where conditions
      const conditions = [];

      // Search condition
      if (query.search) {
        conditions.push(
          or(
            ilike(expenses.description, `%${query.search}%`),
            ilike(expenses.category, `%${query.search}%`)
          )
        );
      }

      // Date range conditions
      if (query.start_date) {
        const startDate = new Date(query.start_date);
        if (isNaN(startDate.getTime())) {
          set.status = 400;
          return { error: "Invalid start_date format. Use ISO 8601 format (e.g., 2026-01-01T00:00:00Z)" };
        }
        conditions.push(gte(expenses.date, startDate));
      }

      if (query.end_date) {
        const endDate = new Date(query.end_date);
        if (isNaN(endDate.getTime())) {
          set.status = 400;
          return { error: "Invalid end_date format. Use ISO 8601 format (e.g., 2026-01-31T23:59:59Z)" };
        }
        conditions.push(lte(expenses.date, endDate));
      }

      // Validate date range
      if (query.start_date && query.end_date) {
        const startDate = new Date(query.start_date);
        const endDate = new Date(query.end_date);
        if (startDate > endDate) {
          set.status = 400;
          return { error: "start_date must be before or equal to end_date" };
        }
      }

      const baseQuery = db.select().from(expenses);
      const expensesList = conditions.length > 0
        ? await baseQuery
            .where(conditions.length === 1 ? conditions[0] : and(...conditions))
            .limit(limit)
            .offset(offset)
        : await baseQuery.limit(limit).offset(offset);

      return expensesList.map((e) => ({
        id: e.id,
        amount: parseFloat(e.amount),
        description: e.description,
        date: e.date,
        category: e.category,
        payment_method: e.paymentMethod,
      }));
    },
    {
      query: t.Object({
        offset: t.Optional(t.Number({ default: 0 })),
        limit: t.Optional(t.Number({ default: 100 })),
        search: t.Optional(t.String()),
        start_date: t.Optional(t.String()),
        end_date: t.Optional(t.String()),
      }),
      response: {
        200: t.Array(ExpenseRead),
        400: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Get a list of expenses",
        tags: ["expenses"],
        description: "Get a paginated list of expenses with optional search and date range filtering",
      },
    }
  )
  .get(
    "/:id",
    async ({ params, set }) => {
      const [expense] = await db
        .select()
        .from(expenses)
        .where(eq(expenses.id, params.id))
        .limit(1);

      if (!expense) {
        set.status = 404;
        return { error: "Expense not found" };
      }

      return {
        id: expense.id,
        amount: parseFloat(expense.amount),
        description: expense.description,
        date: expense.date,
        category: expense.category,
        payment_method: expense.paymentMethod,
      };
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
      response: {
        200: "ExpenseRead",
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Get a single expense by ID",
        tags: ["expenses"],
        description: "Get expense details by ID",
      },
    }
  )
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      const [existing] = await db
        .select()
        .from(expenses)
        .where(eq(expenses.id, params.id))
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Expense not found" };
      }

      const updateData: {
        amount?: string;
        description?: string | null;
        date?: Date;
        category?: string | null;
        paymentMethod?: string | null;
      } = {};

      if (body.amount !== undefined) updateData.amount = body.amount.toString();
      if (body.description !== undefined)
        updateData.description = body.description || null;
      if (body.date !== undefined) updateData.date = body.date;
      if (body.category !== undefined)
        updateData.category = body.category || null;
      if (body.payment_method !== undefined)
        updateData.paymentMethod = body.payment_method || null;

      const [updated] = await db
        .update(expenses)
        .set(updateData)
        .where(eq(expenses.id, params.id))
        .returning();

      return {
        id: updated.id,
        amount: parseFloat(updated.amount),
        description: updated.description,
        date: updated.date,
        category: updated.category,
        payment_method: updated.paymentMethod,
      };
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
      body: "ExpenseUpdate",
      response: {
        200: "ExpenseRead",
        400: t.Object({
          error: t.String(),
        }),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Update an expense by ID",
        tags: ["expenses"],
        description: "Partially update expense information",
      },
    }
  )
  .delete(
    "/:id",
    async ({ params, set }) => {
      const [expense] = await db
        .select()
        .from(expenses)
        .where(eq(expenses.id, params.id))
        .limit(1);

      if (!expense) {
        set.status = 404;
        return { error: "Expense not found" };
      }

      await db.delete(expenses).where(eq(expenses.id, params.id));

      set.status = 204;
      return;
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
      response: {
        204: t.Undefined(),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Delete an expense by ID",
        tags: ["expenses"],
        description: "Delete an expense from the system",
      },
    }
  );
