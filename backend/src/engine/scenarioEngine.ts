/**
 * PaytmResolve AI — Scenario Engine
 * ---------------------------------------------------------------------------
 * The Demo Control Panel buttons are ENVIRONMENT CONTROLS, not "AI actions".
 * Clicking a button mutates the mock backend's state (bank/UPI/receiver/
 * refund status, or a beneficiary's trust profile) — it never writes a
 * canned chat message. The judge then interacts with the app normally
 * (opens the transaction, asks the AI Teammate to investigate) and the AI
 * has to discover and reason about a real, freshly-mutated environment.
 *
 * "Network Failure" here means a simulated payment-service/gateway
 * failure, NOT disabling the browser's actual internet connection.
 *
 * triggerScenario() is idempotent-per-click: every click re-asserts the
 * canonical problem-state for that scenario (with a fresh timestamp), so a
 * judge can re-trigger the same demo repeatedly without restarting the
 * server, and RESET_SCENARIO restores the entire database to its pristine
 * seed state for a full re-run.
 * ---------------------------------------------------------------------------
 */

import type {
  BankStatus,
  DemoControlAction,
  PaymentStatus,
  ReceiverStatus,
  RefundStatus,
  ScenarioId,
  ScenarioResetResult,
  ScenarioTriggerResult,
  Transaction,
  UpiStatus,
} from '../types/index.js';
import {
  appendAuditEvent,
  getSupportCase,
  getTransaction,
  resetDatabase,
  updateBeneficiary,
  updateSupportCase,
  updateTransaction,
} from '../mockDb/transactions.js';
import { resetAllMonitoring } from './monitoringEngine.js';
import { resetBankHealth, triggerBankTimeoutSpike } from './proactiveEngine.js';

// ============================================================================
// TIME HELPERS
// ============================================================================

const minutesAgo = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
const nowIso = () => new Date().toISOString();

// ============================================================================
// SHARED MUTATION HELPER
// ============================================================================

function reassertTransaction(
  transactionId: string,
  patch: Partial<Omit<Transaction, 'transaction_id'>>,
): Transaction {
  const updated = updateTransaction(transactionId, { ...patch, timestamp: nowIso() });
  if (!updated) {
    throw new Error(`ScenarioEngine: cannot find seeded demo transaction "${transactionId}".`);
  }
  return updated;
}

function buildResult(
  scenarioId: ScenarioId,
  transaction: Transaction,
  message: string,
): ScenarioTriggerResult {
  return {
    scenario_id: scenarioId,
    demo_transaction_id: transaction.transaction_id,
    mutated_fields: {
      payment_status: transaction.payment_status,
      bank_status: transaction.bank_status,
      upi_status: transaction.upi_status,
      receiver_status: transaction.receiver_status,
      refund_status: transaction.refund_status,
      timestamp: transaction.timestamp,
      updated_at: transaction.updated_at,
    },
    message,
    triggered_at: nowIso(),
  };
}

// ============================================================================
// ARMED SCENARIOS — "next payment you make" instead of "fake instant history"
// ---------------------------------------------------------------------------
// A judge/tester clicking a scenario button shouldn't make a transaction
// appear in Transaction History that they never actually initiated — that
// reads as the demo faking its own history. Instead, for the scenarios
// that describe what happens WHEN A PAYMENT IS MADE (a gateway timeout, an
// explicit switch failure, an open settlement window), the button just
// arms that outcome. Nothing changes in the database yet. The next real
// payment the customer submits through Send Money — to whoever they pick,
// for whatever amount — is the one that gets that outcome forced onto it,
// at the moment it's actually created. Consumed once, then cleared.
// ============================================================================

export interface ArmedScenarioTarget {
  payment_status: PaymentStatus;
  bank_status: BankStatus;
  upi_status: UpiStatus;
  receiver_status: ReceiverStatus;
  refund_status: RefundStatus;
  is_closed: boolean;
  note: string;
  /** Whether the AI Teammate should start an accelerated monitoring poll
   * on this transaction once it's created, instead of a one-shot investigate. */
  start_monitoring: boolean;
}

export interface ArmedScenario {
  scenario_id: ScenarioId;
  target: ArmedScenarioTarget;
  armed_at: string;
}

