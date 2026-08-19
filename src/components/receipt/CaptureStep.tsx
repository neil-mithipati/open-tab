"use client";

import { useRef, useState } from "react";
import { GlassButton } from "@/components/ui/GlassButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { refreshUserCaches } from "@/app/actions/cache";
import { compressImage } from "@/lib/image/compressImage";
import { useToast, ToastViewport } from "@/components/ui/Toast";
import type { useReceiptFlow } from "@/hooks/useReceiptFlow";
import { Camera } from "lucide-react";

type Flow = ReturnType<typeof useReceiptFlow>;

export function CaptureStep({ flow }: { flow: Flow }) {
  const [error, setError] = useState("");
  const { toasts, showToast, dismiss } = useToast();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError("");
    flow.update("imageFile", file);
    flow.goTo("scanning");

    const { blob, mimeType } = await compressImage(file);
    flow.update("mimeType", mimeType);

    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // create open receipt row
    const { data: receipt } = await supabase
      .from("receipts")
      .insert({ created_by: user.id, status: "open" })
      .select("id")
      .single();

    if (!receipt) { flow.goTo("capture"); setError("Failed to create receipt."); return; }
    flow.update("receiptId", receipt.id);
    // The tab exists from here on, even if the user abandons the scan, so the
    // cached dashboard list is already out of date.
    refreshUserCaches();

    // upload image (compressed on success, original file on fallback)
    const compressed = blob !== file;
    // A dotless filename makes split(".").pop() return the whole name, which
    // would build a storage path the parse route's binding regex rejects.
    const rawExt = compressed ? "jpg" : (file.name.split(".").pop() ?? "jpg");
    const ext = /^[A-Za-z0-9]+$/.test(rawExt) ? rawExt : "jpg";
    const path = `${user.id}/${receipt.id}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("receipt-images")
      .upload(path, blob, { contentType: mimeType });

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
        receiptId: receipt.id,
        mimeType,
      }),
    });

    if (res.status === 429) {
      // Hitting the hourly scan limit is the one failure the user can act on,
      // so it gets said out loud instead of dropping them on an empty manual
      // form. The route discards the receipt row and its uploaded image on a
      // 429, so there is nothing left to edit — go back to capture.
      const err = await res.json().catch(() => ({}));
      const limit = typeof err?.limit === "number" ? err.limit : null;
      showToast(
        limit
          ? `Scan limit reached — ${limit} receipts an hour. Try again later.`
          : "Scan limit reached. Try again later.",
        "error"
      );
      flow.update("receiptId", null);
      flow.update("signedUrl", null);
      // The row created above is gone again, so the cached dashboard list is
      // out of date a second time.
      refreshUserCaches();
      flow.goTo("capture");
      return;
    }

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

      {/* This step owns its own toast queue — Toast.tsx has no provider by
          design, so each call site renders one viewport. */}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
