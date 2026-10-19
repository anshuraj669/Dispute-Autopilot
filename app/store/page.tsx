"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PRODUCTS } from "@/lib/products";
import { money } from "@/lib/format";
import type { Purchase } from "@/lib/purchases";

declare global {
  interface Window {
    paypal?: any;
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

// Loading the SDK twice makes the second copy destroy every button the first
// rendered ("zoid destroyed all components"). React runs effects twice in dev,
// so share one load per page instead of appending a script per effect run.
let sdkPromise: Promise<void> | null = null;
function loadPayPalSdk(clientId: string): Promise<void> {
  if (window.paypal) return Promise.resolve();
  sdkPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
    s.onload = () => resolve();
    s.onerror = () => {
      sdkPromise = null;
      s.remove();
      reject(new Error("Could not load the PayPal SDK"));
    };
    document.body.appendChild(s);
  });
  return sdkPromise;
}

const MAX_QUANTITY = 10;

type BuyButtonProps = {
  sku: string;
  // Read at click time, so changing the quantity doesn't re-render the PayPal buttons.
  quantity: { current: number };
  onPaid: (msg: string) => void;
};

function BuyButton({ sku, quantity, onPaid }: BuyButtonProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.paypal || !ref.current) return;
    const buttons = window.paypal.Buttons({
      style: { layout: "horizontal", tagline: false, height: 38 },
      createOrder: async () => {
        const res = await fetch("/api/orders", { method: "POST", body: JSON.stringify({ sku, quantity: quantity.current }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        return json.id;
      },
      onApprove: async ({ orderID }: { orderID: string }) => {
        const res = await fetch(`/api/orders/${orderID}/capture`, { method: "POST" });
        const json = await res.json();
        if (!res.ok) return onPaid(`Capture failed: ${json.error}`);
        const p = json as Purchase;
        const what = p.items.map((i) => `${i.quantity} × ${i.name}`).join(", ");
        onPaid(`Paid ${money(p.total)} for ${what}. Shipped with USPS ${p.trackingNumber}.`);
      },
    });
    if (!buttons.isEligible()) return;
    // Closing before render finishes (dev double-mount, navigation) rejects; that's expected.
    buttons.render(ref.current).catch(() => {});
    return () => {
      buttons.close?.().catch?.(() => {});
    };
  }, [sku, quantity, onPaid]);

  return <div ref={ref} />;
}

function ProductCard({ i, product, ready, onPaid }: { i: number; product: (typeof PRODUCTS)[number]; ready: boolean; onPaid: (msg: string) => void }) {
  const [qty, setQty] = useState(1);
  const qtyRef = useRef(qty);
  qtyRef.current = qty;
  const unitCents = Math.round(Number(product.price) * 100);
  const total = ((unitCents * qty) / 100).toFixed(2);

  return (
    <div className="panel rise" style={{ "--i": i } as React.CSSProperties}>
      <h2 style={{ marginBottom: 4 }}>{product.name}</h2>
      <p className="sub" style={{ marginBottom: 8 }}>{product.blurb}</p>
      <p style={{ fontWeight: 700, margin: "0 0 12px" }}>{money({ currency_code: "USD", value: product.price })}</p>
      <div className="qty">
        <label htmlFor={`qty-${product.sku}`}>Quantity</label>
        <button type="button" className="btn small" aria-label="Decrease quantity" disabled={qty <= 1} onClick={() => setQty(qty - 1)}>−</button>
        <input
          id={`qty-${product.sku}`}
          type="number"
          min={1}
          max={MAX_QUANTITY}
          value={qty}
          onChange={(e) => setQty(Math.min(MAX_QUANTITY, Math.max(1, Math.floor(Number(e.target.value)) || 1)))}
        />
        <button type="button" className="btn small" aria-label="Increase quantity" disabled={qty >= MAX_QUANTITY} onClick={() => setQty(qty + 1)}>+</button>
        <span className="qty-total">Total {money({ currency_code: "USD", value: total })}</span>
      </div>
      {ready && <BuyButton sku={product.sku} quantity={qtyRef} onPaid={onPaid} />}
    </div>
  );
}

function Purchases({ purchases }: { purchases: Purchase[] | null }) {
  if (purchases === null) return <p className="sub">Loading purchases…</p>;
  if (purchases.length === 0) return <p className="sub">No purchases yet. Buy something above and it will show up here.</p>;
  return (
    <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Total</th>
            <th>Buyer</th>
            <th>Order / capture</th>
            <th>USPS tracking</th>
          </tr>
        </thead>
        <tbody>
          {purchases.map((p) => (
            <tr key={p.orderId}>
              <td>{new Date(p.purchasedAt).toLocaleString()}</td>
              <td>{p.items.map((i) => <div key={i.sku}>{i.name}</div>)}</td>
              <td className="num">{p.items.reduce((n, i) => n + i.quantity, 0)}</td>
              <td className="num">{money(p.total)}</td>
              <td>{p.buyerName ?? "—"}{p.buyerEmail && <div className="sub" style={{ margin: 0 }}>{p.buyerEmail}</div>}</td>
              <td className="mono">{p.orderId}<div className="sub" style={{ margin: 0 }}>{p.captureId}</div></td>
              <td className="mono">{p.trackingNumber}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Store() {
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);

  const loadPurchases = useCallback(async () => {
    const res = await fetch("/api/purchases", { cache: "no-store" });
    if (res.ok) setPurchases((await res.json()).purchases);
  }, []);

  useEffect(() => {
    loadPurchases();
  }, [loadPurchases]);

  // Stable identity, so the PayPal buttons aren't torn down and re-rendered on every update.
  const onPaid = useCallback(
    (msg: string) => {
      setNotice(msg);
      loadPurchases();
    },
    [loadPurchases],
  );

  useEffect(() => {
    if (!CLIENT_ID) return;
    let active = true;
    loadPayPalSdk(CLIENT_ID).then(
      () => active && setReady(true),
      (err: Error) => active && setSdkError(err.message),
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <p className="eyebrow rise">Demo store · PayPal sandbox checkout</p>
      <h1 className="gradient-text rise">Lumen Candle Co.</h1>
      <p className="sub">
        Buy something with a PayPal sandbox buyer account, then open a dispute on it from{" "}
        <a href="https://www.sandbox.paypal.com/resolutioncenter" target="_blank" rel="noreferrer">the sandbox Resolution Center</a>.
        The webhook wakes the agent up.
      </p>

      {!CLIENT_ID && (
        <div className="error" style={{ marginBottom: 16 }}>
          Set NEXT_PUBLIC_PAYPAL_CLIENT_ID and PAYPAL_MODE=sandbox to enable checkout. The dashboard works without it using demo data.
        </div>
      )}
      {sdkError && <div className="error" style={{ marginBottom: 16 }}>{sdkError}. Check the client ID and disable ad blockers.</div>}
      {notice && <div className="success" style={{ marginBottom: 16 }}>{notice}</div>}

      <div className="products">
        {PRODUCTS.map((p, i) => (
          <ProductCard key={p.sku} i={i} product={p} ready={ready} onPaid={onPaid} />
        ))}
      </div>

      <h2 style={{ marginTop: 32 }}>Purchases</h2>
      <Purchases purchases={purchases} />
    </>
  );
}
