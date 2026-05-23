import { GlassCard } from "@/components/ui/GlassCard";
import { EmailForm } from "@/components/auth/EmailForm";

export default function AuthPage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="text-center">
          <h1
            className="text-7xl font-black animate-gradient"
            style={{
              fontFamily: "ui-rounded, system-ui, sans-serif",
              letterSpacing: "-0.03em",
            }}
          >
            Open Tab
          </h1>
        </div>
        <GlassCard className="p-6">
          <h2 className="text-xl font-semibold text-primary mb-6">Sign in</h2>
          <EmailForm />
        </GlassCard>
      </div>
    </div>
  );
}
