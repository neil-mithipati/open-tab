"use server";

import {
  getSupabaseServerClient,
  getSupabaseServiceClient,
} from "@/lib/supabase/server";

const BUCKET = "receipt-images";

// storage.list() pages; ask for a full page and walk until a short one comes
// back, so an account with hundreds of receipt photos still gets cleared.
const LIST_PAGE = 100;

export type DeleteAccountResult = { redirectTo: string } | { error: string };

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
 *   3. delete `charges` the user issued
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
  // severs the link to this account while `display_name` and `venmo_username`
  // stay, so their copy shows a name and nothing more.
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

  // ── 3. charges the user issued ─────────────────────────────────────────────
  // `charges.from_user_id` is NOT NULL and also has no `on delete` action, so
  // it can't be anonymised the way participants can. Every writer sets it to
  // the receipt's owner, so this only ever matches charges on receipts this
  // user created — the same rows step 4 would cascade away.
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
