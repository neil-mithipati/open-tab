import { cacheLife } from "next/cache";
import { createClient } from "@supabase/supabase-js";

// Service client — no cookies, no session, bypasses RLS.
// Safe here because userId is always sourced from a verified server session
// in the calling page before being passed in.
function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

type Receipt = {
  id: string;
  merchant_name: string | null;
  date_of_receipt: string | null;
  total: number | null;
  status: string;
  created_at: string;
};

export async function getUserReceipts(userId: string): Promise<Receipt[]> {
  "use cache";
  cacheLife("minutes");

  const supabase = serviceClient();

  const [{ data: created }, { data: participated }] = await Promise.all([
    supabase
      .from("receipts")
      .select("id, merchant_name, date_of_receipt, total, status, created_at")
      .eq("created_by", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("receipt_participants")
      .select(
        "receipt_id, receipts(id, merchant_name, date_of_receipt, total, status, created_at)"
      )
      .eq("user_id", userId)
      .eq("is_owner", false),
  ]);

  const participatedReceipts = (participated ?? [])
    .map((p) => p.receipts)
    .filter(Boolean)
    .flat() as Receipt[];

  return [...((created ?? []) as Receipt[]), ...participatedReceipts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function getReceiptDetail(receiptId: string) {
  "use cache";
  cacheLife("minutes");

  const supabase = serviceClient();

  const [{ data: receipt }, { data: items }, { data: participants }] =
    await Promise.all([
      supabase.from("receipts").select("*").eq("id", receiptId).single(),
      supabase
        .from("receipt_items")
        .select("*")
        .eq("receipt_id", receiptId)
        .order("sort_order"),
      supabase
        .from("receipt_participants")
        .select("*")
        .eq("receipt_id", receiptId),
    ]);

  return { receipt, items: items ?? [], participants: participants ?? [] };
}

export async function getUserProfile(userId: string) {
  "use cache";
  cacheLife("minutes");

  const { data } = await serviceClient()
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  return data;
}
