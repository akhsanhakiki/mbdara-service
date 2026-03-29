import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PRESIGN_EXPIRES_SEC = 3600;

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function getClient(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const R2_ENV_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
] as const;

/** Names of required env vars that are missing or blank (after trim). */
export function getMissingR2EnvKeys(): string[] {
  return R2_ENV_KEYS.filter((k) => !String(process.env[k] ?? "").trim());
}

export function isR2Configured(): boolean {
  return getMissingR2EnvKeys().length === 0;
}

export function extensionForContentType(contentType: string): string | null {
  return ALLOWED_TYPES[contentType] ?? null;
}

/** Build public URL for an object key (segments encoded, slashes preserved). */
export function publicUrlForKey(key: string): string {
  const base = process.env.R2_PUBLIC_URL!.replace(/\/$/, "");
  const segments = key.split("/").map((s) => encodeURIComponent(s));
  return `${base}/${segments.join("/")}`;
}

export function photoUrlFromKey(
  key: string | null | undefined
): string | null {
  if (!key || !process.env.R2_PUBLIC_URL) return null;
  return publicUrlForKey(key);
}

export function productPhotoKeyPrefix(
  organizationId: string,
  productId: number
): string {
  return `org/${organizationId}/products/${productId}`;
}

export function isKeyForProduct(
  key: string,
  organizationId: string,
  productId: number
): boolean {
  const prefix = productPhotoKeyPrefix(organizationId, productId);
  return key === prefix || key.startsWith(`${prefix}/`);
}

export async function createPresignedProductPhotoUpload(
  key: string,
  contentType: string
): Promise<{ uploadUrl: string; expiresIn: number } | null> {
  const bucket = process.env.R2_BUCKET_NAME;
  const client = getClient();
  if (!bucket || !client) {
    return null;
  }
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: PRESIGN_EXPIRES_SEC,
  });
  return { uploadUrl, expiresIn: PRESIGN_EXPIRES_SEC };
}

export async function deleteObjectByKey(key: string): Promise<void> {
  const bucket = process.env.R2_BUCKET_NAME;
  const client = getClient();
  if (!bucket || !client) {
    return;
  }
  await client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key })
  );
}
