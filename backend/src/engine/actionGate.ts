/**
 * PaytmResolve AI — Action Gate
 * ---------------------------------------------------------------------------
 * THE SECURITY WALL. Zero LLM financial authority is enforced here, in
 * plain deterministic code:
 *
 *     LLM -> proposes action -> Policy Engine -> Risk Engine -> Authorization
 *         -> ACTION GATE -> Financial / Mock API
 *
 * The LLM may propose anything. This file decides what is actually allowed
 * to touch money, and it is the ONLY place that decision is made. Nothing
 * downstream re-checks policy; nothing upstream can skip this gate.
 *
 * Enforced here:
 *   1. Idempotency — replaying an operation_id returns the cached result
 *      instead of re-executing (prevents AI-retry / network-timeout double
 *      payments).
 *   2. Prompt-injection / override-phrase interception — phrases like
 *      "I know him", "I am sure", "ignore policy" are hard-blocked for any
 *      money-moving action, regardless of what the LLM decided to do with
 *      them. This is a substring scan on raw user text, not a model call.
 *   3. Financial limits — ₹10,000 auto-reversal cap per user-refund action,
 *      ₹50,000/day cap on payments to business/merchant beneficiaries.
 *   4. Duplicate-refund guard — never refund a transaction twice.
 *   5. Risk-based gating — CRITICAL-band risk is a hard block
 *      (human-operations only); HIGH-band risk requires a verified OTP
 *      step-up before the gate will allow execution. A bare textual
 *      "user_confirmation" is never sufficient on its own — only a
 *      deterministic `payload.otp_verified === true` flag (set by the real
 *      verification endpoint) satisfies a step-up requirement.
 * ---------------------------------------------------------------------------
 */

import type {
  ActionDecision,
  ActionRequest,
  Beneficiary,
  ProposedActionType,
  RiskEvaluationResult,
  Transaction,
} from '../types/index.js';
import {
  getBeneficiary,
  getIdempotentResult,
  incrementDuplicatePaymentsPrevented,
  listTransactionsBySender,
  storeIdempotentResult,
} from '../mockDb/transactions.js';
import { isTransactionClosed } from './decisionEngine.js';
import { HARD_BLOCK_THRESHOLD, STEP_UP_VERIFICATION_THRESHOLD } from './riskEngine.js';

// ============================================================================
// LABELLED PROTOTYPE POLICY THRESHOLDS
// ============================================================================

/** Directive: "Max ₹10,000 auto-reversal cap for users." */
export const USER_AUTO_REVERSAL_CAP = 10_000;

/** Directive: "₹50,000 daily merchant cap." */
export const MERCHANT_DAILY_CAP = 50_000;

export const MONEY_MOVING_ACTION_TYPES: ReadonlySet<ProposedActionType> = new Set([
  'RETRY_PAYMENT',
  'NEW_PAYMENT',
  'INITIATE_REFUND',
  'REVERSE_DEBIT',
  'CONFIRM_AND_EXECUTE_PAYMENT',
]);

const AUTO_REVERSAL_ACTION_TYPES: ReadonlySet<ProposedActionType> = new Set([
  'INITIATE_REFUND',
  'REVERSE_DEBIT',
]);

/**
 * Phrases a user (or a prompt-injected message pretending to be the user)
 * might use to try to talk the AI — and therefore the backend — into
 * skipping policy. Matching is case-insensitive substring matching on the
 * raw text the user actually typed. This list is intentionally explicit and
 * auditable rather than "the LLM's best judgement".
 */
export const OVERRIDE_PHRASES: readonly string[] = [
  'i know him',
  'i know her',
  'i know them',
  'i am sure',
  "i'm sure",
  'i am absolutely sure',
  "i'm absolutely sure",
  'ignore policy',
  'ignore the policy',
  'ignore previous instructions',
  'ignore all previous instructions',
  'disregard policy',
  'disregard the policy',
  'override the policy',
  'override policy',
  'bypass verification',
  'skip verification',
  'trust me',
  'just do it',
  'just send it',
  'i take full responsibility',
  'i take responsibility',
  'this is not fraud',
  "it's not fraud",
  'i authorize this',
  'i confirm it is fine',
  "i confirm it's fine",
];

