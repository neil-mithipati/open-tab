import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewReceiptPage from "@/app/receipts/new/page";
import type { ReceiptFlowState } from "@/hooks/useReceiptFlow";
import type { FlowParticipant, EditableItem } from "@/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const persistAndShare = vi.fn();
vi.mock("@/lib/receiptShare", () => ({
  persistAndShare: (...args: unknown[]) => persistAndShare(...args),
}));

const saveReceiptState = vi.fn();
vi.mock("@/app/actions/saveReceipt", () => ({
  saveReceiptState: (...args: unknown[]) => saveReceiptState(...args),
}));

const refreshUserCaches = vi.fn();
vi.mock("@/app/actions/cache", () => ({
  refreshUserCaches: (...args: unknown[]) => refreshUserCaches(...args),
}));

// Minimal chainable + thenable supabase mock, mirroring the one used in
// ReceiptEditPage.test.tsx and ReceiptSplitStep.test.tsx — ReceiptSplitStep
// loads friends on mount.
vi.mock("@/lib/supabase/client", () => {
  type QueryResult = { data: unknown; error: null };
  type MockBuilder = {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    then: (resolve: (value: QueryResult) => void) => void;
  };

  function makeBuilder(data: unknown) {
    const builder = {} as MockBuilder;
    builder.select = vi.fn().mockReturnValue(builder);
    builder.eq = vi.fn().mockReturnValue(builder);
    builder.insert = vi.fn().mockResolvedValue({ data: null, error: null });
    builder.delete = vi.fn().mockReturnValue(builder);
    builder.update = vi.fn().mockReturnValue(builder);
    builder.single = vi.fn().mockResolvedValue({ data: null, error: null });
    builder.then = (resolve: (value: QueryResult) => void) => resolve({ data, error: null });
    return builder;
  }

  const empty = makeBuilder([]);

  return {
    getSupabaseBrowserClient: vi.fn(() => ({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-user-id" } } }),
      },
      from: vi.fn(() => empty),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      storage: { from: vi.fn(() => ({ remove: vi.fn() })) },
    })),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "open_tab_receipt_flow";

const ownerParticipant: FlowParticipant = {
  clientId: "owner-1",
  type: "friend",
  userId: "u-owner",
  displayName: "Me",
  venmoUsername: "me",
  isOwner: true,
};

const defaultItems: EditableItem[] = [
  { clientId: "item-1", name: "Burger", price: 12.0, quantity: 1 },
];

function seedFlowState(overrides: Partial<Omit<ReceiptFlowState, "imageFile">> = {}) {
  const state: Omit<ReceiptFlowState, "imageFile"> = {
    step: "split",
    receiptId: "receipt-123",
    signedUrl: null,
    mimeType: null,
    merchantName: "Test Cafe",
    dateOfReceipt: "2025-05-24",
    subtotal: 12,
    tax: 0,
    tip: 0,
    total: 12,
    items: defaultItems,
    participants: [ownerParticipant],
    splitMode: "equal",
    assignments: {},
    ...overrides,
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("NewReceiptPage — share navigation timer", () => {
  beforeEach(() => {
    persistAndShare.mockReset();
    saveReceiptState.mockReset();
    refreshUserCaches.mockReset().mockResolvedValue(undefined);
    mockPush.mockReset();
    sessionStorage.clear();
    seedFlowState();
  });

  it("does not navigate if the component unmounts during the pending window", async () => {
    persistAndShare.mockResolvedValue({ url: "https://example.com/tab/xyz" });
    const user = userEvent.setup();

    const { unmount } = render(<NewReceiptPage />);
    await act(async () => {});

    const shareButton = screen.getByRole("button", { name: "Share to collect" });
    await user.click(shareButton);

    // Toast shown, navigation not yet scheduled to fire.
    expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();

    // Simulate the user tapping the X close button inside the 1.5s window —
    // the page unmounts before the pending push fires.
    unmount();

    // Wait past the 1.5s delay. The timer must have been cleared on
    // unmount, so no navigation should occur.
    await new Promise((resolve) => setTimeout(resolve, 1700));

    expect(mockPush).not.toHaveBeenCalled();
  }, 10000);

  it("navigates to the receipt page after the delay when left mounted", async () => {
    persistAndShare.mockResolvedValue({ url: "https://example.com/tab/xyz" });
    const user = userEvent.setup();

    render(<NewReceiptPage />);
    await act(async () => {});

    const shareButton = screen.getByRole("button", { name: "Share to collect" });
    await user.click(shareButton);
    await screen.findByText(/link copied/i);

    expect(mockPush).not.toHaveBeenCalled();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/receipts/receipt-123"), {
      timeout: 3000,
    });
  }, 10000);
});

describe("NewReceiptPage — Done/Share race", () => {
  beforeEach(() => {
    persistAndShare.mockReset();
    saveReceiptState.mockReset();
    refreshUserCaches.mockReset().mockResolvedValue(undefined);
    mockPush.mockReset();
    sessionStorage.clear();
    seedFlowState();
  });

  it("disables Done while a share is in flight", async () => {
    let resolveShare: (value: { url: string }) => void = () => {};
    persistAndShare.mockReturnValue(
      new Promise((resolve) => {
        resolveShare = resolve;
      })
    );
    const user = userEvent.setup();

    render(<NewReceiptPage />);
    await act(async () => {});

    const shareButton = screen.getByRole("button", { name: "Share to collect" });
    const doneButton = screen.getByRole("button", { name: "Done" });
    expect(doneButton).not.toBeDisabled();

    await user.click(shareButton);
    await waitFor(() => expect(doneButton).toBeDisabled());

    resolveShare({ url: "https://example.com/tab/xyz" });
    await waitFor(() => expect(doneButton).not.toBeDisabled());
  });
});

describe("NewReceiptPage — refreshUserCaches failure", () => {
  beforeEach(() => {
    persistAndShare.mockReset();
    saveReceiptState.mockReset();
    refreshUserCaches.mockReset();
    mockPush.mockReset();
    sessionStorage.clear();
    seedFlowState();
  });

  it("still navigates and does not report a save failure when only the cache refresh rejects", async () => {
    saveReceiptState.mockResolvedValue({ error: null });
    refreshUserCaches.mockRejectedValue(new Error("cache refresh down"));
    const user = userEvent.setup();

    render(<NewReceiptPage />);
    await act(async () => {});

    const doneButton = screen.getByRole("button", { name: "Done" });
    await user.click(doneButton);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByText(/couldn.t save/i)).not.toBeInTheDocument();
  });
});
