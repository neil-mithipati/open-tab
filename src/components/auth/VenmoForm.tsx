"use client";

import { useState } from "react";
import { GlassInput } from "@/components/ui/GlassInput";
import { GlassButton } from "@/components/ui/GlassButton";
import { saveVenmoUsername } from "@/app/actions/profile";

export function VenmoForm() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const raw = username.trim().replace(/^@/, "");
    if (!raw) {
      setError("Enter your Venmo username");
      return;
    }
    setLoading(true);
    setError("");

    const result = await saveVenmoUsername(raw);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <GlassInput
        label="Venmo username"
        placeholder="your-username"
        prefix="@"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoFocus
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        error={error}
      />
      <p className="text-xs text-secondary px-1">
        Used to generate charge links for your friends. You can update this anytime in your profile.
      </p>
      <GlassButton type="submit" size="md" className="self-center px-8" loading={loading}>
        Start splitting
      </GlassButton>
    </form>
  );
}
