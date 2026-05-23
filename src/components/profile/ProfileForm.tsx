"use client";

import { useState } from "react";
import { GlassInput } from "@/components/ui/GlassInput";
import { GlassButton } from "@/components/ui/GlassButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { deriveDisplayName } from "@/lib/utils";

interface Props {
  userId: string;
  initialVenmo: string;
}

export function ProfileForm({ userId, initialVenmo }: Props) {
  const [venmo, setVenmo] = useState(initialVenmo);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const raw = venmo.trim().replace(/^@/, "");
    if (!raw) { setError("Enter your Venmo username"); return; }

    setLoading(true);
    setError("");
    setSaved(false);

    const supabase = getSupabaseBrowserClient();
    const { error: err } = await supabase
      .from("profiles")
      .update({ venmo_username: raw, display_name: deriveDisplayName(raw) })
      .eq("id", userId);

    if (err) { setError("Failed to save. Try again."); }
    else { setSaved(true); }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <GlassInput
        label="Venmo username"
        prefix="@"
        value={venmo}
        onChange={(e) => { setVenmo(e.target.value); setSaved(false); }}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        error={error}
      />
      <GlassButton type="submit" size="md" loading={loading}>
        {saved ? "Saved!" : "Save changes"}
      </GlassButton>
    </form>
  );
}
