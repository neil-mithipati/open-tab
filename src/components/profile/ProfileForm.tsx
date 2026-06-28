"use client";

import { useState } from "react";
import { GlassInput } from "@/components/ui/GlassInput";
import { GlassButton } from "@/components/ui/GlassButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { deriveDisplayName } from "@/lib/utils";

interface Props {
  userId: string;
  initialVenmo: string;
  onSaved?: (venmoUsername: string) => void;
  onCancel?: () => void;
}

export function ProfileForm({ userId, initialVenmo, onSaved, onCancel }: Props) {
  const [venmo, setVenmo] = useState(initialVenmo);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const raw = venmo.trim().replace(/^@/, "");
    if (!raw) { setError("Enter your Venmo username"); return; }

    setLoading(true);
    setError("");

    const supabase = getSupabaseBrowserClient();
    const { error: err } = await supabase
      .from("profiles")
      .update({ venmo_username: raw, display_name: deriveDisplayName(raw) })
      .eq("id", userId);

    setLoading(false);
    if (err) { setError("Failed to save. Try again."); return; }
    onSaved?.(raw);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <GlassInput
        label="Venmo username"
        prefix="@"
        value={venmo}
        onChange={(e) => setVenmo(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        error={error}
      />
      <div className="flex items-center gap-2">
        <GlassButton type="submit" size="md" loading={loading}>
          Save changes
        </GlassButton>
        {onCancel && (
          <GlassButton type="button" variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </GlassButton>
        )}
      </div>
    </form>
  );
}
