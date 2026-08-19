"use server";

import {
  getSupabaseServerClient,
  getSupabaseServiceClient,
} from "@/lib/supabase/server";

const BUCKET = "receipt-images";

// storage.list() pages; ask for a full page and walk until a short one comes
// back, so an account with hundreds of receipt photos still gets cleared.
//
// "A short page is the last page" is an assumption, and it is worth naming: a
// server-side row cap below LIST_PAGE would return fewer objects than asked
// for while more remain, and this loop would stop early and leave them behind.
// Unlike the charge scan below there is nothing to check the page against —
// storage.list() reports no total — and the cost if it happens is orphaned
// photos in the bucket rather than a row left on somebody else's tab.
const LIST_PAGE = 100;

// Same idea for the charge scan in step 3, but a truncated read there is
// silent data loss: a misfiled row nobody looked at falls through to the
// delete instead of being re-pointed, and it is another user's row. So that
// loop does not trust page length. It asks for an exact count and walks until
// it has seen every matching row. See step 3.
const CHARGE_PAGE = 500;

export type DeleteAccountResult = { redirectTo: string } | { error: string };

// `charges.receipt_id` is a to-one relation, which PostgREST returns as an
// object — but the client here is untyped, so accept either shape.
type ChargeScanRow = {
  receipt_id: string;
  receipts: { created_by: string } | { created_by: string }[] | null;
};

function ownerOf(row: ChargeScanRow): string | null {
  const receipt = Array.isArray(row.receipts) ? row.receipts[0] : row.receipts;
  return receipt?.created_by ?? null;
}

