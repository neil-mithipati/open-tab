import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Camera, Users } from "lucide-react";
import { VenmoIcon } from "@/components/ui/VenmoIcon";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GuestStartButton } from "@/components/auth/GuestStartButton";

export default function LandingPage() {
  // Static shell renders the landing page; the dynamic gate redirects an
  // already-logged-in account to Home before it's shown.
  return (
    <Suspense fallback={<Landing />}>
      <LandingGate />
    </Suspense>
  );
}

async function LandingGate() {
  await connection();
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");
  return <Landing />;
}

function Landing() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-5 py-12 gap-7">
      <div className="text-center">
        <h1
          className="text-7xl font-black tracking-tight animate-gradient"
          style={{
            fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
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
        <GuestStartButton />
        <Link href="/auth" className="text-center text-sm text-secondary">
          Already have an account?{" "}
          <span className="text-brand underline">Sign in</span>
        </Link>
      </div>
    </div>
  );
}
