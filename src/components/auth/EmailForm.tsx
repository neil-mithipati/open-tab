"use client";

import { useState } from "react";
import { GlassInput } from "@/components/ui/GlassInput";
import { GlassButton } from "@/components/ui/GlassButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Mail } from "lucide-react";

export function EmailForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");

    const supabase = getSupabaseBrowserClient();
    const emailRedirectTo = `${window.location.origin}/api/auth/callback`;

    // An anonymous (guest) session upgrades in place via updateUser so their
    // existing tabs and friends carry over; everyone else gets a magic link.
    const { data: { user } } = await supabase.auth.getUser();
    const { error: err } = user?.is_anonymous
      ? await supabase.auth.updateUser(
          { email: email.trim() },
          { emailRedirectTo }
        )
      : await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { shouldCreateUser: true, emailRedirectTo },
        });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <div className="w-14 h-14 rounded-full bg-brand/10 flex items-center justify-center">
          <Mail className="w-7 h-7 text-brand" />
        </div>
        <div>
          <p className="font-semibold text-primary">Check your inbox</p>
          <p className="text-sm text-secondary mt-1">
            We sent a magic link to{" "}
            <span className="font-medium text-primary">{email}</span>
          </p>
        </div>
        <button
          onClick={() => { setSent(false); setEmail(""); }}
          className="text-sm text-brand underline mt-1"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <GlassInput
        type="email"
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus
        autoComplete="email"
        inputMode="email"
        error={error}
      />
      <GlassButton type="submit" size="md" className="self-center px-8" loading={loading}>
        Send magic link
      </GlassButton>
    </form>
  );
}
