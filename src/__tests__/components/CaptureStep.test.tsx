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

  // A receipt that would not parse is exactly when someone needs to type the
  // items in by hand, so the row has to survive the failure and the flow has to
  // keep pointing at it. Only the 429 path clears receiptId, because only the
  // 429 path deletes the row.
  it.each([
    ["a parse error", 500, { error: "parse_failed" }],
    ["a refused replay", 409, { error: "already_parsed" }],
  ])(
    "still falls through to manual entry on %s, with the row intact",
    async (_label, status, payload) => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => payload,
      }) as unknown as typeof fetch;
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      const { flow, goTo, update } = fakeFlow();
      const { container } = render(<CaptureStep flow={flow} />);

      await userEvent.upload(
        pickFile(container),
        new File(["x"], "receipt.jpg", { type: "image/jpeg" })
      );

      await waitFor(() => {
        expect(goTo).toHaveBeenLastCalledWith("split");
      });
      expect(screen.queryByText(/scan limit reached/i)).not.toBeInTheDocument();
      // the manual editor opens on the receipt that was just created, not on
      // nothing
      expect(update).toHaveBeenCalledWith("receiptId", "r1");
      expect(update).not.toHaveBeenCalledWith("receiptId", null);
      logged.mockRestore();
    }
  );

  it("shows a distinct message when the parse route refuses with a 503 parse_unavailable, and still falls through to manual entry", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "parse_unavailable" }),
    }) as unknown as typeof fetch;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const { flow, goTo, update } = fakeFlow();
    const { container } = render(<CaptureStep flow={flow} />);

    await userEvent.upload(
      pickFile(container),
      new File(["x"], "receipt.jpg", { type: "image/jpeg" })
    );

    await waitFor(() => {
      expect(screen.getByText(/parsing is unavailable/i)).toBeInTheDocument();
    });
    // distinct from the 429 message
    expect(screen.queryByText(/scan limit reached/i)).not.toBeInTheDocument();
    expect(screen.getByText(/enter the items by hand/i)).toBeInTheDocument();
    expect(goTo).toHaveBeenLastCalledWith("split");
    // the row survives — a 503 doesn't discard anything the way a 429 does
    expect(update).toHaveBeenCalledWith("receiptId", "r1");
    expect(update).not.toHaveBeenCalledWith("receiptId", null);
    logged.mockRestore();
  });
});
