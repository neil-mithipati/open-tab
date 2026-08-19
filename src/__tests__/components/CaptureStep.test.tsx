import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CaptureStep } from "@/components/receipt/CaptureStep";
import type { useReceiptFlow } from "@/hooks/useReceiptFlow";

const refreshUserCaches = vi.fn();

vi.mock("@/app/actions/cache", () => ({
  refreshUserCaches: () => refreshUserCaches(),
}));

vi.mock("@/lib/image/compressImage", () => ({
  compressImage: async (file: File) => ({ blob: file, mimeType: "image/jpeg" }),
}));

// Browser Supabase: signed in, receipt insert returns a row, upload and signed
// URL both succeed. Enough for handleFile to reach the parse call.
vi.mock("@/lib/supabase/client", () => {
  const receipts = {
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: "r1" } }) }) }),
    update: () => ({ eq: async () => ({}) }),
  };
  const profiles = {
    select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }),
  };
  return {
    getSupabaseBrowserClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
      from: (table: string) => (table === "receipts" ? receipts : profiles),
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          createSignedUrl: async () => ({ data: { signedUrl: "https://signed/u1/r1.jpg" } }),
        }),
      },
    }),
  };
});

type Flow = ReturnType<typeof useReceiptFlow>;

function fakeFlow() {
  const update = vi.fn();
  const goTo = vi.fn();
  const flow = { update, goTo, addParticipant: vi.fn() } as unknown as Flow;
  return { flow, update, goTo };
}

function pickFile(container: HTMLElement) {
  const inputs = container.querySelectorAll('input[type="file"]');
  return inputs[inputs.length - 1] as HTMLInputElement;
}

beforeEach(() => {
  refreshUserCaches.mockReset();
});

describe("CaptureStep", () => {
  it("tells the user when the hourly scan limit is hit instead of advancing to an empty split", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "rate_limited", limit: 15 }),
    }) as unknown as typeof fetch;

    const { flow, goTo } = fakeFlow();
    const { container } = render(<CaptureStep flow={flow} />);

    await userEvent.upload(
      pickFile(container),
      new File(["x"], "receipt.jpg", { type: "image/jpeg" })
    );

    await waitFor(() => {
      expect(screen.getByText(/scan limit reached/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/15 receipts an hour/i)).toBeInTheDocument();
    expect(goTo).not.toHaveBeenCalledWith("split");
    expect(goTo).toHaveBeenLastCalledWith("capture");
    // the row the route just deleted must not linger in the cached dashboard
    expect(refreshUserCaches).toHaveBeenCalledTimes(2);
  });

  it("still falls through to manual entry on any other parse failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "parse_failed" }),
    }) as unknown as typeof fetch;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const { flow, goTo } = fakeFlow();
    const { container } = render(<CaptureStep flow={flow} />);

    await userEvent.upload(
      pickFile(container),
      new File(["x"], "receipt.jpg", { type: "image/jpeg" })
    );

    await waitFor(() => {
      expect(goTo).toHaveBeenLastCalledWith("split");
    });
    expect(screen.queryByText(/scan limit reached/i)).not.toBeInTheDocument();
    logged.mockRestore();
  });
});
