import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import * as schema from './schema';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL not found in environment variables');
}

// Connection pooling optimized for Neon free tier
// - max: 3 connections ready (pool_size)
// - max: 8 total connections (3 base + 5 overflow)
// - connectionTimeoutMillis: 10 seconds (pool_timeout)
// - connect_timeout: 3 seconds
// - ssl: required for Neon
// - application_name: for database monitoring
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 3, // Keep 3 connections ready
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Timeout for getting connection from pool
  ssl: {
    rejectUnauthorized: false, // SSL mode require (for Neon)
  },
  // Set application name via connection string or after connection
});

// Set application name for each new connection
pool.on('connect', async (client) => {
  await client.query(`SET application_name = 'mb_dara'`);
});

export const db = drizzle(pool, { schema });
export { pool };

