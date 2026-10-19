"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { InsightsReport, ListingRewrite, ProductInsight } from "@/lib/insights";
import { CountUp, Tilt } from "../components/spatial";

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** Disputes per 100 units: above 1 is a problem for most shops, above 3 is serious. */
function risk(p: ProductInsight): { tone: "critical" | "warning" | "good"; icon: string; label: string } {
  const r = p.disputeRate;
  if (r === null) return p.disputes >= 3 ? { tone: "critical", icon: "▲", label: "Many disputes" } : { tone: "warning", icon: "●", label: "No sales data" };
  if (r >= 3) return { tone: "critical", icon: "▲", label: "High dispute rate" };
  if (r >= 1) return { tone: "warning", icon: "●", label: "Watch" };
  return { tone: "good", icon: "✓", label: "Healthy" };
}

function ReasonBars({ reasons }: { reasons: InsightsReport["reasons"] }) {
  const max = Math.max(...reasons.map((r) => r.count), 1);
  return (
    <div className="hbars" role="table" aria-label="Disputes by reason">
      {reasons.map((r, i) => (
        <div key={r.reason} className="hbar-row" role="row" title={`${r.label}: ${r.count} dispute${r.count === 1 ? "" : "s"}, ${usd(r.amount)}`}>
          <span className="hbar-label" role="cell">{r.label}</span>
          <div className="hbar-track" role="cell">
            <div className="hbar" style={{ width: `${(r.count / max) * 100}%`, "--i": i } as CSSProperties} />
          </div>
          <span className="hbar-value" role="cell">{r.count} · {usd(r.amount)}</span>
        </div>
      ))}
    </div>
  );
}

function OutcomeBar({ o }: { o: ProductInsight["outcomes"] }) {
  const favour = o.won + o.withdrawn;
  const total = favour + o.pending + o.lost || 1;
  const parts = [
    { key: "favour", n: favour, label: "In your favour", cls: "seg-favour" },
    { key: "open", n: o.pending, label: "Still open", cls: "seg-open" },
    { key: "lost", n: o.lost, label: "Lost", cls: "seg-lost" },
  ];
  return (
    <div>
      <div className="seg-bar" role="img" aria-label={parts.map((p) => `${p.label}: ${p.n}`).join(", ")}>
        {parts.filter((p) => p.n > 0).map((p) => (
          <span key={p.key} className={`seg ${p.cls}`} style={{ flexGrow: p.n / total }} title={`${p.label}: ${p.n}`} />
        ))}
      </div>
      <div className="seg-legend">
        {parts.map((p) => (
          <span key={p.key}><i className={`swatch ${p.cls}`} />{p.label} <strong>{p.n}</strong></span>
        ))}
      </div>
    </div>
  );
}

