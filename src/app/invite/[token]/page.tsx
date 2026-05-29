import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { Avatar } from "@/components/ui/Avatar";
import { AddFriendButton } from "@/components/profile/AddFriendButton";

interface Props {
  params: Promise<{ token: string }>;
}

export default function InvitePage({ params }: Props) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-dvh text-secondary text-sm">Loading…</div>}>
      <InviteContent params={params} />
    </Suspense>
  );
}

async function InviteContent({ params }: Props) {
  await connection();
  const { token } = await params;
  const supabase = await getSupabaseServerClient();

  const { data: inviter } = await supabase
    .from("profiles")
    .select("id, display_name, venmo_username")
    .eq("invite_token", token)
    .single();

  if (!inviter) notFound();

  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 gap-8">
      <GlassCard className="w-full max-w-sm p-8 flex flex-col items-center gap-6 text-center">
        <Avatar name={inviter.display_name} size="lg" />
        <div>
          <h1 className="text-2xl font-bold text-primary">@{inviter.display_name}</h1>
          <p className="text-secondary mt-1">wants to split bills with you on open-tab</p>
        </div>

        {user ? (
          user.id === inviter.id ? (
            <p className="text-secondary text-sm">This is your own invite link.</p>
          ) : (
            <AddFriendButton inviterId={inviter.id} currentUserId={user.id} />
          )
        ) : (
          <Link href={`/auth?invite=${token}`} className="w-full">
            <GlassButton size="lg">Sign in to connect</GlassButton>
          </Link>
        )}
      </GlassCard>
    </div>
  );
}
