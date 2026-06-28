"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  getSupabaseServerClient,
  getSupabaseServiceClient,
} from "@/lib/supabase/server";
import { deriveDisplayName } from "@/lib/utils";

export async function saveVenmoUsername(raw: string): Promise<{ error: string } | never> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const displayName = deriveDisplayName(raw);
  const { error } = await supabase
    .from("profiles")
    .upsert(
      { id: user.id, email: user.email ?? "", display_name: displayName, venmo_username: raw },
      { onConflict: "id" }
    );

  if (error) {
    console.error("[saveVenmoUsername] Supabase error:", error);
    return { error: "Something went wrong. Try again." };
  }

  redirect("/dashboard");
}

// Remove a friend. The id is either a profiles.id (a real, bidirectional
// friendship) or an external_contacts.id. We don't know which, so we clear
// both directions of the friendship and any matching external contact —
// all scoped to the caller, so nothing else can be touched. Friendship rows
// need the service client because RLS only allows deleting your own side,
// which would leave the reverse row dangling.
export async function removeFriend(friendId: string): Promise<{ error: string } | { ok: true }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const service = await getSupabaseServiceClient();
  const results = await Promise.all([
    service.from("friendships").delete().eq("user_id", user.id).eq("friend_id", friendId),
    service.from("friendships").delete().eq("user_id", friendId).eq("friend_id", user.id),
    service.from("external_contacts").delete().eq("user_id", user.id).eq("id", friendId),
  ]);

  if (results.some((r) => r.error)) {
    console.error("[removeFriend] Supabase error:", results.map((r) => r.error).filter(Boolean));
    return { error: "Couldn't remove friend. Try again." };
  }

  revalidatePath("/profile");
  return { ok: true };
}
