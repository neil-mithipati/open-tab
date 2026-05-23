import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { InviteQRCode } from "@/components/profile/InviteQRCode";
import { Avatar } from "@/components/ui/Avatar";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

export default async function ProfilePage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/auth");

  const { data: created } = await supabase
    .from("receipts")
    .select("id, merchant_name, date_of_receipt, total, status, created_at")
    .eq("created_by", user.id)
    .order("created_at", { ascending: false });

  const { data: participated } = await supabase
    .from("receipt_participants")
    .select("receipt_id, receipts(id, merchant_name, date_of_receipt, total, status, created_at)")
    .eq("user_id", user.id)
    .eq("is_owner", false);

  const participatedReceipts = (participated ?? [])
    .map((p) => p.receipts)
    .filter(Boolean)
    .flat() as typeof created;

  const allReceipts = [...(created ?? []), ...(participatedReceipts ?? [])].sort(
    (a, b) => new Date(b!.created_at).getTime() - new Date(a!.created_at).getTime()
  );

  return (
    <AppShell>
      <div className="flex flex-col gap-6 pb-10">
        <div className="flex items-center gap-4">
          <Avatar name={profile.display_name} size="lg" />
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
          <h2 className="text-lg font-semibold text-primary mb-3">Invite friends</h2>
          <GlassCard className="p-5">
            <p className="text-sm text-secondary mb-4">
              Share your QR code to split with your friends
            </p>
            <InviteQRCode inviteToken={profile.invite_token} />
          </GlassCard>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-primary mb-3">History</h2>
          {allReceipts.length === 0 ? (
            <GlassCard size="sm" className="p-6 text-center">
              <p className="text-secondary text-sm">No receipts yet</p>
            </GlassCard>
          ) : (
            <div className="flex flex-col gap-3">
              {allReceipts.map((r) => r && (
                <Link key={r.id} href={`/receipts/${r.id}`}>
                  <GlassCard size="sm" className="p-4 flex items-center gap-3 active:scale-[0.98] transition-transform cursor-pointer">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-primary truncate">
                        {r.merchant_name ?? "Receipt"}
                      </p>
                      <p className="text-sm text-secondary">
                        {r.date_of_receipt ? formatDate(r.date_of_receipt) : "—"}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-semibold text-primary">
                        {r.total ? formatCurrency(r.total) : "—"}
                      </p>
                      <span className="text-xs text-secondary capitalize">{r.status}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-tertiary" />
                  </GlassCard>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