let armedScenario: ArmedScenario | null = null;

export function getArmedScenario(): ArmedScenario | null {
  return armedScenario;
}

/** Returns the currently-armed scenario (if any) and clears it — a payment
 * only ever consumes one armed scenario, once. */
export function consumeArmedScenario(): ArmedScenario | null {
  const current = armedScenario;
  armedScenario = null;
  return current;
}

export function clearArmedScenario(): void {
  armedScenario = null;
}

function buildArmedResult(scenarioId: ScenarioId, message: string): ScenarioTriggerResult {
  return {
    scenario_id: scenarioId,
    demo_transaction_id: 'ARMED_NEXT_PAYMENT',
    mutated_fields: {},
    message,
    triggered_at: nowIso(),
  };
}

// ============================================================================
// PER-SCENARIO HANDLERS
// ============================================================================

function triggerNetworkFailure(): ScenarioTriggerResult {
  armedScenario = {
    scenario_id: 'NETWORK_FAILURE',
    target: {
      payment_status: 'FAILED',
      bank_status: 'DEBITED',
      upi_status: 'TIMEOUT',
      receiver_status: 'NOT_RECEIVED',
      refund_status: 'NOT_INITIATED',
      is_closed: false,
      note: 'Payment gateway timeout after bank debit',
      start_monitoring: false,
    },
    armed_at: nowIso(),
  };
  return buildArmedResult(
    'NETWORK_FAILURE',
    'Armed: your NEXT payment will simulate a payment-gateway timeout — money leaves your account, but the UPI switch times ' +
      'out before the receiver is credited. Go to Send Money and pay anyone, any amount, to see it happen.',
  );
}

function triggerDebitNoCredit(): ScenarioTriggerResult {
  armedScenario = {
    scenario_id: 'DEBIT_NO_CREDIT',
    target: {
      payment_status: 'FAILED',
      bank_status: 'DEBITED',
      upi_status: 'FAILED',
      receiver_status: 'NOT_RECEIVED',
      refund_status: 'NOT_INITIATED',
      is_closed: false,
      note: 'UPI switch returned explicit failure after debit',
      start_monitoring: false,
    },
    armed_at: nowIso(),
  };
  return buildArmedResult(
    'DEBIT_NO_CREDIT',
    'Armed: your NEXT payment will simulate a debit-without-credit — the bank debits you, but the UPI switch returns an ' +
      'explicit failure and the receiver never gets it. Go to Send Money and pay anyone, any amount, to see it happen.',
  );
}

function triggerPendingTimeout(): ScenarioTriggerResult {
  armedScenario = {
    scenario_id: 'PENDING_TIMEOUT',
    target: {
      payment_status: 'PENDING',
      bank_status: 'DEBITED',
      upi_status: 'PENDING',
      receiver_status: 'UNKNOWN',
      refund_status: 'NOT_INITIATED',
      is_closed: false,
      note: 'NPCI settlement still pending, within normal SLA window',
      start_monitoring: true,
    },
    armed_at: nowIso(),
  };
  return buildArmedResult(
    'PENDING_TIMEOUT',
    'Armed: your NEXT payment will simulate an open NPCI settlement window — it stays pending instead of settling ' +
      'immediately, and the AI Teammate should monitor it rather than retry. Go to Send Money and pay anyone, any amount, to see it happen.',
  );
}

function triggerDuplicatePayment(): ScenarioTriggerResult {
  const transaction = reassertTransaction('TXN_DUP_04', {
    payment_status: 'PENDING',
    bank_status: 'DEBITED',
    upi_status: 'PENDING',
    receiver_status: 'UNKNOWN',
    refund_status: 'NOT_INITIATED',
    is_closed: false,
    note: 'Original transaction still active — any resend attempt must be blocked',
  });
  appendAuditEvent(
    transaction.transaction_id,
    'SYSTEM',
    'STATE_CHANGE',
    'Demo control: armed the duplicate-payment guard — original transaction is active and unresolved.',
    { scenario_id: 'DUPLICATE_PAYMENT' },
  );
  return buildResult(
    'DUPLICATE_PAYMENT',
    transaction,
    `Simulated an active original transaction (${transaction.transaction_id}). A same-amount resend to the same beneficiary will now be blocked.`,
  );
}

