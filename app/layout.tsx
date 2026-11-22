import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zorax AI Cloud",
  description: "Inference gateway for Zorax Filler",
  icons: { icon: "/zorax.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
