// Downscales and re-encodes a receipt photo client-side before upload.
// Phone cameras produce 3-8 MB originals; this brings them down to a JPEG
// with the longest edge capped at 1600px, which is plenty for Gemini to
// read line items off of and keeps Supabase storage usage sane.
//
// Pure browser-only logic — no Supabase imports, no network calls. If
// decode or encode fails for any reason (unsupported HEIC variant, corrupt
// file, no canvas support), the original file is returned unchanged: a big
// upload beats a broken one.

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

export type CompressResult = {
  blob: Blob;
  mimeType: string;
};

export async function compressImage(file: File): Promise<CompressResult> {
  try {
    const bitmap = await createImageBitmap(file);

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