function triggerConflictingStates(): ScenarioTriggerResult {
  const transaction = reassertTransaction('TXN_CONF_05', {
    payment_status: 'UNKNOWN',
    bank_status: 'DEBITED',
    upi_status: 'UNKNOWN',
    receiver_status: 'NOT_RECEIVED',
    refund_status: 'UNKNOWN',
    is_closed: false,
    note: 'Bank and UPI switch report conflicting outcomes — human reconciliation required',
  });

  const existingCase = getSupportCase('SUP-48291');
  if (existingCase) {
    updateSupportCase('SUP-48291', {
      status: 'ESCALATED',
      diagnosis:
        'Conflicting transaction states across bank, UPI switch, and receiver ledger — cannot safely auto-resolve.',
      recommended_action: 'Human reconciliation required.',
      customer_instruction: 'Do not retry this payment while the case is open.',
    });
  }

  appendAuditEvent(
    transaction.transaction_id,
    'SYSTEM',
    'STATE_CHANGE',
    'Demo control: simulated conflicting bank/UPI/receiver/refund states. Re-opened escalation case SUP-48291.',
    { scenario_id: 'CONFLICTING_STATES' },
  );

  return buildResult(
    'CONFLICTING_STATES',
    transaction,
    `Simulated conflicting states for ${transaction.transaction_id}. Case SUP-48291 is escalated and open.`,
  );
}

function triggerNewBeneficiaryHighValue(): ScenarioTriggerResult {
  // No preset transaction is touched here — this only sets up the
  // ENVIRONMENT (the beneficiary's trust profile). The risk-engine effect
  // only shows up once the customer actually sends a real payment to this
  // beneficiary, exactly like a real risk profile would work.
  updateBeneficiary('BEN_VIKRAM_NEW', {
    account_created_at: minutesAgo(8),
    previous_transactions: 0,
    average_received_amount: 0,
    dispute_count: 0,
    risk_signals: ['NEW_BENEFICIARY', 'NO_TRANSACTION_HISTORY'],
  });
  appendAuditEvent(
    'BEN_VIKRAM_NEW',
    'SYSTEM',
    'STATE_CHANGE',
    'Demo control: set up an 8-minute-old beneficiary (Vikram Singh) to demonstrate high-value step-up verification.',
    { scenario_id: 'NEW_BENEFICIARY_HIGH_VALUE' },
  );
  return buildArmedResult(
    'NEW_BENEFICIARY_HIGH_VALUE',
    'Armed: "Vikram Singh" is now a brand-new beneficiary (8 minutes old, no history). Go to Send Money → Saved Contact → ' +
      'Vikram Singh, and send ₹2,00,000 to see step-up verification trigger.',
  );
}

function triggerHighRiskBlock(): ScenarioTriggerResult {
  // Same idea — only the environment (beneficiary trust profile) changes
  // here. The hard-block only fires once a real payment is actually sent.
  updateBeneficiary('BEN_UNKNOWN_RISKY', {
    account_created_at: minutesAgo(5),
    previous_transactions: 0,
    average_received_amount: 0,
    // A prior dispute on file (not just "new + risky") is what pushes this
    // past the hard-block threshold using only real, receiver-side signals —
    // no reliance on the sending device, which is fixed for this demo
    // customer's own device and can't itself look "unrecognized" once a
    // real payment goes through the actual Send Money form.
    dispute_count: 1,
    risk_signals: ['NEW_BENEFICIARY', 'NO_TRANSACTION_HISTORY', 'UNUSUAL_TIME', 'HIGH_VELOCITY_RECEIVER'],
  });
  appendAuditEvent(
    'BEN_UNKNOWN_RISKY',
    'SYSTEM',
    'STATE_CHANGE',
    'Demo control: set up a brand-new, high-velocity-flagged beneficiary (Rohit M.) to demonstrate the hard fraud block.',
    { scenario_id: 'HIGH_RISK_BLOCK' },
  );
  return buildArmedResult(
    'HIGH_RISK_BLOCK',
    'Armed: "Rohit M." is now a brand-new, high-velocity-flagged beneficiary. Go to Send Money → Saved Contact → Rohit M., ' +
      'and send ₹3,00,000 to see the automatic hard fraud block.',
  );
}

