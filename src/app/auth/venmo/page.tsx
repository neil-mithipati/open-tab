import { GlassCard } from "@/components/ui/GlassCard";
import { VenmoForm } from "@/components/auth/VenmoForm";

export default function VenmoPage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-primary">One last thing</h1>
          <p className="text-secondary mt-2">
            Your Venmo username lets friends charge you easily.
          </p>
        </div>
        <GlassCard className="p-6">
          <VenmoForm />
        </GlassCard>
      </div>
    </div>
  );
}
