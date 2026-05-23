import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "open-tab",
  description: "Split bills. Charge friends.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "open-tab" },
};

export const viewport: Viewport = {
  themeColor: "#040811",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
