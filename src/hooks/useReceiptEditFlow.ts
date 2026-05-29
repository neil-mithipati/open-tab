"use client";

import { useState, useCallback } from "react";
import type { ReceiptFlowState, Step } from "./useReceiptFlow";
import type { FlowParticipant } from "@/types";
import { generateClientId } from "@/lib/utils";

// Same interface as useReceiptFlow but seeded from existing DB data.
// Does not use sessionStorage — state is ephemeral per page visit.
export function useReceiptEditFlow(seed: Omit<ReceiptFlowState, "step" | "imageFile">) {
  const [state, setState] = useState<ReceiptFlowState>({
    ...seed,
    step: "split",
    imageFile: null,
  });

  const update = useCallback(<K extends keyof ReceiptFlowState>(key: K, value: ReceiptFlowState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const goTo = useCallback((step: Step) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const reset = useCallback(() => {
    setState({ ...seed, step: "split", imageFile: null });
  }, [seed]);

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

  return { state, update, goTo, reset, clearSplitState, addParticipant, removeParticipant, toggleAssignment };
}