function triggerBeneficiaryHistoryDecay(): ScenarioTriggerResult {
  // This button does NOT touch the payment's own status — it ages the
  // beneficiary's trust profile, which is what the risk engine actually
  // reads. Re-running the risk evaluation afterwards is what proves the
  // decay, not a change to the transaction record itself.
  updateBeneficiary('BEN_AMIT', {
    account_created_at: daysAgo(120), // ~4 months
    previous_transactions: 12,
    average_received_amount: 7400,
    dispute_count: 0,
    risk_signals: [],
  });

  const transaction = getTransaction('TXN_HISTORY_08');
  if (!transaction) {
    throw new Error('ScenarioEngine: cannot find seeded demo transaction "TXN_HISTORY_08".');
  }

  appendAuditEvent(
    transaction.transaction_id,
    'SYSTEM',
    'STATE_CHANGE',
    'Demo control: backfilled beneficiary history — Amit now shows 12 successful payments (avg ₹7,400, 0 disputes) over ~4 months.',
    { scenario_id: 'BENEFICIARY_HISTORY_DECAY' },
  );

  return buildResult(
    'BENEFICIARY_HISTORY_DECAY',
    transaction,
    'Backfilled Amit\'s beneficiary profile to 12 successful payments over 4 months. Re-run risk evaluation on TXN_HISTORY_08 to see the score drop.',
  );
}

/**
 * Unlike every other scenario, this one has no single "demo transaction"
 * to reassert — it mutates a shared bank-health record that PaymentApp's
 * proactive banner reads directly, independent of any one transaction.
 */
function triggerBankTimeoutSpikeScenario(): ScenarioTriggerResult {
  const health = triggerBankTimeoutSpike();
  appendAuditEvent(
    'BANK_HEALTH_MONITOR',
    'SYSTEM',
    'MONITORING_CHECK',
    `Demo control: simulated a timeout surge at ${health.bank_name} (+${health.surge_percent}%).`,
    { scenario_id: 'BANK_TIMEOUT_SPIKE', bank_health: health },
  );
  return {
    scenario_id: 'BANK_TIMEOUT_SPIKE',
    demo_transaction_id: 'BANK_HEALTH_MONITOR',
    mutated_fields: {},
    message: health.message,
    triggered_at: nowIso(),
  };
}

// ============================================================================
// DISPATCH TABLE
// ============================================================================

const SCENARIO_HANDLERS: Record<ScenarioId, () => ScenarioTriggerResult> = {
  NETWORK_FAILURE: triggerNetworkFailure,
  DEBIT_NO_CREDIT: triggerDebitNoCredit,
  PENDING_TIMEOUT: triggerPendingTimeout,
  DUPLICATE_PAYMENT: triggerDuplicatePayment,
  CONFLICTING_STATES: triggerConflictingStates,
  NEW_BENEFICIARY_HIGH_VALUE: triggerNewBeneficiaryHighValue,
  HIGH_RISK_BLOCK: triggerHighRiskBlock,
  BENEFICIARY_HISTORY_DECAY: triggerBeneficiaryHistoryDecay,
  BANK_TIMEOUT_SPIKE: triggerBankTimeoutSpikeScenario,
};

export function triggerScenario(action: DemoControlAction): ScenarioTriggerResult | ScenarioResetResult {
  if (action === 'RESET_SCENARIO') {
    resetDatabase();
    resetAllMonitoring();
    resetBankHealth();
    clearArmedScenario();
    return {
      scenario_id: 'RESET_SCENARIO',
      message: 'Database restored to its pristine seed state. All 9 demo scenarios and beneficiary profiles have been reset.',
      triggered_at: nowIso(),
    };
  }

  const handler = SCENARIO_HANDLERS[action];
  if (!handler) {
    throw new Error(`ScenarioEngine: unknown scenario id "${action}".`);
  }
  return handler();
}

export function listScenarioIds(): ScenarioId[] {
  return Object.keys(SCENARIO_HANDLERS) as ScenarioId[];
}

/** Thin, explicitly-named alias over triggerScenario('RESET_SCENARIO'). */
export function resetScenario(): ScenarioResetResult {
  return triggerScenario('RESET_SCENARIO') as ScenarioResetResult;
}
