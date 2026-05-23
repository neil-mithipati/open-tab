"use server";

import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { deriveDisplayName } from "@/lib/utils";

export async function saveVenmoUsername(raw: string): Promise<{ error: string } | never> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const displayName = deriveDisplayName(raw);
  const { error } = await supabase
    .from("profiles")
    .upsert(
      { id: user.id, email: user.email ?? "", display_name: displayName, venmo_username: raw },
      { onConflict: "id" }
    );

  if (error) {
    console.error("[saveVenmoUsername] Supabase error:", error);
    return { error: "Something went wrong. Try again." };
  }

  redirect("/dashboard");
}
