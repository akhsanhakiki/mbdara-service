import { Elysia, t } from "elysia";
import { pool } from "../db";
import {
  OrganizationCreate,
  OrganizationRead,
  OrganizationUpdate,
  OrganizationLogoUploadBody,
} from "../types";
import { randomUUID } from "crypto";
import { getUserIdFromHeaders } from "../utils/auth";
import {
  deleteObjectByKey,
  getMissingR2EnvKeys,
  isR2Configured,
  organizationLogoKeyPrefix,
  photoUrlFromKey,
  putWebpObject,
} from "../lib/r2";
import { optimizeOrganizationLogoToWebp } from "../lib/product-image";

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
function mapOrganizationLogo(row: {
  logo: string | null;
  logo_key: string | null;
}): string | null {
  return photoUrlFromKey(row.logo_key) ?? row.logo ?? null;
}

async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const result = await pool.query(
      `SELECT id FROM neon_auth.organization WHERE slug = $1 LIMIT 1`,
      [slug],
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
    OrganizationLogoUploadBody,
  })
  .get(
    "/",
    async ({ query, set, request }) => {
      const authResult = await getUserIdFromHeaders(request.headers);
      if (!authResult.userId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const userId = authResult.userId;

      const offset = query.offset ?? 0;
      const limit = query.limit ?? 100;

      let sql = `SELECT DISTINCT
        o.id,
        o.name,
        o.slug,
        o.logo,
        o.logo_key,
        o."createdAt",
        o.metadata
      FROM neon_auth.organization o
      INNER JOIN neon_auth.member m ON o.id = m."organizationId"
      WHERE m."userId" = $1`;

      const params: any[] = [userId];
      let paramCount = 1;

      if (query.search) {
        sql += ` AND (o.name ILIKE $${++paramCount} OR o.slug ILIKE $${paramCount})`;
        params.push(`%${query.search}%`);
      }

      sql += ` ORDER BY o."createdAt" DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
      params.push(limit, offset);

      const result = await pool.query(sql, params);

      return result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        logo: mapOrganizationLogo(row),
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
        401: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Get a list of organizations",
        tags: ["organizations"],
        description:
          "Get a paginated list of organizations with optional search. Requires bearer token authentication. Returns only organizations the user is a member of.",
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    "/",
    async ({ body, set, request }) => {
      const authResult = await getUserIdFromHeaders(request.headers);
      if (!authResult.userId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const userId = authResult.userId;

      // Generate slug from name
      const baseSlug = generateSlug(body.name);
      const slug = await ensureUniqueSlug(baseSlug);

      const organizationId = randomUUID();
      const memberId = randomUUID();

      try {
        // Start transaction: create organization and add user as admin member
        await pool.query("BEGIN");

        const orgResult = await pool.query(
          `INSERT INTO neon_auth.organization (id, name, slug, metadata, "createdAt")
           VALUES ($1, $2, $3, $4, NOW())
           RETURNING id, name, slug, logo, logo_key, "createdAt", metadata`,
          [organizationId, body.name, slug, body.metadata || null],
        );

        if (orgResult.rows.length === 0) {
          await pool.query("ROLLBACK");
          set.status = 500;
          return { error: "Failed to create organization" };
        }

        // Add the creator as an admin member
        await pool.query(
          `INSERT INTO neon_auth.member (id, "organizationId", "userId", role, "createdAt")
           VALUES ($1, $2, $3, $4, NOW())`,
          [memberId, organizationId, userId, "admin"],
        );

        await pool.query("COMMIT");

        const newOrg = orgResult.rows[0];
        set.status = 201;
        return {
          id: newOrg.id,
          name: newOrg.name,
          slug: newOrg.slug,
          logo: mapOrganizationLogo(newOrg),
          createdAt: newOrg.createdAt,
          metadata: newOrg.metadata,
        };
      } catch (error: any) {
        await pool.query("ROLLBACK");
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
        401: t.Object({
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
        summary: "Create a new organization",
        tags: ["organizations"],
        description: "Create a new organization with auto-generated slug. Requires bearer token authentication. The creator is automatically added as an admin member.",
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    "/:organizationId/logo/upload-url",
    async ({ params, body, set, request }) => {
      const authResult = await getUserIdFromHeaders(request.headers);
      if (!authResult.userId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const userId = authResult.userId;

      if (!isR2Configured()) {
        set.status = 503;
        const missing = getMissingR2EnvKeys();
        return {
          error: `Object storage is not configured. Missing or empty: ${missing.join(", ")}. Add them to .env (exact names) and restart the server.`,
        };
      }

      const memberResult = await pool.query(
        `SELECT o.id, o.logo_key, o.logo
         FROM neon_auth.organization o
         INNER JOIN neon_auth.member m ON o.id = m."organizationId"
         WHERE o.id = $1 AND m."userId" = $2`,
        [params.organizationId, userId],
      );

      if (memberResult.rows.length === 0) {
        set.status = 404;
        return { error: "Organization not found" };
      }

      const org = memberResult.rows[0];
      const raw = Buffer.from(await body.file.arrayBuffer());
      let webp: Buffer;
      try {
        webp = await optimizeOrganizationLogoToWebp(raw);
      } catch {
        set.status = 400;
        return {
          error:
            "Could not process image. Use a valid JPEG, PNG, GIF, or WebP file.",
        };
      }

      const logoKey = `${organizationLogoKeyPrefix(org.id)}/${crypto.randomUUID()}.webp`;

      if (org.logo_key) {
        await deleteObjectByKey(org.logo_key);
      }

      try {
        await putWebpObject(logoKey, webp);
      } catch {
        set.status = 503;
        return { error: "Could not store image in object storage" };
      }

      const updateResult = await pool.query(
        `UPDATE neon_auth.organization
         SET logo_key = $1, logo = NULL
         WHERE id = $2
         RETURNING id, name, slug, logo, logo_key, "createdAt", metadata`,
        [logoKey, params.organizationId],
      );

      const updated = updateResult.rows[0];
      return {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        logo: mapOrganizationLogo(updated),
        createdAt: updated.createdAt,
        metadata: updated.metadata,
      };
    },
    {
      params: t.Object({
        organizationId: t.String(),
      }),
      body: "OrganizationLogoUploadBody",
      response: {
        200: "OrganizationRead",
        400: t.Object({ error: t.String() }),
        401: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        503: t.Object({ error: t.String() }),
      },
      detail: {
        summary: "Upload shop (organization) logo",
        tags: ["organizations"],
        description:
          "multipart/form-data field `file`. Logo is resized (max edge 512px), optimized WebP, stored in R2. Replaces any existing logo URL or file.",
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    "/:organizationId/logo",
    async ({ params, set, request }) => {
      const authResult = await getUserIdFromHeaders(request.headers);
      if (!authResult.userId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const userId = authResult.userId;

      const memberResult = await pool.query(
        `SELECT o.id, o.logo_key
         FROM neon_auth.organization o
         INNER JOIN neon_auth.member m ON o.id = m."organizationId"
         WHERE o.id = $1 AND m."userId" = $2`,
        [params.organizationId, userId],
      );

      if (memberResult.rows.length === 0) {
        set.status = 404;
        return { error: "Organization not found" };
      }

      const org = memberResult.rows[0];
      if (org.logo_key) {
        await deleteObjectByKey(org.logo_key);
      }

      const updateResult = await pool.query(
        `UPDATE neon_auth.organization
         SET logo_key = NULL, logo = NULL
         WHERE id = $1
         RETURNING id, name, slug, logo, logo_key, "createdAt", metadata`,
        [params.organizationId],
      );

      const updated = updateResult.rows[0];
      return {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        logo: mapOrganizationLogo(updated),
        createdAt: updated.createdAt,
        metadata: updated.metadata,
      };
    },
    {
      params: t.Object({
        organizationId: t.String(),
      }),
      response: {
        200: "OrganizationRead",
        401: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
      },
      detail: {
        summary: "Remove shop logo",
        tags: ["organizations"],
        description:
          "Clears logo URL and removes the logo file from object storage if present.",
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    "/:organizationId",
    async ({ params, set, request }) => {
      const authResult = await getUserIdFromHeaders(request.headers);
      if (!authResult.userId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const userId = authResult.userId;

      const result = await pool.query(
        `SELECT 
          o.id,
          o.name,
          o.slug,
          o.logo,
          o.logo_key,
          o."createdAt",
          o.metadata
        FROM neon_auth.organization o
        INNER JOIN neon_auth.member m ON o.id = m."organizationId"
        WHERE o.id = $1 AND m."userId" = $2`,
        [params.organizationId, userId],
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
        logo: mapOrganizationLogo(org),
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
        401: t.Object({
          error: t.String(),
        }),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Get a single organization by ID",
        tags: ["organizations"],
        description: "Get organization details by ID. Requires bearer token authentication. Returns 404 if the user is not a member of the organization.",
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    "/:organizationId",
    async ({ params, body, set, request }) => {
      const authResult = await getUserIdFromHeaders(request.headers);
      if (!authResult.userId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const userId = authResult.userId;

      // Check if organization exists and user is a member
      const checkResult = await pool.query(
        `SELECT o.id, o.name 
         FROM neon_auth.organization o
         INNER JOIN neon_auth.member m ON o.id = m."organizationId"
         WHERE o.id = $1 AND m."userId" = $2`,
        [params.organizationId, userId],
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
            logo_key,
            "createdAt",
            metadata
          FROM neon_auth.organization
          WHERE id = $1`,
          [params.organizationId],
        );
        const org = result.rows[0];
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          logo: mapOrganizationLogo(org),
          createdAt: org.createdAt,
          metadata: org.metadata,
        };
      }

      paramsList.push(params.organizationId);
      const sql = `UPDATE neon_auth.organization
                   SET ${updateFields.join(", ")}
                   WHERE id = $${++paramCount}
                   RETURNING id, name, slug, logo, logo_key, "createdAt", metadata`;

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
          logo: mapOrganizationLogo(updated),
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
        401: t.Object({
          error: t.String(),
        }),
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
        description: "Partially update organization information. Requires bearer token authentication. Returns 404 if the user is not a member of the organization.",
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    "/:organizationId",
    async ({ params, set, request }) => {
      const authResult = await getUserIdFromHeaders(request.headers);
      if (!authResult.userId) {
        set.status = 401;
        return {
          error: `Unauthorized: ${authResult.error || "Invalid or missing bearer token"}`,
        };
      }
      const userId = authResult.userId;

      // Check if organization exists and user is a member
      const checkResult = await pool.query(
        `SELECT o.id, o.logo_key
         FROM neon_auth.organization o
         INNER JOIN neon_auth.member m ON o.id = m."organizationId"
         WHERE o.id = $1 AND m."userId" = $2`,
        [params.organizationId, userId],
      );

      if (checkResult.rows.length === 0) {
        set.status = 404;
        return { error: "Organization not found" };
      }

      const row = checkResult.rows[0];
      if (row.logo_key) {
        await deleteObjectByKey(row.logo_key);
      }

      // Delete organization - members will be cascade deleted
      const result = await pool.query(
        `DELETE FROM neon_auth.organization WHERE id = $1 RETURNING id`,
        [params.organizationId],
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
        401: t.Object({
          error: t.String(),
        }),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Delete an organization by ID",
        tags: ["organizations"],
        description: "Delete an organization and all its members (cascade). Requires bearer token authentication. Returns 404 if the user is not a member of the organization.",
        security: [{ bearerAuth: [] }],
      },
    },
  );
