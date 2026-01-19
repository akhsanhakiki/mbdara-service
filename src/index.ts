import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { productsRouter } from "./routes/products";
import { transactionsRouter } from "./routes/transactions";
import { discountsRouter } from "./routes/discounts";
import { expensesRouter } from "./routes/expenses";
import { summaryRouter } from "./routes/summary";
import { usersRouter } from "./routes/users";
import { organizationsRouter } from "./routes/organizations";
import { membersRouter } from "./routes/members";
import { pool } from "./db";

const app = new Elysia()
  .onRequest(({ request, set }) => {
    set.headers["X-Request-Start"] = Date.now().toString();
  })
  .onAfterHandle(({ request, set }) => {
    const startTime = parseInt(request.headers.get("X-Request-Start") || "0");
    const duration = startTime ? Date.now() - startTime : 0;
    const method = request.method;
    const url = new URL(request.url);
    const path = url.pathname;
    const status = set.status || 200;
    const timestamp = new Date().toISOString();

    const statusColor = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : status >= 300 ? "\x1b[36m" : "\x1b[32m";
    const resetColor = "\x1b[0m";

    console.log(
      `[${timestamp}] ${method} ${path} ${statusColor}${status}${resetColor} ${duration}ms`
    );
  })
  .onError(({ code, error, request, set }) => {
    const startTime = parseInt(request.headers.get("X-Request-Start") || "0");
    const duration = startTime ? Date.now() - startTime : 0;
    const method = request.method;
    const url = new URL(request.url);
    const path = url.pathname;
    const status = set.status || 500;
    const timestamp = new Date().toISOString();

    const statusColor = "\x1b[31m";
    const resetColor = "\x1b[0m";

    console.log(
      `[${timestamp}] ${method} ${path} ${statusColor}${status}${resetColor} ${duration}ms - Error: ${error.message}`
    );
  })
  .use(
    openapi({
      path: "/documentation",
      documentation: {
        info: {
          title: "MBDara API",
          version: "1.0.0",
          description:
            "A simple cashier API for managing products and transactions. Transaction endpoints require bearer token authentication to identify the active organization.",
        },
        tags: [
          { name: "products", description: "Product management endpoints" },
          {
            name: "transactions",
            description: "Transaction management endpoints. Requires bearer token authentication.",
          },
          {
            name: "discounts",
            description: "Discount management endpoints",
          },
          {
            name: "expenses",
            description: "Expense management endpoints",
          },
          {
            name: "summary",
            description: "Summary statistics and analytics endpoints",
          },
          {
            name: "users",
            description: "User management endpoints",
          },
          {
            name: "organizations",
            description: "Organization management endpoints",
          },
          {
            name: "members",
            description: "Organization member management endpoints",
          },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
              description:
                "Bearer token from session. The token is used to identify the active organization. Include it in the Authorization header as: Bearer <token>",
            },
          },
        },
      },
    })
  )
  .get("/", () => {
    return {
      message: "MBDara API",
      version: "1.0.0",
      docs: "/documentation",
    };
  })
  .get("/debug/session", async ({ request, set }) => {
    // Debug endpoint to help verify token lookup
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      set.status = 400;
      return { error: "Missing Authorization header" };
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      set.status = 400;
      return { error: "Invalid format. Expected: Bearer <token>" };
    }

    const token = parts[1].trim();

    try {
      // Try to find the session
      const result = await pool.query(
        `SELECT 
          id,
          token,
          "userId",
          "activeOrganizationId",
          "expiresAt",
          "createdAt"
         FROM neon_auth.session
         WHERE token = $1
         LIMIT 1`,
        [token]
      );

      if (result.rows.length === 0) {
        return {
          token_received: token.substring(0, 20) + "...",
          token_length: token.length,
          found: false,
          message: "Token not found in database. Please verify the token exists in neon_auth.session table.",
        };
      }

      const session = result.rows[0];
      const expiresAt = new Date(session.expiresAt);
      const isExpired = expiresAt < new Date();

      return {
        token_received: token.substring(0, 20) + "...",
        token_length: token.length,
        found: true,
        session: {
          id: session.id,
          userId: session.userId,
          activeOrganizationId: session.activeOrganizationId,
          expiresAt: session.expiresAt,
          isExpired: isExpired,
          hasActiveOrganization: !!session.activeOrganizationId,
        },
      };
    } catch (error) {
      set.status = 500;
      return {
        error: "Database error",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  })
  .use(productsRouter)
  .use(transactionsRouter)
  .use(discountsRouter)
  .use(expensesRouter)
  .use(summaryRouter)
  .use(usersRouter)
  .use(organizationsRouter)
  .use(membersRouter)
  .listen(process.env.PORT ? parseInt(process.env.PORT) : 3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
console.log(
  `📚 API Documentation available at http://${app.server?.hostname}:${app.server?.port}/documentation`
);
