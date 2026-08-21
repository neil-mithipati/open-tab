// Downscales and re-encodes a receipt photo client-side before upload.
// Phone cameras produce 3-8 MB originals; this brings them down to a JPEG
// with the longest edge capped at 1568px, which is plenty for Gemini to
// read line items off of and keeps Supabase storage usage sane.
//
// Pure browser-only logic — no Supabase imports, no network calls. If
// decode or encode fails for any reason (unsupported HEIC variant, corrupt
// file, no canvas support), the original file is returned unchanged: a big
// upload beats a broken one.

const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.7;

export type CompressResult = {
  blob: Blob;
  mimeType: string;
};

// Phone photos carry an EXIF orientation tag rather than pre-rotated pixels,
// and browsers disagree on whether drawing that source to a canvas applies
// it automatically. `imageOrientation: "from-image"` is the documented,
// spec'd way to make createImageBitmap normalize it for us, so orientation
// handling happens exactly once, here, regardless of what a given browser's
// unstated default would otherwise have done. A browser old enough to throw
// on the options object gets a plain decode instead: whatever that
// browser's own default behaviour is (auto-applied or not) is what results,
// but nothing downstream ever rotates a second time on top of it, so there
// is no double-rotation path either way.
async function decodeUpright(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return createImageBitmap(file);
  }
}

export async function compressImage(file: File): Promise<CompressResult> {
  try {
    const bitmap = await decodeUpright(file);

    const { width, height } = bitmap;
    const longestEdge = Math.max(width, height);
    const scale = longestEdge > MAX_EDGE ? MAX_EDGE / longestEdge : 1; // never upscale

    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return { blob: file, mimeType: file.type || "image/jpeg" };
    }

    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
    });

    if (!blob) {
      return { blob: file, mimeType: file.type || "image/jpeg" };
    }

    return { blob, mimeType: "image/jpeg" };
  } catch (err) {
    console.error("[compressImage] falling back to original file:", err);
    return { blob: file, mimeType: file.type || "image/jpeg" };
  }
}
