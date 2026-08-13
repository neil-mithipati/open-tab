import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { userFriendsTag, userProfileTag, userReceiptsTag } from "@/lib/cacheTags";

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
  cacheTag(userReceiptsTag(userId));

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
        .select("*, item_assignments(receipt_item_id, participant_id)")
        .eq("receipt_id", receiptId)
        .order("sort_order"),
      supabase
        .from("receipt_participants")
        .select("*")
        .eq("receipt_id", receiptId),
    ]);

  return { receipt, items: items ?? [], participants: participants ?? [] };
}

type FriendProfile = { id: string; display_name: string; venmo_username: string | null };

export async function getUserFriends(userId: string): Promise<FriendProfile[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(userFriendsTag(userId));

  const supabase = serviceClient();

  const [{ data: friendships }, { data: external }] = await Promise.all([
    supabase
      .from("friendships")
      .select("friend_id, profiles!friendships_friend_id_fkey(id, display_name, venmo_username)")
      .eq("user_id", userId),
    supabase
      .from("external_contacts")
      .select("id, display_name, venmo_username")
      .eq("user_id", userId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realFriends: FriendProfile[] = (friendships ?? []).map((f: any) => f.profiles).flat().filter((p: any): p is FriendProfile => p !== null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const externalFriends: FriendProfile[] = (external ?? []).map((c: any) => ({
    id: c.id,
    display_name: c.display_name ?? c.venmo_username,
    venmo_username: c.venmo_username,
  }));

  return [...realFriends, ...externalFriends];
}

// A fresh signature on every render makes the URL unique, so neither the image
// optimizer nor the browser ever gets a cache hit and the original photo is
// re-fetched and re-encoded each time the user opens it. Signing for two hours
// but reusing the result for at most thirty minutes keeps one stable URL in
// play, well inside its validity window.
export async function getReceiptImageUrl(storagePath: string): Promise<string | null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 1800 });

  const { data } = await serviceClient()
    .storage.from("receipt-images")
    .createSignedUrl(storagePath, 7200);

  return data?.signedUrl ?? null;
}

export async function getUserProfile(userId: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(userProfileTag(userId));

  const { data } = await serviceClient()
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  return data;
}
