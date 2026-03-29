/**
 * One-off: upload a tiny PNG to R2 and set photo_key on the first product.
 * Requires DATABASE_URL and full R2 env vars (same as the API).
 *
 * Usage: bun run scripts/upload-sample-product-photo.ts
 */
import dotenv from "dotenv";
dotenv.config();

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eq, isNotNull } from "drizzle-orm";
import { db, pool } from "../src/db";
import { products } from "../src/db/schema";
import {
  isR2Configured,
  photoUrlFromKey,
  productPhotoKeyPrefix,
} from "../src/lib/r2";

// 1×1 transparent PNG
const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function main() {
  if (!isR2Configured()) {
    console.error(
      "R2 is not fully configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL."
    );
    process.exit(1);
  }

  const [row] = await db
    .select()
    .from(products)
    .where(isNotNull(products.organizationId))
    .limit(1);
  if (!row) {
    console.error(
      "No product with organization_id found. Create one via the API with auth."
    );
    process.exit(1);
  }

  const accountId = process.env.R2_ACCOUNT_ID!;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  const key = `${productPhotoKeyPrefix(row.organizationId, row.id)}/sample-${crypto.randomUUID()}.png`;

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: SAMPLE_PNG,
      ContentType: "image/png",
    })
  );

  await db
    .update(products)
    .set({ photoKey: key })
    .where(eq(products.id, row.id));

  console.log(`Updated product id=${row.id} (${row.name})`);
  console.log(`photo_key=${key}`);
  console.log(`photo_url=${photoUrlFromKey(key)}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => pool.end());
