"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  ["/", "Disputes"],
  ["/insights", "Insights"],
  ["/accuracy", "Track record"],
  ["/settings", "Settings"],
  ["/store", "Demo store"],
] as const;

/** Top navigation; marks the section you're in (a case page counts as Disputes). */
export function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/disputes") : path.startsWith(href));
  return (
    <nav>
      {LINKS.map(([href, label]) => (
        <a key={href} href={href} aria-current={active(href) ? "page" : undefined}>{label}</a>
      ))}
    </nav>
  );
}
