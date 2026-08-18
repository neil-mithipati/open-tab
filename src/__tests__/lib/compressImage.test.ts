import { describe, it, expect, vi, afterEach } from "vitest";
import { compressImage } from "@/lib/image/compressImage";

// happy-dom (our test environment) has no real image codec, so these tests
// exercise the guard logic rather than pixel output: decode/encode failure
// must fall back to returning the original file unchanged.

function makeFile(name = "receipt.jpg", type = "image/jpeg") {
  return new File(["fake-image-bytes"], name, { type });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compressImage fallback contract", () => {
  it("returns the original file when createImageBitmap throws (decode failure)", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decode failed")));

    const file = makeFile();
    const result = await compressImage(file);

    expect(result.blob).toBe(file);
    expect(result.mimeType).toBe(file.type);
  });

  it("falls back to the original file's type when the file has no type set", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decode failed")));

    const file = new File(["bytes"], "photo", { type: "" });
    const result = await compressImage(file);

    expect(result.blob).toBe(file);
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("returns the original file when canvas.toBlob yields null (encode failure)", async () => {
    const fakeBitmap = { width: 2000, height: 1000, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(fakeBitmap));

    const fakeCtx = { drawImage: vi.fn() };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(fakeCtx),
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
    };
    vi.spyOn(document, "createElement").mockReturnValue(fakeCanvas as unknown as HTMLCanvasElement);

    const file = makeFile();
    const result = await compressImage(file);

    expect(result.blob).toBe(file);
    expect(result.mimeType).toBe(file.type);

    vi.restoreAllMocks();
  });

  it("returns the original file when the canvas has no 2d context available", async () => {
    const fakeBitmap = { width: 2000, height: 1000, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(fakeBitmap));

    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(null),
      toBlob: vi.fn(),
    };
    vi.spyOn(document, "createElement").mockReturnValue(fakeCanvas as unknown as HTMLCanvasElement);

    const file = makeFile();
    const result = await compressImage(file);

    expect(result.blob).toBe(file);
    expect(result.mimeType).toBe(file.type);

    vi.restoreAllMocks();
  });

  it("never upscales: scale factor stays at 1 when the longest edge is already under the cap", async () => {
    const fakeBitmap = { width: 800, height: 600, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(fakeBitmap));

    const fakeCtx = { drawImage: vi.fn() };
    const compressedBlob = new Blob(["compressed"], { type: "image/jpeg" });
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(fakeCtx),
      toBlob: (cb: (b: Blob | null) => void) => cb(compressedBlob),
    };
    vi.spyOn(document, "createElement").mockReturnValue(fakeCanvas as unknown as HTMLCanvasElement);

    const file = makeFile();
    const result = await compressImage(file);

    expect(fakeCanvas.width).toBe(800);
    expect(fakeCanvas.height).toBe(600);
    expect(result.blob).toBe(compressedBlob);
    expect(result.mimeType).toBe("image/jpeg");

    vi.restoreAllMocks();
  });

  it("downscales the longest edge to the 1600px cap while preserving aspect ratio", async () => {
    const fakeBitmap = { width: 4000, height: 2000, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(fakeBitmap));

    const fakeCtx = { drawImage: vi.fn() };
    const compressedBlob = new Blob(["compressed"], { type: "image/jpeg" });
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(fakeCtx),
      toBlob: (cb: (b: Blob | null) => void) => cb(compressedBlob),
    };
    vi.spyOn(document, "createElement").mockReturnValue(fakeCanvas as unknown as HTMLCanvasElement);

    const file = makeFile();
    const result = await compressImage(file);

    expect(fakeCanvas.width).toBe(1600);
    expect(fakeCanvas.height).toBe(800);
    expect(result.blob).toBe(compressedBlob);

    vi.restoreAllMocks();
  });
});
