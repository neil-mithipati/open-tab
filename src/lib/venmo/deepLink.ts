import { fromCents } from "@/lib/money";

// Venmo's profile URL is a universal link: the app catches it on mobile and
// the web profile opens everywhere else — so one https link works for both.
export function buildVenmoProfileUrl(username: string): string {
  return `https://venmo.com/u/${encodeURIComponent(username.replace(/^@/, ""))}`;
}

interface VenmoParams {
  recipientUsername: string;
  /**
   * Integer cents. The charge link is the last thing money passes through
   * before a real payment request, so it takes the same integer the split
   * arithmetic produced and converts once, here — nothing upstream is allowed
   * to hand this a float it has already rounded.
   */
  amountCents: number;
  note: string;
  // "pay" = you send money to the recipient (friend → owner reimbursement).
  // "charge" = you request money from the recipient (owner → friend collection).
  txn?: "pay" | "charge";
}

export function buildVenmoLinks(params: VenmoParams): {
  venmoLink: string;
  venmoAppLink: string;
} {
  const { recipientUsername, amountCents, note, txn = "pay" } = params;
  const username = recipientUsername.replace(/^@/, "");
  const encoded = encodeURIComponent(note);
  const amt = fromCents(amountCents).toFixed(2);
  const query = `txn=${txn}&recipients=${username}&amount=${amt}&note=${encoded}`;

  return {
    venmoLink: `https://venmo.com/paycharge?${query}`,
    venmoAppLink: `venmo://paycharge?${query}`,
  };
}
