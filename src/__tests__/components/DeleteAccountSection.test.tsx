import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteAccountSection } from "@/components/profile/DeleteAccountSection";
import { deleteAccount } from "@/app/actions/deleteAccount";

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }),
}));

vi.mock("@/app/actions/deleteAccount", () => ({ deleteAccount: vi.fn() }));

const mockDeleteAccount = vi.mocked(deleteAccount);

async function openModal() {
  const user = userEvent.setup();
  render(<DeleteAccountSection />);
  await user.click(screen.getByRole("button", { name: /delete account/i }));
  return { user };
}

const confirmButton = () => screen.getByRole("button", { name: /delete forever/i });

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteAccount.mockResolvedValue({ redirectTo: "/" });
});

describe("DeleteAccountSection", () => {
  it("does nothing until the affordance is tapped", () => {
    render(<DeleteAccountSection />);
    expect(screen.queryByRole("button", { name: /delete forever/i })).not.toBeInTheDocument();
  });

  it("says plainly what is lost and what friends keep", async () => {
    await openModal();
    expect(screen.getByText(/permanent/i)).toBeInTheDocument();
    expect(screen.getByText(/receipt photos/i)).toBeInTheDocument();
    expect(screen.getByText(/keep your name only/i)).toBeInTheDocument();
  });

  it("keeps the confirm button disabled until the word is typed", async () => {
    const { user } = await openModal();
    expect(confirmButton()).toBeDisabled();

    await user.type(screen.getByLabelText(/type/i), "delet");
    expect(confirmButton()).toBeDisabled();

    await user.type(screen.getByLabelText(/type/i), "e");
    expect(confirmButton()).toBeEnabled();
  });

  it("does not arm on some other word", async () => {
    const { user } = await openModal();
    await user.type(screen.getByLabelText(/type/i), "yes");
    expect(confirmButton()).toBeDisabled();
  });

  it("deletes and sends the user home once confirmed", async () => {
    const { user } = await openModal();
    await user.type(screen.getByLabelText(/type/i), "delete");
    await user.click(confirmButton());

    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledTimes(1));
    expect(mockDeleteAccount).toHaveBeenCalledWith();
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  // Cancel is a true no-op: the modal closes and nothing was called.
  it("cancel closes the modal without calling the action", async () => {
    const { user } = await openModal();
    await user.type(screen.getByLabelText(/type/i), "delete");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("button", { name: /delete forever/i })).not.toBeInTheDocument();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("forgets what was typed when reopened after a cancel", async () => {
    const { user } = await openModal();
    await user.type(screen.getByLabelText(/type/i), "delete");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await user.click(screen.getByRole("button", { name: /delete account/i }));

    expect(confirmButton()).toBeDisabled();
  });

  it("shows the error and stays put when the action fails", async () => {
    mockDeleteAccount.mockResolvedValue({ error: "Couldn't delete your account. Try again." });

    const { user } = await openModal();
    await user.type(screen.getByLabelText(/type/i), "delete");
    await user.click(confirmButton());

    expect(await screen.findByText(/couldn't delete your account/i)).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
