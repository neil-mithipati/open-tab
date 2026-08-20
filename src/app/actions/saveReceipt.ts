"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { userReceiptsTag } from "@/lib/cacheTags";

// ===========================================================================
// Atomic save for the owner's own receipt. The browser used to delete every
// item and participant and re-insert them over three round trips, so a dropped
// connection mid-way wiped the tab. Everything now goes to one RPC
// (save_receipt_state) which does the swap in a single transaction.
//
// Computation stays on the client — this only maps the flow's camelCase,
// clientId-keyed state onto the jsonb payloads the function expects.
// ===========================================================================

// SQLSTATE save_receipt_state raises when the participant set changed under
// the client (migration 0022). PostgREST reads a PT-prefixed code as an HTTP
// status, so this also comes back as a 409 rather than a 500.
const PARTICIPANTS_CHANGED = "PT409";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SaveReceiptItem {
  clientId: string;
  /**
   * The row id this item was read from, when it came out of the database.
   * Sent so the save keeps it instead of minting a new one: an item's id is
   * what a claim points at, and re-minting it destroyed any claim made through
   * the share link since this page loaded (migration 0023). Absent for an item
   * the owner has just typed in.
   */
  dbId?: string | null;
  name: string;
  price: number;
  quantity: number;
}

export interface SaveReceiptParticipant {
  clientId: string;
  userId?: string | null;
  venmoUsername: string;
  displayName: string;
  isOwner: boolean;
}

export interface SaveReceiptCharge {
  participantClientId: string;
  amount: number;
  venmoLink: string | null;
  paidAt: string | null;
}

export interface SaveReceiptFields {
  status?: "open" | "shared" | "closed";
  splitMode?: "equal" | "by_item";
  merchantName?: string | null;
  subtotal?: number | null;
  tax?: number | null;
  tip?: number | null;
  total?: number | null;
}

export interface SaveReceiptInput {
  receiptId: string;
  items: SaveReceiptItem[];
  participants: SaveReceiptParticipant[];
  /** itemClientId → participantClientIds */
  assignments: Record<string, string[]>;
  charges: SaveReceiptCharge[];
  receipt: SaveReceiptFields;
}

interface RpcPayload {
  p_receipt_id: string;
  p_items: {
    client_id: string;
    /** Omitted, not null, for a new item — see SaveReceiptItem.dbId. */
    id?: string;
    name: string;
    price: number;
    quantity: number;
    sort_order: number;
  }[];
  p_participants: {
    client_id: string;
    user_id: string | null;
    venmo_username: string;
    display_name: string;
    is_owner: boolean;
  }[];
  p_assignments: { item_client_id: string; participant_client_id: string }[];
  p_charges: {
    participant_client_id: string;
    amount: number;
    venmo_link: string | null;
    paid_at: string | null;
  }[];
  p_receipt: Record<string, unknown>;
}

// Only the keys the caller actually set are sent, so the share flow (which has
// no opinion about status) leaves the receipt's status untouched. `undefined`
// means "don't write"; an explicit null still clears the column.
function receiptFields(fields: SaveReceiptFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields.status !== undefined) out.status = fields.status;
  if (fields.splitMode !== undefined) out.split_mode = fields.splitMode;
  if (fields.merchantName !== undefined) out.merchant_name = fields.merchantName;
  if (fields.subtotal !== undefined) out.subtotal = fields.subtotal;
  if (fields.tax !== undefined) out.tax = fields.tax;
  if (fields.tip !== undefined) out.tip = fields.tip;
  if (fields.total !== undefined) out.total = fields.total;
  return out;
}

function buildSavePayload(input: SaveReceiptInput): RpcPayload {
  // One row per Venmo username — the unique index added in 0016 rejects a
  // second. Later duplicates fold into the first, and anything that pointed at
  // them (an assignment, a charge) is re-pointed rather than dropped.
  const keptByUsername = new Map<string, string>();
  const alias = new Map<string, string>();
  const p_participants: RpcPayload["p_participants"] = [];

  for (const p of input.participants) {
    const key = p.venmoUsername.trim().toLowerCase();
    const kept = keptByUsername.get(key);
    if (kept) {
      alias.set(p.clientId, kept);
      continue;
    }
    keptByUsername.set(key, p.clientId);
    alias.set(p.clientId, p.clientId);
    p_participants.push({
      client_id: p.clientId,
      user_id: p.userId ?? null,
      venmo_username: p.venmoUsername,
      display_name: p.displayName,
      is_owner: p.isOwner,
    });
  }

  const itemClientIds = new Set(input.items.map((it) => it.clientId));

  const p_assignments: RpcPayload["p_assignments"] = [];
  for (const [itemClientId, participantClientIds] of Object.entries(
    input.assignments
  )) {
    if (!itemClientIds.has(itemClientId)) continue;
    const seen = new Set<string>();
    for (const participantClientId of participantClientIds) {
      const target = alias.get(participantClientId);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      p_assignments.push({
        item_client_id: itemClientId,
        participant_client_id: target,
      });
    }
  }

  const p_charges: RpcPayload["p_charges"] = [];
  for (const c of input.charges) {
    const target = alias.get(c.participantClientId);
    if (!target) continue;
    p_charges.push({
      participant_client_id: target,
      amount: c.amount,
      venmo_link: c.venmoLink,
      paid_at: c.paidAt,
    });
  }

  // The row id is only worth sending if it is one: the function reads it as a
  // uuid, so anything else would fail the whole save rather than just being
  // ignored. A repeated id is dropped after the first — two items cannot be
  // the same row, and the second would collide on the primary key.
  const seenDbIds = new Set<string>();
  const p_items: RpcPayload["p_items"] = input.items.map((it, i) => {
    const dbId = it.dbId && UUID.test(it.dbId) && !seenDbIds.has(it.dbId)
      ? it.dbId
      : undefined;
    if (dbId) seenDbIds.add(dbId);
    return {
      client_id: it.clientId,
      ...(dbId ? { id: dbId } : {}),
      name: it.name,
      price: it.price,
      quantity: it.quantity,
      sort_order: i,
    };
  });

  return {
    p_receipt_id: input.receiptId,
    p_items,
    p_participants,
    p_assignments,
    p_charges,
    p_receipt: receiptFields(input.receipt),
  };
}

export async function saveReceiptState(
  input: SaveReceiptInput
): Promise<{ error?: string }> {
  // The authenticated client, not the service client: save_receipt_state
  // checks the caller against receipts.created_by via auth.uid(), so the
  // session has to reach Postgres.
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.rpc(
    "save_receipt_state",
    buildSavePayload(input)
  );
  // The one refusal the owner can act on: somebody joined through the share
  // link after this page took its snapshot, so the list being sent predates
  // them and applying it would delete them along with their claims. 0022
  // raises PT409 instead and rolls the whole call back, so nothing was
  // written and the only thing to do is reload.
  if (error?.code === PARTICIPANTS_CHANGED) {
    return { error: "Someone just joined this tab. Reload to see them." };
  }
  if (error) return { error: "Couldn't save. Try again." };

  revalidatePath(`/receipts/${input.receiptId}`);
  updateTag(userReceiptsTag(user.id));
  return {};
}
