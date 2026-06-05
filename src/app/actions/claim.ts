"use server";

import { revalidatePath } from "next/cache";
import {
  getSupabaseServerClient,
  getSupabaseServiceClient,
} from "@/lib/supabase/server";
import {
  isValidVenmoUsername,
  deriveDisplayName,
  computeSharedClaimCharges,
} from "@/lib/utils";
import { buildTabUrl } from "@/lib/qr/inviteUrl";
import type { SharedReceipt, EditableItem, FlowParticipant } from "@/types";

// ===========================================================================
// Public claim actions — no auth. Access is gated entirely by the share_token,
// which is unguessable. Every action re-validates the token (and that the
// participant/item belongs to that receipt) before any write. All DB access
// uses the service client; the browser anon key never touches receipt data.
// ===========================================================================

interface ItemWithAssignments {
  id: string;
  receipt_id: string;
  name: string;
  price: number;
  quantity: number;
  sort_order: number;
  item_assignments?: { participant_id: string }[];
}

export async function getSharedReceipt(
  token: string
): Promise<SharedReceipt | null> {
  const supabase = await getSupabaseServiceClient();

  const { data: receipt } = await supabase
    .from("receipts")
    .select(
      "id, status, merchant_name, date_of_receipt, subtotal, tax, tip, total, created_by"
    )
    .eq("share_token", token)
    .single();
  if (!receipt) return null;

  const [{ data: owner }, { data: items }, { data: participants }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, venmo_username")
        .eq("id", receipt.created_by)
        .single(),
      supabase
        .from("receipt_items")
        .select("*, item_assignments(participant_id)")
        .eq("receipt_id", receipt.id)
        .order("sort_order"),
      supabase
        .from("receipt_participants")
        .select(
          "id, display_name, venmo_username, is_owner, joined_via_share, claim_done_at"
        )
        .eq("receipt_id", receipt.id),
    ]);

  const assignments: Record<string, string[]> = {};
  const cleanItems = ((items ?? []) as ItemWithAssignments[]).map((it) => {
    if (it.item_assignments?.length) {
      assignments[it.id] = it.item_assignments.map((a) => a.participant_id);
    }
    const { item_assignments: _drop, ...rest } = it;
    void _drop;
    return rest;
  });

  return {
    id: receipt.id,
    status: receipt.status,
    merchant_name: receipt.merchant_name,
    date_of_receipt: receipt.date_of_receipt,
    subtotal: receipt.subtotal,
    tax: receipt.tax,
    tip: receipt.tip,
    total: receipt.total,
    owner: {
      display_name: owner?.display_name ?? "",
      venmo_username: owner?.venmo_username ?? null,
    },
    items: cleanItems,
    participants: participants ?? [],
    assignments,
  };
}

export async function joinReceipt(
  token: string,
  rawUsername: string
): Promise<{ participantId: string } | { error: string }> {
  const username = rawUsername.trim().replace(/^@/, "");
  if (!isValidVenmoUsername(username)) {
    return { error: "Enter a valid Venmo username." };
  }

  const supabase = await getSupabaseServiceClient();
  const { data: receipt } = await supabase
    .from("receipts")
    .select("id, status")
    .eq("share_token", token)
    .single();
  if (!receipt) return { error: "This link is no longer valid." };
  if (receipt.status !== "claiming") {
    return { error: "Claiming is closed for this receipt." };
  }

  // Resume an existing participant with this username so a returning claimer
  // keeps their claims instead of creating a duplicate.
  const { data: existing } = await supabase
    .from("receipt_participants")
    .select("id")
    .eq("receipt_id", receipt.id)
    .ilike("venmo_username", username)
    .maybeSingle();
  if (existing) return { participantId: existing.id };

  // Link to a real profile if one matches this Venmo username; otherwise this
  // is an external participant (user_id stays null).
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name")
    .ilike("venmo_username", username)
    .maybeSingle();

  const { data: inserted, error } = await supabase
    .from("receipt_participants")
    .insert({
      receipt_id: receipt.id,
      user_id: profile?.id ?? null,
      venmo_username: username,
      display_name: profile?.display_name ?? deriveDisplayName(username),
      is_owner: false,
      joined_via_share: true,
    })
    .select("id")
    .single();

  if (error || !inserted) return { error: "Couldn't join. Try again." };
  return { participantId: inserted.id };
}