// ============================================================================
// PROMPT-INJECTION / OVERRIDE DETECTION
// ============================================================================

export function detectOverridePhrase(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  return OVERRIDE_PHRASES.find((phrase) => normalized.includes(phrase));
}

// ============================================================================
// GATE CONTEXT
// ============================================================================

export interface ActionGateContext {
  transaction?: Transaction;
  risk?: RiskEvaluationResult;
  beneficiary?: Beneficiary;
}

function nowIso(): string {
  return new Date().toISOString();
}

function decide(
  action: ActionRequest,
  result: ActionDecision['result'],
  reason: string,
  rules: string[],
  riskScore?: number,
): ActionDecision {
  return {
    action_id: action.action_id,
    result,
    reason,
    policy_rules_applied: rules,
    risk_score: riskScore,
    decided_at: nowIso(),
  };
}

// ============================================================================
// MERCHANT DAILY CAP HELPER
// ============================================================================

function computeMerchantDailySpend(senderId: string, excludeTransactionId?: string): number {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  return listTransactionsBySender(senderId)
    .filter((t) => {
      if (excludeTransactionId && t.transaction_id === excludeTransactionId) return false;
      if (new Date(t.timestamp).getTime() < startOfDay.getTime()) return false;
      if (t.payment_status === 'FAILED') return false;
      const beneficiary = getBeneficiary(t.receiver_id);
      return beneficiary?.relationship === 'BUSINESS_VENDOR';
    })
    .reduce((sum, t) => sum + t.amount, 0);
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export function evaluateAction(action: ActionRequest, context: ActionGateContext = {}): ActionDecision {
  const rulesApplied: string[] = [];

  // ---- 1. IDEMPOTENCY REPLAY --------------------------------------------
  if (action.operation_id) {
    const cached = getIdempotentResult(action.operation_id);
    if (cached !== undefined) {
      rulesApplied.push('RULE_IDEMPOTENCY_REPLAY: operation_id already processed');
      return decide(
        action,
        'ALLOW',
        `Operation ${action.operation_id} was already executed. Returning the original result instead of re-executing.`,
        rulesApplied,
      );
    }
  }

  // ---- 2. PROMPT-INJECTION / OVERRIDE-PHRASE HARD BLOCK -----------------
  const matchedPhrase = detectOverridePhrase(action.raw_user_text);
  if (matchedPhrase && MONEY_MOVING_ACTION_TYPES.has(action.type)) {
    rulesApplied.push(`RULE_PROMPT_INJECTION_BLOCKED: matched override phrase "${matchedPhrase}"`);
    return decide(
      action,
      'BLOCKED_BY_POLICY',
      'Your confirmation is noted, but it cannot override the transaction security policy. Please complete the required verification instead.',
      rulesApplied,
      context.risk?.risk_score,
    );
  }

  // ---- 3. DUPLICATE-REFUND GUARD ----------------------------------------
  if (action.type === 'INITIATE_REFUND' && context.transaction?.refund_status === 'COMPLETED') {
    rulesApplied.push('RULE_DUPLICATE_REFUND_BLOCKED: refund_status already COMPLETED');
    return decide(
      action,
      'BLOCK',
      'A refund has already been completed for this transaction. Blocking a second refund attempt.',
      rulesApplied,
    );
  }

  // ---- 4. RETRY GUARD (original transaction must be closed) ------------
  if (action.type === 'RETRY_PAYMENT' && context.transaction && !isTransactionClosed(context.transaction)) {
    rulesApplied.push('RULE_RETRY_BLOCKED: original transaction is not closed');
    incrementDuplicatePaymentsPrevented();
    return decide(
      action,
      'BLOCK',
      'The original transaction is still open. Retrying now would risk a duplicate debit.',
      rulesApplied,
    );
  }

  // ---- 5. FINANCIAL LIMIT: AUTO-REVERSAL CAP ----------------------------
  if (AUTO_REVERSAL_ACTION_TYPES.has(action.type) && context.transaction) {
    if (context.transaction.amount > USER_AUTO_REVERSAL_CAP) {
      rulesApplied.push(
        `RULE_AUTO_REVERSAL_CAP_EXCEEDED: amount ₹${context.transaction.amount} > cap ₹${USER_AUTO_REVERSAL_CAP}`,
      );
      return decide(
        action,
        'ESCALATE',
        `Amount ₹${context.transaction.amount.toLocaleString('en-IN')} exceeds the ₹${USER_AUTO_REVERSAL_CAP.toLocaleString('en-IN')} auto-reversal cap. Human sign-off is required before this refund can be executed.`,
        rulesApplied,
      );
    }
    rulesApplied.push(`RULE_AUTO_REVERSAL_CAP_OK: amount ₹${context.transaction.amount} <= cap ₹${USER_AUTO_REVERSAL_CAP}`);
  }

  // ---- 6. FINANCIAL LIMIT: MERCHANT DAILY CAP ----------------------------
  if (
    (action.type === 'NEW_PAYMENT' || action.type === 'CONFIRM_AND_EXECUTE_PAYMENT') &&
    context.beneficiary?.relationship === 'BUSINESS_VENDOR'
  ) {
    const amount = Number(action.payload.amount ?? context.transaction?.amount ?? 0);
    const spentToday = computeMerchantDailySpend(action.payload.sender_id as string, context.transaction?.transaction_id);
    if (spentToday + amount > MERCHANT_DAILY_CAP) {
      rulesApplied.push(
        `RULE_MERCHANT_DAILY_CAP_EXCEEDED: ₹${spentToday} already sent today + ₹${amount} > cap ₹${MERCHANT_DAILY_CAP}`,
      );
      return decide(
        action,
        'BLOCK',
        `This payment would push today's total to this merchant beyond the ₹${MERCHANT_DAILY_CAP.toLocaleString('en-IN')} daily cap.`,
        rulesApplied,
      );
    }
    rulesApplied.push('RULE_MERCHANT_DAILY_CAP_OK');
  }

  // ---- 7. RISK-BASED GATING FOR PAYMENT EXECUTION -----------------------
  if (
    (action.type === 'NEW_PAYMENT' || action.type === 'CONFIRM_AND_EXECUTE_PAYMENT') &&
    context.risk
  ) {
    const { risk_score } = context.risk;

    if (context.risk.requires_human_review || risk_score >= HARD_BLOCK_THRESHOLD) {
      rulesApplied.push(`RULE_HARD_BLOCK: risk_score ${risk_score} >= ${HARD_BLOCK_THRESHOLD}`);
      return decide(
        action,
        'BLOCK',
        `Risk score ${risk_score}/100 exceeds the hard-block threshold. This transaction requires human operations review and cannot be auto-executed.`,
        rulesApplied,
        risk_score,
      );
    }

    if (context.risk.requires_step_up_verification || risk_score >= STEP_UP_VERIFICATION_THRESHOLD) {
      const otpVerified = action.payload?.otp_verified === true;
      if (!otpVerified) {
        rulesApplied.push(
          `RULE_STEP_UP_REQUIRED: risk_score ${risk_score} >= ${STEP_UP_VERIFICATION_THRESHOLD} AND payload.otp_verified !== true`,
        );
        return decide(
          action,
          'REQUIRE_STEP_UP',
          `Risk score ${risk_score}/100 requires step-up verification (simulated OTP) before this payment can proceed. A text confirmation alone is not sufficient.`,
          rulesApplied,
          risk_score,
        );
      }
      rulesApplied.push('RULE_STEP_UP_SATISFIED: payload.otp_verified === true');
    }
  }

  // ---- 8. DEFAULT ALLOW ---------------------------------------------------
  rulesApplied.push('RULE_DEFAULT_ALLOW: no blocking policy triggered');
  const decision = decide(
    action,
    'ALLOW',
    'No blocking policy triggered. Action is authorized to proceed.',
    rulesApplied,
    context.risk?.risk_score,
  );

  if (action.operation_id) {
    storeIdempotentResult(action.operation_id, decision);
  }

  return decision;
}
