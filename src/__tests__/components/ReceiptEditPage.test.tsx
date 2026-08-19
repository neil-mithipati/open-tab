import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReceiptEditPage } from "@/app/receipts/[id]/ReceiptEditPage";
import type { ReceiptFlowState } from "@/hooks/useReceiptFlow";
import type { FlowParticipant, EditableItem } from "@/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockPrefetch = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh, prefetch: mockPrefetch }),
}));

const saveReceiptState = vi.fn();
vi.mock("@/app/actions/saveReceipt", () => ({
  saveReceiptState: (...args: unknown[]) => saveReceiptState(...args),
}));

const refreshUserCaches = vi.fn();
vi.mock("@/app/actions/cache", () => ({
  refreshUserCaches: (...args: unknown[]) => refreshUserCaches(...args),
}));

// Minimal chainable + thenable supabase mock, mirroring the one in
// ReceiptSplitStep.test.tsx — ReceiptSplitStep loads friends on mount.
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

function makeSeed(
  overrides: Partial<Omit<ReceiptFlowState, "step" | "imageFile">> = {}
): Omit<ReceiptFlowState, "step" | "imageFile"> {
  return {
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
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReceiptEditPage — rejected saveReceiptState", () => {
  beforeEach(() => {
    saveReceiptState.mockReset();
    refreshUserCaches.mockReset().mockResolvedValue(undefined);
    mockPush.mockReset();
  });

  it("toasts an error and re-enables Done when the save call throws", async () => {
    saveReceiptState.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();

    render(<ReceiptEditPage seed={makeSeed()} />);
    await act(async () => {});

    const doneButton = screen.getByRole("button", { name: "Done" });
    expect(doneButton).not.toBeDisabled();

    await user.click(doneButton);

    // A rejected call must not leave Done stuck disabled.
    await waitFor(() => expect(doneButton).not.toBeDisabled());
    expect(await screen.findByText(/couldn.t save/i)).toBeInTheDocument();

    // The failed save must not have navigated away or refreshed caches.
    expect(mockPush).not.toHaveBeenCalled();
    expect(refreshUserCaches).not.toHaveBeenCalled();
  });
});
