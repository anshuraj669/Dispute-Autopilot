// One command for local sandbox development:
//   1. starts `next dev`
//   2. opens a Cloudflare quick tunnel to it (new random URL each run)
//   3. points your PayPal webhook at <tunnel>/api/webhooks/paypal
//
// The webhook keeps the same ID, so PAYPAL_WEBHOOK_ID never changes. If it is
// empty (or the webhook was deleted), a new webhook is created and its ID is
// written into .env for you.
//
// Usage: npm run dev:tunnel

export {};

await import("./load-env");

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { bin, install, Tunnel } from "cloudflared";

const PORT = Number(process.env.PORT ?? 3000);
const WEBHOOK_PATH = "/api/webhooks/paypal";
const EVENT_TYPES = [{ name: "CUSTOMER.DISPUTE.CREATED" }, { name: "CUSTOMER.DISPUTE.UPDATED" }];

// Webhooks only matter against the real sandbox; the Next.js child inherits this.
process.env.PAYPAL_MODE = "sandbox";

const { paypalFetch, PayPalError } = await import("../lib/paypal");

/** Writes KEY=value into .env, replacing an existing line or appending one. */
function setEnvVar(key: string, value: string) {
  const text = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(".env", re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`);
  process.env[key] = value;
}

async function createWebhook(url: string): Promise<string> {
  const hook = await paypalFetch("/v1/notifications/webhooks", {
    method: "POST",
    body: JSON.stringify({ url, event_types: EVENT_TYPES }),
  });
  setEnvVar("PAYPAL_WEBHOOK_ID", hook.id);
  return hook.id;
}

async function pointWebhookAt(url: string) {
  const id = process.env.PAYPAL_WEBHOOK_ID;
  if (!id) {
    const newId = await createWebhook(url);
    console.log(`\n✓ Created webhook ${newId} (saved to .env)`);
    return;
  }
  try {
    await paypalFetch(`/v1/notifications/webhooks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify([
        { op: "replace", path: "/url", value: url },
        { op: "replace", path: "/event_types", value: EVENT_TYPES },
      ]),
    });
    console.log(`\n✓ Webhook ${id} now points to ${url}`);
  } catch (err) {
    if (err instanceof PayPalError && err.status === 404) {
      const newId = await createWebhook(url);
      console.log(`\n✓ Webhook ${id} no longer exists; created ${newId} (saved to .env)`);
      return;
    }
    throw err;
  }
}

if (!existsSync(bin)) {
  console.log("Downloading cloudflared (first run only)…");
  await install(bin);
}

// The tunnel comes up first so the webhook (and any newly created ID) is in
// place before Next.js starts and reads its environment.
const tunnel = Tunnel.quick(`http://localhost:${PORT}`);
let next: ChildProcess | null = null;

tunnel.once("url", async (base) => {
  try {
    await pointWebhookAt(`${base}${WEBHOOK_PATH}`);
  } catch (err) {
    console.error("\n✗ Could not update the PayPal webhook:", err instanceof Error ? err.message : err);
    return shutdown(1);
  }
  console.log(`  App:   http://localhost:${PORT}`);
  console.log(`  Store: ${base}/store\n`);
  // Own process group (detached) so shutdown can stop next and all its workers.
  next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT)], {
    stdio: "inherit",
    env: process.env,
    detached: true,
  });
  next.on("exit", (code) => shutdown(code ?? 0));
});

tunnel.on("error", (err) => {
  console.error("Tunnel error:", err.message);
  shutdown(1);
});

const slow = setTimeout(() => {
  if (!next) console.warn("Still waiting for the Cloudflare tunnel URL…");
}, 20_000);

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(slow);
  tunnel.stop();
  if (next?.pid) {
    try {
      process.kill(-next.pid, "SIGINT");
    } catch {}
  }
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
