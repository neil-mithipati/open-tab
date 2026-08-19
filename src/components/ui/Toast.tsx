"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ToastVariant = "success" | "error";

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const AUTO_DISMISS_MS = 3000;

// Minimal hand-rolled toast primitive — no context, no provider. A page owns
// its own toast queue via useToast() and renders <ToastViewport /> once. Kept
// local rather than global because only receipts/new needs it today; lifting
// this into a root layout provider can happen if a second call site needs it.
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, variant }]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        dismiss(id);
      }, AUTO_DISMISS_MS);
      timers.current.add(timer);
    },
    [dismiss]
  );

  // Clear any pending auto-dismiss timers on unmount — the page that owns
  // this hook (e.g. after a share navigates away) can unmount before a
  // timer fires.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  return { toasts, showToast, dismiss };
}

export function ToastViewport({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          onClick={() => dismiss(toast.id)}
          className={`pointer-events-auto glass-panel-sm animate-slide-up max-w-md w-full text-left px-4 py-3 text-sm font-medium ${
            toast.variant === "error" ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
