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

  // Both retained fields get named. `display_name` and `venmo_username` are
  // NOT NULL in migration 0004, so the handle survives on every tab the user
  // ever joined; naming only the name would be a false claim about a payment
  // identifier, on the last screen before something irreversible.
  it("says plainly what is lost and what friends keep", async () => {
    await openModal();
    expect(screen.getByText(/permanent/i)).toBeInTheDocument();
    expect(screen.getByText(/receipt photos/i)).toBeInTheDocument();
    expect(
      screen.getByText(/keep the name and venmo username you used/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no longer linked to your account/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/your name only/i)).not.toBeInTheDocument();
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

  it("submits on Enter once the word is typed", async () => {
    const { user } = await openModal();
    await user.type(screen.getByLabelText(/type/i), "delete");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledTimes(1));
  });

  // The input is never disabled, so a held Enter key repeats keydown. Without
  // the loading guard that is a second account delete in flight against a
  // session the first one is already tearing down.
  it("does not fire a second delete while one is in flight", async () => {
    let finish: (result: { redirectTo: string }) => void = () => {};
    mockDeleteAccount.mockReturnValue(
      new Promise<{ redirectTo: string }>((resolve) => {
        finish = resolve;
      })
    );

    const { user } = await openModal();
    await user.type(screen.getByLabelText(/type/i), "delete");
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");

    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);

    finish({ redirectTo: "/" });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
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
