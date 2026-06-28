"use client";

import { useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { setVenmoUsername } from "@/app/actions/profile";
import { isValidVenmoUsername } from "@/lib/utils";

// Captures the owner's Venmo username before sharing, so claimers know who
// owns the check. Saves it to the profile, then hands control back to share.
export function VenmoPromptModal({
  onSaved,
  onCancel,
}: {
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [venmo, setVenmo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const clean = venmo.trim().replace(/^@/, "");
    if (!isValidVenmoUsername(clean)) {
      setError("Enter a valid Venmo username (5–16 letters, numbers, _ or -).");
      return;
    }
    setError("");
    setLoading(true);
    const result = await setVenmoUsername(clean);
    if ("error" in result) {
      setError(result.error);
      setLoading(false);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 backdrop-blur-sm">
      <GlassCard className="w-full max-w-sm p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-primary">Add your Venmo</h2>
          <p className="text-sm text-secondary mt-1">
            So everyone knows who owns this check and where to pay.
          </p>
        </div>
        <div className="flex items-center glass-panel-sm rounded-2xl overflow-hidden w-full">
          <span className="pl-3 text-secondary text-sm flex-shrink-0">@</span>
          <input
            type="text"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="your Venmo username"
            value={venmo}
            onChange={(e) => { setVenmo(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="flex-1 min-w-0 bg-transparent text-sm text-primary px-2 py-3 outline-none"
            autoFocus
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex items-center gap-2">
          <GlassButton size="md" className="flex-1" loading={loading} onClick={handleSave}>
            Share
          </GlassButton>
          <GlassButton variant="secondary" size="md" onClick={onCancel} disabled={loading}>
            Cancel
          </GlassButton>
        </div>
      </GlassCard>
    </div>
  );
}
