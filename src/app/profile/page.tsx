import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getUserProfile, getUserFriends } from "@/lib/queries";
import { animalEmoji } from "@/lib/utils";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { InviteQRCode } from "@/components/profile/InviteQRCode";
import { FriendsManager } from "@/components/profile/FriendsManager";

export default async function ProfilePage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const [profile, friends] = await Promise.all([
    getUserProfile(user.id),
    getUserFriends(user.id),
  ]);

  if (!profile) redirect("/auth");

  return (
    <AppShell>
      <div className="flex flex-col gap-6 pb-10">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full glass-panel-sm flex items-center justify-center text-2xl flex-shrink-0">
            {animalEmoji(profile.id)}
          </div>
          <div>
            <h1 className="text-xl font-bold text-primary">@{profile.display_name}</h1>
            <p className="text-sm text-secondary">{profile.email}</p>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-primary mb-3">Your details</h2>
          <GlassCard className="p-5">
            <ProfileForm
              userId={profile.id}
              initialVenmo={profile.venmo_username ?? ""}
            />
          </GlassCard>
        </div>

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
      </div>
    </AppShell>
  );
}
