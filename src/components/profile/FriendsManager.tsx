"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isValidVenmoUsername } from "@/lib/utils";
import { Plus } from "lucide-react";

interface Friend {
  id: string;
  display_name: string;
  venmo_username: string | null;
}

interface Props {
  userId: string;
  initialFriends: Friend[];
}

export function FriendsManager({ userId, initialFriends }: Props) {
  const [query, setQuery] = useState("");
  const [friends, setFriends] = useState<Friend[]>(initialFriends);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  function validateUsername(raw: string): string | null {
    if (!isValidVenmoUsername(raw)) {
      if (raw.length < 5) return "Venmo usernames are at least 5 characters.";
      if (raw.length > 16) return "Venmo usernames are at most 16 characters.";
      return "Venmo usernames can only contain letters, numbers, hyphens, and underscores.";
    }
    return null;
  }

  async function handleAdd() {
    const username = query.trim().replace(/^@/, "");
    if (!username) return;
    const validationError = validateUsername(username);
    if (validationError) { setError(validationError); return; }
    setError("");
    setAdding(true);

    const supabase = getSupabaseBrowserClient();

    // Look up the profile by Venmo username
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, display_name, venmo_username")
      .ilike("venmo_username", username)
      .neq("id", userId)
      .single();

    if (!profile) {
      // Not on Open Tab yet — save as an external contact by Venmo username
      const { data: contacts, error: insertError } = await supabase
        .from("external_contacts")
        .insert({ user_id: userId, venmo_username: username })
        .select("id, venmo_username");

      if (insertError) {
        setError(insertError.code === "23505" ? "Already in your friends list." : "Something went wrong. Try again.");
        setAdding(false);
        return;
      }

      const contact = contacts?.[0];
      const contactId = contact?.id ?? crypto.randomUUID();
      setFriends((prev) => [...prev, { id: contactId, display_name: username, venmo_username: username }]);
      setQuery("");
      setAdding(false);
      return;
    }

    if (friends.some((f) => f.id === profile.id)) {
      setError("Already in your friends list.");
      setAdding(false);
      return;
    }

    // Bidirectional insert via the DB helper
    const { error: rpcError } = await supabase.rpc("add_friendship", {
      a: userId,
      b: profile.id,
    });

    if (rpcError) {
      setError("Something went wrong. Try again.");
      setAdding(false);
      return;
    }

    setFriends((prev) => [...prev, profile as Friend]);
    setQuery("");
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Input + add button */}
      <div className="flex items-center glass-panel-sm rounded-2xl overflow-hidden">
        <span className="pl-3 text-secondary text-sm flex-shrink-0">@</span>
        <input
          type="text"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Venmo username"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 min-w-0 bg-transparent text-sm text-primary px-2 py-2.5 outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={adding || !query.trim()}
          className="flex items-center justify-center px-3 py-2.5 bg-brand/20 hover:bg-brand/30 active:bg-brand/40 text-brand transition-colors border-l border-white/8 flex-shrink-0 disabled:opacity-40"
          aria-label="Add friend"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Friends list */}
      {friends.length > 0 && (
        <div className="flex flex-col divide-y divide-white/8">
          {friends.map((friend) => (
            <div key={friend.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={friend.display_name} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-primary truncate">
                  @{friend.venmo_username ?? friend.display_name}
                </p>
                {friend.venmo_username && friend.display_name !== friend.venmo_username && (
                  <p className="text-xs text-secondary truncate">{friend.display_name}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {friends.length === 0 && (
        <p className="text-sm text-secondary text-center py-2">No friends added yet</p>
      )}
    </div>
  );
}
