import { Elysia, t } from "elysia";
import { pool } from "../db";
import { UserInvite, UserRead, UserRoleUpdate } from "../types";
import { randomUUID } from "crypto";

export const usersRouter = new Elysia({ prefix: "/users" })
  .model({
    UserInvite,
    UserRead,
    UserRoleUpdate,
  })
  .get(
    "/",
    async ({ query }) => {
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 100;

      // Query user table directly - role is in the user table
      const result = await pool.query(
        `SELECT 
          id,
          email,
          name,
          "emailVerified",
          role,
          image
        FROM neon_auth."user"
        ORDER BY email
        LIMIT $1 OFFSET $2`,
        [limit, offset],
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role || null,
        emailVerified: row.emailVerified ?? null,
        image: row.image,
      }));
    },
    {
      query: t.Object({
        offset: t.Optional(t.Number({ default: 0 })),
        limit: t.Optional(t.Number({ default: 100 })),
      }),
      response: {
        200: t.Array(UserRead),
      },
      detail: {
        summary: "Get a list of users",
        tags: ["users"],
        description: "Get a paginated list of users with their roles",
      },
    },
  )
  .post(
    "/",
    async ({ body, set }) => {
      // Check if user with email already exists
      const checkResult = await pool.query(
        `SELECT id FROM neon_auth."user" WHERE email = $1 LIMIT 1`,
        [body.email],
      );

      if (checkResult.rows.length > 0) {
        set.status = 409;
        return { error: "User with this email already exists" };
      }

      // Create new user with role directly in user table
      const userId = randomUUID();

      try {
        // Create user with role
        const result = await pool.query(
          `INSERT INTO neon_auth."user" (id, email, name, "emailVerified", role, image)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, email, name, "emailVerified", role, image`,
          [userId, body.email, body.name || null, false, body.role, null],
        );

        if (result.rows.length === 0) {
          set.status = 500;
          return { error: "Failed to create user" };
        }

        const newUser = result.rows[0];
        set.status = 201;
        return {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
          emailVerified: newUser.emailVerified,
          image: newUser.image,
        };
      } catch (error: any) {
        set.status = 500;
        return { error: "Failed to create user", details: error.message };
      }
    },
    {
      body: "UserInvite",
      response: {
        201: "UserRead",
        409: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Invite a new user",
        tags: ["users"],
        description: "Create a new user with email and role",
      },
    },
  )
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      // Check if user exists and update role directly in user table
      const result = await pool.query(
        `UPDATE neon_auth."user"
         SET role = $1, "updatedAt" = NOW()
         WHERE id = $2
         RETURNING id, email, name, "emailVerified", role, image`,
        [body.role, params.id],
      );

      if (result.rows.length === 0) {
        set.status = 404;
        return { error: "User not found" };
      }

      const updatedUser = result.rows[0];
      return {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        emailVerified: updatedUser.emailVerified,
        image: updatedUser.image,
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: "UserRoleUpdate",
      response: {
        200: "UserRead",
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Update user role",
        tags: ["users"],
        description: "Update a user's role by ID",
      },
    },
  )
  .delete(
    "/:id",
    async ({ params, set }) => {
      // Delete user directly - no need to check member table
      const result = await pool.query(
        `DELETE FROM neon_auth."user" WHERE id = $1 RETURNING id`,
        [params.id],
      );

      if (result.rows.length === 0) {
        set.status = 404;
        return { error: "User not found" };
      }

      set.status = 204;
      return;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      response: {
        204: t.Undefined(),
        404: t.Object({
          error: t.String(),
        }),
      },
      detail: {
        summary: "Delete a user",
        tags: ["users"],
        description: "Delete a user by ID",
      },
    },
  );
