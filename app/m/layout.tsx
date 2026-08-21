import type { Metadata, Viewport } from "next";
import { RegisterSW } from "./RegisterSW";

export const metadata: Metadata = {
  title: "EPE Orders",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RegisterSW />
      {children}
    </>
  );
}
