import type { ShrunkTexture, TextureCodec } from './glbOptimize';

/**
 * Browser image codec for `optimizeGlbTextures`: the browser decodes the JPEG/PNG, the image is halved step by step (a straight 4x
 * drawImage aliases), and re-encoded. `colorSpaceConversion: 'none'` keeps normal and metallic-roughness maps as raw data.
 */
export const browserTextureCodec: TextureCodec = {
  async shrink(bytes, mime, { maxSize, quality }): Promise<ShrunkTexture | null> {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') throw new Error('this browser cannot resize images');
    const copy = new Uint8Array(bytes); // detach from the GLB's backing buffer
    const bmp = await createImageBitmap(new Blob([copy], { type: mime }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const originalWidth = bmp.width;
    const originalHeight = bmp.height;
    const scale = Math.min(1, maxSize / Math.max(originalWidth, originalHeight));
    if (scale >= 1) {
      bmp.close();
      return null;
    }
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));

    let source: ImageBitmap | OffscreenCanvas = bmp;
    let w = originalWidth;
    let h = originalHeight;
    while (w > width * 2 || h > height * 2) {
      const nw = Math.max(width, Math.ceil(w / 2));
      const nh = Math.max(height, Math.ceil(h / 2));
      const step = new OffscreenCanvas(nw, nh);
      const sctx = step.getContext('2d')!;
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(source, 0, 0, nw, nh);
      source = step;
      w = nw;
      h = nh;
    }
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    bmp.close();

    const keepPng = mime === 'image/png';
    const out = await canvas.convertToBlob(keepPng ? { type: 'image/png' } : { type: 'image/jpeg', quality });
    return { bytes: new Uint8Array(await out.arrayBuffer()), mime: keepPng ? 'image/png' : 'image/jpeg', width, height, originalWidth, originalHeight };
  },
};
