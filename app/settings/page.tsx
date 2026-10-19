"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { Settings } from "@/lib/settings";

export default function SettingsPage() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setSaved(j.settings);
        setForm(j.settings);
      })
      .catch((err) => setError(String(err)));
  }, []);

  if (!form || !saved) return <p className="sub">{error ?? "Loading…"}</p>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setForm({ ...form, [k]: v });
    setStatus("idle");
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const save = async () => {
    setStatus("saving");
    setError(null);
    const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify(form) });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error);
      return setStatus("idle");
    }
    setSaved(json.settings);
    setForm(json.settings);
    setStatus("saved");
  };

  const auto = form.autonomy === "auto_small";

  return (
    <>
      <section className="hero">
        <div className="rise">
          <p className="eyebrow">Your rules</p>
          <h1 className="gradient-text">Settings</h1>
          <p className="sub">The policy the agent follows, how much it may do without asking you, and the numbers behind the impact figures.</p>
        </div>
      </section>

      <div className="settings-grid">
        <section className="panel rise" style={{ "--i": 1 } as CSSProperties}>
          <h2>How much the agent may do alone</h2>
          <div className="choice" role="radiogroup" aria-label="Autonomy">
            <label className={!auto ? "on" : ""}>
              <input type="radio" name="autonomy" checked={!auto} onChange={() => set("autonomy", "suggest")} />
              <strong>Suggest only</strong>
              <small>The agent investigates and drafts everything. Refunds, evidence and messages wait for your approval.</small>
            </label>
            <label className={auto ? "on" : ""}>
              <input type="radio" name="autonomy" checked={auto} onChange={() => set("autonomy", "auto_small")} />
              <strong>Handle small disputes alone</strong>
              <small>Below your limit, and only when it's confident, the agent carries out its decision and tells you afterwards.</small>
            </label>
          </div>

          <fieldset disabled={!auto} style={{ border: 0, padding: 0, margin: 0, opacity: auto ? 1 : 0.5, transition: "opacity .3s" }}>
            <label className="field">
              <span>Act alone on disputes up to</span>
              <input type="number" min={0} step={1} value={form.autoLimit} onChange={(e) => set("autoLimit", Number(e.target.value))} />
              <small>USD. Anything larger always waits for you.</small>
            </label>
            <label className="field">
              <span>Minimum confidence to act alone</span>
              <select value={form.autoMinConfidence} onChange={(e) => set("autoMinConfidence", e.target.value as Settings["autoMinConfidence"])}>
                <option value="high">High only</option>
                <option value="medium">Medium or high</option>
              </select>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={form.autoMessageBuyer} onChange={(e) => set("autoMessageBuyer", e.target.checked)} />
              <span>
                Also message the buyer when fighting alone
                <small>Sends the agent's polite note through the PayPal dispute thread.</small>
              </span>
            </label>
          </fieldset>
        </section>

        <section className="panel rise" style={{ "--i": 2 } as CSSProperties}>
          <h2>Policy the agent follows</h2>
          <label className="field">
            <span>Shop name</span>
            <input value={form.merchantName} maxLength={120} onChange={(e) => set("merchantName", e.target.value)} />
          </label>
          <label className="field">
            <span>Refund policy</span>
            <textarea rows={4} maxLength={2000} value={form.refundPolicy} onChange={(e) => set("refundPolicy", e.target.value)} />
          </label>
          <label className="field">
            <span>Just refund disputes up to</span>
            <input type="number" min={0} step={1} value={form.autoAcceptThreshold} onChange={(e) => set("autoAcceptThreshold", Number(e.target.value))} />
            <small>USD. Below this, fighting usually costs more time than it saves.</small>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={form.requireDeliveryProof} onChange={(e) => set("requireDeliveryProof", e.target.checked)} />
            <span>
              Never fight "not received" without delivery proof
              <small>The agent refunds unless the carrier confirms delivery to the buyer's address.</small>
            </span>
          </label>
        </section>

        <section className="panel rise" style={{ "--i": 3 } as CSSProperties}>
          <h2>Your economics</h2>
          <p className="sub" style={{ marginBottom: 14 }}>The fight-or-refund maths and the break-even win odds on every case come from these.</p>
          <label className="field">
            <span>PayPal dispute fee</span>
            <input type="number" min={0} step={0.5} value={form.disputeFee} onChange={(e) => set("disputeFee", Number(e.target.value))} />
            <small>USD, from your PayPal fee schedule.</small>
          </label>
          <label className="field">
            <span>The fee is charged</span>
            <select value={form.feeWhen} onChange={(e) => set("feeWhen", e.target.value as Settings["feeWhen"])}>
              <option value="lost">Only when I lose the fight</option>
              <option value="always">On every fight, win or lose</option>
            </select>
            <small>Check your fee schedule; it changes the break-even point a lot on small orders.</small>
          </label>
          <label className="field">
            <span>What an hour of your time is worth</span>
            <input type="number" min={0} step={5} value={form.hourlyRate} onChange={(e) => set("hourlyRate", Number(e.target.value))} />
            <small>USD.</small>
          </label>
          <label className="field">
            <span>Minutes to review a fight the agent prepared</span>
            <input type="number" min={0} step={1} value={form.reviewMinutes} onChange={(e) => set("reviewMinutes", Number(e.target.value))} />
            <small>Reading the packet and approving it.</small>
          </label>
          <label className="field">
            <span>Value recovered from a returned item</span>
            <input type="number" min={0} max={100} step={5} value={form.returnRecoveryPct} onChange={(e) => set("returnRecoveryPct", Number(e.target.value))} />
            <small>% of the price, for "not as described" claims where the buyer sends the item back.</small>
          </label>
          <label className="field">
            <span>Minutes you'd spend on one dispute by hand</span>
            <input type="number" min={1} step={5} value={form.manualMinutes} onChange={(e) => set("manualMinutes", Number(e.target.value))} />
            <small>Reading the claim, finding the order and tracking, writing the response. Used for hours saved.</small>
          </label>
        </section>
      </div>

      <div className="glass savebar">
        {error && <span className="error" style={{ marginRight: "auto" }}>{error}</span>}
        {status === "saved" && !dirty && <span className="sub" style={{ margin: 0 }}>✓ Saved. The agent uses these from its next investigation.</span>}
        <button className="btn" onClick={() => setForm(saved)} disabled={!dirty || status === "saving"}>Discard</button>
        <button className="btn primary" onClick={save} disabled={!dirty || status === "saving"}>
          {status === "saving" ? "Saving…" : "Save settings"}
        </button>
      </div>
    </>
  );
}
