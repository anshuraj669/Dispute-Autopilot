// One call that answers "where does this dispute stand?": the sourced case
// file, the calibrated win estimate and its factors, the money, the evidence
// gaps, contradictions, what PayPal allows right now, and whether the agent's
// decision still holds up against the records.

import { buildCaseFile, type CaseFile } from "./casefile";
import { buildChecklist, COLLECTABLE, type Checklist, type CollectKey } from "./evidence";
import { permissions, type Permissions } from "./guard";
import { assumptions, expectedValue, type ExpectedValue } from "./impact";
import { findContradictions, verifyDecision, type Contradiction, type Verification } from "./integrity";
import { learnedModel } from "./learning";
import { score, type Score } from "./score";
import { getSettings } from "./settings";
import { getCase } from "./store";
import type { CaseRecord, DisputeSummary } from "./types";

export type Assessment = {
  caseFile: CaseFile;
  score: Score;
  ev: ExpectedValue;
  checklist: Checklist;
  contradictions: Contradiction[];
  permissions: Permissions;
  verification: Verification | null;
  /** Set when something changed since the agent decided. */
  stale: string | null;
  model: { name: string; usingLearned: boolean; n: number; brier: number | null };
  record: CaseRecord | null;
};

export async function assess(disputeId: string, disputes?: DisputeSummary[]): Promise<Assessment> {
  const [cf, { weights, model, report }, settings, record] = await Promise.all([
    buildCaseFile(disputeId, disputes),
    learnedModel(disputes),
    getSettings(),
    getCase(disputeId),
  ]);
  const a = assumptions(settings);
  const s = score(cf, weights, model);
  const decision = record?.decision ?? null;

  let stale: string | null = null;
  if (decision && record?.investigatedAt && record.status === "awaiting_approval") {
    const since = Date.parse(record.investigatedAt);
    const added = cf.collected.filter((c) => Date.parse(c.at) > since);
    const said = cf.messages.filter((m) => Date.parse(m.at) > since && m.by === "BUYER");
    if (added.length) stale = `You added evidence (${added.map((c) => COLLECTABLE[c.key as CollectKey]?.label.toLowerCase() ?? c.key).join(", ")}) after the agent decided.`;
    else if (said.length) stale = "The buyer wrote after the agent decided.";
  }

  return {
    caseFile: cf,
    score: s,
    ev: expectedValue(cf.amount, s.p, a, cf.reason),
    checklist: buildChecklist(cf, s, weights, a),
    contradictions: findContradictions(cf),
    permissions: permissions(cf.dispute),
    verification: decision ? verifyDecision(decision, cf, settings) : null,
    stale,
    model: { name: model, usingLearned: report.usingLearned, n: report.n, brier: report.usingLearned ? report.holdout.brier.learned : report.holdout.brier.prior },
    record,
  };
}
