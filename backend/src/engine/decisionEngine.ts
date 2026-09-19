/**
 * PaytmResolve AI — Deterministic Decision Engine
 * ---------------------------------------------------------------------------
 * "This should be deterministic code, not just LLM reasoning."
 *
 * This engine turns the 4-way decoupled transaction state
 * (bank_status / upi_status / receiver_status / refund_status) into a
 * recommended recovery or escalation path using fixed IF/THEN rules — no
 * model call happens here. The AI Teammate may explain the decision in
 * plain language; it never computes it.
 *
 * Rule matrix (in evaluation order):
 *   1. payment_status === PENDING
 *        -> MONITOR_AND_POLL, retry blocked (settlement still in flight).
 *   2. bank=DEBITED & receiver=NOT_RECEIVED & upi in {FAILED, TIMEOUT}
 *        -> REVERSAL_WORKFLOW (safe to auto-initiate a refund).
 *   3. bank=DEBITED & receiver=NOT_RECEIVED & (upi=UNKNOWN | refund=UNKNOWN)
 *        -> HUMAN_ESCALATION (conflicting state, cannot be auto-resolved).
 *   4. payment_status === SUCCESS & receiver=CREDITED
 *        -> ALREADY_RESOLVED, nothing to do.
 *   5. anything else unrecognised
 *        -> HUMAN_ESCALATION (conservative default: never guess).
 *
 * Separately, evaluateDuplicateGuard() implements:
 *   "Original transaction active/not closed -> Block retry."
 * ---------------------------------------------------------------------------
 */

import type { DecisionEngineResult, Transaction } from '../types/index.js';

// ============================================================================
// CLOSED-STATE HELPER (shared with actionGate.ts)
// ============================================================================

/**
 * A transaction is considered CLOSED once nothing further can or should
 * happen to it automatically: it succeeded end-to-end, it was fully
 * refunded/reversed, or it has been explicitly marked closed by an
 * operator/AI action.
 */
export function isTransactionClosed(transaction: Transaction): boolean {
  if (transaction.is_closed === true) return true;
  if (transaction.payment_status === 'SUCCESS' && transaction.receiver_status === 'CREDITED') {
    return true;
  }
  if (transaction.payment_status === 'REFUNDED' && transaction.refund_status === 'COMPLETED') {
    return true;
  }
  if (transaction.payment_status === 'REVERSED' && transaction.bank_status === 'REVERSED') {
    return true;
  }
  return false;
}

// ============================================================================
// RULE 1-5: DIAGNOSE A TRANSACTION'S RECOVERY PATH
// ============================================================================

