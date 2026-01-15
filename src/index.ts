import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { productsRouter } from "./routes/products";
import { transactionsRouter } from "./routes/transactions";
import { discountsRouter } from "./routes/discounts";
import { expensesRouter } from "./routes/expenses";
import { summaryRouter } from "./routes/summary";

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
            "A simple cashier API for managing products and transactions",
        },
        tags: [
          { name: "products", description: "Product management endpoints" },
          {
            name: "transactions",
            description: "Transaction management endpoints",
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
        ],
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
  .use(productsRouter)
  .use(transactionsRouter)
  .use(discountsRouter)
  .use(expensesRouter)
  .use(summaryRouter)
  .listen(process.env.PORT ? parseInt(process.env.PORT) : 3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
console.log(
  `📚 API Documentation available at http://${app.server?.hostname}:${app.server?.port}/documentation`
);
