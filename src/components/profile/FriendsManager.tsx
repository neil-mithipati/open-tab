"use client";

import { useMemo, useState } from "react";
import { removeFriend } from "@/app/actions/profile";
import { refreshUserCaches } from "@/app/actions/cache";
import { addFriendByUsername, type Friend } from "@/lib/friends";
import { isValidVenmoUsername } from "@/lib/utils";
import { Plus, X } from "lucide-react";

interface Props {
  userId: string;
  initialFriends: Friend[];
}

export function FriendsManager({ userId, initialFriends }: Props) {
  const [query, setQuery] = useState("");
  const [friends, setFriends] = useState<Friend[]>(initialFriends);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const sortedFriends = useMemo(
    () =>
      [...friends].sort((a, b) =>
        a.display_name.localeCompare(b.display_name, undefined, {
          sensitivity: "base",
        })
      ),
    [friends]
  );

  async function handleRemove(friend: Friend) {
    setRemovingId(friend.id);
    setError("");
    // Optimistic: drop from the list, restore it if the server rejects.
    const prev = friends;
    setFriends((cur) => cur.filter((f) => f.id !== friend.id));
    const result = await removeFriend(friend.id);
    if ("error" in result) {
      setFriends(prev);
      setError(result.error);
    }
    setRemovingId(null);
  }

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

    const result = await addFriendByUsername(userId, username);
    setAdding(false);

    if ("error" in result) { setError(result.error); return; }
    if ("already" in result || friends.some((f) => f.id === result.friend.id)) {
      setError("Already in your friends list.");
      return;
    }

    setFriends((prev) => [...prev, result.friend]);
    setQuery("");
    // The friendship is written from the browser, so the cached list on the
    // server would otherwise stay one friend behind.
    refreshUserCaches();
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
        <div className="flex flex-col divide-y divide-white/8 max-h-64 overflow-y-auto">
          {sortedFriends.map((friend) => (
            <div key={friend.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-primary truncate">
                  @{friend.venmo_username ?? friend.display_name}
                </p>
                {friend.venmo_username && friend.display_name !== friend.venmo_username && (
                  <p className="text-xs text-secondary truncate">{friend.display_name}</p>
                )}
              </div>
              <button
                onClick={() => handleRemove(friend)}
                disabled={removingId === friend.id}
                className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-tertiary hover:text-primary hover:bg-white/8 transition-colors disabled:opacity-40"
                aria-label={`Remove ${friend.display_name}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
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
