# MBDara Service

A simple POS (Point of Sale) API built with Elysia, Bun, and Drizzle ORM, connecting to Neon PostgreSQL.

## Features

- Product management (CRUD operations)
- Transaction processing with stock validation
- Optimized queries to prevent N+1 issues
- OpenAPI/Swagger documentation
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
   - The schema will be created automatically when you run the application
   - For production, use Drizzle Kit migrations instead

4. Start the development server:
```bash
bun run dev
```

## API Documentation

Once the server is running, visit:
- Swagger UI: http://localhost:3000/swagger
- API Root: http://localhost:3000/

## API Endpoints

### Products
- `POST /products` - Create a new product
- `GET /products` - List products (with pagination)
- `GET /products/:id` - Get a single product
- `PATCH /products/:id` - Update a product
- `DELETE /products/:id` - Delete a product

### Transactions
- `POST /transactions` - Create a new transaction (validates stock, deducts inventory)
- `GET /transactions` - List transactions (with pagination)
- `GET /transactions/:id` - Get a single transaction

## Architecture

- **Elysia** - Fast web framework
- **Drizzle ORM** - Type-safe ORM
- **pg (node-postgres)** - PostgreSQL driver with connection pooling
- **Neon** - Serverless PostgreSQL

## Connection Pooling

The application uses connection pooling optimized for Neon free tier:
- Base pool size: 3 connections
- Max connections: 8 (3 base + 5 overflow)
- Connection timeout: 10 seconds
