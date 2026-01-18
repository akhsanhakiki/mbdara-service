import { Elysia, t } from "elysia";
import { pool } from "../db";
import {
  OrganizationCreate,
  OrganizationRead,
  OrganizationUpdate,
} from "../types";
import { randomUUID } from "crypto";

// Helper function to generate slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
}

// Helper function to ensure unique slug
async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const result = await pool.query(
      `SELECT id FROM neon_auth.organization WHERE slug = $1 LIMIT 1`,
      [slug]
    );

    if (result.rows.length === 0) {
      return slug;
    }

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

export const organizationsRouter = new Elysia({ prefix: "/organizations" })
  .model({
    OrganizationCreate,
    OrganizationRead,
    OrganizationUpdate,
  })
  .get(
    "/",
    async ({ query }) => {
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 100;

      let sql = `SELECT 
        id,
        name,
        slug,
        logo,
        "createdAt",
        metadata
      FROM neon_auth.organization`;

      const params: any[] = [];
      let paramCount = 0;

      if (query.search) {
        sql += ` WHERE name ILIKE $${++paramCount} OR slug ILIKE $${paramCount}`;
        params.push(`%${query.search}%`);
      }

      sql += ` ORDER BY "createdAt" DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
      params.push(limit, offset);

      const result = await pool.query(sql, params);

      return result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        logo: row.logo,
        createdAt: row.createdAt,
        metadata: row.metadata,
      }));
    },
    {
      query: t.Object({
        offset: t.Optional(t.Number({ default: 0 })),
        limit: t.Optional(t.Number({ default: 100 })),
        search: t.Optional(t.String()),
      }),
      response: {
        200: t.Array(OrganizationRead),
      },
      detail: {
        summary: "Get a list of organizations",
        tags: ["organizations"],
        description:
          "Get a paginated list of organizations with optional search",
      },
    }
  )
  .post(
    "/",
    async ({ body, set }) => {
      // Generate slug from name
      const baseSlug = generateSlug(body.name);
      const slug = await ensureUniqueSlug(baseSlug);

      const organizationId = randomUUID();

      try {
        const result = await pool.query(
          `INSERT INTO neon_auth.organization (id, name, slug, logo, metadata, "createdAt")
           VALUES ($1, $2, $3, $4, $5, NOW())
           RETURNING id, name, slug, logo, "createdAt", metadata`,
          [
            organizationId,
            body.name,
            slug,
            body.logo || null,
            body.metadata || null,
          ]
        );

        if (result.rows.length === 0) {
          set.status = 500;
          return { error: "Failed to create organization" };
        }

        const newOrg = result.rows[0];
        set.status = 201;
        return {
          id: newOrg.id,
          name: newOrg.name,
          slug: newOrg.slug,
          logo: newOrg.logo,
          createdAt: newOrg.createdAt,
          metadata: newOrg.metadata,
        };
      } catch (error: any) {
        // Check for unique constraint violation
        if (error.code === "23505") {
          set.status = 409;
          return { error: "Organization with this slug already exists" };
        }
        set.status = 500;
        return {
          error: "Failed to create organization",
          details: error.message,
        };
      }
    },
    {
      body: "OrganizationCreate",
      response: {
        201: "OrganizationRead",
        409: t.Object({
          error: t.String(),
        }),
        500: t.Object({
          error: t.String(),
          details: t.Optional(t.String()),
        }),
      },
      detail: {
        summary: "Create a new organization",
        tags: ["organizations"],
        description: "Create a new organization with auto-generated slug",
      },
    }
  )
  .get(
    "/:organizationId",
    async ({ params, set }) => {
      const result = await pool.query(
        `SELECT 
          id,
          name,
          slug,
          logo,
          "createdAt",
          metadata
        FROM neon_auth.organization
        WHERE id = $1`,
        [params.organizationId]
      );

      if (result.rows.length === 0) {
        set.status = 404;
        return { error: "Organization not found" };
      }

      const org = result.rows[0];
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        createdAt: org.createdAt,
        metadata: org.metadata,
      };
    },
    {
      params: t.Object({
        organizationId: t.String(),
      }),
      response: {
        200: "OrganizationRead",
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Get a single organization by ID",
        tags: ["organizations"],
        description: "Get organization details by ID",
      },
    }
  )
  .patch(
    "/:organizationId",
    async ({ params, body, set }) => {
      // Check if organization exists
      const checkResult = await pool.query(
        `SELECT id, name FROM neon_auth.organization WHERE id = $1`,
        [params.organizationId]
      );

      if (checkResult.rows.length === 0) {
        set.status = 404;
        return { error: "Organization not found" };
      }

      const existing = checkResult.rows[0];
      const updateFields: string[] = [];
      const paramsList: any[] = [];
      let paramCount = 0;

      // If name is being updated, regenerate slug
      if (body.name !== undefined && body.name !== existing.name) {
        const baseSlug = generateSlug(body.name);
        const slug = await ensureUniqueSlug(baseSlug);
        updateFields.push(`name = $${++paramCount}`, `slug = $${++paramCount}`);
        paramsList.push(body.name, slug);
      } else if (body.name !== undefined) {
        updateFields.push(`name = $${++paramCount}`);
        paramsList.push(body.name);
      }

      if (body.logo !== undefined) {
        updateFields.push(`logo = $${++paramCount}`);
        paramsList.push(body.logo || null);
      }

      if (body.metadata !== undefined) {
        updateFields.push(`metadata = $${++paramCount}`);
        paramsList.push(body.metadata || null);
      }

      if (updateFields.length === 0) {
        // No fields to update, return existing organization
        const result = await pool.query(
          `SELECT 
            id,
            name,
            slug,
            logo,
            "createdAt",
            metadata
          FROM neon_auth.organization
          WHERE id = $1`,
          [params.organizationId]
        );
        const org = result.rows[0];
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          logo: org.logo,
          createdAt: org.createdAt,
          metadata: org.metadata,
        };
      }

      paramsList.push(params.organizationId);
      const sql = `UPDATE neon_auth.organization
                   SET ${updateFields.join(", ")}
                   WHERE id = $${++paramCount}
                   RETURNING id, name, slug, logo, "createdAt", metadata`;

      try {
        const result = await pool.query(sql, paramsList);

        if (result.rows.length === 0) {
          set.status = 404;
          return { error: "Organization not found" };
        }

        const updated = result.rows[0];
        return {
          id: updated.id,
          name: updated.name,
          slug: updated.slug,
          logo: updated.logo,
          createdAt: updated.createdAt,
          metadata: updated.metadata,
        };
      } catch (error: any) {
        if (error.code === "23505") {
          set.status = 409;
          return { error: "Organization with this slug already exists" };
        }
        set.status = 500;
        return {
          error: "Failed to update organization",
          details: error.message,
        };
      }
    },
    {
      params: t.Object({
        organizationId: t.String(),
      }),
      body: "OrganizationUpdate",
      response: {
        200: "OrganizationRead",
        404: t.Object({
          error: t.String(),
        }),
        409: t.Object({
          error: t.String(),
        }),
        500: t.Object({
          error: t.String(),
          details: t.Optional(t.String()),
        }),
      },
      detail: {
        summary: "Update an organization by ID",
        tags: ["organizations"],
        description: "Partially update organization information",
      },
    }
  )
  .delete(
    "/:organizationId",
    async ({ params, set }) => {
      // Delete organization - members will be cascade deleted
      const result = await pool.query(
        `DELETE FROM neon_auth.organization WHERE id = $1 RETURNING id`,
        [params.organizationId]
      );

      if (result.rows.length === 0) {
        set.status = 404;
        return { error: "Organization not found" };
      }

      set.status = 204;
      return;
    },
    {
      params: t.Object({
        organizationId: t.String(),
      }),
      response: {
        204: t.Undefined(),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Delete an organization by ID",
        tags: ["organizations"],
        description: "Delete an organization and all its members (cascade)",
      },
    }
  );
