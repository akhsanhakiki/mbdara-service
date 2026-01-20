import { Elysia, t } from "elysia";
import { db } from "../db";
import { discounts, products } from "../db/schema";
import { and, eq, ilike, or } from "drizzle-orm";
import { DiscountCreate, DiscountRead, DiscountUpdate } from "../types";
import { getOrganizationIdFromHeaders } from "../utils/auth";

export const discountsRouter = new Elysia({ prefix: "/discounts" })
  .model({
    DiscountCreate,
    DiscountRead,
    DiscountUpdate,
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

      // Validate: if type is individual_item, product_id is required
      if (body.type === "individual_item" && !body.product_id) {
        set.status = 400;
        return {
          error: "product_id is required when discount type is 'individual_item'",
        };
      }

      // Validate: if type is for_all_item, product_id should not be provided
      if (body.type === "for_all_item" && body.product_id !== undefined) {
        set.status = 400;
        return {
          error: "product_id should not be provided when discount type is 'for_all_item'",
        };
      }

      // Validate product exists if product_id is provided
      if (body.product_id !== undefined) {
        const [product] = await db
          .select()
          .from(products)
          .where(
            and(
              eq(products.id, body.product_id),
              eq(products.organizationId, organizationId)
            )
          )
          .limit(1);

        if (!product) {
          set.status = 404;
          return { error: `Product with id ${body.product_id} not found` };
        }
      }

      // Check if code already exists
      const [existing] = await db
        .select()
        .from(discounts)
        .where(
          and(eq(discounts.code, body.code), eq(discounts.organizationId, organizationId))
        )
        .limit(1);

      if (existing) {
        set.status = 400;
        return { error: "Discount code already exists" };
      }

      const [discount] = await db
        .insert(discounts)
        .values({
          name: body.name,
          code: body.code,
          type: body.type,
          percentage: body.percentage.toString(),
          productId: body.product_id || null,
          organizationId,
        })
        .returning();

      set.status = 201;
      return {
        id: discount.id,
        name: discount.name,
        code: discount.code,
        type: discount.type,
        percentage: parseFloat(discount.percentage),
        product_id: discount.productId,
        organization_id: discount.organizationId ?? null,
      };
    },
    {
      body: "DiscountCreate",
      response: {
        201: "DiscountRead",
        400: t.Object({
          error: t.String(),
        }),
        401: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Create a new discount",
        tags: ["discounts"],
        description:
          "Create a new discount with code, type, and percentage. Requires bearer token authentication. The discount will be associated with the active organization from the session.",
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
        .from(discounts)
        .where(eq(discounts.organizationId, organizationId));

      const discountsList = query.search
        ? await baseQuery
            .where(
              and(
                eq(discounts.organizationId, organizationId),
                or(
                  ilike(discounts.name, `%${query.search}%`),
                  ilike(discounts.code, `%${query.search}%`)
                )
              )
            )
            .limit(limit)
            .offset(offset)
        : await baseQuery.limit(limit).offset(offset);

      return discountsList.map((d) => ({
        id: d.id,
        name: d.name,
        code: d.code,
        type: d.type,
        percentage: parseFloat(d.percentage),
        product_id: d.productId,
        organization_id: d.organizationId ?? null,
      }));
    },
    {
      query: t.Object({
        offset: t.Optional(t.Number({ default: 0 })),
        limit: t.Optional(t.Number({ default: 100 })),
        search: t.Optional(t.String()),
      }),
      response: {
        200: t.Array(DiscountRead),
        401: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Get a list of discounts",
        tags: ["discounts"],
        description:
          "Get a paginated list of discounts with optional search. Requires bearer token authentication. Returns only discounts belonging to the active organization from the session.",
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

      const [discount] = await db
        .select()
        .from(discounts)
        .where(and(eq(discounts.id, params.id), eq(discounts.organizationId, organizationId)))
        .limit(1);

      if (!discount) {
        set.status = 404;
        return { error: "Discount not found" };
      }

      return {
        id: discount.id,
        name: discount.name,
        code: discount.code,
        type: discount.type,
        percentage: parseFloat(discount.percentage),
        product_id: discount.productId,
        organization_id: discount.organizationId ?? null,
      };
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
      response: {
        200: "DiscountRead",
        401: t.Object({
          error: t.String(),
        }),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Get a single discount by ID",
        tags: ["discounts"],
        description:
          "Get discount details by ID. Requires bearer token authentication. Returns 404 if the discount doesn't belong to the active organization from the session.",
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .get(
    "/code/:code",
    async ({ params, set, request }) => {
      const authResult = await getOrganizationIdFromHeaders(request.headers);
      if (!authResult.organizationId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const organizationId = authResult.organizationId;

      const [discount] = await db
        .select()
        .from(discounts)
        .where(
          and(eq(discounts.code, params.code), eq(discounts.organizationId, organizationId))
        )
        .limit(1);

      if (!discount) {
        set.status = 404;
        return { error: "Discount not found" };
      }

      return {
        id: discount.id,
        name: discount.name,
        code: discount.code,
        type: discount.type,
        percentage: parseFloat(discount.percentage),
        product_id: discount.productId,
        organization_id: discount.organizationId ?? null,
      };
    },
    {
      params: t.Object({
        code: t.String(),
      }),
      response: {
        200: "DiscountRead",
        401: t.Object({
          error: t.String(),
        }),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Get a discount by code",
        tags: ["discounts"],
        description:
          "Get discount details by code. Requires bearer token authentication. Returns 404 if the discount doesn't belong to the active organization from the session.",
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
        .from(discounts)
        .where(and(eq(discounts.id, params.id), eq(discounts.organizationId, organizationId)))
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Discount not found" };
      }

      // Determine the final type after update
      const finalType = body.type !== undefined ? body.type : existing.type;

      // Validate: if type is individual_item, product_id is required
      if (finalType === "individual_item") {
        const finalProductId = body.product_id !== undefined ? body.product_id : existing.productId;
        if (!finalProductId) {
          set.status = 400;
          return {
            error: "product_id is required when discount type is 'individual_item'",
          };
        }

        // Validate product exists
        const [product] = await db
          .select()
          .from(products)
          .where(and(eq(products.id, finalProductId), eq(products.organizationId, organizationId)))
          .limit(1);

        if (!product) {
          set.status = 404;
          return { error: `Product with id ${finalProductId} not found` };
        }
      }

      // Validate: if type is for_all_item, product_id should be null
      if (finalType === "for_all_item" && body.product_id !== undefined && body.product_id !== null) {
        set.status = 400;
        return {
          error: "product_id should not be provided when discount type is 'for_all_item'",
        };
      }

      // Check if code is being updated and if it already exists
      if (body.code !== undefined && body.code !== existing.code) {
        const [codeExists] = await db
          .select()
          .from(discounts)
          .where(
            and(eq(discounts.code, body.code), eq(discounts.organizationId, organizationId))
          )
          .limit(1);

        if (codeExists) {
          set.status = 400;
          return { error: "Discount code already exists" };
        }
      }

      const updateData: {
        name?: string;
        code?: string;
        type?: string;
        percentage?: string;
        productId?: number | null;
      } = {};

      if (body.name !== undefined) updateData.name = body.name;
      if (body.code !== undefined) updateData.code = body.code;
      if (body.type !== undefined) updateData.type = body.type;
      if (body.percentage !== undefined)
        updateData.percentage = body.percentage.toString();
      if (body.product_id !== undefined) {
        updateData.productId = body.product_id === null ? null : body.product_id;
      }

      const [updated] = await db
        .update(discounts)
        .set(updateData)
        .where(and(eq(discounts.id, params.id), eq(discounts.organizationId, organizationId)))
        .returning();

      return {
        id: updated.id,
        name: updated.name,
        code: updated.code,
        type: updated.type,
        percentage: parseFloat(updated.percentage),
        product_id: updated.productId,
        organization_id: updated.organizationId ?? null,
      };
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
      body: "DiscountUpdate",
      response: {
        200: "DiscountRead",
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
        summary: "Update a discount by ID",
        tags: ["discounts"],
        description:
          "Partially update discount information. Requires bearer token authentication. Returns 404 if the discount doesn't belong to the active organization from the session.",
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

      const [discount] = await db
        .select()
        .from(discounts)
        .where(and(eq(discounts.id, params.id), eq(discounts.organizationId, organizationId)))
        .limit(1);

      if (!discount) {
        set.status = 404;
        return { error: "Discount not found" };
      }

      await db
        .delete(discounts)
        .where(and(eq(discounts.id, params.id), eq(discounts.organizationId, organizationId)));

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
        summary: "Delete a discount by ID",
        tags: ["discounts"],
        description:
          "Delete a discount from the system. Requires bearer token authentication. Returns 404 if the discount doesn't belong to the active organization from the session.",
        security: [{ bearerAuth: [] }],
      },
    }
  );
