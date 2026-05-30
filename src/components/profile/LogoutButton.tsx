"use client";

import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { GlassButton } from "@/components/ui/GlassButton";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/auth");
  }

  return (
    <GlassButton variant="secondary" size="md" onClick={handleLogout}>
      Log out
    </GlassButton>
  );
}
