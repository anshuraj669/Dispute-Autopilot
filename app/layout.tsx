import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "./components/nav";

export const metadata: Metadata = {
  title: "Dispute Autopilot",
  description: "An AI agent that investigates and resolves PayPal disputes for small merchants.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = process.env.PAYPAL_MODE === "sandbox" ? "PayPal sandbox" : "Demo data";
  return (
    // Browser extensions (Grammarly, password managers, dark-mode tools) add
    // attributes to <html>/<body> before React hydrates; ignore just those.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <header className="topbar">
          <a className="logo" href="/"><span className="logo-mark">◆</span><span>Dispute Autopilot</span></a>
          <Nav />
          <span className="mode"><span className="live-dot" />{mode}</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
