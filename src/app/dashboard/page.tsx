import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getUserReceipts, getUserProfile } from "@/lib/queries";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Camera, ChevronRight } from "lucide-react";

export default function DashboardPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex items-center justify-center h-48 text-secondary text-sm">Loading…</div>}>
        <DashboardContent />
      </Suspense>
    </AppShell>
  );
}

async function DashboardContent() {
  await connection();
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const [profile, allReceipts] = await Promise.all([
    getUserProfile(user.id),
    getUserReceipts(user.id),
  ]);

  if (!profile?.venmo_username) redirect("/auth/venmo");

  return (
    <div className="flex flex-col gap-6 pb-10">
      <h1 className="text-5xl font-bold animate-gradient text-center">Open Tab</h1>

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
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    draft:    { color: "text-tertiary",     label: "draft" },
    reviewing:{ color: "text-amber-400",    label: "reviewing" },
    charging: { color: "text-brand",        label: "charging" },
    settled:  { color: "text-emerald-400",  label: "done" },
  };
  const { color, label } = map[status] ?? { color: "text-tertiary", label: status };
  return (
    <span className={`text-xs font-medium ${color}`}>{label}</span>
  );
}
