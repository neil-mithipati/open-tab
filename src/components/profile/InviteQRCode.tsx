"use client";

import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { useRef } from "react";
import { buildInviteUrl } from "@/lib/qr/inviteUrl";
import { GlassButton } from "@/components/ui/GlassButton";
import { Download, Copy } from "lucide-react";

interface Props {
  inviteToken: string;
}

export function InviteQRCode({ inviteToken }: Props) {
  const url = buildInviteUrl(inviteToken);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "open-tab-invite.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function copy() {
    await navigator.clipboard.writeText(url);
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="p-4 rounded-3xl bg-white">
        <QRCodeSVG value={url} size={180} level="M" />
      </div>
      {/* hidden canvas for download */}
      <div className="hidden">
        <QRCodeCanvas ref={canvasRef} value={url} size={512} level="M" />
      </div>
      <p className="text-xs text-secondary text-center break-all max-w-[240px]">{url}</p>
      <div className="flex gap-2 w-full">
        <GlassButton variant="secondary" size="sm" className="flex-1 gap-2" onClick={copy}>
          <Copy className="w-4 h-4" /> Copy link
        </GlassButton>
        <GlassButton variant="secondary" size="sm" className="flex-1 gap-2" onClick={download}>
          <Download className="w-4 h-4" /> Save QR
        </GlassButton>
      </div>
    </div>
  );
}
