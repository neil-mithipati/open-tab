"use client";

import { Spinner } from "@/components/ui/Spinner";
import { GlassCard } from "@/components/ui/GlassCard";

export function ScanningStep() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
      <Spinner size="lg" />
      <GlassCard className="p-6 text-center w-full max-w-xs">
        <p className="font-semibold text-primary">Reading your receipt…</p>
        <p className="text-sm text-secondary mt-1">AI is parsing items and totals</p>
        {/* shimmer skeleton rows */}
        <div className="flex flex-col gap-3 mt-4">
          {[80, 60, 70, 50].map((w, i) => (
            <div key={i} className="flex justify-between items-center">
              <div
                className="h-3 rounded-full bg-gradient-to-r from-white/10 via-white/25 to-white/10 bg-[length:200%_100%] animate-shimmer"
                style={{ width: `${w}%` }}
              />
              <div className="h-3 w-12 rounded-full bg-gradient-to-r from-white/10 via-white/25 to-white/10 bg-[length:200%_100%] animate-shimmer" />
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
