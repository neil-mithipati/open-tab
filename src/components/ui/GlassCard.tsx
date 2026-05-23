"use client";

import { cn } from "@/lib/utils";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
}

export function GlassCard({ className, size = "md", ...props }: GlassCardProps) {
  return (
    <div
      className={cn(
        size === "sm" && "glass-panel-sm",
        size === "md" && "glass-panel",
        size === "lg" && "glass-panel-lg",
        className
      )}
      {...props}
    />
  );
}
