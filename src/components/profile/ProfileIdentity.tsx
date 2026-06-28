"use client";

import { useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { animalEmoji, deriveDisplayName } from "@/lib/utils";

interface Props {
  userId: string;
  email: string;
  initialDisplayName: string;
  initialVenmo: string;
}

export function ProfileIdentity({ userId, email, initialDisplayName, initialVenmo }: Props) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [venmo, setVenmo] = useState(initialVenmo);

  return (
    <>
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full glass-panel-sm flex items-center justify-center text-2xl flex-shrink-0">
          {animalEmoji(userId)}
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-bold text-primary">@{displayName}</h1>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-sm text-brand hover:underline underline-offset-2"
              >
                edit
              </button>
            )}
          </div>
          <p className="text-sm text-secondary">{email}</p>
        </div>
      </div>

      {editing && (
        <div>
          <h2 className="text-lg font-semibold text-primary mb-3">Venmo username</h2>
          <GlassCard className="p-5">
            <ProfileForm
              userId={userId}
              initialVenmo={venmo}
              onSaved={(newVenmo) => {
                setVenmo(newVenmo);
                setDisplayName(deriveDisplayName(newVenmo));
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </GlassCard>
        </div>
      )}
    </>
  );
}
