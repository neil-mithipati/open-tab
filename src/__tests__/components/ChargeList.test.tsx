import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChargeList } from "@/components/receipt/ChargeList";
import type { Charge, ReceiptParticipant } from "@/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────
// markPaid issues a charges.update(...).eq(...) — make that chain resolve.

const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: vi.fn(() => ({
    from: vi.fn(() => ({ update: mockUpdate })),
  })),
}));

beforeEach(() => {
  mockUpdate.mockClear();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const alice: ReceiptParticipant = {
  id: "p-alice",
  receipt_id: "receipt-123",
  user_id: "u-alice",
  venmo_username: "alicesmith",
  display_name: "Alice Smith",
  is_owner: false,
  joined_via_share: false,
  claim_done_at: null,
};

const bob: ReceiptParticipant = {
  id: "p-bob",
  receipt_id: "receipt-123",
  user_id: null,
  venmo_username: "bob",
  display_name: "Bobby",
  is_owner: false,
  joined_via_share: false,
  claim_done_at: null,
};

const aliceCharge: Charge = {
  id: "c-alice",
  receipt_id: "receipt-123",
  from_user_id: "u-alice",
  to_participant_id: "p-alice",
  amount: 13.0,
  venmo_link: "https://venmo.com/paycharge?txn=pay&recipients=owner&amount=13.00&note=Open%20Tab",
  paid_at: null,
  created_at: "2025-05-24T00:00:00Z",
};

const bobCharge: Charge = {
  id: "c-bob",
  receipt_id: "receipt-123",
  from_user_id: "u-bob",
  to_participant_id: "p-bob",
  amount: 8.67,
  venmo_link: "https://venmo.com/paycharge?txn=pay&recipients=owner&amount=8.67&note=Open%20Tab",
  paid_at: null,
  created_at: "2025-05-24T00:00:00Z",
};

function renderChargeList({
  charges = [aliceCharge, bobCharge],
  participants = [alice, bob],
  isOwner = false,
}: {
  charges?: Charge[];
  participants?: ReceiptParticipant[];
  isOwner?: boolean;
} = {}) {
  return {
    ...render(
      <ChargeList
        charges={charges}
        participants={participants}
        isOwner={isOwner}
        receiptId="receipt-123"
      />
    ),
    user: userEvent.setup(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ChargeList — display", () => {
  it("renders the Charges heading", () => {
    renderChargeList();
    expect(screen.getByText("Charges")).toBeInTheDocument();
  });

  it("renders one row per charge with the participant's venmo username", () => {
    renderChargeList();
    expect(screen.getByText("@alicesmith")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
  });

  it("renders the formatted amount for each charge", () => {
    renderChargeList();
    expect(screen.getByText("$13.00")).toBeInTheDocument();
    expect(screen.getByText("$8.67")).toBeInTheDocument();
  });

  it("renders a Venmo button for each unpaid charge with a link", () => {
    renderChargeList();
    expect(screen.getAllByRole("button", { name: /venmo/i })).toHaveLength(2);
  });

  it("skips charges whose participant is not in the list", () => {
    renderChargeList({ charges: [aliceCharge, bobCharge], participants: [alice] });
    expect(screen.getByText("@alicesmith")).toBeInTheDocument();
    expect(screen.queryByText("@bob")).not.toBeInTheDocument();
  });

  it("shows a Paid badge instead of action buttons when the charge is settled", () => {
    renderChargeList({ charges: [{ ...aliceCharge, paid_at: "2025-05-25T00:00:00Z" }], participants: [alice] });
    expect(screen.getByText(/paid/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /venmo/i })).not.toBeInTheDocument();
  });
});

describe("ChargeList — owner controls", () => {
  it("shows a Mark paid button only for the owner", () => {
    const { rerender } = renderChargeList({ isOwner: false });
    expect(screen.queryByRole("button", { name: /mark paid/i })).not.toBeInTheDocument();

    rerender(
      <ChargeList charges={[aliceCharge, bobCharge]} participants={[alice, bob]} isOwner receiptId="receipt-123" />
    );
    expect(screen.getAllByRole("button", { name: /mark paid/i })).toHaveLength(2);
  });

  it("marks a charge paid and shows the Paid badge after the owner clicks Mark paid", async () => {
    const { user } = renderChargeList({ charges: [aliceCharge], participants: [alice], isOwner: true });
    await user.click(screen.getByRole("button", { name: /mark paid/i }));
    expect(mockUpdate).toHaveBeenCalledWith({ paid_at: expect.any(String) });
    expect(await screen.findByText(/paid/i)).toBeInTheDocument();
  });
});

describe("ChargeList — Venmo action", () => {
  it("opens the Venmo web link in a new tab on desktop", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
      configurable: true,
    });

    const { user } = renderChargeList({ charges: [aliceCharge], participants: [alice] });
    await user.click(screen.getByRole("button", { name: /venmo/i }));
    expect(openSpy).toHaveBeenCalledWith(aliceCharge.venmo_link, "_blank");
    openSpy.mockRestore();
  });

  it("opens the Venmo app link on mobile", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Linux; Android 10; Pixel 4) Mobile Safari",
      configurable: true,
    });

    const { user } = renderChargeList({ charges: [aliceCharge], participants: [alice] });
    await user.click(screen.getByRole("button", { name: /venmo/i }));
    expect(openSpy).toHaveBeenCalledWith(
      aliceCharge.venmo_link!.replace("https://venmo.com/paycharge", "venmo://paycharge"),
      "_blank"
    );
    openSpy.mockRestore();
  });
});
