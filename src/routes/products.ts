import { Elysia, t } from "elysia";
import { db } from "../db";
import { products, productVariations, transactionItems } from "../db/schema";
import { and, eq, ilike, inArray, or } from "drizzle-orm";
import {
  ProductCreate,
  ProductRead,
  ProductUpdate,
  ProductVariationCreate,
  ProductVariationRead,
  ProductVariationUpdate,
} from "../types";
import { getOrganizationIdFromHeaders } from "../utils/auth";

function mapVariationToRead(v: {
  id: number;
  productId: number;
  name: string | null;
  description: string | null;
  price: string;
  cogs: string;
  stock: number;
  bundleQuantity: number | null;
  bundlePrice: string | null;
}) {
  return {
    id: v.id,
    product_id: v.productId,
    name: v.name,
    description: v.description,
    price: parseFloat(v.price),
    cogs: parseFloat(v.cogs),
    stock: v.stock,
    bundle_quantity: v.bundleQuantity,
    bundle_price: v.bundlePrice ? parseFloat(v.bundlePrice) : null,
  };
}

function validateVariationBundle(v: {
  bundle_quantity?: number;
  bundle_price?: number;
}) {
  if (
    (v.bundle_quantity !== undefined && v.bundle_price === undefined) ||
    (v.bundle_quantity === undefined && v.bundle_price !== undefined)
  ) {
    return "bundle_quantity and bundle_price must be provided together or both omitted";
  }
  if (v.bundle_quantity !== undefined && v.bundle_quantity <= 0) {
    return "bundle_quantity must be greater than 0";
  }
  if (v.bundle_price !== undefined && v.bundle_price < 0) {
    return "bundle_price must be greater than or equal to 0";
  }
  return null;
}

