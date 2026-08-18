"use client";

import { useState, useEffect, useCallback } from "react";
import type { EditableItem, FlowParticipant } from "@/types";
import { generateClientId } from "@/lib/utils";

export type Step = "capture" | "scanning" | "split";

export interface ReceiptFlowState {
  step: Step;
  receiptId: string | null;
  imageFile: File | null;
  signedUrl: string | null;
  mimeType: string | null;
  merchantName: string | null;
  dateOfReceipt: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  items: EditableItem[];
  participants: FlowParticipant[];
  splitMode: "equal" | "by_item";
  assignments: Record<string, string[]>; // itemClientId → participantClientIds[]
}

const STORAGE_KEY = "open_tab_receipt_flow";

const INITIAL: ReceiptFlowState = {
  step: "capture",
  receiptId: null,
  imageFile: null,
  signedUrl: null,
  mimeType: null,
  merchantName: null,
  dateOfReceipt: null,
  subtotal: null,
  tax: null,
  tip: null,
  total: null,
  items: [],
  participants: [],
  splitMode: "equal",
  assignments: {},
};

export function useReceiptFlow() {
  const [state, setState] = useState<ReceiptFlowState>(INITIAL);

  // Restore a saved draft from sessionStorage on mount. This is a synchronous
  // read from an external system, not a value derivable at render time, so
  // there is no way to move this setState out of the effect.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState((prev) => ({ ...prev, ...parsed, imageFile: prev.imageFile }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      // imageFile can't be persisted to sessionStorage (a File isn't
      // serializable) so it's excluded from the stored snapshot here.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { imageFile, ...rest } = state;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch {}
  }, [state]);

  const update = useCallback(<K extends keyof ReceiptFlowState>(
    key: K,
    value: ReceiptFlowState[K]
  ) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const goTo = useCallback((step: Step) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const reset = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setState(INITIAL);
  }, []);

  const clearSplitState = useCallback(() => {
    setState((prev) => ({
      ...prev,
      splitMode: "equal",
      participants: prev.participants.filter((p) => p.isOwner),
      assignments: {},
    }));
  }, []);

  function addParticipant(p: Omit<FlowParticipant, "clientId">): string {
    const clientId = generateClientId();
    setState((prev) => ({
      ...prev,
      participants: [...prev.participants, { ...p, clientId }],
    }));
    return clientId;
  }

  function removeParticipant(clientId: string) {
    setState((prev) => ({
      ...prev,
      participants: prev.participants.filter((p) => p.clientId !== clientId),
    }));
  }

  function toggleAssignment(itemClientId: string, participantClientId: string) {
    setState((prev) => {
      const current = prev.assignments[itemClientId] ?? [];
      const next = current.includes(participantClientId)
        ? current.filter((id) => id !== participantClientId)
        : [...current, participantClientId];
      return { ...prev, assignments: { ...prev.assignments, [itemClientId]: next } };
    });
  }

  return {
    state,
    update,
    goTo,
    reset,
    clearSplitState,
    addParticipant,
    removeParticipant,
    toggleAssignment,
  };
}
