"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type RowClassRules,
} from "ag-grid-community";
import type { CaseRecord, DisputeSummary } from "@/lib/types";
import type { Assumptions, ExpectedValue, Impact } from "@/lib/impact";
import { daysUntil, humanStatus, money, reasonLabel, TOOL_LABELS } from "@/lib/format";
import { CountUp, Card } from "./components/spatial";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = DisputeSummary & { case: CaseRecord | null; ev: ExpectedValue | null };
type Scenario = { id: string; expect: "FIGHT" | "ACCEPT"; label: string; hint: string };
type Toast = { key: number; title: string; body: string; href?: string; leaving?: boolean };

const theme = themeQuartz.withParams({
  accentColor: "#0070e0",
  backgroundColor: "transparent",
  foregroundColor: "#0f172a",
  headerBackgroundColor: "rgba(255, 255, 255, 0.45)",
  rowHoverColor: "rgba(0, 112, 224, 0.06)",
  borderColor: "rgba(15, 23, 42, 0.07)",
  fontFamily: "inherit",
  fontSize: 14,
  rowHeight: 54,
  headerHeight: 46,
  wrapperBorderRadius: 16,
  borderRadius: 10,
});

const isOpen = (r: Row) => r.status !== "RESOLVED" && r.case?.status !== "executed";
const usd = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n), 2)}`;

function DueCell({ data }: ICellRendererParams<Row>) {
  const d = daysUntil(data?.sellerResponseDueDate ?? null);
  if (d === null || !data || !isOpen(data)) return <span style={{ color: "#8a93a8" }}>—</span>;
  return <span className={`pill ${d <= 3 ? "urgent" : "neutral"}`}>{d <= 0 ? "Due today" : `${d} day${d === 1 ? "" : "s"}`}</span>;
}

function Working() {
  return (
    <span className="pill live">
      Agent working <span className="dots"><i /><i /><i /></span>
    </span>
  );
}

function RecommendationCell({ data }: ICellRendererParams<Row>) {
  const c = data?.case;
  if (!c) return <span style={{ color: "#8a93a8" }}>Not investigated</span>;
  if (c.status === "investigating") return <Working />;
  if (c.status === "failed") return <span style={{ color: "#dc2626" }}>Failed</span>;
  if (!c.decision) return <span>—</span>;
  return <span className={`pill ${c.decision.action}`}>{c.decision.action}</span>;
}

function EdgeCell({ data }: ICellRendererParams<Row>) {
  const ev = data?.ev;
  if (!ev) return <span style={{ color: "#8a93a8" }}>—</span>;
  const edge = ev.fightEdge;
  return (
    <span
      className={edge >= 0 ? "edge-pos" : "edge-neg"}
      title={`Refund now: −${usd(ev.refundCost, 2)} · Fight: −${usd(ev.fightCost, 2)} expected`}
    >
      {signedUsd(edge)}
    </span>
  );
}

function statusText(r: Row): string {
  if (r.outcome === "CANCELED_BY_BUYER") return "buyer withdrew";
  if (r.outcome === "RESOLVED_SELLER_FAVOUR") return "won";
  if (r.outcome === "RESOLVED_BUYER_FAVOUR" && r.case?.execution?.action === "FIGHT") return "lost";
  if (r.case?.status === "executed") {
    const what = r.case.execution?.action === "FIGHT" ? "evidence sent" : "refunded";
    return r.case.execution?.auto ? `${what} (auto)` : what;
  }
  if (r.case?.status === "awaiting_approval") return "needs your approval";
  return humanStatus(r.status);
}

function StatusCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  if (data.outcome === "CANCELED_BY_BUYER") return <span className="pill FIGHT">buyer withdrew</span>;
  if (data.outcome === "RESOLVED_SELLER_FAVOUR") return <span className="status status-good"><span aria-hidden="true">✓</span> PayPal ruled for you</span>;
  if (data.outcome === "RESOLVED_BUYER_FAVOUR" && data.case?.execution?.action === "FIGHT") return <span className="status status-critical"><span aria-hidden="true">✕</span> lost the fight</span>;
  if (data.case?.status === "executed") {
    return (
      <span>
        {data.case.execution?.action === "FIGHT" ? "evidence sent" : "refunded"}
        {data.case.execution?.auto && <span className="pill live" style={{ marginLeft: 6 }} title={data.case.execution.auto}>auto</span>}
      </span>
    );
  }
  if (data.case?.status === "awaiting_approval") return <span style={{ fontWeight: 650 }}>needs your approval</span>;
  return <span>{humanStatus(data.status)}</span>;
}

function OpenCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  return (
    <a className="btn small" href={`/disputes/${encodeURIComponent(data.id)}`}>
      {data.case?.status === "awaiting_approval" ? "Review" : "Open"}
    </a>
  );
}

function Kpi({ label, value, format, note, tone = "" }: {
  label: string; value: number; format: (n: number) => string; note?: string; tone?: string;
}) {
  return (
    <Card className={`kpi rise ${tone}`}>
      <div className="label">{label}</div>
      <div className="value"><CountUp value={value} format={format} /></div>
      <div className="note">{note}</div>
    </Card>
  );
}

/** What the agent is doing right now, from the latest tool call on a case under investigation. */
function AgentPulse({ working }: { working: Row[] }) {
  const busy = working.length > 0;
  const last = working[0]?.case?.toolCalls.at(-1);
  return (
    <div className={`pulse ${busy ? "busy" : ""}`} aria-live="polite">
      <span className="pulse-orb" aria-hidden="true"><i /></span>
      <div>
        <strong>{busy ? `Investigating ${working.length} dispute${working.length === 1 ? "" : "s"}` : "Agent on watch"}</strong>
        <span>
          {busy
            ? `${working[0].id} · ${last ? TOOL_LABELS[last.tool] ?? last.tool : "Reading the case"}…`
            : "Picks up new disputes from PayPal, even when a notification goes missing"}
        </span>
      </div>
    </div>
  );
}

function ApprovalCard({ row }: { row: Row }) {
  const d = row.case!.decision!;
  const odds = Math.round(d.win_probability * 100);
  const due = daysUntil(row.sellerResponseDueDate ?? null);
  return (
    <Card className={`glass q-card rise ${d.action}`}>
      <a className="q-link" href={`/disputes/${encodeURIComponent(row.id)}`} aria-label={`Review ${row.id}`} />
      <div className="q-top">
        <span className={`pill ${d.action}`}>{d.action === "FIGHT" ? "Fight" : "Refund"}</span>
        {due !== null && <span className={`pill ${due <= 3 ? "urgent" : "neutral"}`}>{due <= 0 ? "Due today" : `${due}d left`}</span>}
      </div>
      <div className="q-amount">{money(row.amount)}</div>
      <div className="q-who">{row.buyerName} · {reasonLabel(row.reason)}</div>
      <p className="q-headline">{d.headline}</p>
      <div className="q-odds">
        <div className="meter"><span style={{ width: `${odds}%` }} /></div>
        <span>{odds}% win odds</span>
      </div>
      <div className="q-foot">
        {row.ev ? (
          <span className={row.ev.fightEdge >= 0 ? "edge-pos" : "edge-neg"}>{signedUsd(row.ev.fightEdge)} vs refunding</span>
        ) : <span />}
        <span className="q-cta">Review →</span>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [assume, setAssume] = useState<Assumptions | null>(null);
  const [mode, setMode] = useState<"mock" | "sandbox" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string[]>([]);
  const [watching, setWatching] = useState<string[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [query, setQuery] = useState("");
  const known = useRef<Set<string> | null>(null);
  const fresh = useRef<Set<string>>(new Set());
  const gridApi = useRef<any>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toast = useCallback((t: Omit<Toast, "key">) => {
    const key = Date.now() + Math.random();
    setToasts((ts) => [...ts, { ...t, key }]);
    setTimeout(() => setToasts((ts) => ts.map((x) => (x.key === key ? { ...x, leaving: true } : x))), 6500);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.key !== key)), 7000);
  }, []);

  const markFresh = useCallback((ids: string[]) => {
    ids.forEach((id) => fresh.current.add(id));
    setTimeout(() => {
      ids.forEach((id) => fresh.current.delete(id));
      gridApi.current?.redrawRows();
    }, 2800);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/disputes", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    setError(null);
    const next: Row[] = json.disputes;
    if (known.current) {
      const added = next.filter((r) => !known.current!.has(r.id)).map((r) => r.id);
      if (added.length) markFresh(added);
    }
    known.current = new Set(next.map((r) => r.id));
    setRows(next);
    const caughtUp: string[] = json.caughtUp ?? [];
    if (caughtUp.length) {
      toast({
        title: `Picked up ${caughtUp.length} missed dispute${caughtUp.length === 1 ? "" : "s"}`,
        body: `PayPal's notification for ${caughtUp.join(", ")} never arrived. The agent found ${caughtUp.length === 1 ? "it" : "them"} in the dispute list and is investigating.`,
      });
      setWatching((w) => [...w, ...caughtUp.filter((id) => !w.includes(id))]);
    }
    setImpact(json.impact);
    setAssume(json.assumptions);
    setMode(json.mode);
  }, [markFresh, toast]);

  useEffect(() => {
    load();
    fetch("/api/simulate", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.enabled && setScenarios(j.scenarios))
      .catch(() => {});
  }, [load]);

  // Refresh while the agent is working so the grid updates live.
  useEffect(() => {
    if (!running.length && !watching.length && !rows.some((r) => r.case?.status === "investigating")) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [running, watching, rows, load]);

  // Announce decisions on disputes we're watching (simulated arrivals).
  useEffect(() => {
    if (!watching.length) return;
    const done = rows.filter((r) => watching.includes(r.id) && (r.case?.decision || r.case?.status === "failed"));
    if (!done.length) return;
    for (const r of done) {
      const d = r.case?.decision;
      toast(
        d
          ? {
              title: `Agent says ${d.action === "FIGHT" ? "fight" : "refund"} · ${r.id}`,
              body: `${Math.round(d.win_probability * 100)}% win odds. ${d.headline}`,
              href: `/disputes/${encodeURIComponent(r.id)}`,
            }
          : { title: `Investigation failed · ${r.id}`, body: r.case?.error ?? "Open the case for details." },
      );
    }
    setWatching((w) => w.filter((id) => !done.some((r) => r.id === id)));
  }, [rows, watching, toast]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  // Arrow keys move between items, Escape closes and hands focus back to the trigger.
  const onMenuKey = (e: KeyboardEvent) => {
    if (!menuOpen) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      setMenuOpen(false);
      menuRef.current?.querySelector<HTMLElement>(".btn")?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  };

  const simulate = async (scenario?: string, dropWebhook = false) => {
    setMenuOpen(false);
    setSimulating(true);
    const res = await fetch("/api/simulate", { method: "POST", body: JSON.stringify({ scenario, dropWebhook }) });
    const json = await res.json();
    setSimulating(false);
    if (!res.ok) return setError(json.error);
    // No webhook: the dispute-list sync in load() has to find it, and announces it.
    if (dropWebhook) return load();
    const label = scenarios.find((s) => s.id === json.scenario)?.label ?? "New dispute";
    toast({ title: `Dispute opened · ${json.disputeId}`, body: `${label}. The agent picked it up and is investigating.`, href: `/disputes/${encodeURIComponent(json.disputeId)}` });
    setWatching((w) => [...w, json.disputeId]);
    load();
  };

  const clearSimulated = async () => {
    setMenuOpen(false);
    const res = await fetch("/api/simulate", { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    toast({ title: "Demo reset", body: `Removed ${json.removed.length} simulated dispute(s).` });
    load();
  };

  // Demo only: PayPal rules on everything under review, feeding the Track record.
  const rule = async () => {
    setMenuOpen(false);
    const res = await fetch("/api/simulate", { method: "PATCH" });
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    const ruled = json.ruled as { id: string; sellerWins: boolean }[];
    toast(
      ruled.length
        ? { title: `PayPal ruled on ${ruled.length} dispute${ruled.length === 1 ? "" : "s"}`, body: `${ruled.filter((r) => r.sellerWins).length} for you, ${ruled.filter((r) => !r.sellerWins).length} for the buyer. The Track record now includes them.`, href: "/accuracy" }
        : { title: "Nothing under review", body: "Submit evidence on a dispute first, then ask PayPal to rule." },
    );
    load();
  };

  const investigateAll = async () => {
    const targets = rows.filter((r) => isOpen(r) && !r.case?.decision && r.case?.status !== "investigating").map((r) => r.id);
    setRunning(targets);
    await Promise.allSettled(targets.map((id) => fetch(`/api/disputes/${encodeURIComponent(id)}/investigate`, { method: "POST" })));
    setRunning([]);
    load();
  };

  const open = rows.filter(isOpen);
  const atStake = open.reduce((sum, r) => sum + Number(r.amount.value), 0);
  const awaiting = rows.filter((r) => isOpen(r) && r.case?.status === "awaiting_approval");
  const working = rows.filter((r) => r.case?.status === "investigating" || running.includes(r.id));
  const awaitingCards = awaiting
    .filter((r) => r.case?.decision)
    .sort((a, b) => (daysUntil(a.sellerResponseDueDate ?? null) ?? 99) - (daysUntil(b.sellerResponseDueDate ?? null) ?? 99));
  const protectedTotal = (impact?.protectedApproved ?? 0) + (impact?.protectedPending ?? 0);
  const insights = rows.map((r) => r.case?.decision?.listing_insight).filter((i): i is string => Boolean(i));
  const nextDue = impact?.nextDeadlineDays ?? null;

  const rowClassRules = useMemo<RowClassRules<Row>>(
    () => ({
      "row-fresh": (p) => Boolean(p.data && fresh.current.has(p.data.id)),
      "row-working": (p) => p.data?.case?.status === "investigating",
    }),
    [],
  );

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { field: "id", headerName: "Dispute", width: 130 },
      { field: "buyerName", headerName: "Buyer", flex: 1, minWidth: 130 },
      { field: "reason", headerName: "Reason", flex: 1, minWidth: 150, valueFormatter: (p) => reasonLabel(p.value) },
      {
        field: "amount",
        headerName: "Amount",
        width: 110,
        valueFormatter: (p) => money(p.value),
        comparator: (a, b) => Number(a.value) - Number(b.value),
        type: "rightAligned",
      },
      {
        headerName: "Respond by",
        width: 130,
        valueGetter: (p) => daysUntil(p.data?.sellerResponseDueDate ?? null),
        cellRenderer: DueCell,
        sort: "asc",
      },
      {
        headerName: "Agent says",
        width: 170,
        valueGetter: (p) => p.data?.case?.decision?.action ?? p.data?.case?.status ?? "",
        cellRenderer: RecommendationCell,
      },
      {
        headerName: "Win odds",
        headerTooltip: "Calibrated estimate from the case facts, checked against past outcomes",
        width: 100,
        valueGetter: (p) => p.data?.case?.decision?.win_probability ?? null,
        valueFormatter: (p) => (p.value === null ? "—" : `${Math.round(p.value * 100)}%`),
        type: "rightAligned",
      },
      {
        headerName: "Fight vs refund",
        headerTooltip: "How much better fighting is than refunding right away, on average",
        width: 140,
        valueGetter: (p) => p.data?.ev?.fightEdge ?? null,
        cellRenderer: EdgeCell,
        type: "rightAligned",
      },
      { headerName: "Status", flex: 1, minWidth: 160, cellRenderer: StatusCell, valueGetter: (p) => (p.data ? statusText(p.data) : "") },
      { headerName: "", width: 100, cellRenderer: OpenCell, sortable: false, suppressHeaderMenuButton: true, colId: "open" },
    ],
    [],
  );

  return (
    <>
      <section className="hero">
        <div className="rise">
          <p className="eyebrow">Dispute desk · {mode === "sandbox" ? "live PayPal sandbox" : "demo data"}</p>
          <h1>Disputes</h1>
          <p className="sub">The agent investigates every dispute, works out whether fighting beats refunding, and waits for your approval.</p>
        </div>
        <div className="toolbar rise" style={{ marginBottom: 0 } as CSSProperties}>
          {mode === "mock" && scenarios.length > 0 && (
            <div className="sim" ref={menuRef} onKeyDown={onMenuKey}>
              <button className="btn" onClick={() => setMenuOpen((o) => !o)} disabled={simulating} aria-haspopup="menu" aria-expanded={menuOpen}>
                {simulating ? <>Opening dispute <span className="dots"><i /><i /><i /></span></> : <>Simulate dispute <span className="caret" aria-hidden="true" /></>}
              </button>
              {menuOpen && (
                <div className="sim-menu" role="menu" aria-label="Simulate a dispute">
                  <button role="menuitem" onClick={() => simulate()}>
                    <span className="sim-text">
                      <strong>Surprise me</strong>
                      <span>A random scenario, like a real day at the shop</span>
                    </span>
                  </button>
                  <hr className="sim-divider" />
                  <p className="sim-section">Open a specific dispute</p>
                  {scenarios.map((s, i) => (
                    <button key={s.id} role="menuitem" onClick={() => simulate(s.id)}>
                      <span className="sim-text">
                        <strong>{s.label}</strong>
                        <span>{s.hint}</span>
                      </span>
                      <span className={`sim-expect ${s.expect}`} title="The right call for this scenario">{s.expect === "FIGHT" ? "fight" : "refund"}</span>
                    </button>
                  ))}
                  <hr className="sim-divider" />
                  <p className="sim-section">Demo controls</p>
                  <button role="menuitem" onClick={() => simulate(undefined, true)}>
                    <span className="sim-text">
                      <strong>Lose PayPal's notification</strong>
                      <span>Open a dispute without the webhook; the next sync catches it</span>
                    </span>
                  </button>
                  <button role="menuitem" onClick={rule}>
                    <span className="sim-text">
                      <strong>PayPal rules on submitted cases</strong>
                      <span>Fast-forward: decide every dispute under review</span>
                    </span>
                  </button>
                  <button role="menuitem" className="sim-danger" onClick={clearSimulated}>
                    <span className="sim-text">
                      <strong>Reset demo</strong>
                      <span>Remove every simulated dispute</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
          <button className="btn primary" onClick={investigateAll} disabled={running.length > 0}>
            {running.length ? <>Investigating {running.length} <span className="dots"><i /><i /><i /></span></> : "Investigate all open"}
          </button>
          <button className="btn" onClick={load}>Refresh</button>
        </div>
      </section>

      <section className="impact glass rise">
        <div className="impact-main">
          <p className="eyebrow">Money protected by the autopilot</p>
          <div className="impact-value"><CountUp value={protectedTotal} format={(n) => usd(n)} /></div>
          <p className="impact-note">
            {impact
              ? impact.recovered
                ? `${usd(impact.recovered)} recovered outright · ${impact.withdrawn} withdrawn by buyers`
                : `${usd(impact.protectedApproved)} approved · ${usd(impact.protectedPending)} waiting on you`
              : "Loading…"}
          </p>
          <AgentPulse working={working} />
        </div>
        <dl className="impact-stats">
          <div>
            <dt>Better than refunding everything</dt>
            <dd className="violet"><CountUp value={impact?.edgeVsRefundAll ?? 0} format={(n) => usd(n)} /></dd>
            <span>{impact?.projectedWinRate != null ? `${Math.round(impact.projectedWinRate * 100)}% projected win rate on fights` : "no fights yet"}</span>
          </div>
          <div>
            <dt>Hours saved</dt>
            <dd><CountUp value={impact?.hoursSaved ?? 0} format={(n) => n.toFixed(1)} /></dd>
            <span>
              {impact && assume
                ? `${impact.handled} disputes × ${assume.manualMinutes} min${impact.autoActed ? ` · ${impact.autoActed} handled alone` : ""}`
                : ""}
            </span>
          </div>
          <div>
            <dt>Deadlines met</dt>
            <dd className="blue">
              <CountUp value={impact?.executed ? (impact.deadlinesMet / impact.executed) * 100 : 0} format={(n) => (impact?.executed ? `${Math.round(n)}%` : "—")} />
            </dd>
            <span>{impact?.avgLeadDays != null ? `drafted ${impact.avgLeadDays.toFixed(1)} days early, on average` : "nothing drafted yet"}</span>
          </div>
        </dl>
      </section>

      <div className="kpi-group">
        <p className="eyebrow rise">Right now</p>
        <section className="kpis">
          <Kpi label="Open disputes" value={open.length} format={(n) => String(Math.round(n))} note={`${rows.length} in total`} />
          <Kpi label="Money at stake" value={atStake} format={(n) => usd(n)} note="across open disputes" />
          <Kpi label="Waiting for your approval" value={awaiting.length} format={(n) => String(Math.round(n))} tone="blue" note={awaiting.length ? "the agent has drafted these" : "nothing waiting"} />
          <Kpi
            label="Next deadline"
            value={nextDue === null ? 0 : Math.max(0, nextDue)}
            format={(n) => (nextDue === null ? "—" : `${n.toFixed(1)} days`)}
            note={nextDue === null ? "no open deadlines" : nextDue <= 3 ? "respond soon" : "plenty of time"}
          />
        </section>
      </div>

      {awaitingCards.length > 0 && (
        <section className="queue">
          <div className="queue-head rise">
            <h2>Waiting for your approval <span className="count">{awaitingCards.length}</span></h2>
            <p className="sub">Investigated and drafted by the agent, soonest deadline first.</p>
          </div>
          <div className="queue-cards">
            {awaitingCards.slice(0, 3).map((r) => <ApprovalCard key={r.id} row={r} />)}
          </div>
          {awaitingCards.length > 3 && <p className="sub queue-more">+{awaitingCards.length - 3} more in the table below</p>}
        </section>
      )}

      {insights.length > 0 && (
        <div className="insight rise" style={{ marginBottom: 18 } as CSSProperties}>
          <strong>Product insight:</strong> {insights[0]}
        </div>
      )}

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="toolbar rise">
        <input
          className="search"
          style={{ maxWidth: 320 }}
          type="search"
          placeholder="Search buyers, reasons, IDs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search disputes"
        />
        <button
          className="btn"
          onClick={() =>
            gridApi.current?.exportDataAsCsv({
              fileName: `disputes-${new Date().toISOString().slice(0, 10)}.csv`,
              processCellCallback: (p: any) =>
                p.column.getColId() === "open" ? "" : p.value && typeof p.value === "object" && "value" in p.value ? p.value.value : p.value,
            })
          }
        >
          Export CSV
        </button>
      </div>

      <div className="glass grid-shell rise">
        <AgGridReact<Row>
          quickFilterText={query}
          theme={theme}
          rowData={rows}
          columnDefs={columnDefs}
          domLayout="autoHeight"
          getRowId={(p) => p.data.id}
          rowClassRules={rowClassRules}
          onGridReady={(e) => (gridApi.current = e.api)}
          defaultColDef={{ sortable: true, resizable: true }}
          tooltipShowDelay={300}
        />
      </div>
      {assume && (
        <p className="sub rise" style={{ marginTop: 12, fontSize: 12.5 } as CSSProperties}>
          Fight vs refund = refund cost − (1 − win odds) × (amount + {usd(assume.disputeFee)} dispute fee). Change the fee and minutes per dispute in <a href="/settings">Settings</a>.
        </p>
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.key} className={`toast ${t.leaving ? "leaving" : ""}`}>
            <span className="t-icon" aria-hidden="true">◆</span>
            <div>
              <strong>{t.title}</strong>
              <p>{t.body}</p>
              {t.href && <a href={t.href} style={{ fontSize: 13, fontWeight: 650 }}>Open case →</a>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
