# MBDara Service

A simple cashier API built with Elysia, Bun, and Drizzle ORM, connecting to Neon PostgreSQL.

## Features

- Product management (CRUD operations)
- Transaction processing with stock validation and automatic inventory deduction
- Optimized queries to prevent N+1 issues (eager loading with batch queries)
- OpenAPI documentation
- Connection pooling optimized for Neon

## Prerequisites

- Bun runtime (v1.0+)
- Neon PostgreSQL database

## Setup

1. Install dependencies:

```bash
bun install
```

2. Create a `.env` file in the root directory:

```bash
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require
PORT=3000
```

3. Set up the database schema:

   - Create the database tables manually or use Drizzle Kit migrations
   - Tables: `product`, `transaction`, `transactionitem`
   - See `src/db/schema.ts` for the schema definition

4. Start the development server:

```bash
bun run dev
```

## API Documentation

Once the server is running, visit:

- OpenAPI Documentation: http://localhost:3000/documentation
- API Root: http://localhost:3000/

## API Endpoints

### Products

- `POST /products` - Create a new product
- `GET /products` - List products (with pagination: `offset`, `limit` query params)
- `GET /products/:id` - Get a single product by ID
- `PATCH /products/:id` - Partially update a product
- `DELETE /products/:id` - Delete a product

### Transactions

- `POST /transactions` - Create a new transaction
  - Validates stock availability
  - Deducts inventory automatically
  - Calculates total amount
  - Returns transaction with items and product names
- `GET /transactions` - List transactions (with pagination: `offset`, `limit` query params)
  - Returns transactions ordered by creation date (newest first)
  - Includes items with product names (optimized to prevent N+1 queries)
- `GET /transactions/:id` - Get a single transaction by ID
  - Includes items with product names

## Architecture

- **Elysia** - Fast web framework
- **Drizzle ORM** - Type-safe ORM
- **pg (node-postgres)** - PostgreSQL driver with connection pooling
- **Neon** - Serverless PostgreSQL

## Connection Pooling

The application uses connection pooling optimized for Neon free tier:

- Max connections: 3
- Idle timeout: 30 seconds
- Connection timeout: 10 seconds
- SSL enabled (required for Neon)
- Application name: `mb_dara` (for database monitoring)
