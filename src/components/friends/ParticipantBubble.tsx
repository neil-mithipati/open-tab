"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { X } from "lucide-react";

// A mini avatar with the Venmo username on tap. Shared by the split UI and the
// friend-group modal, so it takes only the two fields it renders.
export function ParticipantBubble({
  participant,
  onRemove,
}: {
  participant: { displayName: string; venmoUsername: string };
  onRemove?: () => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative flex-shrink-0">
      {/* Avatar — toggles tooltip on click */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setShowTooltip((v) => !v)}
        onKeyDown={(e) => e.key === "Enter" && setShowTooltip((v) => !v)}
        className="relative cursor-pointer"
      >
        <Avatar name={participant.displayName} size="sm" />
      </div>
      {/* Remove button — separate from avatar so no nested button */}
      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center border border-white/20"
          aria-label="Remove"
        >
          <X className="w-2.5 h-2.5 text-white" />
        </button>
      )}
      {showTooltip && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur-sm text-white text-xs rounded-lg px-2.5 py-1 whitespace-nowrap z-30 pointer-events-none shadow-lg">
          @{participant.venmoUsername}
        </div>
      )}
    </div>
  );
}
