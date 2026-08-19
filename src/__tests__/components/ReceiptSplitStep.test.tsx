import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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
// One friend group ("Roommates": alice, bob, cara) exists so the group row can
// be exercised; every other table comes back empty. The fixture lives inside the
// factory because vi.mock is hoisted above any outer declaration.
vi.mock("@/lib/supabase/client", () => {
  const testGroup = {
    id: "g1",
    name: "Roommates",
    friend_group_members: [
      { venmo_username: "alice", display_name: null },
      { venmo_username: "bob", display_name: null },
      { venmo_username: "cara", display_name: null },
    ],
  };

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
  const groups = makeBuilder([testGroup]);

  return {
    getSupabaseBrowserClient: vi.fn(() => ({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-user-id" } } }),
      },
      from: vi.fn((table: string) => (table === "friend_groups" ? groups : empty)),
      // Friends come from a scoped RPC now that profiles is own-row only.
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  };
});

// ─── Stateful wrapper ─────────────────────────────────────────────────────────
// Mimics useReceiptFlow so state transitions actually re-render the component.

type Flow = Parameters<typeof ReceiptSplitStep>[0]["flow"];

function makeStatefulFlow(initial: ReceiptFlowState) {
  // Shared mutable ref so the wrapper can expose the latest state
  let latestState = initial;

  function Wrapper({ onFlow }: { onFlow: (f: Flow, s: () => ReceiptFlowState) => void }) {
    const [state, setState] = useState<ReceiptFlowState>(initial);
    latestState = state;

    const flow: Flow = {
      state,
      update: (key, value) => setState((prev) => ({ ...prev, [key]: value }) as ReceiptFlowState),
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
  return { flow: null, getState: () => latestState, Wrapper };
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
    ...overrides,
  };
}

// ─── Helper to render with stateful flow ──────────────────────────────────────

async function renderSplitStep(initial: ReceiptFlowState = makeDefaultState()) {
  const user = userEvent.setup();
  let capturedFlow: Flow | null = null;
  let capturedGetState: () => ReceiptFlowState = () => initial;

  const { Wrapper } = makeStatefulFlow(initial);

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

  it("applies nothing until Done is pressed", async () => {
    const { user, getState } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    expect(
      getState().participants.some((p) => p.venmoUsername === "alice")
    ).toBe(false);
    expect(screen.queryByRole("heading", { name: /charges/i })).not.toBeInTheDocument();
  });

  it("leaves the check unchanged when Cancel is pressed", async () => {
    const { user, getState } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/add by venmo username/i)).not.toBeInTheDocument()
    );
    expect(
      getState().participants.some((p) => p.venmoUsername === "alice")
    ).toBe(false);
    expect(screen.queryByRole("heading", { name: /charges/i })).not.toBeInTheDocument();
  });

  it("shows the Charges section once Done is pressed", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    await user.click(screen.getByRole("button", { name: /^done$/i }));
    expect(await screen.findByRole("heading", { name: /charges/i })).toBeInTheDocument();
  });

  it("hides the Charges section when the last participant is removed", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    await user.click(screen.getByRole("button", { name: /^done$/i }));
    await screen.findByRole("heading", { name: /charges/i });

    // Reopening seeds the modal with whoever is already on the check — the
    // owner bubble comes first, alice was added after it.
    await user.click(screen.getByRole("button", { name: /even split/i }));
    const removeButtons = await screen.findAllByRole("button", { name: /remove/i });
    await user.click(removeButtons[removeButtons.length - 1]);
    await user.click(screen.getByRole("button", { name: /^done$/i }));
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

  it("offers a matching friend group and stages every member", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    // The modal opens seeded with whoever is already on the check.
    const before = screen.queryAllByLabelText("Remove").length;
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "room");
    await user.click(await screen.findByText("Roommates"));
    // One new bubble per member: alice, bob, cara
    await waitFor(() =>
      expect(screen.getAllByLabelText("Remove")).toHaveLength(before + 3)
    );
  });

  it("charges each group member individually once Done is pressed", async () => {
    const { user, getState } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "room");
    await user.click(await screen.findByText("Roommates"));
    await user.click(screen.getByRole("button", { name: /^done$/i }));

    await waitFor(() =>
      expect(
        getState().participants.map((p) => p.venmoUsername).sort()
      ).toEqual(["alice", "bob", "cara", "me"])
    );
  });

  it("does not add someone twice when they were already picked by hand", async () => {
    const { user, getState } = await renderSplitStep();
    await user.click(screen.getByRole("button", { name: /even split/i }));
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "alice");
    await user.click(await screen.findByText("Add @alice"));
    await user.click(await screen.findByText("Roommates"));
    await user.click(screen.getByRole("button", { name: /^done$/i }));

    await waitFor(() =>
      expect(
        getState().participants.filter((p) => p.venmoUsername.toLowerCase() === "alice")
      ).toHaveLength(1)
    );
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

  it("assigns every member of a friend group to the item", async () => {
    const { user, getState } = await renderSplitStep();
    await user.click(screen.getByText("Burger"));
    await user.type(await screen.findByPlaceholderText(/who had this/i), "room");
    await user.click(await screen.findByText("Roommates"));

    await waitFor(() => {
      const assigned = getState().assignments["item-1"] ?? [];
      expect(new Set(assigned).size).toBe(3);
    });
    expect(
      getState().participants.map((p) => p.venmoUsername).sort()
    ).toEqual(["alice", "bob", "cara", "me"]);
  });

  it("charges each group member for their own share", async () => {
    const { user } = await renderSplitStep();
    await user.click(screen.getByText("Burger"));
    await user.type(await screen.findByPlaceholderText(/who had this/i), "room");
    await user.click(await screen.findByText("Roommates"));
    // A charge card each, not one lumped card for the group.
    await waitFor(() => expect(screen.getAllByText("$4.00").length).toBeGreaterThan(0));
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
