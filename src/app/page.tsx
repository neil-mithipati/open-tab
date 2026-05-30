import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { Camera, Users } from "lucide-react";
import { VenmoIcon } from "@/components/ui/VenmoIcon";

export default function LandingPage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-5 py-12 gap-7">
      <div className="text-center">
        <h1
          className="text-7xl font-black tracking-tight animate-gradient"
          style={{
            fontFamily: "ui-rounded, var(--font-nunito), system-ui, sans-serif",
            letterSpacing: "-0.03em",
          }}
        >
          Open Tab
        </h1>
        <p className="text-lg text-secondary mt-1">Split bills. Charge friends.</p>
      </div>

      <GlassCard className="w-full max-w-sm overflow-hidden p-0">
        {[
          { icon: <Camera className="w-5 h-5 text-brand" />, title: "Scan any receipt", description: "AI reads and itemizes your receipt in seconds" },
          { icon: <Users className="w-5 h-5 text-brand" />, title: "Split your way", description: "Split equally or assign items per person" },
          { icon: <VenmoIcon className="w-5 h-5 text-brand" />, title: "Charge with Venmo", description: "One tap to charge your friends with Venmo" },
        ].map((f, i) => (
          <div key={i} className={`flex items-center gap-4 px-5 py-4 ${i < 2 ? "border-b border-white/10" : ""}`}>
            <div className="w-10 h-10 rounded-2xl glass-panel-sm flex items-center justify-center flex-shrink-0">
              {f.icon}
            </div>
            <div>
              <p className="font-semibold text-primary text-sm">{f.title}</p>
              <p className="text-xs text-secondary mt-0.5">{f.description}</p>
            </div>
          </div>
        ))}
      </GlassCard>

      <div className="w-full max-w-sm flex flex-col items-center gap-3">
        <Link href="/auth">
          <GlassButton size="md" className="px-8">Get started</GlassButton>
        </Link>
        <Link href="/auth" className="text-center text-sm text-secondary">
          Already have an account?{" "}
          <span className="text-brand underline">Sign in</span>
        </Link>
      </div>
    </div>
  );
}
