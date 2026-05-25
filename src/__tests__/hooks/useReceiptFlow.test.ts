import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReceiptFlow } from "@/hooks/useReceiptFlow";
import type { FlowParticipant } from "@/types";

const owner: Omit<FlowParticipant, "clientId"> = {
  type: "friend",
  userId: "u-owner",
  displayName: "Me",
  venmoUsername: "me",
  isOwner: true,
};

const alice: Omit<FlowParticipant, "clientId"> = {
  type: "friend",
  displayName: "Alice",
  venmoUsername: "alice",
  isOwner: false,
};

const bob: Omit<FlowParticipant, "clientId"> = {
  type: "manual",
  displayName: "bob",
  venmoUsername: "bob",
  isOwner: false,
};

describe("useReceiptFlow", () => {
  describe("initial state", () => {
    it("starts at the capture step", () => {
      const { result } = renderHook(() => useReceiptFlow());
      expect(result.current.state.step).toBe("capture");
    });

    it("has no participants on init", () => {
      const { result } = renderHook(() => useReceiptFlow());
      expect(result.current.state.participants).toHaveLength(0);
    });

    it("starts with equal split mode", () => {
      const { result } = renderHook(() => useReceiptFlow());
      expect(result.current.state.splitMode).toBe("equal");
    });
  });

  describe("addParticipant", () => {
    it("adds a participant and returns a non-empty string clientId", () => {
      const { result } = renderHook(() => useReceiptFlow());
      let clientId: string;
      act(() => { clientId = result.current.addParticipant(alice); });
      expect(typeof clientId!).toBe("string");
      expect(clientId!.length).toBeGreaterThan(0);
      expect(result.current.state.participants).toHaveLength(1);
      expect(result.current.state.participants[0].venmoUsername).toBe("alice");
    });

    it("returns a unique clientId each call", () => {
      const { result } = renderHook(() => useReceiptFlow());
      let id1: string, id2: string;
      act(() => { id1 = result.current.addParticipant(alice); });
      act(() => { id2 = result.current.addParticipant(bob); });
      expect(id1!).not.toBe(id2!);
    });

    it("sets clientId correctly on the stored participant", () => {
      const { result } = renderHook(() => useReceiptFlow());
      let clientId: string;
      act(() => { clientId = result.current.addParticipant(alice); });
      expect(result.current.state.participants[0].clientId).toBe(clientId!);
    });
  });

  describe("removeParticipant", () => {
    it("removes the participant by clientId", () => {
      const { result } = renderHook(() => useReceiptFlow());
      let clientId: string;
      act(() => { clientId = result.current.addParticipant(alice); });
      act(() => { result.current.removeParticipant(clientId!); });
      expect(result.current.state.participants).toHaveLength(0);
    });

    it("does not affect other participants", () => {
      const { result } = renderHook(() => useReceiptFlow());
      let aliceId: string, bobId: string;
      act(() => { aliceId = result.current.addParticipant(alice); });
      act(() => { bobId = result.current.addParticipant(bob); });
      act(() => { result.current.removeParticipant(aliceId!); });
      expect(result.current.state.participants).toHaveLength(1);
      expect(result.current.state.participants[0].clientId).toBe(bobId!);
    });
  });

  describe("toggleAssignment", () => {
    it("adds an assignment when not present", () => {
      const { result } = renderHook(() => useReceiptFlow());
      let clientId: string;
      act(() => { clientId = result.current.addParticipant(alice); });
      act(() => { result.current.toggleAssignment("item-1", clientId!); });
      expect(result.current.state.assignments["item-1"]).toContain(clientId!);
    });

    it("removes an assignment on second toggle (idempotent toggle)", () => {
      const { result } = renderHook(() => useReceiptFlow());
      let clientId: string;
      act(() => { clientId = result.current.addParticipant(alice); });
      act(() => { result.current.toggleAssignment("item-1", clientId!); });
      act(() => { result.current.toggleAssignment("item-1", clientId!); });
      expect(result.current.state.assignments["item-1"]).not.toContain(clientId!);
    });

    it("supports multiple participants assigned to the same item", () => {
      const { result } = renderHook(() => useReceiptFlow());
      let aliceId: string, bobId: string;
      act(() => { aliceId = result.current.addParticipant(alice); });
      act(() => { bobId = result.current.addParticipant(bob); });
      act(() => {
        result.current.toggleAssignment("item-1", aliceId!);
        result.current.toggleAssignment("item-1", bobId!);
      });
      expect(result.current.state.assignments["item-1"]).toContain(aliceId!);
      expect(result.current.state.assignments["item-1"]).toContain(bobId!);
    });
  });

  describe("clearSplitState", () => {
    it("removes non-owner participants", () => {
      const { result } = renderHook(() => useReceiptFlow());
      act(() => { result.current.addParticipant(owner); });
      act(() => { result.current.addParticipant(alice); });
      act(() => { result.current.addParticipant(bob); });
      act(() => { result.current.clearSplitState(); });
      const { participants } = result.current.state;
      expect(participants.every((p) => p.isOwner)).toBe(true);
      expect(participants).toHaveLength(1);
    });

    it("keeps owner participants", () => {
      const { result } = renderHook(() => useReceiptFlow());
      let ownerId: string;
      act(() => { ownerId = result.current.addParticipant(owner); });
      act(() => { result.current.addParticipant(alice); });
      act(() => { result.current.clearSplitState(); });
      expect(result.current.state.participants[0].clientId).toBe(ownerId!);
    });

    it("clears all assignments", () => {
      const { result } = renderHook(() => useReceiptFlow());
      let aliceId: string;
      act(() => { aliceId = result.current.addParticipant(alice); });
      act(() => { result.current.toggleAssignment("item-1", aliceId!); });
      act(() => { result.current.clearSplitState(); });
      expect(result.current.state.assignments).toEqual({});
    });

    it("resets splitMode to equal", () => {
      const { result } = renderHook(() => useReceiptFlow());
      act(() => { result.current.update("splitMode", "by_item"); });
      act(() => { result.current.clearSplitState(); });
      expect(result.current.state.splitMode).toBe("equal");
    });
  });

  describe("goTo", () => {
    it("navigates to the specified step", () => {
      const { result } = renderHook(() => useReceiptFlow());
      act(() => { result.current.goTo("split"); });
      expect(result.current.state.step).toBe("split");
    });
  });

  describe("sessionStorage persistence", () => {
    it("restores state from sessionStorage on mount", () => {
      sessionStorage.setItem(
        "open_tab_receipt_flow",
        JSON.stringify({ step: "split", merchantName: "Restored Cafe" })
      );
      const { result } = renderHook(() => useReceiptFlow());
      // useEffect runs after render — wait for it
      expect(result.current.state.merchantName).toBe("Restored Cafe");
    });
  });
});
