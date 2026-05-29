import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";
import { X, Check } from "lucide-react";
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
    <div className="min-h-dvh flex flex-col">
      <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-2 max-w-md mx-auto w-full">
        <Link
          href="/dashboard"
          className="w-9 h-9 rounded-full glass-panel-sm flex items-center justify-center text-secondary hover:text-primary transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </Link>
        <Link
          href="/dashboard"
          className="w-9 h-9 rounded-full glass-panel-sm flex items-center justify-center text-secondary hover:text-primary transition-colors"
          aria-label="Done"
        >
          <Check className="w-4 h-4" />
        </Link>
      </div>
      <main className="flex-1 pb-8 px-4 max-w-md mx-auto w-full">
      <div className="flex flex-col gap-5">

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
      </main>
    </div>
  );
}
