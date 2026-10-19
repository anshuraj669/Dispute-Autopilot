// What PayPal allows on a dispute right now. The dispute record lists the
// actions it currently accepts as HATEOAS links (provide_evidence,
// accept_claim, send_message, ...), which reflect the lifecycle stage, the
// status and the app's API permissions. Every action is checked against
// these before it is attempted, never assumed.

import { humanStatus } from "./format";

export type Action = "FIGHT" | "ACCEPT" | "MESSAGE";

export type Permission = { allowed: boolean; why: string };

export type Permissions = Record<Action, Permission> & {
  /** Link rels PayPal offered, for display. */
  links: string[];
  stage: string;
  status: string;
  deadlinePassed: boolean;
};

const REL: Record<Action, string> = { FIGHT: "provide_evidence", ACCEPT: "accept_claim", MESSAGE: "send_message" };

const VERB: Record<Action, string> = { FIGHT: "submit evidence", ACCEPT: "accept the claim", MESSAGE: "message the buyer" };

export function permissions(dispute: any, now = Date.now()): Permissions {
  const links: string[] = (dispute.links ?? []).map((l: any) => l.rel).filter((r: string) => r && r !== "self");
  const status: string = dispute.status ?? "UNKNOWN";
  const stage: string = dispute.dispute_life_cycle_stage ?? "";
  const due = dispute.seller_response_due_date ? Date.parse(dispute.seller_response_due_date) : null;
  const deadlinePassed = due !== null && due < now;

  const check = (action: Action): Permission => {
    if (status === "RESOLVED") return { allowed: false, why: "The dispute is closed." };
    if (action !== "MESSAGE" && deadlinePassed) {
      return { allowed: false, why: `The response deadline passed on ${new Date(due!).toLocaleDateString("en-US")}.` };
    }
    if (!links.includes(REL[action])) {
      const where = `${humanStatus(status)}${stage ? `, ${humanStatus(stage)} stage` : ""}`;
      return {
        allowed: false,
        why: links.length
          ? `PayPal doesn't offer "${VERB[action]}" on this dispute right now (${where}).`
          : `PayPal lists no actions for this dispute (${where}); check the app's dispute permissions.`,
      };
    }
    return { allowed: true, why: `PayPal accepts this now (${humanStatus(stage || status)}).` };
  };

  return { FIGHT: check("FIGHT"), ACCEPT: check("ACCEPT"), MESSAGE: check("MESSAGE"), links, stage, status, deadlinePassed };
}

/** Throws with PayPal's reason when the action isn't available. */
export function assertAllowed(dispute: any, action: Action) {
  const p = permissions(dispute)[action];
  if (!p.allowed) throw new Error(`Can't ${VERB[action]}: ${p.why}`);
}
