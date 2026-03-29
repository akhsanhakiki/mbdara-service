import sharp from "sharp";

/** Longest edge in pixels (fit inside; smaller images are not enlarged). */
export const PRODUCT_PHOTO_MAX_EDGE = 1600;

/**
 * Resize to fit inside PRODUCT_PHOTO_MAX_EDGE, apply EXIF orientation,
 * encode as optimized WebP.
 */
export async function optimizeProductPhotoToWebp(
  input: Buffer
): Promise<Buffer> {
  return sharp(input, { animated: false })
    .rotate()
    .resize({
      width: PRODUCT_PHOTO_MAX_EDGE,
      height: PRODUCT_PHOTO_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({
      quality: 82,
      alphaQuality: 100,
      effort: 6,
      smartSubsample: true,
    })
    .toBuffer();
}

/** Shop / organization logo — smaller max dimension than product photos. */
export const ORGANIZATION_LOGO_MAX_EDGE = 512;

export async function optimizeOrganizationLogoToWebp(
  input: Buffer
): Promise<Buffer> {
  return sharp(input, { animated: false })
    .rotate()
    .resize({
      width: ORGANIZATION_LOGO_MAX_EDGE,
      height: ORGANIZATION_LOGO_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({
      quality: 85,
      alphaQuality: 100,
      effort: 6,
      smartSubsample: true,
    })
    .toBuffer();
}
