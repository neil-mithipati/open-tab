"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GlassButton } from "@/components/ui/GlassButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Starts an anonymous session so a guest can scan, split, and share a check
// without signing up. They can later upgrade via "Create account".
export function GuestStartButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleStart() {
    setLoading(true);
    setError("");
    const supabase = getSupabaseBrowserClient();
    const { error: err } = await supabase.auth.signInAnonymously();
    if (err) {
      setError("Couldn't get started. Try again.");
      setLoading(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <GlassButton size="md" className="px-8" loading={loading} onClick={handleStart}>
        Get started
      </GlassButton>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
