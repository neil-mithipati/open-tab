"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassInput } from "@/components/ui/GlassInput";
import { formatCurrency } from "@/lib/utils";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { useReceiptFlow } from "@/hooks/useReceiptFlow";
import { Plus, Trash2 } from "lucide-react";

type Flow = ReturnType<typeof useReceiptFlow>;

export function ReviewItemsStep({ flow }: { flow: Flow }) {
  const { state, update, addItem, updateItem, removeItem, goTo } = flow;
  const subtotal = state.items.reduce((s, it) => s + it.price * it.quantity, 0);

  async function handleNext() {
    // persist items to DB
    const supabase = getSupabaseBrowserClient();
    if (state.receiptId) {
      // delete old items and reinsert
      await supabase.from("receipt_items").delete().eq("receipt_id", state.receiptId);
      if (state.items.length > 0) {
        await supabase.from("receipt_items").insert(
          state.items.map((it, i) => ({
            receipt_id: state.receiptId,
            name: it.name,
            price: it.price,
            quantity: it.quantity,
            sort_order: i,
          }))
        );
      }
      await supabase.from("receipts").update({
        merchant_name: state.merchantName,
        date_of_receipt: state.dateOfReceipt,
        subtotal: state.subtotal ?? subtotal,
        tax: state.tax ?? 0,
        tip: state.tip ?? 0,
        total: state.total ?? subtotal + (state.tax ?? 0) + (state.tip ?? 0),
      }).eq("id", state.receiptId);
    }
    goTo("add_participants");
  }

  return (
    <div className="flex flex-col gap-4 pt-4">
      {/* merchant + date */}
      <GlassCard size="sm" className="p-4 flex flex-col gap-3">
        <GlassInput
          label="Merchant"
          value={state.merchantName ?? ""}
          onChange={(e) => update("merchantName", e.target.value || null)}
          placeholder="Restaurant name"
        />
        <GlassInput
          label="Date"
          type="date"
          value={state.dateOfReceipt ?? ""}
          onChange={(e) => update("dateOfReceipt", e.target.value || null)}
        />
      </GlassCard>

      {/* items */}
      <div className="flex flex-col gap-2">
        {state.items.map((item) => (
          <GlassCard key={item.clientId} size="sm" className="p-3 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <input
                className="glass-input py-2 text-sm"
                placeholder="Item name"
                value={item.name}
                onChange={(e) => updateItem(item.clientId, { name: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                className="w-7 h-7 rounded-xl bg-white/15 flex items-center justify-center text-secondary hover:text-primary"
                onClick={() => updateItem(item.clientId, { quantity: Math.max(1, item.quantity - 1) })}
              >−</button>
              <span className="w-5 text-center text-sm font-medium text-primary">{item.quantity}</span>
              <button
                className="w-7 h-7 rounded-xl bg-white/15 flex items-center justify-center text-secondary hover:text-primary"
                onClick={() => updateItem(item.clientId, { quantity: item.quantity + 1 })}
              >+</button>
            </div>
            <div className="w-20 flex-shrink-0">
              <input
                className="glass-input py-2 text-sm text-right"
                type="number"
                step="0.01"
                min="0"
                value={item.price}
                onChange={(e) => updateItem(item.clientId, { price: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <button
              className="text-red-400/70 hover:text-red-400 p-1"
              onClick={() => removeItem(item.clientId)}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </GlassCard>
        ))}
        <GlassButton variant="ghost" size="sm" className="gap-1.5 self-start" onClick={addItem}>
          <Plus className="w-4 h-4" /> Add item
        </GlassButton>
      </div>

      {/* totals */}
      <GlassCard size="sm" className="p-4 flex flex-col gap-2">
        <div className="flex justify-between text-sm">
          <span className="text-secondary">Subtotal</span>
          <span className="text-primary font-medium">{formatCurrency(subtotal)}</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-secondary">Tax</span>
          <input
            className="w-24 glass-input py-1.5 text-sm text-right"
            type="number"
            step="0.01"
            min="0"
            value={state.tax ?? ""}
            placeholder="0.00"
            onChange={(e) => update("tax", parseFloat(e.target.value) || null)}
          />
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-secondary">Tip</span>
          <input
            className="w-24 glass-input py-1.5 text-sm text-right"
            type="number"
            step="0.01"
            min="0"
            value={state.tip ?? ""}
            placeholder="0.00"
            onChange={(e) => update("tip", parseFloat(e.target.value) || null)}
          />
        </div>
        <div className="flex justify-between text-base font-semibold border-t border-white/10 pt-2 mt-1">
          <span className="text-primary">Total</span>
          <span className="text-primary">
            {formatCurrency(subtotal + (state.tax ?? 0) + (state.tip ?? 0))}
          </span>
        </div>
      </GlassCard>

      <GlassButton size="lg" onClick={handleNext} disabled={state.items.length === 0}>
        Continue
      </GlassButton>
    </div>
  );
}