export async function toggleClaim(
  token: string,
  participantId: string,
  itemId: string
): Promise<{ claimed: boolean } | { error: string }> {
  const supabase = await getSupabaseServiceClient();
  const { data: receipt } = await supabase
    .from("receipts")
    .select("id, status")
    .eq("share_token", token)
    .single();
  if (!receipt) return { error: "This link is no longer valid." };
  if (receipt.status !== "claiming") return { error: "Claiming is closed." };

  // Both the participant and item must belong to this receipt.
  const [{ data: participant }, { data: item }] = await Promise.all([
    supabase
      .from("receipt_participants")
      .select("id")
      .eq("id", participantId)
      .eq("receipt_id", receipt.id)
      .maybeSingle(),
    supabase
      .from("receipt_items")
      .select("id")
      .eq("id", itemId)
      .eq("receipt_id", receipt.id)
      .maybeSingle(),
  ]);
  if (!participant || !item) return { error: "Invalid claim." };

  const { data: existing } = await supabase
    .from("item_assignments")
    .select("id")
    .eq("receipt_item_id", itemId)
    .eq("participant_id", participantId)
    .maybeSingle();

  if (existing) {
    await supabase.from("item_assignments").delete().eq("id", existing.id);
    return { claimed: false };
  }
  await supabase
    .from("item_assignments")
    .insert({ receipt_item_id: itemId, participant_id: participantId });
  return { claimed: true };
}

export async function setClaimDone(
  token: string,
  participantId: string,
  done: boolean
): Promise<{ error?: string }> {
  const supabase = await getSupabaseServiceClient();
  const { data: receipt } = await supabase
    .from("receipts")
    .select("id, status")
    .eq("share_token", token)
    .single();
  if (!receipt) return { error: "This link is no longer valid." };
  if (receipt.status !== "claiming") return { error: "Claiming is closed." };

  const { error } = await supabase
    .from("receipt_participants")
    .update({ claim_done_at: done ? new Date().toISOString() : null })
    .eq("id", participantId)
    .eq("receipt_id", receipt.id);
  if (error) return { error: "Couldn't update. Try again." };
  return {};
}

// ===========================================================================
// Owner actions — authenticated. Each verifies the caller owns the receipt
// before mutating.
// ===========================================================================

type OwnedReceipt = {
  receipt: { id: string; created_by: string; status: string; share_token: string | null };
};

async function requireOwnedReceipt(
  receiptId: string
): Promise<OwnedReceipt | { error: string }> {
  const authed = await getSupabaseServerClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: receipt } = await authed
    .from("receipts")
    .select("id, created_by, status, share_token")
    .eq("id", receiptId)
    .single();
  if (!receipt || receipt.created_by !== user.id) {
    return { error: "Not found." };
  }
  return { receipt };
}

export async function shareReceipt(
  receiptId: string
): Promise<{ url: string } | { error: string }> {
  const ctx = await requireOwnedReceipt(receiptId);
  if ("error" in ctx) return { error: ctx.error };

  const service = await getSupabaseServiceClient();
  let token = ctx.receipt.share_token;
  const update: Record<string, unknown> = { status: "claiming" };
  if (!token) {
    token = crypto.randomUUID();
    update.share_token = token;
  }

  const { error } = await service
    .from("receipts")
    .update(update)
    .eq("id", receiptId);
  if (error) return { error: "Couldn't share. Try again." };

  revalidatePath(`/receipts/${receiptId}`);
  return { url: buildTabUrl(token) };
}

export async function reopenEditing(
  receiptId: string
): Promise<{ error?: string }> {
  const ctx = await requireOwnedReceipt(receiptId);
  if ("error" in ctx) return { error: ctx.error };

  const service = await getSupabaseServiceClient();
  const { error } = await service
    .from("receipts")
    .update({ status: "reviewing" })
    .eq("id", receiptId);
  if (error) return { error: "Couldn't reopen. Try again." };

  revalidatePath(`/receipts/${receiptId}`);
  return {};
}

