/**
 * PaytmResolve AI — Ops Agent (AI Payment Operations Teammate)
 * ---------------------------------------------------------------------------
 * The orchestrator. Implements the full operational loop:
 *
 *     UNDERSTAND -> INVESTIGATE -> DECIDE -> ACT -> VERIFY
 *
 * Zero LLM financial authority: this file may optionally call a real LLM
 * (Anthropic) to help UNDERSTAND free-text/voice/Hinglish input, but the
 * LLM's output is only ever used to *guess a transaction id* — it is
 * validated against the mock database before it is trusted, and it is
 * NEVER allowed to decide a diagnosis, a risk score, or an action. Every
 * one of those still flows through decisionEngine.ts, riskEngine.ts, and
 * actionGate.ts exactly as it would if the LLM were absent entirely.
 *
 * LIVE-PITCH SAFETY: if `ANTHROPIC_API_KEY` is unset, or the API call
 * fails/times out/returns garbage, this agent transparently falls back to
 * deterministic regex + keyword parsing. There is no code path in this
 * file that throws out to the caller — investigate() always resolves to a
 * usable OpsAgentOutput, even on total LLM failure or a missing
 * transaction.
 * ---------------------------------------------------------------------------
 */

import type {
  ActionDecision,
  ActionRequest,
  AgentDiagnosisLabel,
  AuditTrailEvent,
  CareEscalation,
  CareEscalationCategory,
  DecisionEngineResult,
  OcrExtractionResult,
  ProposedActionType,
  RiskEvaluationResult,
  SupportCase,
  SupportCasePriority,
  Transaction,
} from '../types/index.js';
import {
  appendAuditEvent,
  addSupportCase,
  generateSupportCaseId,
  getAuditTrail,
  getBeneficiary,
  getCustomer,
  getTransaction,
  listBeneficiariesForCustomer,
  listSupportCases,
  listTransactionsBySender,
  reserveOperationId,
  updateCustomer,
  updateSupportCase,
  updateTransaction,
} from '../mockDb/transactions.js';
import { diagnoseTransaction } from '../engine/decisionEngine.js';
import { evaluateRiskForTransaction } from '../engine/riskEngine.js';
import { detectOverridePhrase, evaluateAction } from '../engine/actionGate.js';
import { startMonitoring } from '../engine/monitoringEngine.js';
import {
  getBankStatusTool,
  getBeneficiaryProfileTool,
  getReceiverStatusTool,
  getRefundStatusTool,
  getTransactionTool,
  getUpiStatusTool,
} from './tools.js';
import type { AgentToolCallRecord } from '../types/index.js';

// ============================================================================
// DEFAULTS
// ============================================================================

/** This hackathon build seeds exactly one customer. Complaints that don't
 * name a transaction fall back to that customer's most recent open one. */
const DEFAULT_SENDER_ID = 'USR_SELF';

const LLM_TIMEOUT_MS = 6_000;
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-haiku-latest';

// ============================================================================
// PUBLIC CONTRACTS
// ============================================================================

export interface OpsAgentInput {
  /** Free text — English, Hindi, or Hinglish. Voice input arrives here
   * already speech-to-text transcribed; the backend treats it identically
   * to typed text, per Directive 28 ("the backend should not care whether
   * the input came from voice, text, or screenshot"). */
  message?: string;
  /** Explicit transaction id, if the caller already knows it. */
  transaction_id?: string;
  /** A previously-parsed receipt, if this complaint originated from an upload. */
  ocr?: OcrExtractionResult;
  /** Sender to fall back to a "most recent open transaction" search for. */
  sender_id?: string;
}

export interface OpsAgentOutput {
  transaction_id: string | null;
  diagnosis: AgentDiagnosisLabel;
  confidence: number;
  /** The "what I found" half of the narrative — what was checked and what
   * it means. Sent as the AI's first chat message, right away. */
  narrative: string;
  /** The "what I did about it" half — null when there's genuinely nothing
   * further to report (e.g. the transaction was already healthy, so the
   * diagnosis sentence already said everything there is to say). Sent as a
   * second chat message a short beat after the first, so a real recovery
   * action reads as something that actually took a moment, not an
   * instant magic fix. */
  resolution_narrative: string | null;
  tool_calls: AgentToolCallRecord[];
  audit_trail: AuditTrailEvent[];
  decision: DecisionEngineResult | null;
  risk: RiskEvaluationResult | null;
  action_decision: ActionDecision | null;
  support_case: SupportCase | null;
  final_transaction: Transaction | null;
  recommended_action: ProposedActionType | null;
  used_llm: boolean;
  intent_hint: string | null;
  /** Non-null exactly when diagnosis === 'ESCALATED_TO_CUSTOMER_CARE' — a
   * qualitative/high-liability/legal case the AI halted on and handed
   * straight to Customer Care instead of attempting any automated fix. */
  care_escalation: CareEscalation | null;
}

// ============================================================================
// STEP 0 helpers — ID generation for artifacts opsAgent creates
// ============================================================================

function generateRefundId(): string {
  const rand = Math.floor(10000 + Math.random() * 89999);
  return `RFD-${rand}`;
}

function generateActionId(): string {
  const rand = Math.floor(10000 + Math.random() * 89999);
  return `ACT-${rand}`;
}

// ============================================================================
// STEP 1: UNDERSTAND — free-text / Hindi / Hinglish parsing
// ============================================================================

const TRANSACTION_ID_PATTERN = /TXN[_A-Z0-9]{2,}/i;

const INTENT_PATTERNS: Array<{ pattern: RegExp; intent: string }> = [
  { pattern: /paise\s*kat\s*gaye/i, intent: 'Customer reports money was deducted from their account.' },
  { pattern: /paisa\s*kat\s*gaya/i, intent: 'Customer reports money was deducted from their account.' },
  { pattern: /paisa\s*nahi\s*pahunch/i, intent: 'Customer reports the receiver never got the money.' },
  { pattern: /paise\s*nahi\s*mile/i, intent: 'Customer reports the receiver never got the money.' },
  { pattern: /refund\s*kab/i, intent: 'Customer is asking when their refund will arrive.' },
  { pattern: /paise\s*wapas/i, intent: 'Customer is asking for their money back.' },
  { pattern: /transaction\s*fail/i, intent: 'Customer reports a failed transaction.' },
  { pattern: /money\s*(deducted|debited)/i, intent: 'Customer reports money was deducted from their account.' },
  { pattern: /not\s*received/i, intent: 'Customer reports the receiver never got the money.' },
  { pattern: /double\s*(charged|debited|paid)/i, intent: 'Customer suspects they were charged twice.' },
  { pattern: /same\s*payment\s*twice/i, intent: 'Customer suspects a duplicate payment.' },
  { pattern: /where\s*is\s*my\s*(refund|money)/i, intent: 'Customer is asking for a status update on their money.' },
];

export function detectIntentHint(text: string | undefined): string | null {
  if (!text) return null;
  const match = INTENT_PATTERNS.find((entry) => entry.pattern.test(text));
  return match?.intent ?? null;
}

export function extractTransactionIdFromText(text: string | undefined): string | null {
  if (!text) return null;
  const match = text.match(TRANSACTION_ID_PATTERN);
  if (!match) return null;
  const candidate = match[0].toUpperCase();
  return getTransaction(candidate) ? candidate : null;
}

