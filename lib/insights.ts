// Product-level view of disputes: which products draw complaints, why, how
// they end, and what the agent suggests changing in the listing.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { provider } from "./paypal";
import { PRODUCTS } from "./products";
import { allCases } from "./store";
import { reasonLabel } from "./format";

const MODEL = "claude-opus-5-5";

export type ProductInsight = {
  name: string;
  sku: string | null;
  blurb: string | null;
  disputes: number;
  open: number;
  amountDisputed: number;
  unitsSold: number | null;
  /** Disputes per 100 units sold, when sales are known. */
  disputeRate: number | null;
  reasons: { reason: string; label: string; count: number }[];
  outcomes: { lost: number; won: number; withdrawn: number; pending: number };
  complaints: string[];
  agentSuggestions: string[];
};

export type InsightsReport = {
  products: ProductInsight[];
  reasons: { reason: string; label: string; count: number; amount: number }[];
  totals: { disputes: number; amount: number; withdrawn: number };
};

// Accept both the product name and SKU (PayPal sandbox disputes list item IDs).
const productFor = (name: string) => PRODUCTS.find((p) => p.name === name || p.sku === name);

export async function buildInsights(): Promise<InsightsReport> {
  const paypal = provider();
  const [disputes, cases, sold] = await Promise.all([paypal.listDisputes(), allCases(), paypal.unitsSold()]);
  const byProduct = new Map<string, ProductInsight>();
  const reasons = new Map<string, { count: number; amount: number }>();

  for (const d of disputes) {
    const amount = Number(d.amount.value);
    const r = reasons.get(d.reason) ?? { count: 0, amount: 0 };
    reasons.set(d.reason, { count: r.count + 1, amount: r.amount + amount });

    for (const item of d.items.length ? d.items : [{ name: "Unknown item", quantity: 1 }]) {
      const known = productFor(item.name);
      const name = known?.name ?? item.name;
      const p =
        byProduct.get(name) ??
        ({
          name,
          sku: known?.sku ?? null,
          blurb: known?.blurb ?? null,
          disputes: 0,
          open: 0,
          amountDisputed: 0,
          unitsSold: sold[name] ?? null,
          disputeRate: null,
          reasons: [],
          outcomes: { lost: 0, won: 0, withdrawn: 0, pending: 0 },
          complaints: [],
          agentSuggestions: [],
        } satisfies ProductInsight);
      p.disputes += 1;
      p.amountDisputed += amount / Math.max(d.items.length, 1);
      if (d.status !== "RESOLVED") p.open += 1;
      const pr = p.reasons.find((x) => x.reason === d.reason);
      if (pr) pr.count += 1;
      else p.reasons.push({ reason: d.reason, label: reasonLabel(d.reason), count: 1 });
      if (d.outcome === "RESOLVED_BUYER_FAVOUR") p.outcomes.lost += 1;
      else if (d.outcome === "RESOLVED_SELLER_FAVOUR") p.outcomes.won += 1;
      else if (d.outcome === "CANCELED_BY_BUYER") p.outcomes.withdrawn += 1;
      else p.outcomes.pending += 1;
      if (d.firstBuyerMessage && p.complaints.length < 6) p.complaints.push(d.firstBuyerMessage);
      const suggestion = cases[d.id]?.decision?.listing_insight;
      if (suggestion && !p.agentSuggestions.includes(suggestion)) p.agentSuggestions.push(suggestion);
      byProduct.set(name, p);
    }
  }

  const products = [...byProduct.values()].map((p) => ({
    ...p,
    amountDisputed: Math.round(p.amountDisputed * 100) / 100,
    disputeRate: p.unitsSold ? (p.disputes / p.unitsSold) * 100 : null,
    reasons: p.reasons.sort((a, b) => b.count - a.count),
  }));
  products.sort((a, b) => (b.disputeRate ?? b.disputes) - (a.disputeRate ?? a.disputes));

  return {
    products,
    reasons: [...reasons.entries()]
      .map(([reason, v]) => ({ reason, label: reasonLabel(reason), ...v }))
      .sort((a, b) => b.count - a.count),
    totals: {
      disputes: disputes.length,
      amount: disputes.reduce((s, d) => s + Number(d.amount.value), 0),
      withdrawn: disputes.filter((d) => d.outcome === "CANCELED_BY_BUYER").length,
    },
  };
}

const ListingSchema = z.object({
  title: z.string().describe("Product title, under 70 characters"),
  description: z.string().describe("Listing description, 2-4 short paragraphs, plain text"),
  key_facts: z.array(z.string()).describe("3-6 bullet points with the concrete facts buyers misread: size, contents, timing"),
  what_changed: z.array(z.string()).describe("Each change and the complaint it answers"),
});

export type ListingRewrite = z.infer<typeof ListingSchema>;

/** Asks Claude to rewrite a listing so the complaints buyers keep raising are answered up front. */
export async function rewriteListing(productName: string): Promise<ListingRewrite> {
  const report = await buildInsights();
  const p = report.products.find((x) => x.name === productName);
  if (!p) throw new Error(`No disputes found for "${productName}".`);

  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(ListingSchema) },
    // On a safety decline, the API retries on a fallback model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system:
      "You rewrite product listings for a small online shop so buyers know exactly what they are getting. " +
      "Work only from the facts given: never invent dimensions, weights, materials or burn times. " +
      "Where a fact buyers need is missing, write a clear placeholder in square brackets, such as [height in cm], for the merchant to fill in.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          product: p.name,
          current_listing: p.blurb ?? "(no listing text on file)",
          disputes: p.disputes,
          dispute_reasons: p.reasons.map((r) => `${r.label}: ${r.count}`),
          buyer_complaints: p.complaints,
          dispute_agent_suggestions: p.agentSuggestions,
        }),
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to rewrite this listing.");
  if (!response.parsed_output) throw new Error(`No listing came back (stop_reason: ${response.stop_reason}).`);
  return response.parsed_output;
}
