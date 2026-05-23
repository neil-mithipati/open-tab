"use client";

import { useState, useEffect, useCallback } from "react";
import type { EditableItem, FlowParticipant, ComputedCharge } from "@/types";
import { generateClientId } from "@/lib/utils";

export type Step =
  | "capture"
  | "scanning"
  | "review_items"
  | "add_participants"
  | "choose_split"
  | "assign_items"
  | "charge_review";

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
  charges: ComputedCharge[];
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
  charges: [],
};

export function useReceiptFlow() {
  const [state, setState] = useState<ReceiptFlowState>(INITIAL);

  // restore from sessionStorage on mount (excluding File object)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setState((prev) => ({ ...prev, ...parsed, imageFile: prev.imageFile }));
      }
    } catch {}
  }, []);

  // persist to sessionStorage on change (excluding File)
  useEffect(() => {
    try {
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

  function addItem() {
    setState((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { clientId: generateClientId(), name: "", price: 0, quantity: 1 },
      ],
    }));
  }

  function updateItem(clientId: string, patch: Partial<EditableItem>) {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.clientId === clientId ? { ...it, ...patch } : it
      ),
    }));
  }

  function removeItem(clientId: string) {
    setState((prev) => ({
      ...prev,
      items: prev.items.filter((it) => it.clientId !== clientId),
    }));
  }

  function addParticipant(p: Omit<FlowParticipant, "clientId">) {
    setState((prev) => ({
      ...prev,
      participants: [...prev.participants, { ...p, clientId: generateClientId() }],
    }));
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
    addItem,
    updateItem,
    removeItem,
    addParticipant,
    removeParticipant,
    toggleAssignment,
  };
}
