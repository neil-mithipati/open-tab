"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { deleteAccount } from "@/app/actions/deleteAccount";

const CONFIRM_WORD = "delete";

// Deleting is irreversible, so it sits at the very bottom, styled to recede,
// behind a modal that will not arm its button until the word is typed out. The
// action takes no arguments — it always deletes whoever is signed in.
export function DeleteAccountSection() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col items-center pt-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-secondary/70 hover:text-red-400 underline underline-offset-4 transition-colors cursor-pointer"
      >
        Delete account
      </button>
      {open && <DeleteAccountModal onCancel={() => setOpen(false)} />}
    </div>
  );
}

function DeleteAccountModal({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Lowercased because phone keyboards capitalise the first letter, and being
  // sent back to retype it teaches nothing about the consequences.
  const confirmed = typed.trim().toLowerCase() === CONFIRM_WORD;

  async function handleDelete() {
    if (!confirmed) return;
    setError("");
    setLoading(true);
    const result = await deleteAccount();
    if ("error" in result) {
      setError(result.error);
      setLoading(false);
      return;
    }
    // The session cookies are gone server-side; refresh so nothing cached in
    // the client router renders as if it were still signed in.
    router.replace(result.redirectTo);
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 backdrop-blur-sm">
      <GlassCard className="w-full max-w-sm p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-primary">Delete account</h2>
          <p className="text-sm text-secondary mt-1">
            This is permanent. It deletes your account, every tab you created and
            its receipt photos, your friends and friend groups.
          </p>
          <p className="text-sm text-secondary mt-2">
            Tabs your friends created stay on their side so their totals still
            add up — those keep your name only, nothing else.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="delete-confirm" className="text-sm text-secondary">
            Type <span className="font-semibold text-primary">{CONFIRM_WORD}</span> to
            confirm
          </label>
          <input
            id="delete-confirm"
            type="text"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={CONFIRM_WORD}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleDelete()}
            className="glass-panel-sm rounded-2xl bg-transparent text-sm text-primary px-3 py-3 outline-none w-full"
            autoFocus
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex items-center gap-2">
          <GlassButton
            variant="danger"
            size="md"
            className="flex-1"
            loading={loading}
            disabled={!confirmed}
            onClick={handleDelete}
          >
            Delete forever
          </GlassButton>
          <GlassButton
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </GlassButton>
        </div>
      </GlassCard>
    </div>
  );
}
