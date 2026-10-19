"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { LearningReport } from "@/lib/learning";
import { CountUp, Tilt } from "../components/spatial";

const pct = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)}%`);

/** Predicted vs actual win rate per bucket; dots on the diagonal mean the estimates are honest. */
function Reliability({ bins }: { bins: LearningReport["reliability"] }) {
  const S = 260;
  const pad = 34;
  const x = (v: number) => pad + v * (S - pad - 10);
  const y = (v: number) => S - pad - v * (S - pad - 10);
  const maxN = Math.max(...bins.map((b) => b.n), 1);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="reliability">
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Calibration: predicted win rate against actual win rate per bucket">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={pad - 6} y={y(t) + 4} textAnchor="end" className="axis-text">{t * 100}%</text>
            <text x={x(t)} y={S - pad + 16} textAnchor="middle" className="axis-text">{t * 100}%</text>
          </g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="diag" />
        {bins.map((b, i) =>
          b.predicted === null || b.actual === null ? null : (
            <g key={b.bin} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <circle cx={x(b.predicted)} cy={y(b.actual)} r={14} fill="transparent" />
              <circle cx={x(b.predicted)} cy={y(b.actual)} r={5 + (b.n / maxN) * 7} className="rel-dot" style={{ "--i": i } as CSSProperties} />
            </g>
          ),
        )}
      </svg>
      <div className="rel-caption">
        {hover !== null && bins[hover].n ? (
          <>Estimated {bins[hover].bin}: predicted <strong>{pct(bins[hover].predicted)}</strong>, actually won <strong>{pct(bins[hover].actual)}</strong> of {bins[hover].n}</>
        ) : (
          <>Across: what the model predicted. Up: how often the merchant actually won. On the line = honest odds. Dot size = number of disputes.</>
        )}
      </div>
    </div>
  );
}

function BrierBars({ h }: { h: LearningReport["holdout"] }) {
  const rows = [
    { label: "Learned model", v: h.brier.learned },
    { label: "Starting rules", v: h.brier.prior },
    { label: "Win rate by claim type", v: h.brier.baseRate },
    ...(h.brier.agent !== null ? [{ label: `LLM's own guess (${h.agentN})`, v: h.brier.agent }] : []),
  ].filter((r): r is { label: string; v: number } => r.v !== null);
  const max = Math.max(...rows.map((r) => r.v), 0.01);
  return (
    <div className="hbars" role="table" aria-label="Prediction error by method, lower is better">
      {rows.map((r, i) => (
        <div key={r.label} className="hbar-row" role="row" title={`${r.label}: Brier ${r.v.toFixed(3)}`}>
          <span className="hbar-label" role="cell">{r.label}</span>
          <div className="hbar-track" role="cell"><div className="hbar" style={{ width: `${(r.v / max) * 100}%`, "--i": i } as CSSProperties} /></div>
          <span className="hbar-value" role="cell">{r.v.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Accuracy() {
  const [data, setData] = useState<{ mode: string; report: LearningReport } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/accuracy", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setData(json);
      })
      .catch((err) => setError(err.message));
  }, []);

  const r = data?.report;
  const improved = r && r.holdout.brier.learned !== null && r.holdout.brier.prior !== null ? (1 - r.holdout.brier.learned / r.holdout.brier.prior) * 100 : null;
  const moved = r ? [...r.weights].filter((w) => Math.abs(w.learned - w.prior) >= 0.15).sort((a, b) => Math.abs(b.learned - b.prior) - Math.abs(a.learned - a.prior)) : [];

  return (
    <>
      <section className="hero">
        <div className="rise">
          <p className="eyebrow">Outcome learning</p>
          <h1 className="gradient-text">Track record</h1>
          <p className="sub">Every estimate is frozen when the agent decides, then checked against what PayPal actually ruled. The model refits itself on those outcomes.</p>
        </div>
      </section>

      {error && <div className="error">{error}</div>}
      {!r && !error && <p className="sub">Loading…</p>}

      {r && (
        <>
          {r.nDemo > 0 && (
            <div className="insight rise" style={{ marginBottom: 18 }}>
              <strong>Demo data:</strong> {r.nDemo} of these {r.n} resolved disputes are a seeded synthetic history, so the learning loop is visible on day one.
              The other {r.nReal} are disputes this app predicted and PayPal ruled on. With real PayPal data only real disputes count.
            </div>
          )}

          <section className="kpis">
            <Tilt className="kpi rise" style={{ "--i": 1 } as CSSProperties}>
              <div className="label"><span className="icon" aria-hidden="true">📚</span>Resolved disputes learned from</div>
              <div className="value"><CountUp value={r.n} format={(n) => String(Math.round(n))} /></div>
              <div className="note">{r.usingLearned ? "Learned weights are live" : r.n >= r.minExamples ? "Learned weights on probation" : `Starting rules until ${r.minExamples}`}</div>
            </Tilt>
            <Tilt className="kpi rise blue" style={{ "--i": 2 } as CSSProperties}>
              <div className="label"><span className="icon" aria-hidden="true">🎯</span>Error on unseen disputes</div>
              <div className="value">{(r.usingLearned ? r.holdout.brier.learned : r.holdout.brier.prior)?.toFixed(3) ?? "—"}</div>
              <div className="note">Brier score of the live model on {r.holdout.n} disputes it hadn't seen; 0 is perfect, 0.25 is a coin flip</div>
            </Tilt>
            <Tilt className={`kpi rise ${improved !== null && improved >= 0 ? "hero-kpi" : ""}`} style={{ "--i": 3 } as CSSProperties}>
              <div className="label"><span className="icon" aria-hidden="true">📈</span>Learning vs the starting rules</div>
              <div className="value">{improved === null ? "—" : `${improved >= 0 ? "−" : "+"}${Math.abs(improved).toFixed(0)}%`}</div>
              <div className="note">{improved === null ? "not enough data yet" : improved >= 0 ? "less prediction error, so learned weights are live" : "more error, so the starting rules stay live"}</div>
            </Tilt>
          </section>

          <div className="grid2">
            <section className="panel rise" style={{ "--i": 4 } as CSSProperties}>
              <h2>Are the odds honest?</h2>
              <p className="sub" style={{ marginBottom: 8 }}>{r.holdout.n} disputes, each predicted by a model trained only on earlier ones.</p>
              <Reliability bins={r.reliability} />
            </section>
            <section className="panel rise" style={{ "--i": 5 } as CSSProperties}>
              <h2>Prediction error by method</h2>
              <p className="sub" style={{ marginBottom: 12 }}>Brier score on the same disputes, each predicted before its outcome was known. Shorter is better.</p>
              <BrierBars h={r.holdout} />
              <h3 style={{ marginTop: 22 }}>Win rate by claim type</h3>
              <table className="table">
                <tbody>
                  {r.winRates.filter((w) => w.n).map((w) => (
                    <tr key={w.group}><td>{w.label}</td><td className="num">{w.won} of {w.n}</td><td className="num">{pct(w.won / w.n)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <section className="panel rise" style={{ "--i": 6, marginTop: 18 } as CSSProperties}>
            <h2>What the outcomes taught it</h2>
            <p className="sub" style={{ marginBottom: 12 }}>
              Weights in log-odds. Starting values encode PayPal Seller Protection rules; learned values are refit on outcomes, kept close to the start so a few cases can't swing them.
              {" "}{r.usingLearned
                ? "The learned weights beat the starting rules on disputes they hadn't seen, so they're live."
                : "On probation: refit weights only go live once they beat the starting rules on disputes they hadn't seen. On this history they don't yet, so every estimate still uses the starting rules."}
            </p>
            {moved.length === 0 && <p className="sub">Nothing has moved much yet.</p>}
            {moved.length > 0 && (
              <div className="facts-table-wrap">
                <table className="table">
                  <thead><tr><th>Claim type</th><th>Factor</th><th className="num">Started</th><th className="num">{r.usingLearned ? "Learned" : "Candidate"}</th><th>Change</th></tr></thead>
                  <tbody>
                    {moved.map((w) => {
                      const flipped = Math.sign(w.learned) !== Math.sign(w.prior) && Math.abs(w.learned) > 0.05;
                      const more = Math.abs(w.learned) > Math.abs(w.prior);
                      return (
                        <tr key={w.key}>
                          <td>{w.groupLabel}</td>
                          <td>{w.label}</td>
                          <td className="num">{w.prior.toFixed(2)}</td>
                          <td className="num"><strong>{w.learned.toFixed(2)}</strong></td>
                          <td>{w.feature === "base" ? (w.learned > w.prior ? "▲ higher starting odds" : "▼ lower starting odds") : flipped ? "⇄ points the other way" : more ? "▲ matters more" : "▼ matters less"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel rise" style={{ "--i": 7, marginTop: 18 } as CSSProperties}>
            <h2>This app's predictions vs PayPal's rulings</h2>
            {r.real.length === 0 ? (
              <p className="sub" style={{ margin: 0 }}>
                None yet. A dispute counts once you fight it and PayPal rules. Refunds don't count: they aren't rulings.
                {data?.mode === "mock" && <> In demo mode, submit evidence on a few disputes, then use <strong>Simulate → PayPal rules on submitted cases</strong>.</>}
              </p>
            ) : (
              <div className="facts-table-wrap">
                <table className="table">
                  <thead><tr><th>Dispute</th><th>Decided</th><th className="num">Calibrated</th><th className="num">LLM guess</th><th>Outcome</th></tr></thead>
                  <tbody>
                    {r.real.map((e) => (
                      <tr key={e.id}>
                        <td><a href={`/disputes/${encodeURIComponent(e.id)}`}>{e.id}</a></td>
                        <td>{new Date(e.at).toLocaleDateString()}</td>
                        <td className="num">{pct(e.predicted)}</td>
                        <td className="num">{pct(e.agentEstimate)}</td>
                        <td>{e.won ? <span className="status status-good"><span aria-hidden="true">✓</span> Won</span> : <span className="status status-critical"><span aria-hidden="true">✕</span> Lost</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
