"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { Avatar } from "@/components/ui/Avatar";
import { formatCurrency } from "@/lib/utils";
import type { useReceiptFlow } from "@/hooks/useReceiptFlow";
import { cn } from "@/lib/utils";

type Flow = ReturnType<typeof useReceiptFlow>;

export function AssignItemsStep({ flow }: { flow: Flow }) {
  const { state, toggleAssignment, goTo } = flow;
  const nonOwners = state.participants.filter((p) => !p.isOwner);

  // running total per participant
  function getTotal(participantClientId: string): number {
    let sum = 0;
    for (const item of state.items) {
      const assignees = state.assignments[item.clientId] ?? [];
      if (assignees.includes(participantClientId) && assignees.length > 0) {
        sum += (item.price * item.quantity) / assignees.length;
      }
    }
    const sub = state.items.reduce((s, it) => s + it.price * it.quantity, 0);
    const taxRate = sub > 0 ? (state.tax ?? 0) / sub : 0;
    const tipRate = sub > 0 ? (state.tip ?? 0) / sub : 0;
    return sum * (1 + taxRate + tipRate);
  }

  const allAssigned = state.items.every(
    (it) => (state.assignments[it.clientId] ?? []).length > 0
  );

  return (
    <div className="flex flex-col gap-4 pt-4">
      {/* participant totals */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {nonOwners.map((p) => (
          <div key={p.clientId} className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <Avatar name={p.displayName} size="sm" />
            <span className="text-xs text-secondary">@{p.displayName}</span>
            <span className="text-xs font-semibold text-brand">{formatCurrency(getTotal(p.clientId))}</span>
          </div>
        ))}
      </div>

      {/* items with checkboxes */}
      <div className="flex flex-col gap-3">
        {state.items.map((item) => {
          const assignees = state.assignments[item.clientId] ?? [];
          return (
            <GlassCard key={item.clientId} size="sm" className="p-4">
              <div className="flex justify-between mb-3">
                <span className="font-medium text-primary text-sm">
                  {item.quantity > 1 ? `${item.quantity}× ` : ""}{item.name}
                </span>
                <span className="text-sm text-secondary">{formatCurrency(item.price * item.quantity)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {nonOwners.map((p) => {
                  const checked = assignees.includes(p.clientId);
                  return (
                    <button
                      key={p.clientId}
                      onClick={() => toggleAssignment(item.clientId, p.clientId)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors",
                        checked
                          ? "bg-brand text-white"
                          : "bg-white/10 text-secondary hover:bg-white/20"
                      )}
                    >
                      <Avatar name={p.displayName} size="sm" className="w-4 h-4 text-[8px]" />
                      @{p.displayName}
                    </button>
                  );
                })}
              </div>
            </GlassCard>
          );
        })}
      </div>

      {!allAssigned && (
        <p className="text-xs text-amber-400 text-center">Assign all items to continue</p>
      )}

      <GlassButton size="lg" disabled={!allAssigned} onClick={() => goTo("charge_review")}>
        Review charges
      </GlassButton>
    </div>
  );
}