export function diagnoseTransaction(transaction: Transaction): DecisionEngineResult {
  const evaluated_at = new Date().toISOString();
  const rules_applied: string[] = [];

  // Rule 0 (checked before everything else): this payment never reached
  // the bank at all — it was deliberately stopped by risk/compliance
  // policy, not by a technical failure. It is NOT "still settling" (Rule
  // 1 below would otherwise wrongly claim that for a step-up-required
  // payment that stalled at NOT_DEBITED), and there is nothing here for an
  // automated reversal or a monitoring poll to do — only a human can clear
  // it, so this always routes straight to escalation with the real reason
  // attached.
  if (transaction.payment_status === 'BLOCKED') {
    rules_applied.push('RULE_POLICY_BLOCKED: payment_status=BLOCKED');
    return {
      transaction_id: transaction.transaction_id,
      decision_code: 'POLICY_BLOCKED',
      recommended_action: 'ESCALATE_TO_HUMAN',
      allow_retry: false,
      reason:
        transaction.policy_block_reason ??
        'This payment was stopped by our risk and compliance policy before it reached the bank.',
      rules_applied,
      evaluated_at,
    };
  }

  // Rule 4 (checked first): already fully resolved, nothing to do.
  if (isTransactionClosed(transaction) && transaction.payment_status === 'SUCCESS') {
    rules_applied.push('RULE_ALREADY_RESOLVED: payment_status=SUCCESS AND receiver_status=CREDITED');
    return {
      transaction_id: transaction.transaction_id,
      decision_code: 'ALREADY_RESOLVED',
      recommended_action: 'MONITOR_TRANSACTION',
      allow_retry: false,
      reason: 'Transaction has already settled successfully end-to-end. No recovery action needed.',
      rules_applied,
      evaluated_at,
    };
  }

  // Rule 1: still settling — never retry a payment that might still land.
  if (transaction.payment_status === 'PENDING') {
    rules_applied.push('RULE_PENDING: payment_status=PENDING');
    return {
      transaction_id: transaction.transaction_id,
      decision_code: 'MONITOR_AND_POLL',
      recommended_action: 'MONITOR_TRANSACTION',
      allow_retry: false,
      reason:
        'Transaction is still settling (NPCI/UPI window open). Retrying now risks a duplicate debit — monitoring instead.',
      rules_applied,
      evaluated_at,
    };
  }

  // Rule 2: money left the bank, the switch explicitly failed or timed out,
  // and the receiver never got it. This is safe to auto-recover.
  const bankDebitedReceiverEmpty =
    transaction.bank_status === 'DEBITED' && transaction.receiver_status === 'NOT_RECEIVED';

  if (bankDebitedReceiverEmpty && (transaction.upi_status === 'FAILED' || transaction.upi_status === 'TIMEOUT')) {
    rules_applied.push(
      'RULE_REVERSAL: bank_status=DEBITED AND receiver_status=NOT_RECEIVED AND upi_status IN (FAILED, TIMEOUT)',
    );
    return {
      transaction_id: transaction.transaction_id,
      decision_code: 'REVERSAL_WORKFLOW',
      recommended_action: 'INITIATE_REFUND',
      allow_retry: false,
      reason:
        'Bank confirmed the debit but the UPI switch failed/timed out before the receiver was credited. Safe to auto-initiate a reversal.',
      rules_applied,
      evaluated_at,
    };
  }

  // Rule 3: bank debited, receiver empty, but the switch or refund state is
  // itself UNKNOWN — the system cannot safely tell what actually happened.
  if (bankDebitedReceiverEmpty && (transaction.upi_status === 'UNKNOWN' || transaction.refund_status === 'UNKNOWN')) {
    rules_applied.push(
      'RULE_ESCALATE: bank_status=DEBITED AND receiver_status=NOT_RECEIVED AND (upi_status=UNKNOWN OR refund_status=UNKNOWN)',
    );
    return {
      transaction_id: transaction.transaction_id,
      decision_code: 'HUMAN_ESCALATION',
      recommended_action: 'ESCALATE_TO_HUMAN',
      allow_retry: false,
      reason:
        'Bank, UPI switch, and receiver ledger disagree on the outcome of this transaction. This cannot be safely auto-resolved.',
      rules_applied,
      evaluated_at,
    };
  }

  // Rule 4b: healthy in-flight/refund-recovering states — safe, no escalation.
  if (transaction.payment_status === 'REFUND_PENDING' || transaction.refund_status === 'PROCESSING') {
    rules_applied.push('RULE_REFUND_IN_PROGRESS: refund_status=PROCESSING');
    return {
      transaction_id: transaction.transaction_id,
      decision_code: 'MONITOR_AND_POLL',
      recommended_action: 'MONITOR_TRANSACTION',
      allow_retry: false,
      reason: 'A refund is already in progress for this transaction. Monitoring until it completes.',
      rules_applied,
      evaluated_at,
    };
  }

  // Rule 5: conservative default. Never guess on an unrecognised combination.
  rules_applied.push('RULE_DEFAULT: unrecognised state combination');
  return {
    transaction_id: transaction.transaction_id,
    decision_code: 'HUMAN_ESCALATION',
    recommended_action: 'ESCALATE_TO_HUMAN',
    allow_retry: false,
    reason: 'This state combination is not covered by a known recovery rule. Escalating out of caution rather than guessing.',
    rules_applied,
    evaluated_at,
  };
}

