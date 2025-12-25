import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { productsRouter } from "./routes/products";
import { transactionsRouter } from "./routes/transactions";

const app = new Elysia()
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
  .listen(process.env.PORT ? parseInt(process.env.PORT) : 3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
console.log(
  `📚 API Documentation available at http://${app.server?.hostname}:${app.server?.port}/documentation`
);
