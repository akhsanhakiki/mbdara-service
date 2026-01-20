import { Elysia, t } from "elysia";
import { db } from "../db";
import { products } from "../db/schema";
import { and, eq, ilike, or } from "drizzle-orm";
import { ProductCreate, ProductRead, ProductUpdate } from "../types";
import { getOrganizationIdFromHeaders } from "../utils/auth";

export const productsRouter = new Elysia({ prefix: "/products" })
  .model({
    ProductCreate,
    ProductRead,
    ProductUpdate,
  })
  .post(
    "/",
    async ({ body, set, request }) => {
      const authResult = await getOrganizationIdFromHeaders(request.headers);
      if (!authResult.organizationId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const organizationId = authResult.organizationId;

      // Validate bundle pricing: both fields must be provided together or both null/undefined
      if (
        (body.bundle_quantity !== undefined && body.bundle_price === undefined) ||
        (body.bundle_quantity === undefined && body.bundle_price !== undefined)
      ) {
        set.status = 400;
        return {
          error:
            "bundle_quantity and bundle_price must be provided together or both omitted",
        };
      }

      if (body.bundle_quantity !== undefined && body.bundle_quantity <= 0) {
        set.status = 400;
        return { error: "bundle_quantity must be greater than 0" };
      }

      if (body.bundle_price !== undefined && body.bundle_price < 0) {
        set.status = 400;
        return { error: "bundle_price must be greater than or equal to 0" };
      }

      const [product] = await db
        .insert(products)
        .values({
          name: body.name,
          price: body.price.toString(),
          cogs: Math.round(body.cogs).toString(),
          description: body.description || null,
          stock: body.stock ?? 0,
          bundleQuantity:
            body.bundle_quantity !== undefined ? body.bundle_quantity : null,
          bundlePrice:
            body.bundle_price !== undefined
              ? Math.round(body.bundle_price).toString()
              : null,
          organizationId,
        })
        .returning();

      set.status = 201;
      return {
        id: product.id,
        name: product.name,
        price: parseFloat(product.price),
        cogs: parseFloat(product.cogs),
        description: product.description,
        stock: product.stock,
        bundle_quantity: product.bundleQuantity,
        bundle_price: product.bundlePrice
          ? parseFloat(product.bundlePrice)
          : null,
        organization_id: product.organizationId ?? null,
      };
    },
    {
      body: "ProductCreate",
      response: {
        201: "ProductRead",
        400: t.Object({
          error: t.String(),
        }),
        401: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Create a new product",
        tags: ["products"],
        description:
          "Create a new product in the system. Requires bearer token authentication. The product will be associated with the active organization from the session.",
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .get(
    "/",
    async ({ query, set, request }) => {
      const authResult = await getOrganizationIdFromHeaders(request.headers);
      if (!authResult.organizationId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const organizationId = authResult.organizationId;

      const offset = query.offset ?? 0;
      const limit = query.limit ?? 100;

      const baseQuery = db
        .select()
        .from(products)
        .where(eq(products.organizationId, organizationId));

      const productsList = query.search
        ? await baseQuery
            .where(
              and(
                eq(products.organizationId, organizationId),
                or(
                  ilike(products.name, `%${query.search}%`),
                  ilike(products.description, `%${query.search}%`)
                )
              )
            )
            .limit(limit)
            .offset(offset)
        : await baseQuery.limit(limit).offset(offset);

      return productsList.map((p) => ({
        id: p.id,
        name: p.name,
        price: parseFloat(p.price),
        cogs: parseFloat(p.cogs),
        description: p.description,
        stock: p.stock,
        bundle_quantity: p.bundleQuantity,
        bundle_price: p.bundlePrice ? parseFloat(p.bundlePrice) : null,
        organization_id: p.organizationId ?? null,
      }));
    },
    {
      query: t.Object({
        offset: t.Optional(t.Number({ default: 0 })),
        limit: t.Optional(t.Number({ default: 100 })),
        search: t.Optional(t.String()),
      }),
      response: {
        200: t.Array(ProductRead),
        401: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Get a list of products",
        tags: ["products"],
        description:
          "Get a paginated list of products with optional search. Requires bearer token authentication. Returns only products belonging to the active organization from the session.",
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .get(
    "/:id",
    async ({ params, set, request }) => {
      const authResult = await getOrganizationIdFromHeaders(request.headers);
      if (!authResult.organizationId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const organizationId = authResult.organizationId;

      const [product] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, params.id), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) {
        set.status = 404;
        return { error: "Product not found" };
      }

      return {
        id: product.id,
        name: product.name,
        price: parseFloat(product.price),
        cogs: parseFloat(product.cogs),
        description: product.description,
        stock: product.stock,
        bundle_quantity: product.bundleQuantity,
        bundle_price: product.bundlePrice ? parseFloat(product.bundlePrice) : null,
        organization_id: product.organizationId ?? null,
      };
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
      response: {
        200: "ProductRead",
        401: t.Object({
          error: t.String(),
        }),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Get a single product by ID",
        tags: ["products"],
        description:
          "Get product details by ID. Requires bearer token authentication. Returns 404 if the product doesn't belong to the active organization from the session.",
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .patch(
    "/:id",
    async ({ params, body, set, request }) => {
      const authResult = await getOrganizationIdFromHeaders(request.headers);
      if (!authResult.organizationId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const organizationId = authResult.organizationId;

      const [existing] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, params.id), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Product not found" };
      }

      // Validate bundle pricing: both fields must be provided together or both null/undefined
      if (
        (body.bundle_quantity !== undefined && body.bundle_price === undefined) ||
        (body.bundle_quantity === undefined && body.bundle_price !== undefined)
      ) {
        set.status = 400;
        return {
          error:
            "bundle_quantity and bundle_price must be provided together or both omitted",
        };
      }

      if (body.bundle_quantity !== undefined && body.bundle_quantity <= 0) {
        set.status = 400;
        return { error: "bundle_quantity must be greater than 0" };
      }

      if (body.bundle_price !== undefined && body.bundle_price < 0) {
        set.status = 400;
        return { error: "bundle_price must be greater than or equal to 0" };
      }

      const updateData: {
        name?: string;
        price?: string;
        cogs?: string;
        description?: string | null;
        stock?: number;
        bundleQuantity?: number | null;
        bundlePrice?: string | null;
      } = {};

      if (body.name !== undefined) updateData.name = body.name;
      if (body.price !== undefined) updateData.price = body.price.toString();
      if (body.cogs !== undefined) updateData.cogs = Math.round(body.cogs).toString();
      if (body.description !== undefined)
        updateData.description = body.description || null;
      if (body.stock !== undefined) updateData.stock = body.stock;
      if (body.bundle_quantity !== undefined) {
        updateData.bundleQuantity = body.bundle_quantity ?? null;
      }
      if (body.bundle_price !== undefined) {
        updateData.bundlePrice =
          body.bundle_price !== null ? Math.round(body.bundle_price).toString() : null;
      }

      const [updated] = await db
        .update(products)
        .set(updateData)
        .where(and(eq(products.id, params.id), eq(products.organizationId, organizationId)))
        .returning();

      return {
        id: updated.id,
        name: updated.name,
        price: parseFloat(updated.price),
        cogs: parseFloat(updated.cogs),
        description: updated.description,
        stock: updated.stock,
        bundle_quantity: updated.bundleQuantity,
        bundle_price: updated.bundlePrice
          ? parseFloat(updated.bundlePrice)
          : null,
        organization_id: updated.organizationId ?? null,
      };
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
      body: "ProductUpdate",
      response: {
        200: "ProductRead",
        400: t.Object({
          error: t.String(),
        }),
        401: t.Object({
          error: t.String(),
        }),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Update a product by ID",
        tags: ["products"],
        description:
          "Partially update product information. Requires bearer token authentication. Returns 404 if the product doesn't belong to the active organization from the session.",
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .delete(
    "/:id",
    async ({ params, set, request }) => {
      const authResult = await getOrganizationIdFromHeaders(request.headers);
      if (!authResult.organizationId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const organizationId = authResult.organizationId;

      const [product] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, params.id), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) {
        set.status = 404;
        return { error: "Product not found" };
      }

      await db
        .delete(products)
        .where(and(eq(products.id, params.id), eq(products.organizationId, organizationId)));

      set.status = 204;
      return;
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
      response: {
        204: t.Undefined(),
        401: t.Object({
          error: t.String(),
        }),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Delete a product by ID",
        tags: ["products"],
        description:
          "Delete a product from the system. Requires bearer token authentication. Returns 404 if the product doesn't belong to the active organization from the session.",
        security: [{ bearerAuth: [] }],
      },
    }
  );