// ============================================================================
// DUPLICATE / RETRY GUARD
// "Original transaction active/not closed -> Block retry."
// ============================================================================

export interface DuplicateGuardCandidate {
  sender_id: string;
  receiver_id: string;
  amount: number;
  /** Excluded from the "existing" search — e.g. the candidate's own id if it already exists. */
  exclude_transaction_id?: string;
}

export function evaluateDuplicateGuard(
  candidate: DuplicateGuardCandidate,
  senderTransactions: Transaction[],
): DecisionEngineResult {
  const evaluated_at = new Date().toISOString();

  const conflictingTransaction = senderTransactions.find((t) => {
    if (candidate.exclude_transaction_id && t.transaction_id === candidate.exclude_transaction_id) {
      return false;
    }
    // A "duplicate" only makes sense once real money has actually started
    // moving. A record still at bank_status=NOT_DEBITED is a pre-send
    // placeholder (e.g. a risk-review fixture awaiting step-up) — nothing
    // has happened yet, so it has nothing to duplicate. Anything at
    // DEBITED or beyond represents genuine in-flight money and is a real
    // duplicate risk.
    return (
      t.receiver_id === candidate.receiver_id &&
      t.amount === candidate.amount &&
      t.bank_status !== 'NOT_DEBITED' &&
      !isTransactionClosed(t)
    );
  });

  if (conflictingTransaction) {
    return {
      transaction_id: conflictingTransaction.transaction_id,
      decision_code: 'DUPLICATE_BLOCKED',
      recommended_action: 'BLOCK_ACTION',
      allow_retry: false,
      reason: `An existing transaction (${conflictingTransaction.transaction_id}) to the same beneficiary for the same amount is still open. Resending now would risk a duplicate debit.`,
      rules_applied: ['RULE_DUPLICATE_GUARD: matching receiver_id AND amount AND NOT isTransactionClosed'],
      evaluated_at,
    };
  }

  return {
    transaction_id: candidate.exclude_transaction_id ?? 'NEW_PAYMENT_CANDIDATE',
    decision_code: 'SAFE_TO_PROCEED',
    recommended_action: 'NEW_PAYMENT',
    allow_retry: true,
    reason: 'No open transaction to this beneficiary for this amount was found. Safe to proceed.',
    rules_applied: ['RULE_DUPLICATE_GUARD: no matching open transaction found'],
    evaluated_at,
  };
}

// ============================================================================
// RETRY-SPECIFIC GUARD — used when the AI proposes RETRY_PAYMENT for a
// specific, already-known original transaction (as opposed to a brand-new
// send-money candidate, which goes through evaluateDuplicateGuard above).
// ============================================================================

export function evaluateRetryEligibility(originalTransaction: Transaction): DecisionEngineResult {
  const evaluated_at = new Date().toISOString();

  if (!isTransactionClosed(originalTransaction)) {
    return {
      transaction_id: originalTransaction.transaction_id,
      decision_code: 'DUPLICATE_BLOCKED',
      recommended_action: 'BLOCK_ACTION',
      allow_retry: false,
      reason: 'The original transaction is still open (not closed). Retrying now would risk a duplicate debit.',
      rules_applied: ['RULE_RETRY_GUARD: isTransactionClosed(original) === false'],
      evaluated_at,
    };
  }

  return {
    transaction_id: originalTransaction.transaction_id,
    decision_code: 'SAFE_TO_PROCEED',
    recommended_action: 'RETRY_PAYMENT',
    allow_retry: true,
    reason: 'The original transaction is closed. A fresh retry is permitted, subject to authorization.',
    rules_applied: ['RULE_RETRY_GUARD: isTransactionClosed(original) === true'],
    evaluated_at,
  };
}
