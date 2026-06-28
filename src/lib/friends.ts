import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface Friend {
  id: string;
  display_name: string;
  venmo_username: string | null;
}

// Adds someone to the current user's friend list by Venmo username. If they're
// an Open Tab user, create a real bidirectional friendship; otherwise store them
// as an external contact. Returns the new friend, or { already } when they're
// already a contact. Shared by the profile Friends manager and the split UI's
// auto-add-on-manual-entry.
export async function addFriendByUsername(
  userId: string,
  rawUsername: string
): Promise<{ friend: Friend } | { already: true } | { error: string }> {
  const username = rawUsername.trim().replace(/^@/, "");
  if (!username) return { error: "Enter a username." };

  const supabase = getSupabaseBrowserClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, venmo_username")
    .ilike("venmo_username", username)
    .neq("id", userId)
    .single();

  if (!profile) {
    // Not on Open Tab — save as an external contact by Venmo username.
    const { data: contacts, error: insertError } = await supabase
      .from("external_contacts")
      .insert({ user_id: userId, venmo_username: username })
      .select("id, venmo_username");
    if (insertError) {
      return insertError.code === "23505"
        ? { already: true }
        : { error: "Something went wrong. Try again." };
    }
    const contact = contacts?.[0];
    return {
      friend: {
        id: contact?.id ?? crypto.randomUUID(),
        display_name: username,
        venmo_username: username,
      },
    };
  }

  const { error: rpcError } = await supabase.rpc("add_friendship", {
    a: userId,
    b: profile.id,
  });
  if (rpcError) return { error: "Something went wrong. Try again." };
  return { friend: profile as Friend };
}
