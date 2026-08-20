import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { EditableItem, FlowParticipant, ComputedCharge } from "@/types";
import { buildVenmoLinks } from "./venmo/deepLink";
import { formatCents, itemsSubtotalCents, lineTotalCents, roundCents, toCents } from "./money";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const ANIMALS = ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐧","🦆","🦉","🦇","🐺","🐴","🦄","🐝","🦋","🐢","🐍","🦎","🐙","🦑","🐬","🐳","🦈","🦭","🐘","🦛","🦒","🦘","🦔","🦝","🦥","🦦","🦨","🐇","🦌","🐓","🦚","🦜","🦩","🕊️","🐆","🐅","🦓"];

export function animalEmoji(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return ANIMALS[Math.abs(hash) % ANIMALS.length];
}

/**
 * Formats DOLLARS. Only the surfaces that read money straight off a
 * numeric(10,2) column still hold dollars — everywhere else is integer cents
 * and uses formatCents from src/lib/money.ts.
 */
export function formatCurrency(amount: number): string {
  return formatCents(toCents(amount));
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

// Build the Venmo note: "Open Tab: Merchant (Item, Item (x2), …)".
// Items the recipient ordered are grouped by name with a "(xN)" quantity
// suffix when N > 1; an empty list omits the parenthetical entirely.
export function buildVenmoNote(
  merchantName: string | null,
  orderedItems: { name: string; quantity: number }[]
): string {
  const base = `Open Tab: ${merchantName ?? "receipt"}`;
  if (orderedItems.length === 0) return base;
  const grouped = new Map<string, number>();
  for (const it of orderedItems) {
    grouped.set(it.name, (grouped.get(it.name) ?? 0) + it.quantity);
  }
  const list = Array.from(grouped, ([name, qty]) =>
    qty > 1 ? `${name} (x${qty})` : name
  ).join(", ");
  return `${base} (${list})`;
}

// Splits `totalCents` across the exact (possibly fractional) per-person cent
// shares in `exactCents`, using largest-remainder allocation: each share is
// floored, then the leftover cents are handed out one at a time to whoever
// has the largest fractional remainder (ties broken by array index) until
// the integer shares sum exactly to `totalCents`. This is what keeps the
// sum of every participant's charge — including the owner's implicit,
// unreturned share — equal to the charged total instead of drifting by a
// cent or two from independent per-person rounding.
//
// This is rule 3 of the rounding rule in src/lib/money.ts: inside the cent
// domain nothing rounds, it allocates. A per-person Math.round here would be
// a second rounding and would put the split a cent or two out on receipts
// that are perfectly correct.
function allocateCents(totalCents: number, exactCents: number[]): number[] {
  // Round away floating-point noise (e.g. 733.0000000001) before flooring.
  // Four decimal places is far finer than a cent, so it can't mask a real
  // remainder, but it's coarse enough to stop float noise from breaking
  // otherwise-equal fractional remainders into a false ordering.
  const cleaned = exactCents.map((v) => Math.round(v * 1e4) / 1e4);
  const floors = cleaned.map((v) => Math.floor(v));
  const allocated = floors.reduce((sum, v) => sum + v, 0);
  const remainder = totalCents - allocated;
  const order = cleaned
    .map((v, i) => ({ i, frac: Math.round((v - Math.floor(v)) * 1e4) / 1e4 }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = [...floors];
  for (let k = 0; k < remainder; k++) {
    result[order[k].i] += 1;
  }
  return result;
}

/** `totalCents` is integer cents, as is every amount returned. */
export function computeEqualCharges(
  totalCents: number,
  participants: FlowParticipant[],
  merchantName: string | null,
  items: EditableItem[]
): ComputedCharge[] {
  const nonOwners = participants.filter((p) => !p.isOwner);
  if (nonOwners.length === 0) return [];
  const exactCents = participants.map(() => totalCents / participants.length);
  const cents = allocateCents(totalCents, exactCents);
  // Even split shares the whole bill, so the note lists every item.
  const note = buildVenmoNote(
    merchantName,
    items.map((it) => ({ name: it.name, quantity: it.quantity }))
  );
  return nonOwners.map((p) => {
    const amountCents = cents[participants.indexOf(p)];
    return {
      participant: p,
      amountCents,
      // Owner is collecting from friends → request money (charge), not pay.
      ...buildVenmoLinks({ recipientUsername: p.venmoUsername, amountCents, note, txn: "charge" }),
    };
  });
}

/** `subtotal`, `tax` and `tip` are integer cents, as is every amount returned. */
export function computeItemCharges(
  items: EditableItem[],
  assignments: Record<string, string[]>, // itemClientId → participantClientIds
  participants: FlowParticipant[],
  subtotalCents: number,
  taxCents: number,
  tipCents: number,
  merchantName: string | null,
  // Unused here, but kept so call sites can pass the same argument list as
  // computeSharedClaimCharges below.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _date: string | null
): ComputedCharge[] {
  const taxRate = subtotalCents > 0 ? taxCents / subtotalCents : 0;
  const tipRate = subtotalCents > 0 ? tipCents / subtotalCents : 0;

  // Compute every participant's (including the owner's) assigned-item
  // subtotal and ordered-items list first, so the remainder allocation can
  // account for the owner's implicit share of the assigned-items total.
  const perParticipant = participants.map((p) => {
    let itemSubtotalCents = 0;
    const ordered: { name: string; quantity: number }[] = [];
    for (const item of items) {
      const assignees = assignments[item.clientId] ?? [];
      if (assignees.includes(p.clientId) && assignees.length > 0) {
        // Fractional cents on purpose — allocateCents settles them below.
        itemSubtotalCents += lineTotalCents(item) / assignees.length;
        ordered.push({ name: item.name, quantity: item.quantity });
      }
    }
    return { itemSubtotalCents, ordered };
  });

  const exactCents = perParticipant.map(
    ({ itemSubtotalCents }) => itemSubtotalCents * (1 + taxRate + tipRate)
  );
  const totalCents = roundCents(exactCents.reduce((sum, v) => sum + v, 0));
  const cents = allocateCents(totalCents, exactCents);

  return participants
    .map((p, i) => {
      const amountCents = cents[i];
      const note = buildVenmoNote(merchantName, perParticipant[i].ordered);
      return {
        participant: p,
        amountCents,
        // Owner is collecting from friends → request money (charge), not pay.
        ...buildVenmoLinks({ recipientUsername: p.venmoUsername, amountCents, note, txn: "charge" }),
      };
    })
    .filter((c) => !c.participant.isOwner);
}

// Charge computation for the shared "crowd-claim" flow. Differs from
// computeItemCharges in two ways:
//   1. Unclaimed items (no assignees) are split evenly across ALL participants
//      (including the owner), so each non-owner is charged one even share.
//   2. The stored Venmo link is the friend → owner reimbursement link
//      (txn=pay, recipient = owner), since that's the link a claimer taps to pay.
// Tax and tip are pro-rated against each person's pre-tax share, as elsewhere.
/** `tax` and `tip` are integer cents, as is every amount returned. */
export function computeSharedClaimCharges(
  items: EditableItem[],
  assignments: Record<string, string[]>, // itemClientId → participantClientIds
  participants: FlowParticipant[],
  taxCents: number,
  tipCents: number,
  ownerVenmoUsername: string,
  merchantName: string | null,
  // Unused here, but kept so call sites can pass the same argument list as
  // computeItemCharges above.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _date: string | null
): ComputedCharge[] {
  if (participants.length === 0) return [];

  const subtotalCents = itemsSubtotalCents(items);
  const taxRate = subtotalCents > 0 ? taxCents / subtotalCents : 0;
  const tipRate = subtotalCents > 0 ? tipCents / subtotalCents : 0;

  const unclaimedCents = items.reduce((s, it) => {
    const assignees = assignments[it.clientId] ?? [];
    return assignees.length === 0 ? s + lineTotalCents(it) : s;
  }, 0);
  const unclaimedSharePerPerson = unclaimedCents / participants.length;

  // Compute every participant's (including the owner's) pre-tax share first,
  // so the remainder allocation can account for the owner's implicit share
  // of the subtotal (claimed + unclaimed) total.
  const perParticipant = participants.map((p) => {
    let itemSubtotalCents = 0;
    const ordered: { name: string; quantity: number }[] = [];
    for (const item of items) {
      const assignees = assignments[item.clientId] ?? [];
      if (assignees.includes(p.clientId) && assignees.length > 0) {
        itemSubtotalCents += lineTotalCents(item) / assignees.length;
        ordered.push({ name: item.name, quantity: item.quantity });
      }
    }
    const preTaxCents = itemSubtotalCents + unclaimedSharePerPerson;
    return { preTaxCents, ordered };
  });

  const exactCents = perParticipant.map(
    ({ preTaxCents }) => preTaxCents * (1 + taxRate + tipRate)
  );
  const totalCents = roundCents(exactCents.reduce((sum, v) => sum + v, 0));
  const cents = allocateCents(totalCents, exactCents);

  return participants
    .map((p, i) => {
      const amountCents = cents[i];
      const note = buildVenmoNote(merchantName, perParticipant[i].ordered);
      return {
        participant: p,
        amountCents,
        ...buildVenmoLinks({ recipientUsername: ownerVenmoUsername, amountCents, note, txn: "pay" }),
      };
    })
    .filter((c) => !c.participant.isOwner);
}
