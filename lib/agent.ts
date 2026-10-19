// The dispute investigator: Claude with read-only tools over a sourced case
// file plus a final record_decision tool that checks its evidence against the
// records. It never moves money itself - execution happens only after the
// merchant approves (lib/execute.ts), and only if PayPal allows the action.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { provider } from "./paypal";
import { trackShipment } from "./carrier";
import { getSettings } from "./settings";
import { updateCase } from "./store";
import { assess, type Assessment } from "./assess";
import { caseFileForAgent } from "./casefile";
import { verifyDecision } from "./integrity";
import { EVIDENCE_TYPES, type Decision, type ToolCall } from "./types";

const MODEL = "claude-opus-5-5";
/** How many times record_decision may bounce a decision back before recording it as is (execution stays blocked). */
const MAX_REJECTIONS = 2;

const SYSTEM = `You are Dispute Autopilot, an analyst that handles PayPal disputes for a small online merchant.

For each dispute you investigate the facts with your tools, then decide whether the merchant should FIGHT (submit evidence) or ACCEPT (refund the buyer and close the case).

How to investigate:
- Start with get_case_file. It holds every fact you may cite, each with an ID and the source record it came from, plus a calibrated win estimate built from those facts, the break-even win probability for this merchant, missing evidence, contradictions between records, and what PayPal allows on this dispute right now.
- Use the other tools to look closer when something in the case file needs it: get_dispute, get_capture and get_order for the raw records, check_carrier_status for scan history, search_transaction for payer verification (matters most for UNAUTHORISED claims), list_merchant_disputes for repeated complaints.
- Read the buyer's messages: earlier messages can contradict the claim.
- Call get_merchant_policy before deciding, and follow the merchant's rules it returns.

How to decide:
- The calibrated estimate comes from a model checked against real dispute outcomes. Treat it as the starting point. Report your own estimate in win_probability; if it differs from the calibrated one by more than 0.15, say why in deviation_reason, naming the facts the model doesn't weigh.
- Fight only when the win probability is clearly above the break-even in the case file, which already accounts for the dispute fee, the merchant's time and any return value. If the disputed amount is at or below the auto-accept threshold, recommend ACCEPT unless there is clear evidence of fraud.
- If PayPal doesn't currently allow the action you'd recommend, say so in the reasoning.

Evidence integrity:
- Every evidence item must list in sources the case-file fact IDs it rests on, e.g. ["carrier.1.status", "order.ship_to"]. Only facts from get_case_file can be cited; if something isn't in the case file, it can't be submitted.
- Never invent tracking numbers, dates, amounts or messages. Use tracking numbers exactly as they appear on the order.
- If the records contradict each other, address the contradiction in the reasoning rather than ignoring it.
- record_decision checks your evidence against the case file and rejects anything unsourced; fix what it reports and call it again.

When you are done, call record_decision exactly once. The seller_statement goes to PayPal reviewers: factual, specific, under 150 words. The buyer_message goes to the buyer: polite and brief. If the same product keeps getting disputes, put a concrete fix for the listing in listing_insight; otherwise set it to null.`;

const EvidenceSchema = z.object({
  evidence_type: z.enum(EVIDENCE_TYPES),
  description: z.string().describe("What this evidence shows, citing specific facts from tool results"),
  carrier: z.string().optional().describe("Carrier code such as USPS, UPS, FEDEX or DHL, only for tracking evidence; omit if unknown"),
  tracking_number: z.string().optional().describe("Tracking number exactly as seen in the order"),
  sources: z.array(z.string()).min(1).describe("Case-file fact IDs this evidence rests on"),
});

const DecisionSchema = z.object({
  action: z.enum(["FIGHT", "ACCEPT"]),
  win_probability: z.number().min(0).max(1).describe("Your own estimate of the chance PayPal rules for the seller if they fight"),
  deviation_reason: z
    .string()
    .nullable()
    .describe("Why your estimate differs from the calibrated estimate by more than 0.15, citing facts; null otherwise"),
  confidence: z.enum(["low", "medium", "high"]),
  headline: z.string().describe("One sentence summary for the merchant dashboard"),
  reasoning: z.array(z.string()).min(2).max(6).describe("Key facts and the conclusion drawn from each"),
  evidence: z.array(EvidenceSchema).describe("Evidence to submit if fighting; empty when accepting"),
  seller_statement: z.string().describe("Statement for PayPal reviewers (used when fighting)"),
  buyer_message: z.string().describe("Message to the buyer"),
  listing_insight: z.string().nullable().describe("Product listing fix if this is a repeated complaint, else null"),
});

