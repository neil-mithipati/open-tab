import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ReceiptSplitStep } from "@/components/receipt/ReceiptSplitStep";
import type { ReceiptFlowState } from "@/hooks/useReceiptFlow";
import type { FlowParticipant, EditableItem } from "@/types";
import { generateClientId } from "@/lib/utils";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Supabase mock: auth returns a user, from() chains resolve gracefully.
// The builder is chainable AND thenable: `await from(x).select().eq()` resolves
// to { data: [] }, while `.single()` resolves to { data: null } for single-row
// queries (e.g. the self-profile lookup).
vi.mock("@/lib/supabase/client", () => {
  const builder: any = {};
  builder.select = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockReturnValue(builder);
  builder.insert = vi.fn().mockResolvedValue({ data: null, error: null });
  builder.delete = vi.fn().mockReturnValue(builder);
  builder.update = vi.fn().mockReturnValue(builder);
  builder.single = vi.fn().mockResolvedValue({ data: null, error: null });
  builder.then = (resolve: any) => resolve({ data: [], error: null });

  return {
    getSupabaseBrowserClient: vi.fn(() => ({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-user-id" } } }),
      },
      from: vi.fn().mockReturnValue(builder),
    })),
  };
});

// ─── Stateful wrapper ─────────────────────────────────────────────────────────
// Mimics useReceiptFlow so state transitions actually re-render the component.

type Flow = Parameters<typeof ReceiptSplitStep>[0]["flow"];

function makeStatefulFlow(initial: ReceiptFlowState): { flow: Flow; getState: () => ReceiptFlowState } {
  // Shared mutable ref so the wrapper can expose the latest state
  let latestState = initial;

  function Wrapper({ onFlow }: { onFlow: (f: Flow, s: () => ReceiptFlowState) => void }) {
    const [state, setState] = useState<ReceiptFlowState>(initial);
    latestState = state;

    const flow: Flow = {
      state,
      update: (key, value) => setState((prev) => ({ ...prev, [key]: value as any })),
      goTo: (step) => setState((prev) => ({ ...prev, step })),
      reset: vi.fn(),
      clearSplitState: () =>
        setState((prev) => ({
          ...prev,
          splitMode: "equal",
          participants: prev.participants.filter((p) => p.isOwner),
          assignments: {},
          charges: [],
        })),
      addParticipant: (p) => {
        const clientId = generateClientId();
        setState((prev) => ({
          ...prev,
          participants: [...prev.participants, { ...p, clientId }],
        }));
        return clientId;
      },
      removeParticipant: (clientId) =>
        setState((prev) => ({
          ...prev,
          participants: prev.participants.filter((p) => p.clientId !== clientId),
        })),
      toggleAssignment: (itemClientId, participantClientId) =>
        setState((prev) => {
          const current = prev.assignments[itemClientId] ?? [];
          const next = current.includes(participantClientId)
            ? current.filter((id) => id !== participantClientId)
            : [...current, participantClientId];
          return { ...prev, assignments: { ...prev.assignments, [itemClientId]: next } };
        }),
    };

    onFlow(flow, () => latestState);
    return <ReceiptSplitStep flow={flow} />;
  }

  // Return the wrapper component and a state accessor; the caller renders Wrapper
  return { flow: null as any, getState: () => latestState, Wrapper };
}

// ─── Shared test state ────────────────────────────────────────────────────────

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
  { clientId: "item-2", name: "Fries", price: 8.0, quantity: 1 },
];

function makeDefaultState(overrides: Partial<ReceiptFlowState> = {}): ReceiptFlowState {
  return {
    step: "split",
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
    items: defaultItems,
    participants: [ownerParticipant],
    splitMode: "equal",
    assignments: {},
    charges: [],
    ...overrides,
  };
}

// ─── Helper to render with stateful flow ──────────────────────────────────────

async function renderSplitStep(initial: ReceiptFlowState = makeDefaultState()) {
  const user = userEvent.setup();
  let capturedFlow: Flow = null as any;
  let capturedGetState: () => ReceiptFlowState = () => initial;

  const { Wrapper } = makeStatefulFlow(initial) as any;

  const utils = render(
    <Wrapper
      onFlow={(flow: Flow, getState: () => ReceiptFlowState) => {
        capturedFlow = flow;
        capturedGetState = getState;
      }}
    />
  );

  // Flush the async friends-loading useEffect so it doesn't leak into assertions
  await act(async () => {});

  return { ...utils, user, getFlow: () => capturedFlow, getState: capturedGetState };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReceiptSplitStep — receipt display", () => {
  it("renders the merchant name", async () => {
    await renderSplitStep();
    // Merchant name is an editable input, not static text
    expect(screen.getByDisplayValue("Test Cafe")).toBeInTheDocument();
  });

  it("renders all item names", async () => {
    await renderSplitStep();
    expect(screen.getByText("Burger")).toBeInTheDocument();
    expect(screen.getByText("Fries")).toBeInTheDocument();
  });

  it("renders the total", async () => {
    await renderSplitStep();
    expect(screen.getByText("$26.00")).toBeInTheDocument();
  });

  it("renders tax and tip when non-zero", async () => {
    await renderSplitStep();
    expect(screen.getByText("Tax")).toBeInTheDocument();
    expect(screen.getByText("Tip")).toBeInTheDocument();
  });

  it("renders the Retake button", async () => {
    await renderSplitStep();
    expect(screen.getByRole("button", { name: /retake/i })).toBeInTheDocument();
  });

  it("Retake button returns to the capture step", async () => {
    const { user, getState } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /retake/i }));
    await waitFor(() => expect(getState().step).toBe("capture"));
  });
});

