"use client";

import { useState } from "react";
import { GlassButton } from "@/components/ui/GlassButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { UserPlus, Check } from "lucide-react";

interface Props {
  inviterId: string;
  currentUserId: string;
}

export function AddFriendButton({ inviterId, currentUserId }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");

  async function addFriend() {
    setStatus("loading");
    const supabase = getSupabaseBrowserClient();
    await supabase.rpc("add_friendship", { a: currentUserId, b: inviterId });
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
    <GlassButton size="lg" loading={status === "loading"} onClick={addFriend}>
      <UserPlus className="w-5 h-5 mr-2" /> Add as friend
    </GlassButton>
  );
}
