"use server";

import { updateTag } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  userFriendGroupsTag,
  userFriendsTag,
  userProfileTag,
  userReceiptsTag,
} from "@/lib/cacheTags";

// Receipts, profiles and friends are written from the browser straight to
// Supabase, so the server never learns those rows changed and keeps serving the
// cached copies. Client flows call this right after a write and before
// navigating, so the page they land on reads fresh data.
export async function refreshUserCaches(): Promise<void> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  updateTag(userReceiptsTag(user.id));
  updateTag(userProfileTag(user.id));
  updateTag(userFriendsTag(user.id));
  updateTag(userFriendGroupsTag(user.id));
}
