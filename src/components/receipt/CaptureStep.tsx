"use client";

import { useRef, useState } from "react";
import { GlassButton } from "@/components/ui/GlassButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { refreshUserCaches } from "@/app/actions/cache";
import { compressImage } from "@/lib/image/compressImage";
import { RECEIPT_IMAGE_URL_TTL_SECONDS } from "@/lib/storage";
import { useToast, ToastViewport } from "@/components/ui/Toast";
import type { useReceiptFlow } from "@/hooks/useReceiptFlow";
import { Camera, RotateCw } from "lucide-react";

type Flow = ReturnType<typeof useReceiptFlow>;

// The one parse the route hands back, waiting to be spent.
//
// Module scope rather than component state, and the reason is structural: the
// page swaps this component out for ScanningStep the moment a scan starts, so
// by the time the parse answers, this component is unmounted and every
// setState on it is a no-op. Sending the flow back to "capture" then mounts a
// FRESH CaptureStep, which is where the offer has to appear. The flow state
// survives that, but it is typed in useReceiptFlow and not this component's to
// extend, so the marker lives here and the new instance reads it on mount.
//
// It carries the receiptId it belongs to so a stale marker can never offer a
// retry of somebody else's scan.
let pendingRetry: { receiptId: string; mimeType: string; userId: string } | null = null;

export function CaptureStep({ flow }: { flow: Flow }) {
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(() => pendingRetry);
  const [retrying, setRetrying] = useState(false);
  const { toasts, showToast, dismiss } = useToast();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError("");
    setRetry(null);
    pendingRetry = null;
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

    // A signed URL for the preview thumbnail the split step shows beside the
    // items. Fifteen minutes rather than the hour this used to ask for: long
    // enough to cover a split session start to finish, short enough that the
    // copy written to the row below is a dead string within the quarter hour.
    const { data: signed } = await supabase.storage
      .from("receipt-images")
      .createSignedUrl(path, RECEIPT_IMAGE_URL_TTL_SECONDS);

    if (!signed) { flow.goTo("capture"); return; }
    flow.update("signedUrl", signed.signedUrl);

    // image_url is a POINTER, not a credential. Every reader of this column —
    // the parse route, the receipt page, the discard path — runs
    // extractStoragePath over it and signs a fresh URL from the path it
    // recovers; not one of them follows the stored string. So the signature
    // going stale costs nothing, and a row that leaks stops being a way into
    // the bucket a quarter of an hour after it was written.
    await supabase.from("receipts").update({ image_url: signed.signedUrl }).eq("id", receipt.id);

    await runParse(receipt.id, mimeType, user.id);
  }

  // Everything from the parse call onward, so a retry can run it again against
  // the receipt and the image already uploaded. Nothing here re-uploads.
  async function runParse(receiptId: string, mimeType: string, userId: string) {
    const supabase = getSupabaseBrowserClient();
    setRetry(null);
    pendingRetry = null;
    flow.goTo("scanning");

    // call Gemini parse API
    const res = await fetch("/api/receipts/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receiptId,
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
      // out of date a second time. Awaited (unlike the fire-and-forget call
      // above) so a slow cache refresh cannot land after the next scan has
      // already created a new row.
      await refreshUserCaches();
      flow.goTo("capture");
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[handleFile] parse API error:", err);
      if (err?.error === "parse_retryable") {
        // The model provider failed — a 5xx, a dropped connection, a timeout —
        // and the route has handed the receipt's claim back rather than
        // spending it. The photo is still uploaded and the server will honour
        // another attempt, so offer one instead of dropping the user in a
        // manual form for an outage that may already be over. Only this one
        // error gets the offer: a 503 parse_unavailable, a 500 parse_failed
        // and a 409 all mean the parse is gone, and a button that could only
        // fail would be a lie.
        pendingRetry = { receiptId, mimeType, userId };
        setRetry(pendingRetry);
        flow.goTo("capture");
        return;
      }
      if (err?.error === "parse_unavailable") {
        // A 503 here almost always means an outage on our side (an unapplied
        // migration is the usual cause), not anything the user did — silence
        // makes it look like the manual form below is just how this app
        // works. Say what happened and that the form in front of them still
        // works by hand.
        showToast("Parsing is unavailable right now. Enter the items by hand.", "error");
      }
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
        .eq("id", userId)
        .single();

      if (profile?.venmo_username) {
        flow.addParticipant({
          type: "friend",
          userId,
          displayName: profile.display_name,
          venmoUsername: profile.venmo_username,
          isOwner: true,
        });
      }
    }

    flow.goTo("split");
  }

  async function handleRetry() {
    if (!retry || retrying) return;
    setRetrying(true);
    await runParse(retry.receiptId, retry.mimeType, retry.userId);
    setRetrying(false);
  }

  return (
    <div className="flex flex-col gap-4 pt-4">
      {retry ? (
        // The hero while it is showing: the photo is already up there and one
        // tap finishes the job the user started.
        <>
          <p className="text-sm text-secondary text-center">
            Couldn&apos;t reach the scanner. Your photo is saved — try again.
          </p>
          <GlassButton size="lg" className="gap-2" onClick={handleRetry} disabled={retrying}>
            <RotateCw className="w-5 h-5" /> Try again
          </GlassButton>
          <button
            onClick={() => cameraRef.current?.click()}
            className="text-sm text-secondary hover:text-primary transition-colors text-center"
          >
            Take a new photo
          </button>
        </>
      ) : (
        <GlassButton
          size="lg"
          className="gap-2"
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="w-5 h-5" /> Take photo
        </GlassButton>
      )}

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
