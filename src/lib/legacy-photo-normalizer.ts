/** Both implementations decode in a separate process. Only the generated WebP is sent to Storage. */
export async function getLegacyPhotoNormalizer() {
  if (process.env.NODE_ENV === "production") {
    const { getLegacyProductionDecoder } = await import("./production-media-runtime");
    return getLegacyProductionDecoder();
  }
  const { createLocalMediaWorker } = await import("./media-worker");
  return createLocalMediaWorker(process.cwd());
}
