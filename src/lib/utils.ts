import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { EditableItem, FlowParticipant, ComputedCharge } from "@/types";
import { buildVenmoLinks } from "./venmo/deepLink";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const ANIMALS = ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐧","🦆","🦉","🦇","🐺","🐴","🦄","🐝","🦋","🐢","🐍","🦎","🐙","🦑","🐬","🐳","🦈","🦭","🐘","🦛","🦒","🦘","🦔","🦝","🦥","🦦","🦨","🐇","🦌","🐓","🦚","🦜","🦩","🕊️","🐆","🐅","🦓"];

export function animalEmoji(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return ANIMALS[Math.abs(hash) % ANIMALS.length];
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr + "T12:00:00"));
}

export function generateClientId(): string {
  return crypto.randomUUID();
}

export function deriveDisplayName(venmoUsername: string): string {
  return venmoUsername.replace(/^@/, "");
}

// Venmo usernames are 5–16 chars: letters, numbers, hyphens, underscores.
// Pass the raw value with any leading "@" already stripped.
export function isValidVenmoUsername(raw: string): boolean {
  return /^[a-zA-Z0-9_-]{5,16}$/.test(raw);
}

export function computeEqualCharges(
  total: number,
  participants: FlowParticipant[],
  merchantName: string | null,
  date: string | null
): ComputedCharge[] {
  const nonOwners = participants.filter((p) => !p.isOwner);
  if (nonOwners.length === 0) return [];
  const perPerson = Math.round((total / participants.length) * 100) / 100;
  const note = `Open Tab: ${merchantName ?? "receipt"}${date ? ` ${date}` : ""}`;
  return nonOwners.map((p) => ({
    participant: p,
    amount: perPerson,
    // Owner is collecting from friends → request money (charge), not pay.
    ...buildVenmoLinks({ recipientUsername: p.venmoUsername, amount: perPerson, note, txn: "charge" }),
  }));
}

export function computeItemCharges(
  items: EditableItem[],
  assignments: Record<string, string[]>, // itemClientId → participantClientIds
  participants: FlowParticipant[],
  subtotal: number,
  tax: number,
  tip: number,
  merchantName: string | null,
  date: string | null
): ComputedCharge[] {
  const nonOwners = participants.filter((p) => !p.isOwner);
  const taxRate = subtotal > 0 ? tax / subtotal : 0;
  const tipRate = subtotal > 0 ? tip / subtotal : 0;
  const note = `Open Tab: ${merchantName ?? "receipt"}${date ? ` ${date}` : ""}`;

  return nonOwners.map((p) => {
    let itemSubtotal = 0;
    for (const item of items) {
      const assignees = assignments[item.clientId] ?? [];
      if (assignees.includes(p.clientId) && assignees.length > 0) {
        const share = (item.price * item.quantity) / assignees.length;
        itemSubtotal += share;
      }
    }
    const amount = Math.round(itemSubtotal * (1 + taxRate + tipRate) * 100) / 100;
    return {
      participant: p,
      amount,
      // Owner is collecting from friends → request money (charge), not pay.
      ...buildVenmoLinks({ recipientUsername: p.venmoUsername, amount, note, txn: "charge" }),
    };
  });
}

// Charge computation for the shared "crowd-claim" flow. Differs from
// computeItemCharges in two ways:
//   1. Unclaimed items (no assignees) are split evenly across ALL participants
//      (including the owner), so each non-owner is charged one even share.
//   2. The stored Venmo link is the friend → owner reimbursement link
//      (txn=pay, recipient = owner), since that's the link a claimer taps to pay.
// Tax and tip are pro-rated against each person's pre-tax share, as elsewhere.
export function computeSharedClaimCharges(
  items: EditableItem[],
  assignments: Record<string, string[]>, // itemClientId → participantClientIds
  participants: FlowParticipant[],
  tax: number,
  tip: number,
  ownerVenmoUsername: string,
  merchantName: string | null,
  date: string | null
): ComputedCharge[] {
  if (participants.length === 0) return [];

  const subtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
  const taxRate = subtotal > 0 ? tax / subtotal : 0;
  const tipRate = subtotal > 0 ? tip / subtotal : 0;
  const note = `Open Tab: ${merchantName ?? "receipt"}${date ? ` ${date}` : ""}`;

  const unclaimedTotal = items.reduce((s, it) => {
    const assignees = assignments[it.clientId] ?? [];
    return assignees.length === 0 ? s + it.price * it.quantity : s;
  }, 0);
  const unclaimedSharePerPerson = unclaimedTotal / participants.length;

  const nonOwners = participants.filter((p) => !p.isOwner);

  return nonOwners.map((p) => {
    let itemSubtotal = 0;
    for (const item of items) {
      const assignees = assignments[item.clientId] ?? [];
      if (assignees.includes(p.clientId) && assignees.length > 0) {
        itemSubtotal += (item.price * item.quantity) / assignees.length;
      }
    }
    const preTax = itemSubtotal + unclaimedSharePerPerson;
    const amount = Math.round(preTax * (1 + taxRate + tipRate) * 100) / 100;
    return {
      participant: p,
      amount,
      ...buildVenmoLinks({ recipientUsername: ownerVenmoUsername, amount, note, txn: "pay" }),
    };
  });
}
