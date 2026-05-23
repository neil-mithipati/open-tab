"use client";

import { BottomNav } from "./BottomNav";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-dvh flex flex-col">
      <main className="flex-1 pb-24 px-4 pt-6 max-w-md mx-auto w-full">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
