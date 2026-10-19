export {};

// Day-1 check: can this sandbox app do everything the demo needs?
// Usage: npm run check:sandbox   (reads .env)

await import("./load-env");
process.env.PAYPAL_MODE = "sandbox";

const { paypalFetch, PayPalError } = await import("../lib/paypal");

type Check = { name: string; run: () => Promise<string> };

const checks: Check[] = [
  {
    name: "OAuth credentials",
    run: async () => {
      await paypalFetch("/v1/customer/disputes?page_size=1");
      return "token issued";
    },
  },
  {
    name: "Disputes API",
    run: async () => {
      const list = await paypalFetch("/v1/customer/disputes?page_size=50");
      const items: any[] = list.items ?? [];
      if (!items.length) return "reachable, but no disputes yet. Create one (see README: Create a sandbox dispute).";
      return `${items.length} dispute(s): ${items.map((d) => `${d.dispute_id} [${d.status}]`).join(", ")}`;
    },
  },
  {
    name: "Transaction Search API",
    run: async () => {
      const end = new Date();
      const start = new Date(end.getTime() - 30 * 86_400_000);
      const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
      const r = await paypalFetch(`/v1/reporting/transactions?start_date=${iso(start)}&end_date=${iso(end)}&page_size=1`);
      return `reachable (${r.total_items ?? 0} transactions in the last 30 days)`;
    },
  },
  {
    name: "Webhook ID configured",
    run: async () => {
      if (!process.env.PAYPAL_WEBHOOK_ID) throw new Error("PAYPAL_WEBHOOK_ID is empty");
      const hooks = await paypalFetch("/v1/notifications/webhooks");
      const hook = (hooks.webhooks ?? []).find((w: any) => w.id === process.env.PAYPAL_WEBHOOK_ID);
      if (!hook) throw new Error("PAYPAL_WEBHOOK_ID not found on this app");
      const events: string[] = hook.event_types.map((e: any) => e.name);
      const ok = events.includes("CUSTOMER.DISPUTE.CREATED") || events.includes("*");
      return `${hook.url} ${ok ? "(subscribed to CUSTOMER.DISPUTE.CREATED)" : "(NOT subscribed to CUSTOMER.DISPUTE.CREATED)"}`;
    },
  },
];

let failed = 0;
for (const c of checks) {
  try {
    console.log(`✓ ${c.name}: ${await c.run()}`);
  } catch (err) {
    failed++;
    const msg = err instanceof PayPalError ? `HTTP ${err.status} ${err.body.slice(0, 200)}` : (err as Error).message;
    console.log(`✗ ${c.name}: ${msg}`);
  }
}
process.exit(failed ? 1 : 0);
