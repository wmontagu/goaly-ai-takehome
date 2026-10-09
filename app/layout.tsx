import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SOP Claims Agent",
  description: "An insurance claims support agent governed by a fixed 4-phase SOP.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
