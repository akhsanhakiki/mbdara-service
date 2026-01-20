import { pool } from "../db";

/**
 * Extracts bearer token from Authorization header
 * @param authHeader - The Authorization header value (e.g., "Bearer <token>")
 * @returns The token string or null if not found
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null;
  }

  // Trim whitespace from token
  return parts[1].trim();
}

/**
 * Gets the active organization ID from a session token
 * @param token - The session token
 * @returns Object with organizationId and error message if any
 */
export async function getActiveOrganizationId(
  token: string
): Promise<{ organizationId: string | null; error: string | null }> {
  try {
    const trimmedToken = token.trim();
    
    // Query the session table - using quoted identifiers for camelCase columns
    const result = await pool.query(
      `SELECT 
        "activeOrganizationId",
        "expiresAt"
       FROM neon_auth.session
       WHERE token = $1
       LIMIT 1`,
      [trimmedToken]
    );

    if (result.rows.length === 0) {
      return {
        organizationId: null,
        error: "Session not found. Token may be invalid. Please verify the token exists in the neon_auth.session table.",
      };
    }

    const session = result.rows[0];

    // Check if session is expired
    const expiresAt = new Date(session.expiresAt);
    if (expiresAt < new Date()) {
      return {
        organizationId: null,
        error: "Session expired. Please login again.",
      };
    }

    if (!session.activeOrganizationId) {
      return {
        organizationId: null,
        error: "No active organization set for this session.",
      };
    }

    return { organizationId: session.activeOrganizationId, error: null };
  } catch (error) {
    return {
      organizationId: null,
      error: `Database error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Gets the active organization ID from request headers
 * @param headers - Request headers object
 * @returns Object with organizationId and error message if any
 */
export async function getOrganizationIdFromHeaders(
  headers: Headers
): Promise<{ organizationId: string | null; error: string | null }> {
  const authHeader = headers.get("authorization");
  
  if (!authHeader) {
    return { organizationId: null, error: "Missing Authorization header" };
  }

  const token = extractBearerToken(authHeader);

  if (!token) {
    return {
      organizationId: null,
      error: "Invalid Authorization header format. Expected: Bearer <token>",
    };
  }

  const result = await getActiveOrganizationId(token);
  
  if (result.error) {
    return { organizationId: null, error: result.error };
  }

  if (!result.organizationId) {
    return {
      organizationId: null,
      error: "Session not found, expired, or no active organization set",
    };
  }

  return { organizationId: result.organizationId, error: null };
}
