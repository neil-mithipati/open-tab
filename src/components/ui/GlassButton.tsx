"use client";

import { cn } from "@/lib/utils";

interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export function GlassButton({
  className,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  children,
  ...props
}: GlassButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-semibold transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:pointer-events-none select-none cursor-pointer",
        size === "sm" && "px-4 py-2 text-sm rounded-2xl",
        size === "md" && "px-5 py-3 text-base rounded-2xl",
        size === "lg" && "px-6 py-4 text-lg rounded-3xl w-full",
        variant === "primary" && "glass-panel-sm text-primary hover:-translate-y-0.5 hover:brightness-[1.12]",
        variant === "secondary" && "glass-panel-sm text-primary hover:bg-white/[0.06]",
        variant === "ghost" && "text-secondary hover:text-primary hover:bg-white/15 rounded-xl",
        variant === "danger" && "bg-red-500/80 text-white hover:bg-red-500",
        className
      )}
      {...props}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <Spinner size="sm" />
          {children}
        </span>
      ) : children}
    </button>
  );
}

function Spinner({ size = "sm" }: { size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "rounded-full border-2 border-white/30 border-t-white animate-spin",
        size === "sm" ? "w-4 h-4" : "w-5 h-5"
      )}
    />
  );
}