export async function closeClaiming(
  receiptId: string
): Promise<{ error?: string }> {
  const ctx = await requireOwnedReceipt(receiptId);
  if ("error" in ctx) return { error: ctx.error };

  const service = await getSupabaseServiceClient();
  const [{ data: receipt }, { data: items }, { data: participants }] =
    await Promise.all([
      service
        .from("receipts")
        .select("id, created_by, merchant_name, date_of_receipt, tax, tip")
        .eq("id", receiptId)
        .single(),
      service
        .from("receipt_items")
        .select("id, name, price, quantity, item_assignments(participant_id)")
        .eq("receipt_id", receiptId)
        .order("sort_order"),
      service
        .from("receipt_participants")
        .select("id, user_id, venmo_username, display_name, is_owner")
        .eq("receipt_id", receiptId),
    ]);
  if (!receipt) return { error: "Not found." };

  // The owner's Venmo username is who claimers reimburse.
  const ownerParticipant = (participants ?? []).find((p) => p.is_owner);
  let ownerVenmo = ownerParticipant?.venmo_username ?? "";
  if (!ownerVenmo) {
    const { data: prof } = await service
      .from("profiles")
      .select("venmo_username")
      .eq("id", receipt.created_by)
      .single();
    ownerVenmo = prof?.venmo_username ?? "";
  }

  // Map DB rows into the shapes computeSharedClaimCharges expects, using the
  // DB id as the clientId.
  const flowItems: EditableItem[] = (items ?? []).map((it) => ({
    clientId: it.id,
    dbId: it.id,
    name: it.name,
    price: it.price,
    quantity: it.quantity,
  }));
  const flowParticipants: FlowParticipant[] = (participants ?? []).map((p) => ({
    clientId: p.id,
    dbId: p.id,
    type: p.user_id ? "friend" : "manual",
    userId: p.user_id ?? undefined,
    displayName: p.display_name,
    venmoUsername: p.venmo_username,
    isOwner: p.is_owner,
  }));
  const assignments: Record<string, string[]> = {};
  for (const it of (items ?? []) as ItemWithAssignments[]) {
    if (it.item_assignments?.length) {
      assignments[it.id] = it.item_assignments.map((a) => a.participant_id);
    }
  }

  const computed = computeSharedClaimCharges(
    flowItems,
    assignments,
    flowParticipants,
    receipt.tax ?? 0,
    receipt.tip ?? 0,
    ownerVenmo,
    receipt.merchant_name,
    receipt.date_of_receipt
  );

  // Replace any prior charges, then insert fresh ones.
  await service.from("charges").delete().eq("receipt_id", receiptId);
  const chargeRows = computed
    .filter((c) => c.amount > 0 && c.participant.dbId)
    .map((c) => ({
      receipt_id: receiptId,
      from_user_id: receipt.created_by,
      to_participant_id: c.participant.dbId!,
      amount: c.amount,
      venmo_link: c.venmoLink,
      paid_at: null,
    }));
  if (chargeRows.length > 0) {
    const { error } = await service.from("charges").insert(chargeRows);
    if (error) return { error: "Couldn't create charges. Try again." };
  }

  await service
    .from("receipts")
    .update({ status: "charging" })
    .eq("id", receiptId);

  revalidatePath(`/receipts/${receiptId}`);
  return {};
}

export interface ClaimChargeRow {
  participantId: string;
  amount: number;
  paidAt: string | null;
}

export async function getClaimCharges(
  receiptId: string
): Promise<ClaimChargeRow[] | { error: string }> {
  const ctx = await requireOwnedReceipt(receiptId);
  if ("error" in ctx) return { error: ctx.error };

  const service = await getSupabaseServiceClient();
  const { data } = await service
    .from("charges")
    .select("to_participant_id, amount, paid_at")
    .eq("receipt_id", receiptId);

  return (data ?? []).map((c) => ({
    participantId: c.to_participant_id,
    amount: c.amount,
    paidAt: c.paid_at,
  }));
}

export async function markClaimChargePaid(
  receiptId: string,
  participantId: string,
  paid: boolean
): Promise<{ error?: string }> {
  const ctx = await requireOwnedReceipt(receiptId);
  if ("error" in ctx) return { error: ctx.error };

  const service = await getSupabaseServiceClient();
  const { error } = await service
    .from("charges")
    .update({ paid_at: paid ? new Date().toISOString() : null })
    .eq("receipt_id", receiptId)
    .eq("to_participant_id", participantId);
  if (error) return { error: "Couldn't update. Try again." };

  // Settle the receipt once every charge is paid.
  const { data: charges } = await service
    .from("charges")
    .select("paid_at")
    .eq("receipt_id", receiptId);
  const allPaid =
    (charges ?? []).length > 0 && (charges ?? []).every((c) => c.paid_at);
  await service
    .from("receipts")
    .update({ status: allPaid ? "settled" : "charging" })
    .eq("id", receiptId);

  revalidatePath(`/receipts/${receiptId}`);
  return {};
}
