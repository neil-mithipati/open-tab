"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import { GlassCard } from "@/components/ui/GlassCard";
import { formatCurrency, formatDate } from "@/lib/utils";
import { AlignJustify, Image as ImageIcon } from "lucide-react";

export interface CheckPreviewItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

// Read-only twin of the editable check in ReceiptSplitStep: the same parsed
// breakdown and original photo, for screens where the check can be looked at
// but not changed. `dimmed` fades it back and blocks interaction, leaving room
// for `overlay` (the action that unlocks editing) to float on top.
export function CheckPreview({
  merchantName,
  dateOfReceipt,
  items,
  tax,
  tip,
  total,
  imageUrl,
  dimmed = false,
  overlay,
}: {
  merchantName: string | null;
  dateOfReceipt: string | null;
  items: CheckPreviewItem[];
  tax: number | null;
  tip: number | null;
  total: number | null;
  imageUrl?: string | null;
  dimmed?: boolean;
  overlay?: ReactNode;
}) {
  const [view, setView] = useState<"parsed" | "original">("parsed");

  const subtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
  const grandTotal = total ?? subtotal + (tax ?? 0) + (tip ?? 0);

  return (
    <div className="flex flex-col gap-2">
      {/* The toggle stays live even when the check itself is locked */}
      {imageUrl && (
        <div className="flex justify-end">
          <div className="glass-panel-sm rounded-2xl p-1 flex gap-1">
            <button
              onClick={() => setView("parsed")}
              className={`flex items-center justify-center w-8 h-8 rounded-xl transition-all ${
                view === "parsed" ? "bg-white/15 text-primary" : "text-tertiary hover:text-secondary"
              }`}
              aria-label="Parsed receipt"
            >
              <AlignJustify className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView("original")}
              className={`flex items-center justify-center w-8 h-8 rounded-xl transition-all ${
                view === "original" ? "bg-white/15 text-primary" : "text-tertiary hover:text-secondary"
              }`}
              aria-label="Original receipt"
            >
              <ImageIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="relative">
        <div className={dimmed ? "opacity-40 pointer-events-none select-none" : ""}>
          {/* Both views stay mounted so the photo is already fetched when the
              toggle is pressed. */}
          {imageUrl && (
            <div className={view === "original" ? "" : "hidden"}>
              <GlassCard className="overflow-hidden p-0">
                <div className="relative w-full" style={{ minHeight: "60vh" }}>
                  <Image
                    src={imageUrl}
                    alt="Original receipt"
                    fill
                    priority
                    sizes="(max-width: 768px) 100vw, 448px"
                    className="object-contain"
                  />
                </div>
              </GlassCard>
            </div>
          )}

          <div className={view === "original" ? "hidden" : ""}>
            <GlassCard className="p-0 overflow-hidden">
              <div className="px-4 pt-4 pb-3">
                <p className="font-bold text-primary text-lg leading-tight truncate">
                  {merchantName ?? "Receipt"}
                </p>
                {dateOfReceipt && (
                  <p className="text-sm text-secondary mt-0.5">{formatDate(dateOfReceipt)}</p>
                )}
              </div>

              <div className="h-px bg-white/8" />

              <div className="px-4 py-2 flex flex-col divide-y divide-white/8">
                {items.map((item) => (
                  <div key={item.id} className="py-2.5 flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 text-primary truncate">{item.name}</span>
                    {item.quantity > 1 && (
                      <span className="text-secondary flex-shrink-0">×{item.quantity}</span>
                    )}
                    <span className="text-primary font-medium flex-shrink-0">
                      {formatCurrency(item.price * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="h-px bg-white/8" />

              <div className="px-4 py-3 flex flex-col gap-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-secondary">Subtotal</span>
                  <span className="text-primary">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-secondary">Tax</span>
                  <span className="text-primary">{formatCurrency(tax ?? 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-secondary">Tip</span>
                  <span className="text-primary">{formatCurrency(tip ?? 0)}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-white/8 mt-0.5">
                  <span className="font-bold text-primary">Total</span>
                  <span className="font-bold text-primary text-lg">
                    {formatCurrency(grandTotal)}
                  </span>
                </div>
              </div>
            </GlassCard>
          </div>
        </div>

        {overlay && (
          <div className="absolute inset-0 flex justify-center pointer-events-none">
            {/* Sticks to the middle of the viewport, so it stays reachable
                however far down the check the reader has scrolled. */}
            <div className="sticky top-1/2 self-start pointer-events-auto">{overlay}</div>
          </div>
        )}
      </div>
    </div>
  );
}
