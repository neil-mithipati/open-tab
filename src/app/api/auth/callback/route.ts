import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await getSupabaseServerClient();

  // Magic-link / PKCE sign-in delivers a `code`; email-change confirmation
  // (the anonymous→permanent upgrade) delivers `token_hash` + `type`.
  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  } else if (tokenHash && type) {
    await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  }

  // The new-user trigger only fires on insert, so a freshly-upgraded account
  // still has an empty profile email — backfill it from the now-permanent user.
  const { data: { user } } = await supabase.auth.getUser();
  if (user && !user.is_anonymous && user.email) {
    await supabase.from("profiles").update({ email: user.email }).eq("id", user.id);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
