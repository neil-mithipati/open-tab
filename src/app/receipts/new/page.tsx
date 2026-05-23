"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useReceiptFlow } from "@/hooks/useReceiptFlow";
import { CaptureStep } from "@/components/receipt/CaptureStep";
import { ScanningStep } from "@/components/receipt/ScanningStep";
import { ReviewItemsStep } from "@/components/receipt/ReviewItemsStep";
import { AddParticipantsStep } from "@/components/receipt/AddParticipantsStep";
import { ChooseSplitStep } from "@/components/receipt/ChooseSplitStep";
import { AssignItemsStep } from "@/components/receipt/AssignItemsStep";
import { ChargeReviewStep } from "@/components/receipt/ChargeReviewStep";
import { ChevronLeft } from "lucide-react";

const STEP_LABELS: Record<string, string> = {
  capture: "Scan Receipt",
  scanning: "Reading...",
  review_items: "Review Items",
  add_participants: "Add People",
  choose_split: "Split Method",
  assign_items: "Assign Items",
  charge_review: "Charges",
};

export default function NewReceiptPage() {
  const flow = useReceiptFlow();
  const router = useRouter();
  const { step } = flow.state;

  // reset flow on unmount only if we reach the end
  useEffect(() => {
    return () => {};
  }, []);

  function handleBack() {
    const order: typeof step[] = [
      "capture", "scanning", "review_items", "add_participants",
      "choose_split", "assign_items", "charge_review",
    ];
    const idx = order.indexOf(step);
    if (idx <= 0) { router.push("/dashboard"); return; }
    // skip assign_items when going back from charge_review if equal split
    if (step === "charge_review" && flow.state.splitMode === "equal") {
      flow.goTo("choose_split");
    } else if (step === "scanning") {
      flow.goTo("capture");
    } else {
      flow.goTo(order[idx - 1]);
    }
  }

  const showBack = step !== "scanning";

  return (
    <div className="min-h-dvh flex flex-col">
      {/* header */}
      <div className="flex items-center gap-2 px-4 pt-safe pt-4 pb-2">
        {showBack && (
          <button onClick={handleBack} className="text-secondary hover:text-primary p-1 -ml-1">
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        <h1 className="text-lg font-semibold text-primary">{STEP_LABELS[step]}</h1>
      </div>

      {/* step progress dots */}
      <StepDots step={step} />

      <div className="flex-1 px-4 pb-8 max-w-md mx-auto w-full">
        {step === "capture" && <CaptureStep flow={flow} />}
        {step === "scanning" && <ScanningStep />}
        {step === "review_items" && <ReviewItemsStep flow={flow} />}
        {step === "add_participants" && <AddParticipantsStep flow={flow} />}
        {step === "choose_split" && <ChooseSplitStep flow={flow} />}
        {step === "assign_items" && <AssignItemsStep flow={flow} />}
        {step === "charge_review" && <ChargeReviewStep flow={flow} />}
      </div>
    </div>
  );
}

const ORDERED_STEPS = [
  "capture", "review_items", "add_participants", "choose_split", "charge_review",
] as const;

function StepDots({ step }: { step: string }) {
  const idx = ORDERED_STEPS.indexOf(step as typeof ORDERED_STEPS[number]);
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