function Rewrite({ product }: { product: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [listing, setListing] = useState<ListingRewrite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const go = async () => {
    setState("busy");
    setError(null);
    const res = await fetch("/api/insights/rewrite", { method: "POST", body: JSON.stringify({ product }) });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error);
      return setState("idle");
    }
    setListing(json.listing);
    setState("done");
  };

  const copy = async () => {
    if (!listing) return;
    const text = `${listing.title}\n\n${listing.description}\n\n${listing.key_facts.map((f) => `• ${f}`).join("\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy; select the text instead.");
    }
  };

  return (
    <div className="block">
      {state !== "done" && (
        <button className="btn glow" onClick={go} disabled={state === "busy"}>
          {state === "busy" ? <>Rewriting the listing <span className="dots"><i /><i /><i /></span></> : "✨ Rewrite the listing with AI"}
        </button>
      )}
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      {listing && (
        <div className="listing rise">
          <div className="listing-head">
            <h3>Suggested listing</h3>
            <button className="btn small" onClick={copy}>{copied ? "✓ Copied" : "Copy"}</button>
          </div>
          <p className="listing-title">{listing.title}</p>
          <p style={{ whiteSpace: "pre-wrap", margin: "0 0 10px" }}>{listing.description}</p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
            {listing.key_facts.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          <details>
            <summary>What changed and why ({listing.what_changed.length})</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              {listing.what_changed.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </details>
          <p className="sub" style={{ margin: "10px 0 0", fontSize: 12.5 }}>Fill in anything in [brackets] before publishing.</p>
        </div>
      )}
    </div>
  );
}

function ProductCard({ p, i }: { p: ProductInsight; i: number }) {
  const r = risk(p);
  return (
    <Tilt max={3} className="panel rise product-insight" style={{ "--i": i + 3 } as CSSProperties}>
      <div className="pi-head">
        <div>
          <h2 style={{ marginBottom: 2 }}>{p.name}</h2>
          <span className="sub" style={{ margin: 0, fontSize: 13 }}>
            {p.disputes} dispute{p.disputes === 1 ? "" : "s"} · {usd(p.amountDisputed)} disputed{p.open ? ` · ${p.open} open` : ""}
          </span>
        </div>
        <span className={`status status-${r.tone}`}><span aria-hidden="true">{r.icon}</span> {r.label}</span>
      </div>

      <div className="pi-rate">
        <span className="pi-rate-value">{p.disputeRate === null ? "—" : `${p.disputeRate.toFixed(1)}%`}</span>
        <span className="sub" style={{ margin: 0, fontSize: 13 }}>
          {p.unitsSold === null ? "of sales disputed (no sales data yet)" : `of ${p.unitsSold} units sold were disputed`}
        </span>
      </div>

      <div className="block">
        <h3>How they ended</h3>
        <OutcomeBar o={p.outcomes} />
      </div>

      <div className="block">
        <h3>Why buyers disputed</h3>
        <div className="badges" style={{ marginTop: 0 }}>
          {p.reasons.map((x) => <span key={x.reason} className="pill neutral">{x.label} × {x.count}</span>)}
        </div>
      </div>

      {p.complaints.length > 0 && (
        <div className="block">
          <h3>In their words</h3>
          {p.complaints.slice(0, 3).map((c, k) => <blockquote key={k} className="complaint">“{c}”</blockquote>)}
        </div>
      )}

      {p.agentSuggestions.length > 0 && (
        <div className="block insight"><strong>The agent noticed:</strong> {p.agentSuggestions[0]}</div>
      )}

      {(r.tone !== "good" || p.agentSuggestions.length > 0) && <Rewrite product={p.name} />}
    </Tilt>
  );
}

export default function Insights() {
  const [report, setReport] = useState<InsightsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/insights", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setReport(json);
      })
      .catch((err) => setError(err.message));
  }, []);

  const top = report?.reasons[0];

  return (
    <>
      <section className="hero">
        <div className="rise">
          <p className="eyebrow">Prevention</p>
          <h1 className="gradient-text">Insights</h1>
          <p className="sub">Which products draw disputes, why, and what to change in the listing so the next buyer isn't surprised.</p>
        </div>
      </section>

      {error && <div className="error">{error}</div>}
      {!report && !error && <p className="sub">Loading…</p>}

      {report && (
        <>
          <section className="kpis">
            <Tilt className="kpi rise" style={{ "--i": 1 } as CSSProperties}>
              <div className="label"><span className="icon" aria-hidden="true">📬</span>Disputes</div>
              <div className="value"><CountUp value={report.totals.disputes} format={(n) => String(Math.round(n))} /></div>
              <div className="note">{usd(report.totals.amount)} disputed in total</div>
            </Tilt>
            <Tilt className="kpi rise blue" style={{ "--i": 2 } as CSSProperties}>
              <div className="label"><span className="icon" aria-hidden="true">🔎</span>Top reason</div>
              <div className="value" style={{ fontSize: 22, paddingTop: 6 }}>{top?.label ?? "—"}</div>
              <div className="note">{top ? `${top.count} of ${report.totals.disputes} disputes` : ""}</div>
            </Tilt>
            <Tilt className="kpi rise hero-kpi" style={{ "--i": 3 } as CSSProperties}>
              <div className="label"><span className="icon" aria-hidden="true">🤝</span>Withdrawn after a message</div>
              <div className="value"><CountUp value={report.totals.withdrawn} format={(n) => String(Math.round(n))} /></div>
              <div className="note">buyers who closed the case themselves</div>
            </Tilt>
          </section>

          <section className="panel rise" style={{ "--i": 4, marginBottom: 18 } as CSSProperties}>
            <h2>Why buyers dispute</h2>
            <ReasonBars reasons={report.reasons} />
          </section>

          <div className="products">
            {report.products.map((p, i) => <ProductCard key={p.name} p={p} i={i} />)}
          </div>
        </>
      )}
    </>
  );
}
