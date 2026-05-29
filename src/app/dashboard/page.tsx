import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Camera, ChevronRight } from "lucide-react";

export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, venmo_username")
    .eq("id", user.id)
    .single();

  if (!profile?.venmo_username) redirect("/auth/venmo");

  const [{ data: created }, { data: participated }] = await Promise.all([
    supabase
      .from("receipts")
      .select("id, merchant_name, date_of_receipt, total, status, created_at")
      .eq("created_by", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("receipt_participants")
      .select("receipt_id, receipts(id, merchant_name, date_of_receipt, total, status, created_at)")
      .eq("user_id", user.id)
      .eq("is_owner", false),
  ]);

  type Receipt = { id: string; merchant_name: string | null; date_of_receipt: string | null; total: number | null; status: string; created_at: string };

  const participatedReceipts = (participated ?? [])
    .map((p) => p.receipts)
    .filter(Boolean)
    .flat() as Receipt[];

  const allReceipts = [...(created ?? []) as Receipt[], ...participatedReceipts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <AppShell>
      <div className="flex flex-col gap-6 pb-10">
        <div>
          <p className="text-secondary text-sm">Welcome back,</p>
          <h1 className="text-2xl font-bold text-primary">@{profile.display_name}</h1>
        </div>

        <Link href="/receipts/new">
          <GlassCard className="p-5 flex items-center gap-4 active:scale-[0.98] transition-transform cursor-pointer">
            <div className="w-12 h-12 rounded-2xl bg-brand flex items-center justify-center flex-shrink-0">
              <Camera className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="font-semibold text-primary">Scan a receipt</p>
              <p className="text-sm text-secondary">Split a new bill</p>
            </div>
            <ChevronRight className="w-5 h-5 text-tertiary ml-auto" />
          </GlassCard>
        </Link>

        <div>
          <h2 className="text-lg font-semibold text-primary mb-3">Activity</h2>
          {allReceipts.length > 0 ? (
            <div className="flex flex-col gap-3">
              {allReceipts.map((r) => (
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
                      <StatusBadge status={r.status} />
                    </div>
                    <ChevronRight className="w-4 h-4 text-tertiary" />
                  </GlassCard>
                </Link>
              ))}
            </div>
          ) : (
            <GlassCard size="sm" className="p-6 text-center">
              <p className="text-secondary text-sm">No receipts yet</p>
              <Link href="/receipts/new">
                <GlassButton variant="ghost" size="sm" className="mt-2">
                  Scan your first receipt
                </GlassButton>
              </Link>
            </GlassCard>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "text-tertiary",
    reviewing: "text-amber-400",
    charging: "text-brand",
    settled: "text-emerald-400",
  };
  return (
    <span className={`text-xs font-medium capitalize ${map[status] ?? "text-tertiary"}`}>
      {status}
    </span>
  );
}
