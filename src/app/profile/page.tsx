import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getUserProfile, getUserFriends } from "@/lib/queries";
import { ProfileIdentity } from "@/components/profile/ProfileIdentity";
import { InviteQRCode } from "@/components/profile/InviteQRCode";
import { FriendsManager } from "@/components/profile/FriendsManager";
import { LogoutButton } from "@/components/profile/LogoutButton";

export default function ProfilePage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex items-center justify-center h-48 text-secondary text-sm">Loading…</div>}>
        <ProfileContent />
      </Suspense>
    </AppShell>
  );
}

async function ProfileContent() {
  await connection();
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  // Guests have no profile to manage — prompt them to create an account.
  if (user.is_anonymous) {
    return (
      <GlassCard className="p-8 flex flex-col items-center text-center gap-4">
        <p className="text-secondary">
          Create an account to keep a history of your tabs and friends
        </p>
        <Link href="/auth" className="w-full">
          <GlassButton variant="primary" size="md" className="w-full">
            Create account
          </GlassButton>
        </Link>
      </GlassCard>
    );
  }

  const [profile, friends] = await Promise.all([
    getUserProfile(user.id),
    getUserFriends(user.id),
  ]);

  if (!profile) redirect("/auth");

  return (
    <div className="flex flex-col gap-6 pb-10">
      <ProfileIdentity
        userId={profile.id}
        email={profile.email}
        initialDisplayName={profile.display_name}
        initialVenmo={profile.venmo_username ?? ""}
      />

      <div>
        <h2 className="text-lg font-semibold text-primary mb-3">Add friends</h2>
        <GlassCard className="p-5">
          <FriendsManager userId={user.id} initialFriends={friends} />
        </GlassCard>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-primary mb-3">Invite friends</h2>
        <GlassCard className="p-5">
          <p className="text-sm text-secondary mb-4">
            Share your QR code to split with your friends
          </p>
          <InviteQRCode inviteToken={profile.invite_token} />
        </GlassCard>
      </div>
      <div className="flex justify-center pt-2">
        <LogoutButton />
      </div>
    </div>
  );
}