/**
 * Permanently delete the signed-in user's account and everything it owns.
 *
 * Takes no arguments on purpose. The target is always the caller's own session
 * user — a user id parameter on a `"use server"` export is reachable by direct
 * POST, which would turn this into "delete anyone's account". Do not add one.
 *
 * Order matters, and it is not arbitrary:
 *
 *   1. storage objects under `<bucket>/<user id>/` — while we still know the
 *      prefix and can fail before anything irreversible in the database
 *   2. anonymise `receipt_participants` rows (see below)
 *   3. re-point `charges` that sit on someone else's receipt, then delete the
 *      rest
 *   4. delete the `profiles` row, which cascades to everything else
 *   5. delete the `auth.users` row
 *   6. sign out
 *
 * Steps 2 and 3 exist because two foreign keys into `profiles` have no
 * `on delete` action and would otherwise block step 4:
 * `receipt_participants.user_id` (migration 0004) and `charges.from_user_id`
 * (0007). Everything else cascades from `profiles`: `receipts` (0002) and
 * through them `receipt_items` (0003), `receipt_participants` (0004),
 * `item_assignments` (0005) and `charges` (0007); `friendships` in both
 * directions (0006); `external_contacts` (0010); `friend_groups` (0014) and
 * through them `friend_group_members`.
 *
 * Step 1 running first is a deliberate trade, not an oversight. The only
 * handle on those objects is the `<user id>/` prefix, so if the database work
 * below fails after them, the account survives with tabs pointing at photos
 * that are already gone — the images render as missing until the user retries.
 * The other order is worse and permanent: delete the rows first and a storage
 * failure strands photos nobody can find, list, or remove ever again. A tab
 * without its picture is recoverable; an unreachable picture is not.
 *
 * Re-running after a partial failure is safe: every step is a no-op once it
 * has succeeded, and the session survives until step 5.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const service = await getSupabaseServiceClient();

  // ── 1. receipt photos ──────────────────────────────────────────────────────
  // Deliberately first, and fatal on failure. The only handle on these objects
  // is the `<user id>/` prefix; delete the rows first and a storage error
  // leaves photos nobody can find, let alone remove.
  const paths: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await service.storage
      .from(BUCKET)
      .list(user.id, { limit: LIST_PAGE, offset });

    if (error) {
      console.error("[deleteAccount] storage list error:", error);
      return { error: "Couldn't delete your account. Try again." };
    }

    const page = data ?? [];
    for (const entry of page) {
      // Folders and the empty-folder placeholder come back with a null id.
      if (!entry.id) continue;
      paths.push(`${user.id}/${entry.name}`);
    }
    if (page.length < LIST_PAGE) break;
  }

  if (paths.length > 0) {
    const { error } = await service.storage.from(BUCKET).remove(paths);
    if (error) {
      console.error("[deleteAccount] storage remove error:", error);
      return { error: "Couldn't delete your account. Try again." };
    }
  }

  // ── 2. anonymise participation in other people's tabs ──────────────────────
  // Kept, not deleted. These rows are how someone else's settled tab still adds
  // up; removing them would silently rewrite their history. Dropping `user_id`
  // severs the link to this account, but `display_name` and `venmo_username`
  // are both NOT NULL in 0004 and stay — their copy keeps the name and the
  // Venmo handle used on that tab, unlinked from any account. The modal says
  // exactly this; keep the two in step.
  //
  // Scoped by `user_id` alone, which also covers the rows on the user's *own*
  // receipts — those disappear a moment later when the receipt cascades. This
  // has to run before step 4 either way: `receipt_participants.user_id`
  // references `profiles(id)` with no `on delete` action, so a surviving row
  // fails the profile delete outright.
  const { error: anonymiseError } = await service
    .from("receipt_participants")
    .update({ user_id: null })
    .eq("user_id", user.id);

  if (anonymiseError) {
    console.error("[deleteAccount] anonymise participants error:", anonymiseError);
    return { error: "Couldn't delete your account. Try again." };
  }

  // ── 3. charges carrying this user's id ─────────────────────────────────────
  // `charges.from_user_id` is NOT NULL and also has no `on delete` action, so
  // unlike a participant row it cannot be anonymised: every row pointing at
  // this profile has to move or go before step 4 can run.
  //
  // A charge is supposed to be issued by the receipt's owner —
  // `save_receipt_state` (0016) writes the owner it looked up, and
  // `claim.ts` writes `receipt.created_by`. An older client-side save path
  // stamped the *session* user instead, and a non-owner participant could
  // reach it. That path is gone — saves now go through `save_receipt_state`,
  // which refuses a caller who does not own the receipt — but rows it already
  // wrote are still out there, carrying a guest's id on somebody else's tab.
  // Deleting by `from_user_id` alone would take those rows off that person's
  // tab and break their totals: the exact harm step 2 exists to prevent.
  //
  // So: find them, hand them back to the receipt's real owner, and only then
  // delete what is left. What is left is charges on this user's own receipts,
  // which step 4 would cascade away regardless.
  //
  // The scan pages, and it does not assume a short page means the last page: a
  // server-side row cap below CHARGE_PAGE truncates every page, which would
  // end the walk after the first one and leave the rows behind it unseen —
  // exactly the misfiled rows this step exists to find. So it asks for an
  // exact count and stops on that, advancing by what actually arrived rather
  // than by what it asked for. An empty page ends the loop either way, which
  // is also what happens if the server sends no count at all.
  const foreignReceipts = new Map<string, string>();
  let scanned = 0;
  for (let offset = 0; ; ) {
    const { data, error, count } = await service
      .from("charges")
      .select("receipt_id, receipts!inner(created_by)", { count: "exact" })
      .eq("from_user_id", user.id)
      .order("id")
      .range(offset, offset + CHARGE_PAGE - 1);

    if (error) {
      console.error("[deleteAccount] scan charges error:", error);
      return { error: "Couldn't delete your account. Try again." };
    }

    const page = (data ?? []) as ChargeScanRow[];
    for (const row of page) {
      const owner = ownerOf(row);
      if (!owner || owner === user.id) continue;
      foreignReceipts.set(row.receipt_id, owner);
    }

    scanned += page.length;
    offset += page.length;
    if (page.length === 0) break;
    if (typeof count === "number") {
      if (scanned >= count) break;
    } else if (page.length < CHARGE_PAGE) break;
  }

  // One update per affected receipt rather than per row: the set is small (a
  // tab you were a guest on, not one you created) and it keeps the filter to
  // two equalities instead of a URL full of ids.
  for (const [receiptId, owner] of foreignReceipts) {
    const { error } = await service
      .from("charges")
      .update({ from_user_id: owner })
      .eq("from_user_id", user.id)
      .eq("receipt_id", receiptId);

    if (error) {
      console.error("[deleteAccount] re-point charges error:", error);
      return { error: "Couldn't delete your account. Try again." };
    }
  }

  // Now safe: everything still matching is on a receipt this user owns.
  const { error: chargesError } = await service
    .from("charges")
    .delete()
    .eq("from_user_id", user.id);

  if (chargesError) {
    console.error("[deleteAccount] delete charges error:", chargesError);
    return { error: "Couldn't delete your account. Try again." };
  }

  // ── 4. the profile, and everything that cascades from it ───────────────────
  const { error: profileError } = await service
    .from("profiles")
    .delete()
    .eq("id", user.id);

  if (profileError) {
    console.error("[deleteAccount] delete profile error:", profileError);
    return { error: "Couldn't delete your account. Try again." };
  }

  // ── 5. the auth user ───────────────────────────────────────────────────────
  // Works the same for anonymous (guest) sign-ins, which own data too.
  const { error: authError } = await service.auth.admin.deleteUser(user.id);

  if (authError) {
    console.error("[deleteAccount] delete auth user error:", authError);
    return { error: "Couldn't delete your account. Try again." };
  }

  // ── 6. drop the session ────────────────────────────────────────────────────
  // The session's user no longer exists, so the logout endpoint may 401/403/404
  // — supabase-js ignores exactly those and clears the cookies regardless.
  await supabase.auth.signOut();

  return { redirectTo: "/" };
}
