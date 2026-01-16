import { Elysia, t } from "elysia";
import { pool } from "../db";
import { MemberCreate, MemberRead, MemberUpdate } from "../types";
import { randomUUID } from "crypto";

export const membersRouter = new Elysia({ prefix: "/organizations" })
  .model({
    MemberCreate,
    MemberRead,
    MemberUpdate,
  })
  .get(
    "/:organizationId/members",
    async ({ params, set }) => {
      // Check if organization exists
      const orgCheck = await pool.query(
        `SELECT id FROM neon_auth.organization WHERE id = $1`,
        [params.organizationId]
      );

      if (orgCheck.rows.length === 0) {
        set.status = 404;
        return { error: "Organization not found" };
      }

      // Get all members with user information
      const result = await pool.query(
        `SELECT 
          m.id,
          m."organizationId",
          m."userId",
          m.role,
          m."createdAt",
          u.id as user_id,
          u.email as user_email,
          u.name as user_name,
          u.image as user_image
        FROM neon_auth.member m
        INNER JOIN neon_auth."user" u ON m."userId" = u.id
        WHERE m."organizationId" = $1
        ORDER BY m."createdAt" DESC`,
        [params.organizationId]
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        organizationId: row.organizationId,
        userId: row.userId,
        role: row.role,
        createdAt: row.createdAt,
        user: {
          id: row.user_id,
          email: row.user_email,
          name: row.user_name,
          image: row.user_image,
        },
      }));
    },
    {
      params: t.Object({
        organizationId: t.String(),
      }),
      response: {
        200: t.Array(MemberRead),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Get all members of an organization",
        tags: ["members"],
        description: "Get a list of all members for an organization with user information",
      },
    }
  )
  .post(
    "/:organizationId/members",
    async ({ params, body, set }) => {
      // Check if organization exists
      const orgCheck = await pool.query(
        `SELECT id FROM neon_auth.organization WHERE id = $1`,
        [params.organizationId]
      );

      if (orgCheck.rows.length === 0) {
        set.status = 404;
        return { error: "Organization not found" };
      }

      // Check if user exists
      const userCheck = await pool.query(
        `SELECT id, email, name, image FROM neon_auth."user" WHERE id = $1`,
        [body.userId]
      );

      if (userCheck.rows.length === 0) {
        set.status = 404;
        return { error: "User not found" };
      }

      // Check if user is already a member
      const memberCheck = await pool.query(
        `SELECT id FROM neon_auth.member 
         WHERE "organizationId" = $1 AND "userId" = $2`,
        [params.organizationId, body.userId]
      );

      if (memberCheck.rows.length > 0) {
        set.status = 409;
        return { error: "User is already a member of this organization" };
      }

      const memberId = randomUUID();

      try {
        const result = await pool.query(
          `INSERT INTO neon_auth.member (id, "organizationId", "userId", role, "createdAt")
           VALUES ($1, $2, $3, $4, NOW())
           RETURNING id, "organizationId", "userId", role, "createdAt"`,
          [memberId, params.organizationId, body.userId, body.role]
        );

        if (result.rows.length === 0) {
          set.status = 500;
          return { error: "Failed to create member" };
        }

        const newMember = result.rows[0];
        const user = userCheck.rows[0];

        set.status = 201;
        return {
          id: newMember.id,
          organizationId: newMember.organizationId,
          userId: newMember.userId,
          role: newMember.role,
          createdAt: newMember.createdAt,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
          },
        };
      } catch (error: any) {
        set.status = 500;
        return { error: "Failed to create member", details: error.message };
      }
    },
    {
      params: t.Object({
        organizationId: t.String(),
      }),
      body: "MemberCreate",
      response: {
        201: "MemberRead",
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
        summary: "Add a user to an organization",
        tags: ["members"],
        description: "Create a new member relationship between a user and organization",
      },
    }
  )
  .patch(
    "/:organizationId/members/:memberId",
    async ({ params, body, set }) => {
      // Check if organization exists
      const orgCheck = await pool.query(
        `SELECT id FROM neon_auth.organization WHERE id = $1`,
        [params.organizationId]
      );

      if (orgCheck.rows.length === 0) {
        set.status = 404;
        return { error: "Organization not found" };
      }

      // Check if member exists and belongs to the organization
      const memberCheck = await pool.query(
        `SELECT m.id, m."userId"
         FROM neon_auth.member m
         WHERE m.id = $1 AND m."organizationId" = $2`,
        [params.memberId, params.organizationId]
      );

      if (memberCheck.rows.length === 0) {
        set.status = 404;
        return { error: "Member not found" };
      }

      if (body.role === undefined) {
        // No update needed, return current member
        const result = await pool.query(
          `SELECT 
            m.id,
            m."organizationId",
            m."userId",
            m.role,
            m."createdAt",
            u.id as user_id,
            u.email as user_email,
            u.name as user_name,
            u.image as user_image
          FROM neon_auth.member m
          INNER JOIN neon_auth."user" u ON m."userId" = u.id
          WHERE m.id = $1`,
          [params.memberId]
        );

        const row = result.rows[0];
        return {
          id: row.id,
          organizationId: row.organizationId,
          userId: row.userId,
          role: row.role,
          createdAt: row.createdAt,
          user: {
            id: row.user_id,
            email: row.user_email,
            name: row.user_name,
            image: row.user_image,
          },
        };
      }

      // Update member role
      const result = await pool.query(
        `UPDATE neon_auth.member
         SET role = $1
         WHERE id = $2 AND "organizationId" = $3
         RETURNING id, "organizationId", "userId", role, "createdAt"`,
        [body.role, params.memberId, params.organizationId]
      );

      if (result.rows.length === 0) {
        set.status = 404;
        return { error: "Member not found" };
      }

      // Get user information
      const userResult = await pool.query(
        `SELECT id, email, name, image FROM neon_auth."user" WHERE id = $1`,
        [memberCheck.rows[0].userId]
      );

      const updatedMember = result.rows[0];
      const user = userResult.rows[0];

      return {
        id: updatedMember.id,
        organizationId: updatedMember.organizationId,
        userId: updatedMember.userId,
        role: updatedMember.role,
        createdAt: updatedMember.createdAt,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        },
      };
    },
    {
      params: t.Object({
        organizationId: t.String(),
        memberId: t.String(),
      }),
      body: "MemberUpdate",
      response: {
        200: "MemberRead",
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Update a member's role",
        tags: ["members"],
        description: "Update the role of a member in an organization",
      },
    }
  )
  .delete(
    "/:organizationId/members/:memberId",
    async ({ params, set }) => {
      // Check if organization exists
      const orgCheck = await pool.query(
        `SELECT id FROM neon_auth.organization WHERE id = $1`,
        [params.organizationId]
      );

      if (orgCheck.rows.length === 0) {
        set.status = 404;
        return { error: "Organization not found" };
      }

      // Delete member
      const result = await pool.query(
        `DELETE FROM neon_auth.member 
         WHERE id = $1 AND "organizationId" = $2
         RETURNING id`,
        [params.memberId, params.organizationId]
      );

      if (result.rows.length === 0) {
        set.status = 404;
        return { error: "Member not found" };
      }

      set.status = 204;
      return;
    },
    {
      params: t.Object({
        organizationId: t.String(),
        memberId: t.String(),
      }),
      response: {
        204: t.Undefined(),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Remove a member from an organization",
        tags: ["members"],
        description: "Delete a member relationship between a user and organization",
      },
    }
  );
