"use client";

import { useState } from "react";
import { GlassButton } from "@/components/ui/GlassButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { refreshUserCaches } from "@/app/actions/cache";
import { UserPlus, Check } from "lucide-react";

interface Props {
  inviterId: string;
  currentUserId: string;
}

export function AddFriendButton({ inviterId, currentUserId }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function addFriend() {
    setStatus("loading");
    const supabase = getSupabaseBrowserClient();
    // add_friendship refuses unless the caller is one of the two users, so a
    // stale or signed-out session comes back as an error instead of silently
    // doing nothing.
    const { error } = await supabase.rpc("add_friendship", { a: currentUserId, b: inviterId });
    if (error) {
      setStatus("error");
      return;
    }
    await refreshUserCaches();
    setStatus("done");
  }

  if (status === "done") {
    return (
      <div className="flex items-center gap-2 text-emerald-400 font-medium">
        <Check className="w-5 h-5" /> Connected!
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center gap-2">
      <GlassButton size="lg" loading={status === "loading"} onClick={addFriend}>
        <UserPlus className="w-5 h-5 mr-2" /> Add as friend
      </GlassButton>
      {status === "error" && (
        <p className="text-sm text-red-400">Couldn&apos;t connect. Try again.</p>
      )}
    </div>
  );
}
