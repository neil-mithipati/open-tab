"use client";

import { useCallback, useRef, useState } from "react";

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

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss]
  );

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
            toast.variant === "error" ? "text-red-300" : "text-emerald-300"
          }`}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
