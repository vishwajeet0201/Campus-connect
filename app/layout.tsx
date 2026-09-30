import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "CampusGlass | VJTI",
  description: "A college-only campus network for VJTI students.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en" className={inter.variable}><body><svg className="glass-filter-defs" aria-hidden="true"><defs><filter id="glass-displacement"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="4" result="noise" /><feDisplacementMap in="SourceGraphic" in2="noise" scale="2" /></filter></defs></svg>{children}</body></html>;
}
