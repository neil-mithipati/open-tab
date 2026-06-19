"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, User, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", icon: Home, label: "Home" },
  { href: "/profile", icon: User, label: "Profile" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 px-4"
      style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
    >
      <div className="glass-panel px-6 py-2 flex items-center justify-around max-w-md mx-auto" style={{ background: "rgba(4, 8, 17, 0.75)" }}>
        <NavItem href={NAV[0].href} icon={NAV[0].icon} label={NAV[0].label} active={pathname.startsWith(NAV[0].href)} />

        <Link href="/receipts/new" className="flex flex-col items-center gap-0.5 -mt-6" aria-label="New receipt">
          <span className={cn(
            "w-14 h-14 rounded-full bg-brand text-white flex items-center justify-center",
            "shadow-[0_4px_20px_rgba(99,102,241,0.5)] active:scale-95 transition-transform"
          )}>
            <Plus className="w-7 h-7" strokeWidth={2.5} />
          </span>
          <span className="text-[10px] text-secondary">New</span>
        </Link>

        <NavItem href={NAV[1].href} icon={NAV[1].icon} label={NAV[1].label} active={pathname.startsWith(NAV[1].href)} />
      </div>
    </nav>
  );
}

function NavItem({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
}) {
  return (
    <Link href={href} className="flex flex-col items-center gap-0.5 px-3 py-1">
      <Icon
        className={cn("w-6 h-6 transition-colors", active ? "text-brand" : "text-tertiary")}
        strokeWidth={active ? 1.75 : 1.5}
        strokeLinecap="square"
        strokeLinejoin="miter"
        strokeMiterlimit={10}
      />
      <span className={cn("text-[10px] font-medium", active ? "text-brand" : "text-tertiary")}>
        {label}
      </span>
    </Link>
  );
}
