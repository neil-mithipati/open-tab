import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FriendGroupsManager } from "@/components/profile/FriendGroupsManager";
import {
  createFriendGroup,
  updateFriendGroup,
  deleteFriendGroup,
} from "@/app/actions/friendGroups";
import type { FriendGroup } from "@/types";

vi.mock("@/app/actions/friendGroups", () => ({
  createFriendGroup: vi.fn(),
  updateFriendGroup: vi.fn(),
  deleteFriendGroup: vi.fn(),
}));

vi.mock("@/app/actions/cache", () => ({ refreshUserCaches: vi.fn() }));
vi.mock("@/lib/friends", () => ({ addFriendByUsername: vi.fn().mockResolvedValue({}) }));

const roommates: FriendGroup = {
  id: "g1",
  name: "Roommates",
  members: [
    { venmoUsername: "alice", displayName: null },
    { venmoUsername: "bob", displayName: null },
  ],
};

const friends = [
  { id: "u-alice", display_name: "alice", venmo_username: "alice" },
  { id: "u-bob", display_name: "bob", venmo_username: "bob" },
];

function renderManager(groups: FriendGroup[] = []) {
  const user = userEvent.setup();
  render(
    <FriendGroupsManager userId="me" initialGroups={groups} initialFriends={friends} />
  );
  return { user };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FriendGroupsManager — empty state", () => {
  it("offers only the create button when there are no groups", () => {
    renderManager();
    expect(screen.getByRole("button", { name: /create friend group/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^delete/i)).not.toBeInTheDocument();
  });
});

describe("FriendGroupsManager — rows", () => {
  it("lists the group name and its members", () => {
    renderManager([roommates]);
    expect(screen.getByText("Roommates")).toBeInTheDocument();
    expect(screen.getByText("alice, bob")).toBeInTheDocument();
  });

  it("opens the populated modal when a group is clicked", async () => {
    const { user } = renderManager([roommates]);
    await user.click(screen.getByText("Roommates"));
    expect(await screen.findByDisplayValue("Roommates")).toBeInTheDocument();
    // One removable bubble per member
    expect(screen.getAllByLabelText("Remove")).toHaveLength(2);
  });

  it("removes the row immediately when deleted", async () => {
    vi.mocked(deleteFriendGroup).mockResolvedValue({ ok: true });
    const { user } = renderManager([roommates]);
    await user.click(screen.getByLabelText("Delete Roommates"));
    await waitFor(() => expect(screen.queryByText("Roommates")).not.toBeInTheDocument());
  });

  it("puts the row back when the delete fails", async () => {
    vi.mocked(deleteFriendGroup).mockResolvedValue({ error: "Couldn't delete the group. Try again." });
    const { user } = renderManager([roommates]);
    await user.click(screen.getByLabelText("Delete Roommates"));
    expect(await screen.findByText(/couldn't delete the group/i)).toBeInTheDocument();
    expect(screen.getByText("Roommates")).toBeInTheDocument();
  });

  it("does not open the modal when the delete X is clicked", async () => {
    vi.mocked(deleteFriendGroup).mockResolvedValue({ ok: true });
    const { user } = renderManager([roommates]);
    await user.click(screen.getByLabelText("Delete Roommates"));
    expect(screen.queryByDisplayValue("Roommates")).not.toBeInTheDocument();
  });
});

describe("FriendGroupsManager — modal validation", () => {
  it("requires a name", async () => {
    const { user } = renderManager();
    await user.click(screen.getByRole("button", { name: /create friend group/i }));
    await user.click(await screen.findByRole("button", { name: /^done$/i }));
    expect(await screen.findByText(/give your group a name/i)).toBeInTheDocument();
    expect(createFriendGroup).not.toHaveBeenCalled();
  });

  it("requires at least one member", async () => {
    const { user } = renderManager();
    await user.click(screen.getByRole("button", { name: /create friend group/i }));
    await user.type(await screen.findByLabelText(/group name/i), "Poker");
    await user.click(screen.getByRole("button", { name: /^done$/i }));
    expect(await screen.findByText(/add at least one person/i)).toBeInTheDocument();
    expect(createFriendGroup).not.toHaveBeenCalled();
  });

  it("saves a named group with its members", async () => {
    vi.mocked(createFriendGroup).mockResolvedValue({
      group: { id: "g2", name: "Poker", members: [{ venmoUsername: "alice", displayName: "alice" }] },
    });
    const { user } = renderManager();
    await user.click(screen.getByRole("button", { name: /create friend group/i }));
    await user.type(await screen.findByLabelText(/group name/i), "Poker");
    await user.type(screen.getByPlaceholderText(/add by venmo username/i), "alice");
    await user.click(await screen.findByText("@alice"));
    await user.click(screen.getByRole("button", { name: /^done$/i }));

    await waitFor(() =>
      expect(createFriendGroup).toHaveBeenCalledWith("Poker", [
        { venmoUsername: "alice", displayName: "alice" },
      ])
    );
    expect(await screen.findByText("Poker")).toBeInTheDocument();
  });

  it("changes nothing when the modal is cancelled", async () => {
    const { user } = renderManager([roommates]);
    await user.click(screen.getByText("Roommates"));
    await user.type(await screen.findByLabelText(/group name/i), " renamed");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^done$/i })).not.toBeInTheDocument()
    );
    expect(updateFriendGroup).not.toHaveBeenCalled();
    expect(screen.getByText("Roommates")).toBeInTheDocument();
  });
});
