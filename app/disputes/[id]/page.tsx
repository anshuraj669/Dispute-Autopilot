"use client";

import { use, useCallback, useEffect, useState, type CSSProperties } from "react";
import type { CaseRecord, ToolCall } from "@/lib/types";
import type { ExpectedValue } from "@/lib/impact";
import type { CaseFile } from "@/lib/casefile";
import type { Score } from "@/lib/score";
import type { Checklist, ChecklistItem } from "@/lib/evidence";
import type { Contradiction, Verification } from "@/lib/integrity";
import type { Permissions } from "@/lib/guard";
import { daysUntil, humanStatus, money, reasonLabel } from "@/lib/format";
import { Ring, Tilt } from "../../components/spatial";

type View = {
  dispute: any;
  case: CaseRecord | null;
  caseFile: Omit<CaseFile, "dispute">;
  score: Score;
  ev: ExpectedValue;
  checklist: Checklist;
  contradictions: Contradiction[];
  permissions: Permissions;
  verification: Verification | null;
  stale: string | null;
  model: { name: string; usingLearned: boolean; n: number; brier: number | null };
};

const DAY = 86_400_000;
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const pct = (p: number) => `${Math.round(p * 100)}%`;
const pts = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))} pts`;
const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/** Refund-now vs fight-on-average, on the same scale, with what goes into each. */
function EvCompare({ ev, action }: { ev: ExpectedValue; action: "FIGHT" | "ACCEPT" | null }) {
  const scale = Math.max(ev.refundCost, ev.fightCost, 1);
  const better = ev.fightEdge >= 0 ? "FIGHT" : "ACCEPT";
  return (
    <div className="ev">
      <div className={`ev-row ${action === "ACCEPT" ? "picked" : ""}`}>
        <span className="ev-name">Refund now</span>
        <div className="ev-track"><div className="ev-bar refund" style={{ width: `${(ev.refundCost / scale) * 100}%`, "--i": 0 } as CSSProperties} /></div>
        <span className="ev-val">−{usd(ev.refundCost)}</span>
      </div>
      <div className={`ev-row ${action === "FIGHT" ? "picked" : ""}`}>
        <span className="ev-name">Fight</span>
        <div className="ev-track"><div className="ev-bar fight" style={{ width: `${(ev.fightCost / scale) * 100}%`, "--i": 1 } as CSSProperties} /></div>
        <span className="ev-val">−{usd(ev.fightCost)}</span>
      </div>
      <div className="ev-verdict">
        {better === "FIGHT"
          ? <>Fighting keeps <span className="edge-pos">{usd(ev.fightEdge)}</span> more than refunding, on average.</>
          : <>Refunding now saves <span className="edge-neg">{usd(-ev.fightEdge)}</span> compared with fighting, on average.</>}
        {action && better !== action && <> The agent still recommends {action === "FIGHT" ? "fighting" : "refunding"}; see its reasoning.</>}
      </div>
      <div className="ev-formula">
        Refund = {usd(ev.amount)}{ev.recovery > 0 && <> − {usd(ev.recovery)} back from the return</>} + {usd(ev.timeCostRefund)} of your time.
        {" "}Fight = {pct(1 - ev.winProbability)} chance of losing × ({usd(ev.amount - ev.recovery)}{ev.feeWhen === "lost" && <> + {usd(ev.fee)} fee</>})
        {ev.feeWhen === "always" && <> + {usd(ev.fee)} fee</>} + {usd(ev.timeCostFight)} of review time.
      </div>
    </div>
  );
}

/** The calibrated estimate on a track, with the break-even point marked. */
function OddsMeter({ p, breakEven }: { p: number; breakEven: number }) {
  return (
    <div className="odds">
      <div className="odds-track" role="img" aria-label={`Win estimate ${pct(p)}; fighting pays above ${pct(breakEven)}`}>
        <div className="odds-fill" style={{ width: `${p * 100}%` }} />
        {breakEven < 1 && <div className="odds-mark" style={{ left: `${breakEven * 100}%` }} title={`Break-even ${pct(breakEven)}`} />}
      </div>
      <div className="odds-legend">
        <span>0%</span>
        {breakEven < 1 ? <span>Fighting pays above <strong>{pct(breakEven)}</strong></span> : <span>Fighting never pays at this amount</span>}
        <span>100%</span>
      </div>
    </div>
  );
}

function WhyOdds({ v }: { v: View }) {
  const { score, ev, model } = v;
  const max = Math.max(...score.factors.map((f) => Math.abs(f.points)), 1);
  const agent = v.case?.decision?.agent_estimate;
  return (
    <Tilt max={2} className="panel rise" style={{ "--i": 5 } as CSSProperties}>
      <h2>Win odds, explained</h2>
      <div className="odds-head">
        <span className="odds-value">{pct(score.p)}</span>
        <span className="sub" style={{ margin: 0 }}>chance PayPal rules for you if you fight</span>
      </div>
      <OddsMeter p={score.p} breakEven={ev.breakEven} />
      <div className="factors">
        <div className="factor base">
          <span className="factor-label">Starting odds for this kind of claim</span>
          <span className="factor-val">{pct(score.baseP)}</span>
        </div>
        {score.factors.map((f, i) => (
          <div key={f.key} className="factor rise" style={{ "--i": i } as CSSProperties} title={`Facts: ${f.facts.join(", ")}`}>
            <span className="factor-label">{f.label}</span>
            <div className="factor-track">
              <div className={`factor-bar ${f.points >= 0 ? "pos" : "neg"}`} style={{ width: `${(Math.abs(f.points) / max) * 50}%` }} />
            </div>
            <span className={`factor-val ${f.points >= 0 ? "pos" : "neg"}`}>{pts(f.points)}</span>
          </div>
        ))}
        {!score.factors.length && <p className="sub" style={{ margin: "6px 0 0" }}>No facts in the records move the odds either way yet.</p>}
      </div>
      {agent !== undefined && (
        <p className="agent-read">
          The agent's own read: <strong>{pct(agent)}</strong>
          {Math.abs(agent - score.p) > 0.15 && v.case?.decision?.deviation_reason && <> · {v.case.decision.deviation_reason}</>}
        </p>
      )}
      <p className="model-note">
        A transparent model, not an AI guess: {model.name}
        {model.brier !== null && <> · Brier score {model.brier.toFixed(3)} on disputes it hadn't seen</>} · <a href="/accuracy">Track record →</a>
      </p>
    </Tilt>
  );
}

const STATUS_ICON: Record<ChecklistItem["status"], { icon: string; label: string }> = {
  have: { icon: "✓", label: "In the records" },
  collected: { icon: "✓", label: "You added this" },
  missing: { icon: "●", label: "Missing, can be collected" },
  not_collectable: { icon: "✕", label: "Missing" },
};

function CollectForm({ id, item, onDone }: { id: string; item: ChecklistItem; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("key", item.collect!);
    form.set("note", note);
    if (file) form.set("file", file);
    const res = await fetch(`/api/disputes/${encodeURIComponent(id)}/evidence`, { method: "POST", body: form });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error);
    onDone();
  };
  return (
    <div className="collect-form">
      <textarea rows={2} maxLength={1000} placeholder="What it shows, with dates (e.g. 'Buyer emailed on Mar 2 asking to switch scents')" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      <div className="toolbar" style={{ margin: "8px 0 0" }}>
        <label className="btn small file-btn">
          {file ? `📎 ${file.name}` : "Attach file"}
          <input type="file" accept="application/pdf,image/png,image/jpeg,image/gif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} hidden />
        </label>
        <button className="btn small primary" onClick={save} disabled={busy || (!note.trim() && !file)}>{busy ? "Saving…" : "Add to the case"}</button>
        <span className="sub" style={{ margin: 0, fontSize: 12 }}>PDF or image, up to 5 MB. Sent to PayPal with the evidence.</span>
      </div>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function EvidenceGaps({ v, id, reload, closed }: { v: View; id: string; reload: () => void; closed: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const { items, collectBy } = v.checklist;
  const missing = items.filter((i) => i.status === "missing");
  const left = collectBy ? (Date.parse(collectBy) - Date.now()) / DAY : null;
  const remove = async (key: string) => {
    await fetch(`/api/disputes/${encodeURIComponent(id)}/evidence?key=${key}`, { method: "DELETE" });
    reload();
  };
  return (
    <Tilt max={2} className="panel rise" style={{ "--i": 6 } as CSSProperties}>
      <h2>Evidence checklist</h2>
      <p className="sub" style={{ marginBottom: 12 }}>
        What PayPal looks for on {/^[aeiou]/i.test(reasonLabel(v.caseFile.reason)) ? "an" : "a"} {reasonLabel(v.caseFile.reason).toLowerCase()} claim.
        {missing.length > 0 && collectBy && !closed && (
          <> Collect by <strong>{shortDate(collectBy)}</strong>{left !== null && left > 0 ? ` (${left.toFixed(1)} days)` : ""}, a day before PayPal's deadline.</>
        )}
      </p>
      <ul className="checklist">
        {items.map((it) => {
          const s = STATUS_ICON[it.status];
          return (
            <li key={it.key} className={`check check-${it.status}`}>
              <span className="check-icon" aria-label={s.label} title={s.label}>{s.icon}</span>
              <div className="check-body">
                <div className="check-title">
                  <strong>{it.label}</strong>
                  {it.status === "missing" && it.gainPts !== undefined && it.gainPts > 0.5 && (
                    <span className="gain">{pts(it.gainPts)}{it.gainUsd && it.gainUsd >= 0.5 ? ` · worth ~${usd(it.gainUsd)}` : " · won't change the call"}</span>
                  )}
                </div>
                <div className="check-detail">{it.detail}</div>
                {it.status === "missing" && it.how && <div className="check-how">{it.how}</div>}
                {it.status === "missing" && !closed && (open === it.key
                  ? <CollectForm id={id} item={it} onDone={() => { setOpen(null); reload(); }} />
                  : <button className="btn small" style={{ marginTop: 6 }} onClick={() => setOpen(it.key)}>I have this</button>)}
                {it.status === "collected" && !closed && <button className="linklike" onClick={() => remove(it.key)}>Remove</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </Tilt>
  );
}

const SEVERITY: Record<Contradiction["severity"], { icon: string; label: string }> = {
  high: { icon: "▲", label: "Important" },
  medium: { icon: "●", label: "Check" },
  info: { icon: "i", label: "Note" },
};

function CaseFilePanel({ v }: { v: View }) {
  const { facts, sources } = v.caseFile;
  const src = new Map(sources.map((s) => [s.id, s]));
  return (
    <section className="panel rise" style={{ "--i": 7, marginTop: 18 } as CSSProperties}>
      <h2>Case file</h2>
      <p className="sub" style={{ marginBottom: 12 }}>
        Every fact the agent may cite, with the record it came from. The agent can't submit anything that isn't here.
      </p>
      {v.contradictions.length > 0 && (
        <div className="block" style={{ marginTop: 0 }}>
          <h3>What the records say against each other</h3>
          <ul className="contradictions">
            {v.contradictions.map((c, i) => (
              <li key={i} className={`contra contra-${c.severity}`}>
                <span className="contra-icon" title={SEVERITY[c.severity].label} aria-label={SEVERITY[c.severity].label}>{SEVERITY[c.severity].icon}</span>
                <div>
                  <strong>{c.title}</strong>
                  <span className="contra-helps">{c.helps === "seller" ? "helps you" : c.helps === "buyer" ? "helps the buyer" : "context"}</span>
                  <div>{c.detail}</div>
                  <div className="fact-ids">{c.facts.map((f) => <code key={f}>{f}</code>)}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="facts-table-wrap">
        <table className="table facts-table">
          <thead><tr><th>Fact</th><th>Value</th><th>Recorded</th><th>Source</th></tr></thead>
          <tbody>
            {facts.map((f) => (
              <tr key={f.id}>
                <td><code>{f.id}</code><div className="fact-label">{f.label}</div></td>
                <td className="fact-value">{f.value}</td>
                <td className="nowrap">{f.at ? shortDate(f.at) : "—"}</td>
                <td>{src.get(f.source)?.label ?? f.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="block">
        <summary>Source records and fingerprints ({sources.length})</summary>
        <ul className="sources">
          {sources.map((s) => (
            <li key={s.id}>
              <strong>{s.label}</strong> <code>{s.id}</code>
              <div className="sub" style={{ margin: 0, fontSize: 12.5 }}>{s.ref} · fetched {shortDate(s.fetchedAt)}</div>
              <code className="sha" title={s.sha256}>SHA-256 {s.sha256.slice(0, 16)}…</code>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

const TOOL_LABELS: Record<string, string> = {
  get_case_file: "Read the sourced case file",
  get_dispute: "Read the dispute",
  get_capture: "Looked up the payment",
  get_order: "Opened the order",
  search_transaction: "Checked the transaction record",
  check_carrier_status: "Checked carrier tracking",
  list_merchant_disputes: "Compared with past disputes",
  get_merchant_policy: "Read your refund policy",
  record_decision: "Recorded a decision",
};

/** Why a tool call failed, in one short line (the full error is in the tooltip). */
function ToolError({ call }: { call: ToolCall }) {
  if (call.ok || !call.error) return null;
  const short = call.error.replace(/^PayPal \S+ -> /, "").split(" {")[0];
  return <span className="trace-error" title={call.error}>{call.tool === "record_decision" ? "Integrity check sent it back: " : ""}{short.length > 160 ? `${short.slice(0, 160)}…` : short}</span>;
}

function Allowed({ p }: { p: Permissions }) {
  const rows: [string, keyof Pick<Permissions, "FIGHT" | "ACCEPT" | "MESSAGE">][] = [["Submit evidence", "FIGHT"], ["Accept claim", "ACCEPT"], ["Message buyer", "MESSAGE"]];
  return (
    <div className="allowed">
      <span className="allowed-label">PayPal allows now</span>
      {rows.map(([label, k]) => (
        <span key={k} className={`allowed-chip ${p[k].allowed ? "yes" : "no"}`} title={p[k].why}>
          <span aria-hidden="true">{p[k].allowed ? "✓" : "✕"}</span> {label}
        </span>
      ))}
    </div>
  );
}

export default function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [v, setV] = useState<View | null>(null);
  const [busy, setBusy] = useState<"investigate" | "execute" | "message" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  // After a message goes out, keep polling for a while so the buyer's reply shows up.
  const [listenUntil, setListenUntil] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch(`/api/disputes/${encodeURIComponent(id)}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    setV(json);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!listenUntil) return;
    const t = setInterval(() => (Date.now() > listenUntil ? setListenUntil(0) : load()), 2500);
    return () => clearInterval(t);
  }, [listenUntil, load]);

  const record = v?.case ?? null;
  // Poll during an investigation so the tool trace appears step by step.
  useEffect(() => {
    if (busy !== "investigate" && record?.status !== "investigating") return;
    const t = setInterval(load, 1200);
    return () => clearInterval(t);
  }, [busy, record?.status, load]);

  const run = async (kind: "investigate" | "execute") => {
    setBusy(kind);
    setError(null);
    const res = await fetch(`/api/disputes/${encodeURIComponent(id)}/${kind}`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) setError(json.error);
    setBusy(null);
    load();
  };

  const sendMessage = async () => {
    const content = (draft ?? record?.decision?.buyer_message ?? "").trim();
    if (!content) return;
    setBusy("message");
    setError(null);
    const res = await fetch(`/api/disputes/${encodeURIComponent(id)}/message`, { method: "POST", body: JSON.stringify({ content }) });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setError(json.error);
    setDraft(null);
    setListenUntil(Date.now() + 60_000);
    load();
  };

  if (!v) return <p>{error ?? "Loading…"}</p>;

  const { dispute, permissions: perms, verification } = v;
  const txn = dispute.disputed_transactions?.[0];
  const due = daysUntil(dispute.seller_response_due_date);
  const decision = record?.decision;
  const investigating = busy === "investigate" || record?.status === "investigating";

  // How much of the response window is left, and how early the agent drafted.
  const dueAt = dispute.seller_response_due_date ? Date.parse(dispute.seller_response_due_date) : null;
  const openedAt = Date.parse(dispute.create_time);
  const windowLeft = dueAt ? (dueAt - Date.now()) / Math.max(dueAt - openedAt, DAY) : null;
  const daysLeft = dueAt ? Math.max(0, (dueAt - Date.now()) / DAY) : null;
  const leadDays = dueAt && record?.investigatedAt ? (dueAt - Date.parse(record.investigatedAt)) / DAY : null;
  const isClosed = dispute.status === "RESOLVED" || record?.status === "executed";

  const allowed = decision ? perms[decision.action] : null;
  const blocked = decision?.action === "FIGHT" && verification && !verification.ok;
  const sourceIds = new Map(v.caseFile.facts.map((f) => [f.id, f.value]));

  return (
    <>
      <p className="rise"><a href="/">← All disputes</a></p>
      <div className="case-head">
        <div className="rise" style={{ "--i": 1 } as CSSProperties}>
          <p className="eyebrow">{dispute.dispute_id} · {txn?.buyer?.name ?? "Unknown buyer"}</p>
          <h1 className="gradient-text">{reasonLabel(dispute.reason)} · {money(dispute.dispute_amount)}</h1>
          <div className="badges">
            <span className="pill neutral">{humanStatus(dispute.status)}</span>
            {investigating && <span className="pill live">Agent working <span className="dots"><i /><i /><i /></span></span>}
            {leadDays !== null && leadDays > 0 && <span className="pill FIGHT">⚡ Drafted {leadDays.toFixed(1)} days before the deadline</span>}
            {record?.execution?.ok && <span className="pill FIGHT">✓ {record.execution.action === "FIGHT" ? "Evidence sent" : "Refunded"}</span>}
            {record?.execution?.ok && record.execution.auto && <span className="pill live" title={record.execution.auto}>🤖 Agent acted on its own</span>}
            {dispute.dispute_outcome?.outcome_code === "CANCELED_BY_BUYER" && <span className="pill FIGHT">🎉 Buyer withdrew the claim</span>}
            {dispute.dispute_outcome?.outcome_code === "RESOLVED_SELLER_FAVOUR" && <span className="pill FIGHT">🏆 PayPal ruled for you</span>}
            {dispute.dispute_outcome?.outcome_code === "RESOLVED_BUYER_FAVOUR" && record?.execution?.action === "FIGHT" && <span className="pill ACCEPT">PayPal ruled for the buyer</span>}
          </div>
        </div>
        {windowLeft !== null && daysLeft !== null && !isClosed && (
          <div className="rise" style={{ "--i": 2 } as CSSProperties}>
            <Ring fraction={windowLeft} tone={daysLeft <= 2 ? "danger" : daysLeft <= 4 ? "warn" : "ok"}>
              <strong>{due !== null && due <= 0 ? "Today" : daysLeft.toFixed(1)}</strong>
              <span>{due !== null && due <= 0 ? "deadline" : "days to respond"}</span>
            </Ring>
          </div>
        )}
      </div>

      <div className="grid2">
        <Tilt max={3} className="panel rise" style={{ "--i": 3 } as CSSProperties}>
          <h2>The case</h2>
          <dl className="facts">
            <dt>Items</dt>
            <dd>{txn?.items?.map((i: any) => `${i.item_quantity ?? 1} × ${i.item_name}`).join(", ") || "—"}</dd>
            <dt>Paid</dt>
            <dd>{txn?.create_time ? new Date(txn.create_time).toLocaleDateString() : "—"}</dd>
            <dt>Opened</dt>
            <dd>{new Date(dispute.create_time).toLocaleDateString()}</dd>
            <dt>Stage</dt>
            <dd>{humanStatus(dispute.dispute_life_cycle_stage ?? "")}</dd>
            <dt>Transaction</dt>
            <dd>{txn?.seller_transaction_id ?? "—"}</dd>
          </dl>
          <Allowed p={perms} />
          <div className="messages">
            {(dispute.messages ?? []).map((m: any, i: number) => (
              <div key={i} className={`msg ${m.posted_by}`}>
                <div className="meta">{m.posted_by === "SELLER" ? "You" : "Buyer"} · {new Date(m.time_posted).toLocaleString()}</div>
                {m.content}
              </div>
            ))}
            {listenUntil > 0 && dispute.status !== "RESOLVED" && (
              <div className="msg BUYER typing" aria-live="polite">
                <span className="dots"><i /><i /><i /></span> waiting for the buyer
              </div>
            )}
          </div>
          {dispute.status !== "RESOLVED" && decision && (
            <div className="compose">
              <h3>Message the buyer</h3>
              <textarea
                value={draft ?? decision.buyer_message}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                maxLength={2000}
                aria-label="Message to the buyer"
              />
              <div className="toolbar" style={{ marginBottom: 0, marginTop: 8 }}>
                <button className="btn primary" onClick={sendMessage} disabled={busy !== null || !perms.MESSAGE.allowed} title={perms.MESSAGE.why}>
                  {busy === "message" ? "Sending…" : "Send to buyer"}
                </button>
                <span className="sub" style={{ margin: 0, fontSize: 12.5 }}>
                  {perms.MESSAGE.allowed ? "Drafted by the agent. Nothing is sent until you click." : perms.MESSAGE.why}
                </span>
              </div>
            </div>
          )}
        </Tilt>

        <section className="panel rise" style={{ "--i": 4 } as CSSProperties}>
          <h2>Agent</h2>

          {record?.trigger && (investigating || decision) && (
            <div className="insight" style={{ marginBottom: 12 }}>
              <strong>{investigating ? "Re-investigating:" : "Updated decision:"}</strong> {record.trigger}
            </div>
          )}

          {v.stale && !investigating && (
            <div className="insight" style={{ marginBottom: 12 }}>
              <strong>Things changed:</strong> {v.stale} The odds and the money below are already updated.{" "}
              <button className="linklike" onClick={() => run("investigate")}>Ask the agent to reconsider</button>
            </div>
          )}

          {!decision && !investigating && (
            <button className="btn primary" onClick={() => run("investigate")}>Investigate this dispute</button>
          )}

          {(investigating || (record?.toolCalls.length ?? 0) > 0) && !decision && (
            <ul className="trace">
              {record?.toolCalls.map((c, i) => (
                <li key={i} className={c.ok ? "" : "err"}>{TOOL_LABELS[c.tool] ?? c.tool}<ToolError call={c} /></li>
              ))}
              {investigating && <li className="running">{record?.toolCalls.length ? "Weighing the evidence…" : "Reading the case…"}</li>}
            </ul>
          )}

          {record?.status === "failed" && record.error && <div className="error block">{record.error}</div>}

          {decision && (
            <>
              <div className="decision-head">
                <span className={`pill big ${decision.action}`}>{decision.action === "FIGHT" ? "FIGHT IT" : "REFUND"}</span>
                <div className="meter" title="Calibrated chance of winning if you fight">
                  <span style={{ width: `${Math.round(v.score.p * 100)}%` }} />
                </div>
                <span>{pct(v.score.p)} win odds · {decision.confidence} confidence</span>
              </div>
              <p style={{ fontWeight: 600, margin: "8px 0" }}>{decision.headline}</p>

              <div className="block">
                <h3>Fight or refund: the money</h3>
                <EvCompare ev={v.ev} action={decision.action} />
              </div>

              <div className="block">
                <h3>Why</h3>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {decision.reasoning.map((r, i) => <li key={i} className="rise" style={{ "--i": i } as CSSProperties}>{r}</li>)}
                </ul>
              </div>

              {decision.action === "FIGHT" && decision.evidence.length > 0 && (
                <div className="block">
                  <h3>Evidence to submit</h3>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {decision.evidence.map((e, i) => {
                      const check = verification?.items[i];
                      return (
                        <li key={i} style={{ marginBottom: 6 }}>
                          <strong>{humanStatus(e.evidence_type)}</strong>: {e.description}
                          {e.tracking_number && <> ({e.carrier} {e.tracking_number})</>}
                          <div className="fact-ids">
                            {(e.sources ?? []).map((s) => (
                              <code key={s} className={sourceIds.has(s) ? "" : "bad"} title={sourceIds.get(s) ?? "Not in the case file"}>{sourceIds.has(s) ? "✓" : "✕"} {s}</code>
                            ))}
                            {check && !check.cited.length && <code className="bad">✕ no source</code>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {decision.action === "FIGHT" ? (
                <div className="block"><h3>Statement to PayPal</h3><div className="quote">{decision.seller_statement}</div></div>
              ) : (
                <div className="block"><h3>Note to the buyer</h3><div className="quote">{decision.buyer_message}</div></div>
              )}

              {decision.listing_insight && (
                <div className="block insight"><strong>Fix the listing:</strong> {decision.listing_insight}</div>
              )}

              <details className="block">
                <summary>How the agent got here ({record?.toolCalls.length} steps)</summary>
                <ul className="trace" style={{ marginTop: 8 }}>
                  {record?.toolCalls.map((c, i) => (
                    <li key={i} className={c.ok ? "" : "err"} style={{ "--i": i } as CSSProperties}>{TOOL_LABELS[c.tool] ?? c.tool}<ToolError call={c} /></li>
                  ))}
                </ul>
              </details>

              <div className="block">
                {verification && verification.problems.length > 0 && !record?.execution?.ok && (
                  <div className={verification.ok ? "insight" : "error"} style={{ marginBottom: 12 }}>
                    <strong>{verification.ok ? "Check before approving:" : "Blocked by the evidence check:"}</strong>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>{verification.problems.map((p, i) => <li key={i}>{p.text}</li>)}</ul>
                  </div>
                )}
                {decision.action === "FIGHT" && (
                  <p style={{ margin: "0 0 12px" }}>
                    <a href={`/api/disputes/${encodeURIComponent(id)}/packet`} target="_blank" rel="noreferrer">📄 Preview the evidence packet (PDF)</a>
                    <span className="sub" style={{ margin: 0, fontSize: 12.5 }}> · attached to the submission, with source fingerprints</span>
                  </p>
                )}
                {record?.execution?.ok ? (
                  <div className="success">
                    Done: {record.execution.detail}
                    {record.execution.auto && <div style={{ fontSize: 13, marginTop: 4 }}>{record.execution.auto}</div>}
                  </div>
                ) : dispute.status === "RESOLVED" ? (
                  <div className="success">This dispute is closed{dispute.dispute_outcome?.outcome_code === "CANCELED_BY_BUYER" ? ": the buyer withdrew it, so there is nothing to submit." : "."}</div>
                ) : (
                  <>
                    <div className="toolbar">
                      <button
                        className={`btn ${decision.action === "FIGHT" ? "fight" : "accept"}`}
                        onClick={() => run("execute")}
                        disabled={busy !== null || !allowed?.allowed || Boolean(blocked)}
                        title={!allowed?.allowed ? allowed?.why : blocked ? "Fix the evidence first" : undefined}
                      >
                        {busy === "execute" ? "Sending to PayPal…" : decision.action === "FIGHT" ? "Approve & submit evidence" : "Approve refund"}
                      </button>
                      <button className="btn" onClick={() => run("investigate")} disabled={busy !== null}>Re-investigate</button>
                    </div>
                    {allowed && !allowed.allowed && <div className="sub" style={{ margin: 0, fontSize: 13 }}>✕ {allowed.why}</div>}
                  </>
                )}
                {record?.execution && !record.execution.ok && <div className="error">{record.execution.detail}</div>}
              </div>
            </>
          )}

          {!decision && (
            <div className="block">
              <h3>Fight or refund: the money</h3>
              <EvCompare ev={v.ev} action={null} />
            </div>
          )}

          {error && <div className="error block">{error}</div>}
        </section>
      </div>

      <div className="grid2" style={{ marginTop: 18 }}>
        <WhyOdds v={v} />
        <EvidenceGaps v={v} id={id} reload={load} closed={isClosed} />
      </div>

      <CaseFilePanel v={v} />
    </>
  );
}