/** A flat demand for money back ("I need a refund", "give me my money
 * back", "paisa wapas karo") with no transaction id, amount, or named
 * recipient attached to it isn't actually ABOUT any one specific payment —
 * it's a generic ask. Used in two places: (1) to stop a stale
 * "active transaction" hint left over from a previous, unrelated
 * investigation from being silently trusted for a brand-new generic
 * complaint like this one (see resolveTargetTransactionId step 1 — this was
 * the actual bug: a vague "I need a refund, sent it to my friend" message
 * got matched to whatever transaction happened to still be active in the
 * chat, producing a confusing technical narrative about a payment the
 * customer never actually named), and (2) to give the honest "I only
 * refund a confirmed-stuck payment" reply instead of a raw lookup failure. */
export function isGenericRefundDemand(text: string | undefined): boolean {
  return /\brefund(s|ed|ing)?\b|money\s*back|paisa\s*wapas|paise\s*wapas/i.test(text ?? '');
}

// ----------------------------------------------------------------------------
// Deterministic amount / recipient-name matching.
//
// This is the fix for a real bug: previously, when a complaint named no
// transaction id and the LLM path was unavailable/unconfident, the agent
// fell back to "the sender's most recent still-open transaction" — which
// meant a complaint about a payment that was never actually made (wrong
// amount, wrong person) could get matched to a completely unrelated
// transaction and confidently "resolved". That is exactly the kind of
// preset, non-thinking behavior this app must never produce. Instead, we
// now require the message to actually match a real transaction on amount
// and/or recipient name before touching anything — and say so plainly
// when nothing matches.
// ----------------------------------------------------------------------------

const AMOUNT_PATTERNS: RegExp[] = [
  /(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d+)?)/i,
  /([\d,]+(?:\.\d+)?)\s?(?:rupees?|rs\.?|inr)\b/i,
];

export function extractAmountFromText(text: string | undefined): number | null {
  if (!text) return null;
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const numeric = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(numeric) && numeric > 0) return numeric;
    }
  }
  return null;
}

/** Returns beneficiary ids whose name plausibly appears in the free text
 * (matched word-by-word, case-insensitive, so "Sarvesh" matches nothing if
 * no beneficiary is actually named Sarvesh — it must never guess). */
export function findMentionedBeneficiaryIds(text: string | undefined, senderId: string): string[] {
  if (!text) return [];
  const lowerText = text.toLowerCase();
  const beneficiaries = listBeneficiariesForCustomer(senderId);
  const matches: string[] = [];
  for (const beneficiary of beneficiaries) {
    const nameTokens = beneficiary.name
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3);
    const isMentioned = nameTokens.some((token) => new RegExp(`\\b${token}\\b`).test(lowerText));
    if (isMentioned) matches.push(beneficiary.beneficiary_id);
  }
  return matches;
}

/**
 * Tries to find the one real transaction the free-text complaint is
 * actually describing, using the amount and/or recipient name it mentions.
 * Returns null (never a guess) when the evidence doesn't converge on
 * exactly one transaction.
 */
function matchTransactionFromText(
  text: string | undefined,
  senderId: string,
): { transactionId: string | null; amount: number | null; beneficiaryIds: string[] } {
  const amount = extractAmountFromText(text);
  const beneficiaryIds = findMentionedBeneficiaryIds(text, senderId);

  if (amount === null && beneficiaryIds.length === 0) {
    return { transactionId: null, amount, beneficiaryIds };
  }

  const candidates = listTransactionsBySender(senderId).filter((t) => {
    const amountMatches = amount === null || t.amount === amount;
    const beneficiaryMatches = beneficiaryIds.length === 0 || beneficiaryIds.includes(t.receiver_id);
    return amountMatches && beneficiaryMatches;
  });

  // Only accept an unambiguous single match. Anything else (zero matches,
  // or several candidates the message can't disambiguate) is reported
  // honestly rather than guessed.
  if (candidates.length === 1) {
    return { transactionId: candidates[0].transaction_id, amount, beneficiaryIds };
  }

  return { transactionId: null, amount, beneficiaryIds };
}

/**
 * Best-effort LLM-assisted extraction. Returns null on ANY problem —
 * missing key, network failure, timeout, malformed response, or a
 * hallucinated transaction id that doesn't actually exist in our database.
 * This function is never awaited without a surrounding try/catch by its
 * caller, and it never throws itself.
 */
