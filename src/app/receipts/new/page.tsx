"use client";

import { useRouter } from "next/navigation";
import { useReceiptFlow } from "@/hooks/useReceiptFlow";
import { CaptureStep } from "@/components/receipt/CaptureStep";
import { ScanningStep } from "@/components/receipt/ScanningStep";
import { ReceiptSplitStep } from "@/components/receipt/ReceiptSplitStep";
import { ChargeScreen } from "@/components/receipt/ChargeScreen";
import { X } from "lucide-react";

export default function NewReceiptPage() {
  const flow = useReceiptFlow();
  const router = useRouter();
  const { step } = flow.state;

  return (
    <div className="min-h-dvh flex flex-col">
      <div className="flex items-center px-4 pt-safe pt-4 pb-2">
        {step !== "scanning" && (
          <button
            onClick={() => router.push("/dashboard")}
            className="w-9 h-9 rounded-full glass-panel-sm flex items-center justify-center text-secondary hover:text-primary transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <StepDots step={step} />

      <div className="flex-1 px-4 pb-8 max-w-md mx-auto w-full">
        {step === "capture" && <CaptureStep flow={flow} />}
        {step === "scanning" && <ScanningStep />}
        {step === "split" && <ReceiptSplitStep flow={flow} />}
        {step === "charge" && <ChargeScreen flow={flow} />}
      </div>
    </div>
  );
}

const ORDERED_STEPS = ["capture", "split", "charge"] as const;

function StepDots({ step }: { step: string }) {
  const idx = ORDERED_STEPS.indexOf(step as (typeof ORDERED_STEPS)[number]);
  return (
    <div className="flex items-center justify-center gap-1.5 py-2">
      {ORDERED_STEPS.map((s, i) => (
        <div
          key={s}
          className={`rounded-full transition-all duration-300 ${
            i === idx
              ? "w-5 h-1.5 bg-brand"
              : i < idx
              ? "w-1.5 h-1.5 bg-brand/50"
              : "w-1.5 h-1.5 bg-white/20"
          }`}
        />
      ))}
    </div>
  );
}
