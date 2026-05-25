import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChargeScreen } from "@/components/receipt/ChargeScreen";
import type { ReceiptFlowState } from "@/hooks/useReceiptFlow";
import type { ComputedCharge, FlowParticipant } from "@/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockReset = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const alice: FlowParticipant = {
  clientId: "alice",
  type: "friend",
  displayName: "Alice Smith",
  venmoUsername: "alicesmith",
  isOwner: false,
};

const bob: FlowParticipant = {
  clientId: "bob",
  type: "manual",
  displayName: "bob",
  venmoUsername: "bob",
  isOwner: false,
};

const charges: ComputedCharge[] = [
  {
    participant: alice,
    amount: 13.0,
    venmoLink: "https://venmo.com/paycharge?txn=pay&recipients=alicesmith&amount=13.00&note=open-tab",
    venmoAppLink: "venmo://paycharge?txn=pay&recipients=alicesmith&amount=13.00&note=open-tab",
  },
  {
    participant: bob,
    amount: 8.67,
    venmoLink: "https://venmo.com/paycharge?txn=pay&recipients=bob&amount=8.67&note=open-tab",
    venmoAppLink: "venmo://paycharge?txn=pay&recipients=bob&amount=8.67&note=open-tab",
  },
];

function makeState(overrides: Partial<ReceiptFlowState> = {}): ReceiptFlowState {
  return {
    step: "charge",
    receiptId: "receipt-123",
    imageFile: null,
    signedUrl: null,
    mimeType: null,
    merchantName: "Test Cafe",
    dateOfReceipt: "2025-05-24",
    subtotal: 20,
    tax: 2,
    tip: 4,
    total: 26,
    items: [],
    participants: [alice, bob],
    splitMode: "equal",
    assignments: {},
    charges,
    ...overrides,
  };
}

function renderChargeScreen(state: ReceiptFlowState = makeState()) {
  const flow: Parameters<typeof ChargeScreen>[0]["flow"] = {
    state,
    update: vi.fn(),
    goTo: vi.fn(),
    reset: mockReset,
    clearSplitState: vi.fn(),
    addParticipant: vi.fn().mockReturnValue("new-id"),
    removeParticipant: vi.fn(),
    toggleAssignment: vi.fn(),
  };
  return { ...render(<ChargeScreen flow={flow} />), user: userEvent.setup(), flow };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ChargeScreen — display", () => {
  it("renders the merchant name as a heading", () => {
    renderChargeScreen();
    expect(screen.getByText("Test Cafe")).toBeInTheDocument();
  });

  it("renders the formatted date", () => {
    renderChargeScreen();
    expect(screen.getByText(/may 24, 2025/i)).toBeInTheDocument();
  });

  it("renders the Venmo note/subject line", () => {
    renderChargeScreen();
    expect(screen.getByText(/open-tab: Test Cafe 2025-05-24/i)).toBeInTheDocument();
  });

  it("renders one row per charge", () => {
    renderChargeScreen();
    expect(screen.getByText("@alicesmith")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
  });

  it("renders the correct amount for each participant", () => {
    renderChargeScreen();
    expect(screen.getByText("$13.00")).toBeInTheDocument();
    expect(screen.getByText("$8.67")).toBeInTheDocument();
  });

  it("renders a 'Pay on Venmo' button for each participant", () => {
    renderChargeScreen();
    const payButtons = screen.getAllByRole("button", { name: /pay on venmo/i });
    expect(payButtons).toHaveLength(2);
  });

  it("renders a Done button", () => {
    renderChargeScreen();
    expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
  });
});

describe("ChargeScreen — actions", () => {
  it("opens the Venmo web link in a new tab on desktop", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    // Simulate desktop (no Mobi in user agent)
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
      configurable: true,
    });

    const { user } = renderChargeScreen();
    const payButtons = screen.getAllByRole("button", { name: /pay on venmo/i });
    await user.click(payButtons[0]);
    expect(openSpy).toHaveBeenCalledWith(
      "https://venmo.com/paycharge?txn=pay&recipients=alicesmith&amount=13.00&note=open-tab",
      "_blank"
    );
    openSpy.mockRestore();
  });

  it("opens the Venmo app link on mobile", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Linux; Android 10; Pixel 4) Mobile Safari",
      configurable: true,
    });

    const { user } = renderChargeScreen();
    const payButtons = screen.getAllByRole("button", { name: /pay on venmo/i });
    await user.click(payButtons[0]);
    expect(openSpy).toHaveBeenCalledWith(
      "venmo://paycharge?txn=pay&recipients=alicesmith&amount=13.00&note=open-tab",
      "_blank"
    );
    openSpy.mockRestore();
  });

  it("Done button calls reset", async () => {
    const { user } = renderChargeScreen();
    await user.click(screen.getByRole("button", { name: /done/i }));
    expect(mockReset).toHaveBeenCalled();
  });

  it("Done button navigates to the receipt detail page", async () => {
    const { user } = renderChargeScreen();
    await user.click(screen.getByRole("button", { name: /done/i }));
    expect(mockPush).toHaveBeenCalledWith("/receipts/receipt-123");
  });

  it("Done button navigates to dashboard when no receiptId", async () => {
    const { user } = renderChargeScreen(makeState({ receiptId: null }));
    await user.click(screen.getByRole("button", { name: /done/i }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard");
  });
});

describe("ChargeScreen — edge cases", () => {
  it("renders gracefully with no charges", () => {
    renderChargeScreen(makeState({ charges: [] }));
    expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pay on venmo/i })).not.toBeInTheDocument();
  });

  it("falls back to 'Receipt' when merchantName is null", () => {
    renderChargeScreen(makeState({ merchantName: null }));
    expect(screen.getByText("Receipt")).toBeInTheDocument();
  });
});
