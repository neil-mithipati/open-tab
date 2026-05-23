import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { ChargeList } from "@/components/receipt/ChargeList";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ReceiptDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const { data: receipt } = await supabase
    .from("receipts")
    .select("*")
    .eq("id", id)
    .single();

  if (!receipt) notFound();

  const { data: items } = await supabase
    .from("receipt_items")
    .select("*")
    .eq("receipt_id", id)
    .order("sort_order");

  const { data: participants } = await supabase
    .from("receipt_participants")
    .select("*")
    .eq("receipt_id", id);

  const { data: charges } = await supabase
    .from("charges")
    .select("*")
    .eq("receipt_id", id);

  const isOwner = receipt.created_by === user.id;

  return (
    <AppShell>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="text-secondary hover:text-primary">
            <ChevronLeft className="w-6 h-6" />
          </Link>
          <h1 className="text-xl font-bold text-primary truncate">
            {receipt.merchant_name ?? "Receipt"}
          </h1>
        </div>

        <GlassCard className="p-5">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="font-semibold text-primary text-lg">
                {receipt.merchant_name ?? "—"}
              </p>
              <p className="text-sm text-secondary">
                {receipt.date_of_receipt ? formatDate(receipt.date_of_receipt) : "—"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-primary">
                {receipt.total ? formatCurrency(receipt.total) : "—"}
              </p>
              <span className="text-xs text-secondary capitalize">{receipt.status}</span>
            </div>
          </div>

          {items && items.length > 0 && (
            <div className="border-t border-white/10 pt-4 flex flex-col gap-2">
              {items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-secondary">
                    {item.quantity > 1 ? `${item.quantity}× ` : ""}{item.name}
                  </span>
                  <span className="text-primary font-medium">
                    {formatCurrency(item.price * item.quantity)}
                  </span>
                </div>
              ))}
              <div className="border-t border-white/10 mt-2 pt-2 flex flex-col gap-1">
                {receipt.tax ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-secondary">Tax</span>
                    <span className="text-primary">{formatCurrency(receipt.tax)}</span>
                  </div>
                ) : null}
                {receipt.tip ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-secondary">Tip</span>
                    <span className="text-primary">{formatCurrency(receipt.tip)}</span>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </GlassCard>

        {charges && charges.length > 0 && participants && (
          <ChargeList
            charges={charges}
            participants={participants}
            isOwner={isOwner}
            receiptId={id}
          />
        )}
      </div>
    </AppShell>
  );
}