describe("ReceiptSplitStep — Even Split mode", () => {
  it("shows the Even Split button", async () => {
    await renderSplitStep();
    expect(screen.getByRole("button", { name: /even split/i })).toBeInTheDocument();
  });

  it("does not show the username input before pressing Even Split", async () => {
    await renderSplitStep();
    expect(screen.queryByPlaceholderText(/venmo username/i)).not.toBeInTheDocument();
  });

  it("shows the username input after pressing Even Split", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    expect(screen.getByPlaceholderText(/add by venmo username/i)).toBeInTheDocument();
  });

  it("shows autocomplete 'Add @username' when typing a username", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "alice");
    expect(await screen.findByText("Add @alice")).toBeInTheDocument();
  });

  it("shows a participant bubble after adding a username", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    // The Avatar for "alice" (initials "AL") should appear (in the bubble and the live charge card)
    expect(screen.getAllByText("AL").length).toBeGreaterThan(0);
  });

  it("shows the Charges section once a participant is added", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    expect(await screen.findByRole("heading", { name: /charges/i })).toBeInTheDocument();
  });

  it("hides the Charges section when the last participant is removed", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    await screen.findByRole("heading", { name: /charges/i });
    await user.click(await screen.findByRole("button", { name: /remove/i }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /charges/i })).not.toBeInTheDocument()
    );
  });

  it("shows the @venmoUsername tooltip when a bubble avatar is clicked", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    // Count "@alice" occurrences before clicking (the live charge card already shows one)
    const before = screen.queryAllByText("@alice").length;
    // The first "AL" avatar is the participant bubble (rendered above the live charge cards)
    await user.click(screen.getAllByText("AL")[0]);
    await waitFor(() => expect(screen.queryAllByText("@alice").length).toBe(before + 1));
  });

  it("does not show the Charges section with zero participants", async () => {
    await renderSplitStep();
    expect(screen.queryByRole("heading", { name: /charges/i })).not.toBeInTheDocument();
  });
});

describe("ReceiptSplitStep — mode switching", () => {
  it("clicking an item after Even Split clears even-split participants", async () => {
    const { user } = await renderSplitStep();
    // Add alice via even split
    await user.click(screen.getByRole("button", { name: /even split/i }));
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    expect(screen.getAllByText("AL").length).toBeGreaterThan(0);
    // Click an item to switch to itemize mode
    await user.click(screen.getByText("Burger"));
    // Alice's bubble (and her live charge card) should be gone
    expect(screen.queryByText("AL")).not.toBeInTheDocument();
  });

  it("sets splitMode to by_item when an item is clicked", async () => {
    const { user, getState } = await renderSplitStep();
    await user.click(screen.getByText("Burger"));
    await waitFor(() => expect(getState().splitMode).toBe("by_item"));
  });
});

describe("ReceiptSplitStep — Itemize mode", () => {
  it("shows an inline input below an item when it is clicked", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByText("Burger"));
    expect(await screen.findByPlaceholderText(/who had this/i)).toBeInTheDocument();
  });

  it("closes the inline input when clicking outside", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByText("Burger"));
    await screen.findByPlaceholderText(/who had this/i);
    await user.click(document.body);
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/who had this/i)).not.toBeInTheDocument()
    );
  });

  it("shows an avatar next to the item after assigning a participant", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByText("Burger"));
    await user.type(await screen.findByPlaceholderText(/who had this/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    // Avatar initials for "alice" = "AL" (item bubble + live charge card)
    expect(screen.getAllByText("AL").length).toBeGreaterThan(0);
  });

  it("does not show the Charges section before any item is assigned", async () => {
    const { user } = await renderSplitStep();
    // Enter itemize mode but assign nobody yet
    await user.click(screen.getByText("Burger"));
    await screen.findByPlaceholderText(/who had this/i);
    expect(screen.queryByRole("heading", { name: /charges/i })).not.toBeInTheDocument();
  });

  it("shows the Charges section once every item has at least one assignee", async () => {
    const { user } = await renderSplitStep();
    // Assign alice to Burger
    await user.click(screen.getByText("Burger"));
    await user.type(await screen.findByPlaceholderText(/who had this/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    // Assign alice to Fries as well (same person, different item)
    await user.click(screen.getByText("Fries"));
    await user.type(await screen.findByPlaceholderText(/who had this/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    expect(await screen.findByRole("heading", { name: /charges/i })).toBeInTheDocument();
  });
});
