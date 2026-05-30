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
    ...buildVenmoLinks({ recipientUsername: p.venmoUsername, amount: perPerson, note }),
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
      ...buildVenmoLinks({ recipientUsername: p.venmoUsername, amount, note }),
    };
  });
}