async function understandWithLLM(message: string): Promise<{ transaction_id: string | null; intent_summary: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content:
              'A customer of a payments app sent this message (it may be English, Hindi, or Hinglish). ' +
              'Extract ONLY a transaction id if one is explicitly present (it looks like "TXN..."), and a one-sentence ' +
              'English summary of what they are reporting. Respond with STRICT JSON only, no prose, no markdown fences, ' +
              'in exactly this shape: {"transaction_id": "TXN..." or null, "intent_summary": "..."}.\n\n' +
              `Customer message: """${message}"""`,
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const textBlock = payload.content?.find((block) => block.type === 'text')?.text;
    if (!textBlock) return null;

    const jsonMatch = textBlock.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as { transaction_id?: unknown; intent_summary?: unknown };
    const rawId = typeof parsed.transaction_id === 'string' ? parsed.transaction_id.toUpperCase() : null;
    // Never trust the LLM's transaction id at face value — validate it
    // against the real database before it can steer anything downstream.
    const validatedId = rawId && getTransaction(rawId) ? rawId : null;
    const intentSummary =
      typeof parsed.intent_summary === 'string' && parsed.intent_summary.trim().length > 0
        ? parsed.intent_summary.trim()
        : 'Customer reported a payment issue.';

    return { transaction_id: validatedId, intent_summary: intentSummary };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface ResolvedTarget {
  transactionId: string | null;
  usedLlm: boolean;
  intentHint: string | null;
  /** Only populated when transactionId is null, to help build an honest,
   * specific "couldn't find it" reply instead of a generic one. */
  noMatchContext?: { amountMentioned: number | null; beneficiaryMentioned: boolean };
}

async function resolveTargetTransactionId(input: OpsAgentInput): Promise<ResolvedTarget> {
  const senderIdForHintCheck = input.sender_id ?? DEFAULT_SENDER_ID;

  // 1. An explicit id is normally trusted outright — but it is only ever a
  // *hint* carried over from the UI's "active transaction" context bar
  // (e.g. the customer investigated TXN_X, then typed a brand-new,
  // unrelated complaint while that context bar was still showing). If the
  // new message names a specific amount or beneficiary that contradicts
  // the hinted transaction, that hint is stale and must NOT silently
  // override what the customer is actually describing right now — this is
  // exactly the "preset answer" bug: answering about the wrong payment
  // with total confidence instead of listening to the new message.
  if (input.transaction_id) {
    const hinted = getTransaction(input.transaction_id);
    if (hinted) {
      const mentionedAmount = extractAmountFromText(input.message);
      const mentionedBeneficiaryIds = findMentionedBeneficiaryIds(input.message, senderIdForHintCheck);
      const amountConflicts = mentionedAmount !== null && hinted.amount !== mentionedAmount;
      const beneficiaryConflicts = mentionedBeneficiaryIds.length > 0 && !mentionedBeneficiaryIds.includes(hinted.receiver_id);
      // A flat, generic "I need a refund" / "send my money back" with no
      // amount or named recipient attached isn't actually about whatever
      // transaction happens to still be sitting in the chat's "active
      // transaction" context (e.g. left over from investigating an earlier,
      // unrelated payment in the same open chat session) — it's a brand-new,
      // unspecific ask. Trusting the stale hint here is exactly the bug a
      // customer reported: a vague refund demand got silently matched to an
      // unrelated transaction and answered with a confusing, technically
      // real but contextually wrong narrative. Skipping the hint in this
      // case lets it fall through to steps 3-5, which then honestly say
      // "I need the transaction id, or the amount and who it was sent to"
      // instead of guessing.
      const isVagueGenericAsk =
        isGenericRefundDemand(input.message) && mentionedAmount === null && mentionedBeneficiaryIds.length === 0;
      if (!amountConflicts && !beneficiaryConflicts && !isVagueGenericAsk) {
        return { transactionId: input.transaction_id, usedLlm: false, intentHint: detectIntentHint(input.message) };
      }
      // Fall through deliberately: don't return here. Let steps 3-5 below
      // find (or honestly fail to find) the transaction the new message
      // actually describes, instead of trusting a hint that no longer fits.
    }
  }

  // 2. A previously-parsed receipt naming a real transaction.
  if (input.ocr?.found_transaction_id && getTransaction(input.ocr.found_transaction_id)) {
    return {
      transactionId: input.ocr.found_transaction_id,
      usedLlm: false,
      intentHint: 'Customer uploaded a payment receipt for this transaction.',
    };
  }

  const intentHint = detectIntentHint(input.message);
  const senderId = input.sender_id ?? DEFAULT_SENDER_ID;

  // 3. Deterministic regex extraction of an explicit transaction id.
  const regexId = extractTransactionIdFromText(input.message);
  if (regexId) {
    return { transactionId: regexId, usedLlm: false, intentHint };
  }

  // 4. Deterministic amount / recipient-name matching against the sender's
  // real transactions. This never guesses: it only returns an id when the
  // message's own details (amount and/or a named beneficiary) converge on
  // exactly one real transaction.
  const matched = matchTransactionFromText(input.message, senderId);
  if (matched.transactionId) {
    return { transactionId: matched.transactionId, usedLlm: false, intentHint };
  }

  // 5. Best-effort LLM assist (never trusted blindly; validated internally
  // against the real database before it can steer anything downstream).
  if (input.message) {
    const llmResult = await understandWithLLM(input.message).catch(() => null);
    if (llmResult?.transaction_id) {
      return { transactionId: llmResult.transaction_id, usedLlm: true, intentHint: llmResult.intent_summary };
    }
  }

  // Nothing converged on a real transaction. Deliberately no fallback to
  // "the sender's most recent open transaction" here — matching an
  // unrelated transaction to a complaint that doesn't actually describe it
  // is worse than admitting we couldn't find it.
  return {
    transactionId: null,
    usedLlm: false,
    intentHint,
    noMatchContext: {
      amountMentioned: matched.amount,
      beneficiaryMentioned: matched.beneficiaryIds.length > 0,
    },
  };
}

// ============================================================================
// STEP 2: INVESTIGATE — sequential tool calls, every one audited
// ============================================================================

function runInvestigationTools(transactionId: string): AgentToolCallRecord[] {
  const calls: AgentToolCallRecord[] = [
    getTransactionTool({ transaction_id: transactionId }),
    getBankStatusTool({ transaction_id: transactionId }),
    getUpiStatusTool({ transaction_id: transactionId }),
    getReceiverStatusTool({ transaction_id: transactionId }),
    getRefundStatusTool({ transaction_id: transactionId }),
  ];

  const transaction = getTransaction(transactionId);
  if (transaction) {
    calls.push(getBeneficiaryProfileTool({ beneficiary_id: transaction.receiver_id }));
  }

  for (const call of calls) {
    appendAuditEvent(
      transactionId,
      'AI',
      'TOOL_CALL',
      `Called tool "${call.tool_name}" with ${JSON.stringify(call.arguments)}.`,
      { call_id: call.call_id, result: call.result },
    );
  }

  return calls;
}

// ============================================================================
// STEP 3: DECIDE — deterministic diagnosis + risk context
// ============================================================================

/** A friendly, human-readable status word — matches exactly how the
 * frontend's History screen labels each outcome (see rowOutcomeFor() /
 * the status label in PaymentApp.tsx), instead of the raw PaymentStatus
 * enum the customer has never actually seen anywhere in the app. */
function friendlyStatusLabel(status: Transaction['payment_status']): string {
  switch (status) {
    case 'SUCCESS':
      return 'Successful';
    case 'REFUNDED':
      return 'Refunded to you';
    case 'BLOCKED':
      return 'Blocked';
    case 'FAILED':
    case 'UNKNOWN':
      return 'Failed';
    default:
      return 'Pending';
  }
}

/** The transactions worth mentioning back to the customer in a chat
 * message — kept in sync with what the frontend's Payment History screen
 * actually shows them (see curateHistory() in PaymentApp.tsx), instead of
 * a raw "most recent N by timestamp" query. That mismatch was a real bug:
 * this app's demo/test data leaves a lot of PENDING scenario transactions
 * lying around, so a plain recency query kept surfacing transaction ids
 * the customer could never find anywhere in their own History — a "for
 * reference" list that didn't actually reference anything they could see. */
function recentTransactionsForReference(senderId: string, limit = 3): Transaction[] {
  const byRecency = [...listTransactionsBySender(senderId)].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const meaningful = byRecency.filter((t) => t.payment_status !== 'PENDING' && t.payment_status !== 'INITIATED');
  const pool = meaningful.length > 0 ? meaningful : byRecency;
  return pool.slice(0, limit);
}

/** Describes a transaction the same way the customer would recognize it
 * from History — who it went to and its friendly status — rather than a
 * bare transaction id and enum value that mean nothing to them at a
 * glance. */
function describeTransactionForReference(t: Transaction): string {
  const name = getBeneficiary(t.receiver_id)?.name ?? t.receiver_id;
  return `₹${t.amount.toLocaleString('en-IN')} to ${name} (${friendlyStatusLabel(t.payment_status)}, ${t.transaction_id})`;
}

function mapDecisionToDiagnosis(transaction: Transaction, decision: DecisionEngineResult): AgentDiagnosisLabel {
  switch (decision.decision_code) {
    case 'REVERSAL_WORKFLOW':
      return transaction.upi_status === 'TIMEOUT' ? 'NETWORK_TIMEOUT_POST_DEBIT' : 'DEBIT_WITHOUT_CREDIT';
    case 'HUMAN_ESCALATION':
      return 'CONFLICTING_STATE_UNSAFE';
    case 'MONITOR_AND_POLL':
      return 'SETTLEMENT_PENDING';
    case 'DUPLICATE_BLOCKED':
      return 'POSSIBLE_DUPLICATE';
    case 'POLICY_BLOCKED':
      return 'POLICY_BLOCKED';
    case 'ALREADY_RESOLVED':
      return transaction.refund_status === 'COMPLETED' ? 'REFUND_COMPLETE' : 'TRANSACTION_HEALTHY';
    case 'SAFE_TO_PROCEED':
    default:
      return 'TRANSACTION_HEALTHY';
  }
}

// ============================================================================
// STEP 4: ACT — refund execution / monitoring / human escalation
// ============================================================================

function executeRefundWorkflow(transaction: Transaction): Transaction {
  const refundId = generateRefundId();

  appendAuditEvent(
    transaction.transaction_id,
    'AI',
    'ACTION_EXECUTED',
    `Refund initiated. Refund ID ${refundId}.`,
    { refund_id: refundId },
  );

  updateTransaction(transaction.transaction_id, {
    refund_status: 'PROCESSING',
    payment_status: 'REFUND_PENDING',
  });

  appendAuditEvent(
    transaction.transaction_id,
    'SYSTEM',
    'MONITORING_CHECK',
    'Monitoring refund settlement with the bank.',
  );

  // Simulation can accelerate time (Directive 24) — settle synchronously
  // within this same request rather than requiring a real poll loop.
  const settled = updateTransaction(transaction.transaction_id, {
    refund_status: 'COMPLETED',
    payment_status: 'REFUNDED',
    bank_status: 'REVERSED',
    is_closed: true,
  })!;

  // The refund narrative says "₹X has been restored" — that has to be
  // literally true, not just a status label. Only credit back money that
  // was actually debited from the bank in the first place (this refund
  // path only ever runs for a DEBITED-but-not-credited transaction), and
  // guard against crediting twice if this is somehow re-run.
  if (transaction.bank_status === 'DEBITED') {
    const customer = getCustomer(transaction.sender_id);
    if (customer) {
      updateCustomer(transaction.sender_id, { balance: customer.balance + transaction.amount });
    }
  }

  appendAuditEvent(
    settled.transaction_id,
    'SYSTEM',
    'VERIFICATION',
    `Verified refund_status=COMPLETED. ₹${settled.amount.toLocaleString('en-IN')} restored to the sender.`,
  );

  appendAuditEvent(settled.transaction_id, 'AI', 'RESOLUTION', 'Transaction marked RESOLVED.');

  return settled;
}

function findOpenCaseForTransaction(transactionId: string): SupportCase | undefined {
  return listSupportCases().find(
    (c) => c.transaction_id === transactionId && c.status !== 'RESOLVED' && c.status !== 'CLOSED',
  );
}

function priorityFromRisk(risk: RiskEvaluationResult | null): SupportCasePriority {
  if (!risk) return 'HIGH';
  if (risk.risk_level === 'CRITICAL') return 'CRITICAL';
  if (risk.risk_level === 'HIGH') return 'HIGH';
  return 'MEDIUM';
}

function escalateToHuman(
  transaction: Transaction,
  reason: string,
  auditTrailSoFar: AuditTrailEvent[],
  toolCalls: AgentToolCallRecord[],
  risk: RiskEvaluationResult | null,
): SupportCase {
  const existing = findOpenCaseForTransaction(transaction.transaction_id);

  const evidence: Record<string, unknown> = {
    bank_status: transaction.bank_status,
    upi_status: transaction.upi_status,
    receiver_status: transaction.receiver_status,
    refund_status: transaction.refund_status,
    payment_status: transaction.payment_status,
    amount: transaction.amount,
    risk_score: risk?.risk_score ?? null,
    risk_level: risk?.risk_level ?? null,
    tool_calls: toolCalls.map((call) => ({ tool_name: call.tool_name, result: call.result })),
  };

  if (existing) {
    const updated = updateSupportCase(existing.case_id, {
      status: 'ESCALATED',
      diagnosis: reason,
      evidence,
      investigation_timeline: [...existing.investigation_timeline, ...auditTrailSoFar],
    })!;
    appendAuditEvent(transaction.transaction_id, 'AI', 'ESCALATION', `Re-escalated existing case ${updated.case_id}.`, {
      case_id: updated.case_id,
    });
    return updated;
  }

  const caseId = generateSupportCaseId();
  const newCase: SupportCase = {
    case_id: caseId,
    transaction_id: transaction.transaction_id,
    customer_id: transaction.sender_id,
    reason,
    priority: priorityFromRisk(risk),
    investigation_timeline: auditTrailSoFar,
    evidence,
    diagnosis: reason,
    actions_taken: ['Automatic recovery was not possible; escalated to human operations with full evidence trace.'],
    recommended_action: 'Human reconciliation required.',
    customer_instruction: 'Do not retry this payment while the case is open.',
    status: 'ESCALATED',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  addSupportCase(newCase);

  appendAuditEvent(transaction.transaction_id, 'AI', 'ESCALATION', `Created support case ${caseId}.`, {
    case_id: caseId,
  });

  return newCase;
}

// ============================================================================
// STEP 5: VERIFY + narrative synthesis
// ============================================================================

function computeConfidence(decision: DecisionEngineResult, gateResult: ActionDecision['result'] | null): number {
  if (decision.decision_code === 'ALREADY_RESOLVED' || decision.decision_code === 'SAFE_TO_PROCEED') return 0.98;
  if (decision.decision_code === 'REVERSAL_WORKFLOW') return gateResult === 'ALLOW' ? 0.95 : 0.75;
  if (decision.decision_code === 'MONITOR_AND_POLL') return 0.8;
  if (decision.decision_code === 'DUPLICATE_BLOCKED') return 0.85;
  if (decision.decision_code === 'POLICY_BLOCKED') return 0.98;
  if (decision.decision_code === 'HUMAN_ESCALATION') return 0.55;
  return 0.5;
}

interface NarrativeParts {
  /** The diagnosis: what was checked and what it means. Sent immediately. */
  diagnosis: string;
  /** What was (or will be) done about it. Null when the diagnosis sentence
   * already says everything there is to say (a healthy transaction) — in
   * that case there's no separate "and here's what I did" message. */
  resolution: string | null;
}

function synthesizeNarrative(params: {
  transaction: Transaction;
  decision: DecisionEngineResult;
  gate: ActionDecision | null;
  supportCase: SupportCase | null;
  finalTransaction: Transaction | null;
  intentHint: string | null;
}): NarrativeParts {
  const { transaction, decision, gate, supportCase, finalTransaction, intentHint } = params;
  const diagnosisSentences: string[] = [];

  // These two codes mean "nothing was ever actually wrong" — decision.reason
  // is the VERDICT ("already settled, no action needed"), not a description
  // of a problem. Bundling it straight onto the same sentence as the raw
  // status check made one message read as "here's an issue... which is
  // already resolved" in a single breath — confusing, since it sounds like
  // it's narrating a problem and its fix in the same beat. It's held back
  // here and sent as its own, second message instead (see resolutionSentences
  // below), the same two-beat "here's what I found" / "here's the outcome"
  // pattern every other diagnosis already uses.
  const isAlreadyHealthy = decision.decision_code === 'ALREADY_RESOLVED' || decision.decision_code === 'SAFE_TO_PROCEED';

  if (intentHint) {
    diagnosisSentences.push(intentHint);
  }

  if (decision.decision_code === 'POLICY_BLOCKED') {
    // Never the generic "bank status is NOT_DEBITED, UPI status is
    // NOT_INITIATED…" line here — nothing happened at the bank at all, so
    // that sentence would just be four ways of saying "nothing," and reads
    // as evasive next to a customer asking "why was I blocked?" Lead with
    // the plain truth instead: this was a deliberate stop, not a glitch,
    // and no money ever moved.
    diagnosisSentences.push(
      `This payment never reached the bank — no money was debited from your account. It was stopped upfront by our risk and compliance checks, not by a technical error, so there's nothing here for me to retry or fix automatically.`,
    );
    diagnosisSentences.push(decision.reason);
  } else {
    diagnosisSentences.push(
      `I checked transaction ${transaction.transaction_id}: bank status is ${transaction.bank_status}, ` +
        `UPI status is ${transaction.upi_status}, receiver status is ${transaction.receiver_status}, ` +
        `and refund status is ${transaction.refund_status}.`,
    );
    if (!isAlreadyHealthy) {
      diagnosisSentences.push(decision.reason);
    }
  }

  if (gate?.result === 'BLOCKED_BY_POLICY') {
    diagnosisSentences.push(gate.reason);
  } else if (gate?.result === 'ESCALATE' || gate?.result === 'BLOCK') {
    diagnosisSentences.push(gate.reason);
  }

  const resolutionSentences: string[] = [];

  if (supportCase) {
    resolutionSentences.push(
      decision.decision_code === 'POLICY_BLOCKED'
        ? `I've opened case ${supportCase.case_id} so a compliance reviewer can look at this and clear it manually if it's genuinely you. ${supportCase.customer_instruction}`
        : `I've opened case ${supportCase.case_id} with the full investigation trace attached for our operations team. ${supportCase.customer_instruction}`,
    );
  } else if (finalTransaction?.payment_status === 'REFUNDED') {
    resolutionSentences.push(`Your refund is complete — ₹${finalTransaction.amount.toLocaleString('en-IN')} has been restored.`);
  } else if (decision.decision_code === 'MONITOR_AND_POLL') {
    resolutionSentences.push('I will keep monitoring this transaction and update you the moment it settles.');
  } else if (isAlreadyHealthy) {
    // The verdict, held back from the diagnosis sentence above — its own
    // message, after the reading pause, instead of crammed onto the same
    // line as the raw status check.
    resolutionSentences.push(decision.reason);
  }

  return {
    diagnosis: diagnosisSentences.join(' '),
    resolution: resolutionSentences.length > 0 ? resolutionSentences.join(' ') : null,
  };
}

// ============================================================================
// STEP 1b: GENERAL DOMAIN Q&A — judge/demo-facing knowledge base
// ----------------------------------------------------------------------------
// Not every message to the AI Teammate is "investigate my transaction." A
// judge (or the user, rehearsing) will often ask how the app or the
// underlying engine works. Those are real, in-domain questions and deserve
// a real answer instead of a "couldn't find a transaction matching that"
// dead end. This is a small, honest, deterministic FAQ — no LLM, no
// fabricated capability claims — checked before we give up and say we
// can't find a transaction.
// ============================================================================

interface FaqEntry {
  patterns: RegExp[];
  answer: string;
}

const FAQ_ENTRIES: FaqEntry[] = [
  {
    patterns: [/what\s+is\s+upi/i, /how\s+does\s+upi\s+work/i],
    answer:
      'UPI (Unified Payments Interface) is the real-time payment rail run by NPCI that most Indian apps — PhonePe, GPay, Paytm — sit on top of. A single payment actually touches three separate systems: your bank (which debits you), the UPI switch (which routes the message), and the receiver\'s bank (which credits them). Normally all three agree instantly. This app exists because sometimes they don\'t.',
  },
  {
    patterns: [/4[\s-]?way|four[\s-]?way|decoupled\s+status|bank\s+status.*upi\s+status/i],
    answer:
      'Most apps only show you one payment status. This one tracks four, independently: bank status (was money actually debited from your account), UPI status (did the network message succeed), receiver status (did the money actually land in the other person\'s account), and refund status. A payment can be DEBITED at the bank but not yet CREDITED to the receiver — that gap is exactly where money gets "stuck," and tracking all four separately is what lets the AI Teammate tell the difference between "still settling," "stuck and needs a refund," and "actually fine."',
  },
  {
    patterns: [/real\s+(llm|ai|model)|use\s+.*llm|chatgpt|does.*ai.*decide|ai.*make.*decision|ai.*authority/i],
    answer:
      'The AI never decides your money\'s fate. It can optionally use a language model to parse free text (like "paise kat gaye but usko nahi mila") into a transaction id — but that\'s it. Every actual decision — the risk score, whether to refund, whether to block a payment, whether a human needs to step in — runs through deterministic, human-authored rules: a risk engine, a decision engine, and a policy gate. If the LLM is unavailable or fails, the app falls back to plain keyword matching and nothing about the financial logic changes.',
  },
  {
    patterns: [/risk\s+score|how.*risk.*calculat|risk\s+engine/i],
    answer:
      'The risk score is a 0-100 number built from several independent signals — things like how new the beneficiary is, the payment amount, device recognition, and past dispute history. It\'s fully deterministic: the same inputs always produce the same score, and every point is traceable to a specific rule, not a model guess. Below 21 is low risk and goes straight through; 21-50 needs no extra step; 51 and above asks for a PIN or biometric step-up; 90 and above is hard-blocked regardless of what you enter.',
  },
  {
    patterns: [/step[\s-]?up|why.*pin|why.*fingerprint|why.*verify/i],
    answer:
      'Step-up verification (asking for your PIN or fingerprint again) triggers automatically once a payment\'s risk score crosses a threshold — usually a large amount going to a beneficiary you don\'t pay often. It\'s the same idea banks and UPI apps already use for high-value transfers: a routine payment sails through, an unusual one asks you to confirm you really meant it.',
  },
  {
    patterns: [/action\s+gate|policy\s+gate|hard[\s-]?block|why.*blocked/i],
    answer:
      'Even after the AI decides what it thinks should happen (refund, retry, monitor), that proposal still has to pass a separate policy gate before anything actually executes — it can approve it, ask for step-up verification, escalate to a human, or block it outright. This is deliberate: the investigation and the authority to act are kept separate, so the AI can reason freely without ever being the last checkpoint on your money.',
  },
  {
    patterns: [/human\s+escalat|support\s+case|sup-\d+|when.*human/i],
    answer:
      'When the AI finds a situation it isn\'t confident enough to resolve on its own — conflicting signals from the bank, UPI switch, and receiver, or a policy that requires manual review — it opens a support case with the full investigation trace attached and hands it to a human operations agent instead of guessing. You get a case number to track it, and nothing is auto-resolved behind your back.',
  },
  {
    patterns: [/duplicate\s+payment|double\s+(charge|debit|pay)|paid\s+twice/i],
    answer:
      'If you\'ve already got one payment to the same beneficiary in flight, the app flags a retry as a possible duplicate and monitors instead of blindly resubmitting — retrying a payment that might still land is exactly how people get double-debited. The AI checks the original transaction\'s live status before deciding whether a "new" payment is actually a duplicate.',
  },
  {
    patterns: [/what\s+happens.*payment\s+fail|failed\s+payment|money\s+(stuck|deducted|debited).*not.*(receiv|credit)/i],
    answer:
      'If money leaves your account but never reaches the receiver, that\'s a debit-without-credit — the most common "stuck payment" pattern. The AI Teammate checks the bank, UPI, and receiver status independently to confirm the money really is stuck (not just slow), and if so runs a refund workflow that reverses the debit and restores your balance, with every step logged.',
  },
  {
    patterns: [/refund.*how\s+long|when.*refund|refund.*time/i],
    answer:
      'Once the AI confirms a payment is genuinely stuck (debited but never credited, or a timeout), the refund in this app completes immediately as part of the same investigation — that\'s a deliberate demo simplification. In a real deployment this would follow NPCI\'s standard reversal timelines (typically within a few business days), which the app doesn\'t attempt to simulate.',
  },
  {
    patterns: [/rbi|regulat|complian|guideline/i],
    answer:
      'RBI guidance around UPI generally pushes for extra friction on unusually large or first-time payments — exactly what this app\'s step-up verification and risk-based gating are modeled on. This is a hackathon prototype, not a certified product, so it takes inspiration from that spirit rather than implementing a specific regulatory checklist.',
  },
  {
    patterns: [/is\s+this\s+(a\s+)?real|is\s+this\s+connected\s+to\s+(a\s+)?real\s+bank|real\s+money|mock|fake\s+data|in[\s-]?memory/i],
    answer:
      'This is a self-contained prototype — an in-memory mock database standing in for a bank/UPI backend, with no real money or real bank connection. That\'s intentional: it lets the whole 4-way status engine, risk scoring, and AI investigation be demoed live and deterministically, without depending on any external payment rail.',
  },
  {
    // A loan/credit request isn't a payment-investigation question at all —
    // this AI Teammate's job is diagnosing what happened to a transaction,
    // not originating credit products. Previously a message like "I need a
    // loan" fell through to the generic "couldn't identify which
    // transaction you mean" reply, which is honest but unhelpful: it
    // doesn't point the customer anywhere. This says plainly that it's out
    // of scope here and points to the one place in the app that actually
    // handles it.
    patterns: [
      /\bloan(s)?\b/i,
      /\bemi\b/i,
      /\bborrow(ing)?\s*(money|cash|some\s*money)?\b/i,
      /\bcredit\s*line\b/i,
      /\b(need|want|apply\s*for)\b.*\b(loan|credit)\b/i,
    ],
    answer:
      "I can't help with loans here — I only investigate payments and transactions. For personal loan offers, eligibility, and applying, check the Loans section on the home screen.",
  },
];

function matchGeneralQuestion(message: string | undefined): string | null {
  if (!message || message.trim().length < 3) return null;
  for (const entry of FAQ_ENTRIES) {
    if (entry.patterns.some((p) => p.test(message))) {
      return entry.answer;
    }
  }
  return null;
}

// ============================================================================
// STEP 1c: CUSTOMER CARE ESCALATION PROTOCOL
// ----------------------------------------------------------------------------
// A separate, higher-priority check than everything else in this file.
// Every diagnosis/decision/risk/action-gate machinery below exists to
// resolve TECHNICAL UPI problems (a timeout, a desync between rails, a
// stuck reversal) — situations where the 4-way state machine actually has
// an answer. These five categories are not that: fraud, a payment sent to
// the wrong person, a compromised account, a merchant walking away from a
// physical dispute, or a case that already involves police/legal/medical
// escalation. None of those are things this app's deterministic engines
// have any business "resolving" — they need a human with real authority
// (identity verification, bank coordination, sometimes law enforcement).
//
// So this check runs FIRST, before transaction resolution, before the FAQ,
// before anything else, and — if it matches — investigate() returns
// immediately with a care-escalation payload. No diagnosis, no risk score,
// no auto-reversal is ever attempted for these.
// ============================================================================

interface CareEscalationMatch {
  category: CareEscalationCategory;
  reason: string;
}

const CARE_ESCALATION_PATTERNS: Array<{ category: CareEscalationCategory; reason: string; patterns: RegExp[] }> = [
  {
    category: 'FRAUD_SCAM_PHISHING',
    reason: 'Customer reports a suspected fraud, scam, or phishing attempt.',
    patterns: [
      /\bscam(med)?\b/i,
      /\bfraud\b/i,
      /\blottery\b/i,
      /\bphishing\b/i,
      /tricked\s*me/i,
      /some\s*one\s*trick/i,
      /\bhack(ed|ing)?\b/i,
      /cyber\s*crime/i,
      /cyber\s*fraud/i,
    ],
  },
  {
    category: 'WRONG_BENEFICIARY_TRANSFER',
    reason: 'Customer sent money to the wrong beneficiary/UPI ID by mistake.',
    patterns: [
      // Was too narrow before — only matched "wrong number/account/vpa/upi",
      // so a completely ordinary phrasing like "sent the money to a wrong
      // person" fell through untouched and got the generic "couldn't
      // identify a transaction" dead end instead of being recognized as
      // exactly the wrong-beneficiary case this protocol exists for.
      /wrong\s*(number|account|vpa|upi|person|beneficiary|recipient)/i,
      /galat\s*(account|number|vpa|vyakti|bande|insaan)?\s*(ko\s*)?(me|mein)?\s*(bhej|bhejh)/i,
      /mistaken\s*transfer/i,
      /sent\s*(it\s*|the\s*money\s*|money\s*)?to\s*(the\s*|a\s*|an\s*)?wrong\s*(person|number|account|vpa)/i,
    ],
  },
  {
    category: 'ACCOUNT_TAKEOVER_SECURITY',
    reason: 'Customer reports a security incident — SIM swap, stolen device, or unauthorized account access.',
    patterns: [
      /sim\s*swap/i,
      /(device|phone)\s*(stolen|lost)/i,
      /unauthorized\s*access/i,
      /freeze\s*my\s*account/i,
      /account\s*(has\s*been\s*)?hacked/i,
      /block\s*my\s*account/i,
    ],
  },
  {
    category: 'MERCHANT_PHYSICAL_DISPUTE',
    reason: 'Customer has an unresolved dispute with a merchant over a physical/in-store transaction.',
    patterns: [
      /shopkeeper\s*(refus|denied|not\s*giv)/i,
      /merchant\s*(not|refus|denied)/i,
      /merchant\s*.*goods/i,
      /double\s*deduct(ion)?\s*at\s*(the\s*)?store/i,
      /store\s*charged\s*(me\s*)?twice/i,
    ],
  },
  {
    category: 'REGULATORY_SEVERE_DISTRESS',
    reason: 'Customer indicated legal/regulatory involvement or severe distress requiring human handling.',
    patterns: [
      /\bpolice\b/i,
      /\bfir\b/i,
      /\blawyer\b/i,
      /consumer\s*court/i,
      /hospital\s*emergency/i,
      /sue\s*paytm/i,
      /legal\s*action/i,
    ],
  },
];

function detectCareEscalation(message: string | undefined): CareEscalationMatch | null {
  if (!message || message.trim().length < 3) return null;
  for (const entry of CARE_ESCALATION_PATTERNS) {
    if (entry.patterns.some((p) => p.test(message))) {
      return { category: entry.category, reason: entry.reason };
    }
  }
  return null;
}

/** Placeholder Customer Care number for this demo/hackathon build — replace
 * with a real, staffed support line before any production use. */
const CARE_PHONE_DISPLAY = '+91 98765 43210';
const CARE_PHONE_TEL_HREF = 'tel:+919876543210';

function generateCareTicketId(): string {
  const rand = Math.floor(10000 + Math.random() * 89999);
  return `CARE-${rand}`;
}

const CARE_EMPATHY_NARRATIVE: Record<CareEscalationCategory, string> = {
  FRAUD_SCAM_PHISHING:
    "I'm really sorry this happened to you. This looks like it could be fraud, and that's not something I can safely handle on my own — it needs a person who can verify what happened and act on your account directly.",
  WRONG_BENEFICIARY_TRANSFER:
    "I understand — sending money to the wrong person is stressful, and I don't have the authority to pull funds back from someone else's account on my own. This needs a human who can coordinate that recovery properly.",
  ACCOUNT_TAKEOVER_SECURITY:
    "This sounds like it could be a security issue with your account or device, and that's serious — I'm not going to attempt any automated fix here. This needs a person who can secure your account right away.",
  MERCHANT_PHYSICAL_DISPUTE:
    "I'm sorry you're dealing with this. A dispute with a merchant in person isn't something I can resolve from a transaction log alone — it needs a human who can actually follow up with the merchant.",
  REGULATORY_SEVERE_DISTRESS:
    "I hear you, and I want to make sure this gets handled by an actual person right away, not an automated system — this isn't something I should be attempting to resolve on my own.",
};

/** Builds the full escalation payload for a matched care case. Halts here —
 * the caller never falls through to transaction resolution, risk scoring,
 * or the action gate for this request. */
function buildCareEscalation(match: CareEscalationMatch, transactionId: string | null): OpsAgentOutput {
  const ticketId = generateCareTicketId();
  const now = new Date().toISOString();

  // Deliberately no appendAuditEvent() here: the CareEscalationCard is
  // already the dedicated, prominent signal for this state, and dumping
  // an extra "matched category X, opened ticket Y" line into the same
  // transaction's audit trail was redundant chatter on top of it — and,
  // for a transaction that already has its own prior technical history,
  // pulling that whole trail in is also just noise for a case a human is
  // about to handle directly.

  const escalation: CareEscalation = {
    ticket_id: ticketId,
    category: match.category,
    reason: match.reason,
    priority: 'URGENT',
    phone_display: CARE_PHONE_DISPLAY,
    phone_tel_href: CARE_PHONE_TEL_HREF,
    status: 'OPEN',
    created_at: now,
  };

  return {
    transaction_id: transactionId,
    diagnosis: 'ESCALATED_TO_CUSTOMER_CARE',
    confidence: 1,
    narrative: CARE_EMPATHY_NARRATIVE[match.category],
    resolution_narrative:
      `I've opened an urgent case (${ticketId}) for our Customer Care team — please don't retry or take further action until they've spoken with you. ` +
      `You can call Priority Care directly, or start a simulated agent call below to see how the hand-off works.`,
    tool_calls: [],
    audit_trail: [],
    decision: null,
    risk: null,
    action_decision: null,
    support_case: null,
    final_transaction: transactionId ? (getTransaction(transactionId) ?? null) : null,
    recommended_action: null,
    used_llm: false,
    intent_hint: match.reason,
    care_escalation: escalation,
  };
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export async function investigate(input: OpsAgentInput): Promise<OpsAgentOutput> {
  try {
    // Customer Care Escalation Protocol — checked FIRST, before anything
    // else in this function. See the section above for why: these
    // categories are human-only by design, not a diagnosis this engine is
    // meant to attempt.
    const careMatch = detectCareEscalation(input.message);
    if (careMatch) {
      return buildCareEscalation(careMatch, input.transaction_id ?? null);
    }

    if (input.transaction_id) {
      appendAuditEvent(
        input.transaction_id,
        'USER',
        'COMPLAINT_RECEIVED',
        input.message ? `Complaint received: "${input.message}"` : 'Investigation requested directly by transaction id.',
      );
    }

    const { transactionId, usedLlm, intentHint, noMatchContext } = await resolveTargetTransactionId(input);

    if (!transactionId) {
      // Before assuming this is a failed transaction lookup, check whether
      // it's actually a general in-domain question (how UPI works, why a
      // risk score triggered step-up, etc.) — exactly the kind of thing a
      // judge asks during a demo. Only treated as a question when there's no
      // dangling amount/beneficiary reference that looks like a real
      // transaction search gone wrong.
      if (!noMatchContext?.amountMentioned && !noMatchContext?.beneficiaryMentioned) {
        const faqAnswer = matchGeneralQuestion(input.message);
        if (faqAnswer) {
          return {
            transaction_id: null,
            diagnosis: 'GENERAL_QUESTION_ANSWERED',
            confidence: 0.9,
            narrative: faqAnswer,
            resolution_narrative: null,
            tool_calls: [],
            audit_trail: [],
            decision: null,
            risk: null,
            action_decision: null,
            support_case: null,
            final_transaction: null,
            recommended_action: null,
            used_llm: usedLlm,
            intent_hint: intentHint,
            care_escalation: null,
          };
        }
      }

      const senderId = input.sender_id ?? DEFAULT_SENDER_ID;
      const recent = recentTransactionsForReference(senderId);
      const recentSummary = recent.map(describeTransactionForReference).join('; ');

      // A flat demand for a refund ("give me a refund", "paisa wapas karo")
      // is a different situation from "I can't find your transaction" —
      // answering it with a raw list of unrelated transaction ids is a
      // non-answer. This app never just issues a refund because it's
      // asked for; a refund only happens once the AI has confirmed a
      // specific payment is genuinely stuck (debited but never credited).
      // Saying that plainly, instead of pretending the request was a
      // transaction lookup that simply failed, is the "reply
      // intelligently" behavior being asked for here.
      const isDirectRefundDemand = isGenericRefundDemand(input.message);

      let narrative: string;
      if (isDirectRefundDemand) {
        narrative =
          "A refund isn't something I hand out just because it's asked for — I only refund a payment once I've actually confirmed it's stuck (debited from your account but never reached the receiver). " +
          'Tell me the transaction id, or the amount and who it was sent to, and I\'ll check what really happened before doing anything.';
      } else if (noMatchContext?.amountMentioned && !noMatchContext.beneficiaryMentioned) {
        narrative = `I couldn't find a payment of ₹${noMatchContext.amountMentioned.toLocaleString('en-IN')} in your account matching that description.`;
      } else if (noMatchContext?.beneficiaryMentioned && !noMatchContext.amountMentioned) {
        narrative = "I couldn't find a payment to that person in your account, or there's more than one and I can't tell which without the amount.";
      } else if (noMatchContext?.amountMentioned && noMatchContext.beneficiaryMentioned) {
        narrative = `I couldn't find a transaction matching both that amount and that recipient in your account — it may not have gone through PaytmResolve, or a detail might be off.`;
      } else {
        narrative = "I couldn't identify which transaction you mean.";
      }

      if (!isDirectRefundDemand) {
        narrative += ' Could you share the transaction id, or double-check the amount and recipient?';
        if (recent.length > 0) {
          narrative += ` For reference, your most recent transactions are: ${recentSummary}.`;
        }
      }

      // Nothing here matched a transaction, a known FAQ, a refund demand,
      // or a Customer Care category — this is a genuinely unhandled
      // request, not a search that just needs more detail. Rather than
      // leaving that dead-ended, say so honestly and offer the one thing
      // that always works: a human.
      if (!isDirectRefundDemand && !noMatchContext?.amountMentioned && !noMatchContext?.beneficiaryMentioned) {
        narrative +=
          " If this isn't something I can help with here, let me know and I'll get our Customer Care team involved instead.";
      }

      return {
        transaction_id: null,
        diagnosis: 'TRANSACTION_NOT_FOUND',
        confidence: 0,
        narrative,
        resolution_narrative: null,
        tool_calls: [],
        audit_trail: [],
        decision: null,
        risk: null,
        action_decision: null,
        support_case: null,
        final_transaction: null,
        recommended_action: null,
        used_llm: usedLlm,
        intent_hint: intentHint,
        care_escalation: null,
      };
    }

    if (!input.transaction_id) {
      // We didn't know the id until resolution just now — log the
      // complaint against the transaction we actually landed on.
      appendAuditEvent(
        transactionId,
        'USER',
        'COMPLAINT_RECEIVED',
        input.message ? `Complaint received: "${input.message}"` : 'Investigation requested via receipt upload.',
        { resolved_via: usedLlm ? 'LLM_ASSISTED' : 'DETERMINISTIC' },
      );
    }

    // ---- INVESTIGATE ------------------------------------------------------
    const toolCalls = runInvestigationTools(transactionId);
    const transaction = getTransaction(transactionId)!;

    // ---- DECIDE ------------------------------------------------------------
    const risk = evaluateRiskForTransaction(transactionId) ?? null;
    if (risk) {
      appendAuditEvent(
        transactionId,
        'SYSTEM',
        'RISK_EVALUATED',
        `Risk score ${risk.risk_score}/100 (${risk.risk_level}).`,
        { risk_score: risk.risk_score, risk_level: risk.risk_level },
      );
    }

    const decision = diagnoseTransaction(transaction);
    appendAuditEvent(transactionId, 'AI', 'DECISION', decision.reason, {
      decision_code: decision.decision_code,
      recommended_action: decision.recommended_action,
      rules_applied: decision.rules_applied,
    });

    // ---- ACT -----------------------------------------------------------
    const actionRequest: ActionRequest = {
      action_id: generateActionId(),
      transaction_id: transactionId,
      type: decision.recommended_action,
      proposed_by: 'AI',
      payload: {},
      requested_at: new Date().toISOString(),
      operation_id: reserveOperationId(),
      raw_user_text: input.message,
      override_attempt_detected: Boolean(detectOverridePhrase(input.message)),
    };

    appendAuditEvent(transactionId, 'AI', 'ACTION_PROPOSED', `Proposed action: ${decision.recommended_action}.`, {
      action_id: actionRequest.action_id,
    });

    const gateDecision = evaluateAction(actionRequest, { transaction, risk: risk ?? undefined });

    appendAuditEvent(
      transactionId,
      'SYSTEM',
      gateDecision.result === 'ALLOW' ? 'ACTION_GATE_ALLOWED' : 'ACTION_GATE_BLOCKED',
      gateDecision.reason,
      { result: gateDecision.result, policy_rules_applied: gateDecision.policy_rules_applied },
    );

    if (gateDecision.result === 'BLOCKED_BY_POLICY') {
      appendAuditEvent(
        transactionId,
        'SYSTEM',
        'PROMPT_INJECTION_BLOCKED',
        'An override phrase in the customer message was detected and ignored by policy.',
      );
    }

    let finalTransaction: Transaction | null = transaction;
    let supportCase: SupportCase | null = null;

    if (gateDecision.result === 'ALLOW') {
      if (decision.recommended_action === 'INITIATE_REFUND') {
        finalTransaction = executeRefundWorkflow(transaction);
      } else if (decision.recommended_action === 'MONITOR_TRANSACTION') {
        // Kick off the real accelerated-time background poller (see
        // engine/monitoringEngine.ts) instead of a single static message.
        // Idempotent: re-investigating a transaction already being
        // monitored just returns its current progress, it never restarts
        // the clock or double-schedules checks.
        const monitoringState = startMonitoring(transactionId);
        appendAuditEvent(
          transactionId,
          'SYSTEM',
          'MONITORING_CHECK',
          monitoringState.is_complete
            ? 'Monitoring already completed for this transaction.'
            : 'Monitoring started: polling the UPI switch on an accelerated schedule (checks at +0s, +3s, +6s).',
          { monitoring_started_at: monitoringState.started_at },
        );
        finalTransaction = getTransaction(transactionId) ?? transaction;
      } else if (decision.recommended_action === 'ESCALATE_TO_HUMAN') {
        supportCase = escalateToHuman(
          transaction,
          decision.reason,
          getAuditTrail(transactionId),
          toolCalls,
          risk,
        );
        finalTransaction = getTransaction(transactionId) ?? transaction;
      } else {
        finalTransaction = getTransaction(transactionId) ?? transaction;
      }
    } else {
      // Gate blocked / escalated / required step-up / hard-blocked a
      // policy override: whatever the AI proposed, a human now needs to
      // look at this with the full evidence trace attached.
      supportCase = escalateToHuman(
        transaction,
        gateDecision.reason,
        getAuditTrail(transactionId),
        toolCalls,
        risk,
      );
      finalTransaction = getTransaction(transactionId) ?? transaction;
    }

    // ---- VERIFY ----------------------------------------------------------
    const diagnosis = mapDecisionToDiagnosis(transaction, decision);
    const confidence = computeConfidence(decision, gateDecision.result);
    const narrativeParts = synthesizeNarrative({
      transaction,
      decision,
      gate: gateDecision,
      supportCase,
      finalTransaction,
      intentHint,
    });

    return {
      transaction_id: transactionId,
      diagnosis,
      confidence,
      narrative: narrativeParts.diagnosis,
      resolution_narrative: narrativeParts.resolution,
      tool_calls: toolCalls,
      audit_trail: getAuditTrail(transactionId),
      decision,
      risk,
      action_decision: gateDecision,
      support_case: supportCase,
      final_transaction: finalTransaction,
      recommended_action: decision.recommended_action,
      used_llm: usedLlm,
      intent_hint: intentHint,
      care_escalation: null,
    };
  } catch (error) {
    // This agent must never crash the live pitch. Any unexpected failure
    // degrades to a safe, explicit "needs clarification" response instead
    // of propagating an exception to the route layer.
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      transaction_id: input.transaction_id ?? null,
      diagnosis: 'TRANSACTION_NOT_FOUND',
      confidence: 0,
      narrative: `I ran into an unexpected issue while investigating this (${message}). Please try again or provide the transaction id directly.`,
      resolution_narrative: null,
      tool_calls: [],
      audit_trail: [],
      decision: null,
      risk: null,
      action_decision: null,
      support_case: null,
      final_transaction: null,
      recommended_action: null,
      used_llm: false,
      intent_hint: null,
      care_escalation: null,
    };
  }
}
