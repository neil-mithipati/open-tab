"use client";

import { useRef, useState } from "react";
import { GlassButton } from "@/components/ui/GlassButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { useReceiptFlow } from "@/hooks/useReceiptFlow";
import { Camera } from "lucide-react";

type Flow = ReturnType<typeof useReceiptFlow>;

export function CaptureStep({ flow }: { flow: Flow }) {
  const [error, setError] = useState("");
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError("");
    flow.update("imageFile", file);
    flow.update("mimeType", file.type || "image/jpeg");
    flow.goTo("scanning");

    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // create draft receipt row
    const { data: receipt } = await supabase
      .from("receipts")
      .insert({ created_by: user.id, status: "draft" })
      .select("id")
      .single();

    if (!receipt) { flow.goTo("capture"); setError("Failed to create receipt."); return; }
    flow.update("receiptId", receipt.id);

    // upload image
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${user.id}/${receipt.id}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("receipt-images")
      .upload(path, file, { contentType: file.type });

    if (uploadErr) { flow.goTo("capture"); setError("Upload failed."); return; }

    // get signed URL for Gemini
    const { data: signed } = await supabase.storage
      .from("receipt-images")
      .createSignedUrl(path, 3600);

    if (!signed) { flow.goTo("capture"); return; }
    flow.update("signedUrl", signed.signedUrl);

    // update receipt with image url
    await supabase.from("receipts").update({ image_url: signed.signedUrl }).eq("id", receipt.id);

    // call Gemini parse API
    const res = await fetch("/api/receipts/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signedUrl: signed.signedUrl,
        receiptId: receipt.id,
        mimeType: file.type,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[handleFile] parse API error:", err);
      flow.goTo("split");
      return;
    }
    const json = await res.json();
    if (json.success && json.data) {
      const d = json.data;
      flow.update("merchantName", d.merchant_name);
      flow.update("dateOfReceipt", d.date_of_receipt);
      flow.update("subtotal", d.subtotal);
      flow.update("tax", d.tax);
      flow.update("tip", d.tip);
      flow.update("total", d.total);
      flow.update(
        "items",
        (d.items ?? []).map((it: { name: string; price: number; quantity: number }, i: number) => ({
          clientId: `item-${i}`,
          name: it.name,
          price: it.price,
          quantity: it.quantity,
        }))
      );

      // add self as owner participant
      const { data: profile } = await supabase
        .from("profiles")
        .select("venmo_username, display_name")
        .eq("id", user.id)
        .single();

      if (profile?.venmo_username) {
        flow.addParticipant({
          type: "friend",
          userId: user.id,
          displayName: profile.display_name,
          venmoUsername: profile.venmo_username,
          isOwner: true,
        });
      }
    }

    flow.goTo("split");
  }

  return (
    <div className="flex flex-col gap-4 pt-4">
      <GlassButton
        size="lg"
        className="gap-2"
        onClick={() => cameraRef.current?.click()}
      >
        <Camera className="w-5 h-5" /> Take photo
      </GlassButton>

      <button
        onClick={() => fileRef.current?.click()}
        className="text-sm text-secondary hover:text-primary transition-colors text-center"
      >
        Choose from library
      </button>

      {error && <p className="text-sm text-red-400 text-center">{error}</p>}

      {/* hidden inputs */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  );
}