export const productsRouter = new Elysia({ prefix: "/products" })
  .model({
    ProductCreate,
    ProductRead,
    ProductUpdate,
    ProductVariationCreate,
    ProductVariationRead,
    ProductVariationUpdate,
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

      if (body.variations?.length) {
        for (const v of body.variations) {
          const err = validateVariationBundle(v);
          if (err) {
            set.status = 400;
            return { error: err };
          }
        }
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

      const variationsList: Array<{
        id: number;
        productId: number;
        name: string | null;
        description: string | null;
        price: string;
        cogs: string;
        stock: number;
        bundleQuantity: number | null;
        bundlePrice: string | null;
      }> = [];

      if (body.variations?.length) {
        const inserted = await db
          .insert(productVariations)
          .values(
            body.variations.map((v) => ({
              productId: product.id,
              name: v.name ?? null,
              description: v.description ?? null,
              price: v.price.toString(),
              cogs: Math.round(v.cogs).toString(),
              stock: v.stock ?? 0,
              bundleQuantity:
                v.bundle_quantity !== undefined ? v.bundle_quantity : null,
              bundlePrice:
                v.bundle_price !== undefined
                  ? Math.round(v.bundle_price).toString()
                  : null,
            }))
          )
          .returning();
        variationsList.push(...inserted);
      }

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
        variations: variationsList.map(mapVariationToRead),
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

      const productIds = productsList.map((p) => p.id);
      const variationsList =
        productIds.length > 0
          ? await db
              .select()
              .from(productVariations)
              .where(
                productIds.length === 1
                  ? eq(productVariations.productId, productIds[0])
                  : inArray(productVariations.productId, productIds)
              )
          : [];
      const variationsByProductId = new Map<number, typeof variationsList>();
      for (const v of variationsList) {
        const arr = variationsByProductId.get(v.productId) ?? [];
        arr.push(v);
        variationsByProductId.set(v.productId, arr);
      }

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
        variations: (variationsByProductId.get(p.id) ?? []).map(
          mapVariationToRead
        ),
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
    "/:id/variations",
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

      const variationsList = await db
        .select()
        .from(productVariations)
        .where(eq(productVariations.productId, product.id));

      return variationsList.map(mapVariationToRead);
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
      response: {
        200: t.Array(ProductVariationRead),
        401: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
      },
      detail: {
        summary: "List variations for a product",
        tags: ["products", "variations"],
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .get(
    "/:id/variations/:variationId",
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

      const [variation] = await db
        .select()
        .from(productVariations)
        .where(
          and(
            eq(productVariations.id, params.variationId),
            eq(productVariations.productId, params.id)
          )
        )
        .limit(1);

      if (!variation) {
        set.status = 404;
        return { error: "Variation not found" };
      }

      return mapVariationToRead(variation);
    },
    {
      params: t.Object({
        id: t.Number(),
        variationId: t.Number(),
      }),
      response: {
        200: ProductVariationRead,
        401: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
      },
      detail: {
        summary: "Get a single variation by ID",
        tags: ["products", "variations"],
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .post(
    "/:id/variations",
    async ({ params, body, set, request }) => {
      const authResult = await getOrganizationIdFromHeaders(request.headers);
      if (!authResult.organizationId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const organizationId = authResult.organizationId;

      const err = validateVariationBundle(body);
      if (err) {
        set.status = 400;
        return { error: err };
      }

      const [product] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, params.id), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) {
        set.status = 404;
        return { error: "Product not found" };
      }

      const [variation] = await db
        .insert(productVariations)
        .values({
          productId: product.id,
          name: body.name ?? null,
          description: body.description ?? null,
          price: body.price.toString(),
          cogs: Math.round(body.cogs).toString(),
          stock: body.stock ?? 0,
          bundleQuantity:
            body.bundle_quantity !== undefined ? body.bundle_quantity : null,
          bundlePrice:
            body.bundle_price !== undefined
              ? Math.round(body.bundle_price).toString()
              : null,
        })
        .returning();

      set.status = 201;
      return mapVariationToRead(variation);
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
      body: "ProductVariationCreate",
      response: {
        201: ProductVariationRead,
        400: t.Object({ error: t.String() }),
        401: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
      },
      detail: {
        summary: "Create a variation for a product",
        tags: ["products", "variations"],
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .patch(
    "/:id/variations/:variationId",
    async ({ params, body, set, request }) => {
      const authResult = await getOrganizationIdFromHeaders(request.headers);
      if (!authResult.organizationId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const organizationId = authResult.organizationId;

      const err = body && validateVariationBundle(body);
      if (err) {
        set.status = 400;
        return { error: err };
      }

      const [product] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, params.id), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) {
        set.status = 404;
        return { error: "Product not found" };
      }

      const [existing] = await db
        .select()
        .from(productVariations)
        .where(
          and(
            eq(productVariations.id, params.variationId),
            eq(productVariations.productId, params.id)
          )
        )
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Variation not found" };
      }

      const updateData: {
        name?: string | null;
        description?: string | null;
        price?: string;
        cogs?: string;
        stock?: number;
        bundleQuantity?: number | null;
        bundlePrice?: string | null;
      } = {};
      if (body?.name !== undefined) updateData.name = body.name ?? null;
      if (body?.description !== undefined)
        updateData.description = body.description ?? null;
      if (body?.price !== undefined) updateData.price = body.price.toString();
      if (body?.cogs !== undefined)
        updateData.cogs = Math.round(body.cogs).toString();
      if (body?.stock !== undefined) updateData.stock = body.stock;
      if (body?.bundle_quantity !== undefined)
        updateData.bundleQuantity = body.bundle_quantity ?? null;
      if (body?.bundle_price !== undefined)
        updateData.bundlePrice =
          body.bundle_price !== null
            ? Math.round(body.bundle_price).toString()
            : null;

      const [updated] = await db
        .update(productVariations)
        .set(updateData)
        .where(
          and(
            eq(productVariations.id, params.variationId),
            eq(productVariations.productId, params.id)
          )
        )
        .returning();

      return mapVariationToRead(updated);
    },
    {
      params: t.Object({
        id: t.Number(),
        variationId: t.Number(),
      }),
      body: "ProductVariationUpdate",
      response: {
        200: ProductVariationRead,
        400: t.Object({ error: t.String() }),
        401: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
      },
      detail: {
        summary: "Update a variation",
        tags: ["products", "variations"],
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .delete(
    "/:id/variations/:variationId",
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

      const [existingVariation] = await db
        .select()
        .from(productVariations)
        .where(
          and(
            eq(productVariations.id, params.variationId),
            eq(productVariations.productId, params.id)
          )
        )
        .limit(1);

      if (!existingVariation) {
        set.status = 404;
        return { error: "Variation not found" };
      }

      const [inUse] = await db
        .select()
        .from(transactionItems)
        .where(eq(transactionItems.productVariationId, params.variationId))
        .limit(1);

      if (inUse) {
        set.status = 409;
        return {
          error:
            "Cannot delete variation: it is referenced by one or more transaction items",
        };
      }

      await db
        .delete(productVariations)
        .where(
          and(
            eq(productVariations.id, params.variationId),
            eq(productVariations.productId, params.id)
        ));

      set.status = 204;
      return;
    },
    {
      params: t.Object({
        id: t.Number(),
        variationId: t.Number(),
      }),
      response: {
        204: t.Undefined(),
        401: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        409: t.Object({ error: t.String() }),
      },
      detail: {
        summary: "Delete a variation",
        tags: ["products", "variations"],
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

      const variationsList = await db
        .select()
        .from(productVariations)
        .where(eq(productVariations.productId, product.id));

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
        variations: variationsList.map(mapVariationToRead),
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

      const variationsList = await db
        .select()
        .from(productVariations)
        .where(eq(productVariations.productId, updated.id));

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
        variations: variationsList.map(mapVariationToRead),
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