/** `trigger` says why this run started (e.g. a buyer reply); it is shown to the agent and the merchant. */
export async function investigate(disputeId: string, trigger: string | null = null): Promise<Decision> {
  const paypal = provider();
  const calls: ToolCall[] = [];
  let decision: z.infer<typeof DecisionSchema> | null = null;
  let assessment: Assessment | null = null;
  let rejections = 0;

  // Wraps a tool body so every call is traced and errors go back to Claude as text.
  const traced = <T>(name: string, fn: (input: T) => Promise<unknown>) => {
    return async (input: T) => {
      const entry: ToolCall = { tool: name, input, ok: true, at: new Date().toISOString() };
      calls.push(entry);
      await updateCase(disputeId, (c) => ({ ...c, toolCalls: [...calls] }));
      try {
        return JSON.stringify(await fn(input));
      } catch (err) {
        entry.ok = false;
        entry.error = err instanceof Error ? err.message : String(err);
        await updateCase(disputeId, (c) => ({ ...c, toolCalls: [...calls] }));
        return JSON.stringify({ error: entry.error });
      }
    };
  };

  const tools = [
    betaZodTool({
      name: "get_case_file",
      description:
        "The sourced case file for this dispute: facts with IDs to cite, the calibrated win estimate and the factors behind it, the break-even win probability, missing evidence, contradictions, and the actions PayPal allows right now. Call this first.",
      inputSchema: z.object({}),
      run: traced("get_case_file", async () => {
        const a = await assess(disputeId);
        return {
          ...caseFileForAgent(a.caseFile),
          calibrated_estimate: {
            win_probability: Number(a.score.p.toFixed(3)),
            model: a.model.name,
            starting_odds: Number(a.score.baseP.toFixed(3)),
            factors: a.score.factors.map((f) => ({ factor: f.label, points: Math.round(f.points), facts: f.facts })),
          },
          economics: {
            break_even_win_probability: Number(a.ev.breakEven.toFixed(3)),
            refund_cost: Number(a.ev.refundCost.toFixed(2)),
            fight_cost_on_average: Number(a.ev.fightCost.toFixed(2)),
            dispute_fee: a.ev.fee,
            fee_charged: a.ev.feeWhen === "always" ? "on every fight" : "only when the fight is lost",
            return_recovery: Number(a.ev.recovery.toFixed(2)),
          },
          missing_evidence: a.checklist.items
            .filter((i) => i.status === "missing" || i.status === "not_collectable")
            .map((i) => ({ item: i.label, collectable: i.status === "missing", note: i.detail, adds_points: i.gainPts ? Math.round(i.gainPts) : undefined })),
          contradictions: a.contradictions.map((c) => ({ severity: c.severity, title: c.title, detail: c.detail, facts: c.facts })),
          paypal_allows_now: {
            submit_evidence: a.permissions.FIGHT,
            accept_claim: a.permissions.ACCEPT,
            message_buyer: a.permissions.MESSAGE,
          },
        };
      }),
    }),
    betaZodTool({
      name: "get_dispute",
      description: "Get full PayPal dispute details: reason, amount, deadline, disputed transactions and buyer/seller messages.",
      inputSchema: z.object({ dispute_id: z.string() }),
      run: traced("get_dispute", ({ dispute_id }: { dispute_id: string }) => paypal.getDispute(dispute_id)),
    }),
    betaZodTool({
      name: "get_capture",
      description: "Get a PayPal payment capture by ID (the dispute's seller_transaction_id). Includes the related order ID and seller protection status.",
      inputSchema: z.object({ capture_id: z.string() }),
      run: traced("get_capture", ({ capture_id }: { capture_id: string }) => paypal.getCapture(capture_id)),
    }),
    betaZodTool({
      name: "get_order",
      description: "Get a PayPal checkout order: payer, items, shipping address and shipment trackers.",
      inputSchema: z.object({ order_id: z.string() }),
      run: traced("get_order", ({ order_id }: { order_id: string }) => paypal.getOrder(order_id)),
    }),
    betaZodTool({
      name: "search_transaction",
      description: "Look up a transaction in PayPal Transaction Search for payer verification status, payer email and shipping info.",
      inputSchema: z.object({
        transaction_id: z.string(),
        around_date: z.string().describe("ISO date near the transaction, e.g. the capture create_time"),
      }),
      run: traced("search_transaction", ({ transaction_id, around_date }: { transaction_id: string; around_date: string }) =>
        paypal.searchTransactions(transaction_id, around_date),
      ),
    }),
    betaZodTool({
      name: "check_carrier_status",
      description:
        "Get the carrier's delivery status for a tracking number: delivered or not, when, where, signature, and the scan history. Pass the carrier if the order names it.",
      inputSchema: z.object({
        tracking_number: z.string(),
        carrier: z.string().optional().describe("Carrier code such as USPS, UPS, FEDEX or DHL, if known"),
      }),
      run: traced("check_carrier_status", ({ tracking_number, carrier }: { tracking_number: string; carrier?: string }) =>
        trackShipment(tracking_number, carrier, paypal.mode),
      ),
    }),
    betaZodTool({
      name: "list_merchant_disputes",
      description: "List this merchant's open and resolved disputes, to spot repeated complaints about the same product.",
      inputSchema: z.object({}),
      run: traced("list_merchant_disputes", () => paypal.listDisputes()),
    }),
    betaZodTool({
      name: "get_merchant_policy",
      description:
        "Get the merchant's name, refund policy, the amount at or below which disputes should simply be refunded, the dispute fee charged when a fight is lost, and the merchant's own rules.",
      inputSchema: z.object({}),
      run: traced("get_merchant_policy", async () => {
        const s = await getSettings();
        return {
          merchant: s.merchantName,
          refund_policy: s.refundPolicy,
          auto_accept_threshold_usd: s.autoAcceptThreshold,
          dispute_fee_if_lost_usd: s.disputeFee,
          rules: s.requireDeliveryProof
            ? ["Never fight a 'not received' claim unless the carrier confirms delivery to the buyer's shipping address."]
            : [],
        };
      }),
    }),
    betaZodTool({
      name: "record_decision",
      description: "Record your final recommendation. Call once, after investigating; it is checked against the case file.",
      inputSchema: DecisionSchema,
      run: async (input) => {
        const fresh = await assess(disputeId);
        const check = verifyDecision(input, fresh.caseFile, await getSettings());
        const blocking = check.problems.filter((p) => p.level === "block");
        if (blocking.length && rejections < MAX_REJECTIONS) {
          rejections += 1;
          calls.push({ tool: "record_decision", input: { action: input.action }, ok: false, at: new Date().toISOString(), error: blocking.map((p) => p.text).join(" ") });
          await updateCase(disputeId, (c) => ({ ...c, toolCalls: [...calls] }));
          return `Rejected by the integrity check:\n${blocking.map((p) => `- ${p.text}`).join("\n")}\nFix these (cite only fact IDs from get_case_file, or change the decision) and call record_decision again.`;
        }
        decision = input;
        assessment = fresh;
        calls.push({ tool: "record_decision", input: { action: input.action }, ok: true, at: new Date().toISOString() });
        return "Decision recorded. Reply with one short sentence and stop.";
      },
    }),
  ];

  await updateCase(disputeId, (c) => ({ ...c, status: "investigating", error: null, toolCalls: [], decision: null, trigger }));

  try {
    const client = new Anthropic();
    const final = await client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "high" },
      // On a safety decline, the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_iterations: 20,
      system: SYSTEM,
      tools,
      messages: [
        {
          role: "user",
          content:
            `Investigate PayPal dispute ${disputeId} and record your decision. Current time: ${new Date().toISOString()}.` +
            (trigger ? `\n\nThis is a follow-up investigation: ${trigger} Read the latest messages and update your decision.` : ""),
        },
      ],
    });

    if (final.stop_reason === "refusal") throw new Error("The model declined to handle this dispute.");
    if (!decision) throw new Error(`Agent finished without recording a decision (stop_reason: ${final.stop_reason}).`);

    // The calibrated estimate is the official one; the agent's read is kept beside it.
    const raw = decision as z.infer<typeof DecisionSchema>;
    const a: Assessment = (assessment as Assessment | null) ?? (await assess(disputeId));
    const recorded: Decision = { ...raw, win_probability: a.score.p, agent_estimate: raw.win_probability };
    const at = new Date().toISOString();
    await updateCase(disputeId, (c) => ({
      ...c,
      status: "awaiting_approval",
      decision: recorded,
      toolCalls: calls,
      investigatedAt: at,
      prediction: { p: a.score.p, group: a.score.group, features: a.score.active, model: a.score.model, agentEstimate: raw.win_probability, at },
    }));
    return recorded;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateCase(disputeId, (c) => ({ ...c, status: "failed", error: message, toolCalls: calls }));
    throw err;
  }
}
