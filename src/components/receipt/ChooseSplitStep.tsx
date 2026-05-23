"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import type { useReceiptFlow } from "@/hooks/useReceiptFlow";
import { Users, List } from "lucide-react";
import { cn } from "@/lib/utils";

type Flow = ReturnType<typeof useReceiptFlow>;

export function ChooseSplitStep({ flow }: { flow: Flow }) {
  const { state, update, goTo } = flow;

  function selectMode(mode: "equal" | "by_item") {
    update("splitMode", mode);
  }

  function handleNext() {
    if (state.splitMode === "by_item") {
      goTo("assign_items");
    } else {
      goTo("charge_review");
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-6">
      <p className="text-secondary text-sm text-center">How should the bill be split?</p>

      <div className="flex flex-col gap-3">
        <SplitOption
          icon={<Users className="w-8 h-8" />}
          title="Split equally"
          description="Divide the total evenly among everyone"
          selected={state.splitMode === "equal"}
          onClick={() => selectMode("equal")}
        />
        <SplitOption
          icon={<List className="w-8 h-8" />}
          title="Assign by item"
          description="Choose who pays for each item"
          selected={state.splitMode === "by_item"}
          onClick={() => selectMode("by_item")}
        />
      </div>

      <GlassButton size="lg" onClick={handleNext} className="mt-2">
        Continue
      </GlassButton>
    </div>
  );
}

function SplitOption({
  icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <GlassCard
      className={cn(
        "p-5 flex items-center gap-4 cursor-pointer transition-all active:scale-[0.98]",
        selected && "ring-2 ring-brand shadow-[0_0_24px_rgba(99,102,241,0.25)]"
      )}
      onClick={onClick}
    >
      <div className={cn("w-14 h-14 rounded-3xl flex items-center justify-center flex-shrink-0",
        selected ? "bg-brand text-white" : "bg-white/15 text-secondary"
      )}>
        {icon}
      </div>
      <div>
        <p className="font-semibold text-primary">{title}</p>
        <p className="text-sm text-secondary mt-0.5">{description}</p>
      </div>
    </GlassCard>
  );
}
