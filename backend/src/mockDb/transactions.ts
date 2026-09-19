/**
 * PaytmResolve AI — Mock In-Memory Database
 * ---------------------------------------------------------------------------
 * ZERO EXTERNAL DB DEPENDENCIES.
 *
 * Every account, beneficiary, transaction, and CRM case the demo needs is
 * pre-seeded here, in memory, at process start. There is no SQL, no ORM, no
 * external service — `npm install && npm run dev` is enough for the whole
 * app to be fully functional immediately after `git clone`.
 *
 * This file owns:
 *   - The 8 deterministic scenario transactions (+ 2 plain historical ones
 *     for a believable transaction list) referenced throughout the plan.
 *   - Customers, Beneficiaries, Support (CRM) cases, Audit Trail events.
 *   - A tiny repository API (get/list/add/update) that every engine, agent,
 *     and route in later steps builds on top of.
 *   - An idempotency-operation store (Map) — the raw storage the future
 *     action-gate / idempotency layer (Directive #16) will read and write.
 *   - resetDatabase() — restores everything to its pristine seed state so
 *     the "Reset Scenario" demo-control button and repeat demo runs are
 *     100% deterministic.
 *
 * Nothing here talks to the LLM, the risk engine, or the action gate. This
 * file is intentionally "dumb data + dumb accessors" so later engines can
 * be layered on top of it without circular imports.
 * ---------------------------------------------------------------------------
 */

import type {
  Transaction,
  Customer,
  Beneficiary,
  SupportCase,
  AuditTrailEvent,
  ScenarioId,
} from '../types/index.js';

// ============================================================================
// TIME HELPERS — every seed timestamp is relative to "now" so the demo
// always looks fresh, no matter when the server is started.
// ============================================================================

const NOW = () => Date.now();
const minutesAgo = (mins: number) => new Date(NOW() - mins * 60_000).toISOString();
const hoursAgo = (hrs: number) => new Date(NOW() - hrs * 60 * 60_000).toISOString();
const daysAgo = (days: number) => new Date(NOW() - days * 24 * 60 * 60_000).toISOString();
const nowIso = () => new Date(NOW()).toISOString();

// ============================================================================
// ID GENERATION — human-readable, deterministic-looking, collision-safe.
// ============================================================================

let auditEventCounter = 0;
let operationCounter = 0;

function nextAuditEventId(): string {
  auditEventCounter += 1;
  return `EVT-${String(auditEventCounter).padStart(5, '0')}`;
}

function nextOperationId(): string {
  operationCounter += 1;
  return `OP-${String(80000 + operationCounter)}`;
}

export function generateTransactionId(prefix = 'TXN'): string {
  const rand = Math.floor(10000 + Math.random() * 89999);
  return `${prefix}${rand}`;
}

let newBeneficiaryCounter = 0;

/** Generates a fresh beneficiary id for a phone number / UPI ID the customer
 * enters directly (not one of the pre-seeded demo contacts). */
export function generateBeneficiaryId(): string {
  newBeneficiaryCounter += 1;
  return `BEN_NEW_${String(newBeneficiaryCounter).padStart(3, '0')}`;
}

// ============================================================================
// SEED FACTORY — returns brand-new, independent copies of every entity.
// Called once at module load, and again by resetDatabase().
// ============================================================================

interface SeedData {
  transactions: Transaction[];
  customers: Customer[];
  beneficiaries: Beneficiary[];
  supportCases: SupportCase[];
  auditTrail: Record<string, AuditTrailEvent[]>;
}

function buildAuditEvent(
  transactionId: string,
  actor: AuditTrailEvent['actor'],
  type: AuditTrailEvent['type'],
  description: string,
  metadata?: Record<string, unknown>,
  timestamp?: string,
): AuditTrailEvent {
  return {
    event_id: nextAuditEventId(),
    transaction_id: transactionId,
    timestamp: timestamp ?? nowIso(),
    actor,
    type,
    description,
    metadata,
  };
}

function buildSeedData(): SeedData {
  // --------------------------------------------------------------------
  // CUSTOMERS
  // --------------------------------------------------------------------
  const customers: Customer[] = [
    {
      user_id: 'USR_SELF',
      name: 'Ananya Verma',
      email: 'ananya.verma@example.com',
      phone: '+91-9821000011',
      balance: 500000,
      normal_transaction_amount: 3200,
      transaction_history: [
        'TXN_NET_01',
        'TXN_DEBIT_02',
        'TXN_PEND_03',
        'TXN_DUP_04',
        'TXN_CONF_05',
        'TXN_RISK_06',
        'TXN_HIGHRISK_07',
        'TXN_HISTORY_08',
        'TXN_HIST_A',
        'TXN_HIST_B',
      ],
      known_devices: ['DEV_ANANYA_PHONE'],
      beneficiaries: [
        'BEN_RAHUL',
        'BEN_SURESH',
        'BEN_VIKRAM_NEW',
        'BEN_UNKNOWN_RISKY',
        'BEN_AMIT',
      ],
      created_at: daysAgo(400),
    },
  ];

  // --------------------------------------------------------------------
  // BENEFICIARIES
  // --------------------------------------------------------------------
  const beneficiaries: Beneficiary[] = [
    {
      beneficiary_id: 'BEN_RAHUL',
      name: 'Rahul Kumar',
      upi_id: 'rahul.kumar@upi',
      account_created_at: daysAgo(410),
      previous_transactions: 34,
      average_received_amount: 2100,
      dispute_count: 0,
      risk_signals: [],
      relationship: 'PERSONAL_CONTACT',
    },
    {
      beneficiary_id: 'BEN_SURESH',
      name: 'Suresh Iyer (Vendor)',
      upi_id: 'suresh.iyer.store@upi',
      account_created_at: daysAgo(200),
      previous_transactions: 15,
      average_received_amount: 4300,
      dispute_count: 0,
      risk_signals: [],
      relationship: 'BUSINESS_VENDOR',
    },
    {
      beneficiary_id: 'BEN_VIKRAM_NEW',
      name: 'Vikram Singh',
      upi_id: 'vikram.singh.new@upi',
      account_created_at: minutesAgo(8),
      previous_transactions: 0,
      average_received_amount: 0,
      dispute_count: 0,
      risk_signals: ['NEW_BENEFICIARY', 'NO_TRANSACTION_HISTORY'],
      relationship: 'OTHER',
    },
    {
      beneficiary_id: 'BEN_UNKNOWN_RISKY',
      name: 'Rohit M.',
      upi_id: 'rohit.m.unverified@upi',
      account_created_at: minutesAgo(5),
      previous_transactions: 0,
      average_received_amount: 0,
      dispute_count: 0,
      risk_signals: [
        'NEW_BENEFICIARY',
        'NO_TRANSACTION_HISTORY',
        'UNUSUAL_TIME',
        'HIGH_VELOCITY_RECEIVER',
      ],
      relationship: 'OTHER',
    },
    {
      beneficiary_id: 'BEN_AMIT',
      name: 'Amit Verma',
      upi_id: 'amit.verma@upi',
      account_created_at: minutesAgo(8),
      previous_transactions: 0,
      average_received_amount: 0,
      dispute_count: 0,
      risk_signals: ['NEW_BENEFICIARY', 'NO_TRANSACTION_HISTORY'],
      relationship: 'OTHER',
    },
  ];

  // --------------------------------------------------------------------
  // TRANSACTIONS — the 8 deterministic scenario records, plus 2 plain
  // historical successes for a believable transaction list.
  // --------------------------------------------------------------------
  const transactions: Transaction[] = [
    // 1) NETWORK_FAILURE — Bank debited, UPI gateway timed out, receiver
    //    never credited. Auto-Initiate Reversal Workflow (~2h ETA).
    {
      transaction_id: 'TXN_NET_01',
      sender_id: 'USR_SELF',
      receiver_id: 'BEN_RAHUL',
      amount: 2000,
      currency: 'INR',
      timestamp: minutesAgo(6),
      payment_status: 'FAILED',
      bank_status: 'DEBITED',
      upi_status: 'TIMEOUT',
      receiver_status: 'NOT_RECEIVED',
      refund_status: 'NOT_INITIATED',
      device_id: 'DEV_ANANYA_PHONE',
      idempotency_key: 'IDEMP-NET-01',
      created_at: minutesAgo(6),
      updated_at: minutesAgo(6),
      scenario_id: 'NETWORK_FAILURE',
      note: 'Payment gateway timeout after bank debit',
    },

    // 2) DEBIT_NO_CREDIT — Bank debited, UPI switch explicitly failed,
    //    receiver never credited. Safe Retry Authorization.
    {
      transaction_id: 'TXN_DEBIT_02',
      sender_id: 'USR_SELF',
      receiver_id: 'BEN_RAHUL',
      amount: 2500,
      currency: 'INR',
      timestamp: minutesAgo(15),
      payment_status: 'FAILED',
      bank_status: 'DEBITED',
      upi_status: 'FAILED',
      receiver_status: 'NOT_RECEIVED',
      refund_status: 'NOT_INITIATED',
      device_id: 'DEV_ANANYA_PHONE',
      idempotency_key: 'IDEMP-DEBIT-02',
      created_at: minutesAgo(15),
      updated_at: minutesAgo(15),
      scenario_id: 'DEBIT_NO_CREDIT',
      note: 'UPI switch returned explicit failure after debit',
    },

    // 3) PENDING_TIMEOUT — NPCI settlement pending. Recheck & Monitor,
    //    no duplicate payment should be allowed while this is open.
    {
      transaction_id: 'TXN_PEND_03',
      sender_id: 'USR_SELF',
      receiver_id: 'BEN_RAHUL',
      amount: 1800,
      currency: 'INR',
      timestamp: minutesAgo(3),
      payment_status: 'PENDING',
      bank_status: 'DEBITED',
      upi_status: 'PENDING',
      receiver_status: 'UNKNOWN',
      refund_status: 'NOT_INITIATED',
      device_id: 'DEV_ANANYA_PHONE',
      idempotency_key: 'IDEMP-PEND-03',
      created_at: minutesAgo(3),
      updated_at: minutesAgo(3),
      scenario_id: 'PENDING_TIMEOUT',
      note: 'NPCI settlement still pending, within normal SLA window',
    },

    // 4) DUPLICATE_PAYMENT — original transaction is still active/pending;
    //    used to prove the system blocks an accidental duplicate debit.
    {
      transaction_id: 'TXN_DUP_04',
      sender_id: 'USR_SELF',
      receiver_id: 'BEN_RAHUL',
      amount: 5000,
      currency: 'INR',
      timestamp: minutesAgo(2),
      payment_status: 'PENDING',
      bank_status: 'DEBITED',
      upi_status: 'PENDING',
      receiver_status: 'UNKNOWN',
      refund_status: 'NOT_INITIATED',
      device_id: 'DEV_ANANYA_PHONE',
      idempotency_key: 'IDEMP-DUP-04',
      created_at: minutesAgo(2),
      updated_at: minutesAgo(2),
      scenario_id: 'DUPLICATE_PAYMENT',
      note: 'Original transaction still active — any resend attempt must be blocked',
    },

    // 5) CONFLICTING_STATES — bank/UPI/receiver/refund disagree; cannot be
    //    safely auto-resolved. Escalated to Human Operations (#SUP-48291).
    {
      transaction_id: 'TXN_CONF_05',
      sender_id: 'USR_SELF',
      receiver_id: 'BEN_SURESH',
      amount: 5000,
      currency: 'INR',
      timestamp: hoursAgo(2),
      payment_status: 'UNKNOWN',
      bank_status: 'DEBITED',
      upi_status: 'UNKNOWN',
      receiver_status: 'NOT_RECEIVED',
      refund_status: 'UNKNOWN',
      device_id: 'DEV_ANANYA_PHONE',
      idempotency_key: 'IDEMP-CONF-05',
      created_at: hoursAgo(2),
      updated_at: hoursAgo(2),
      scenario_id: 'CONFLICTING_STATES',
      note: 'Bank and UPI switch report conflicting outcomes — human reconciliation required',
    },

    // 6) NEW_BENEFICIARY_HIGH_VALUE — ₹2,00,000 to an 8-minute-old
    //    beneficiary. Expected risk ≈78/100 → step-up verification.
    {
      transaction_id: 'TXN_RISK_06',
      sender_id: 'USR_SELF',
      receiver_id: 'BEN_VIKRAM_NEW',
      amount: 200000,
      currency: 'INR',
      timestamp: minutesAgo(1),
      payment_status: 'PENDING',
      bank_status: 'NOT_DEBITED',
      upi_status: 'NOT_INITIATED',
      receiver_status: 'NOT_RECEIVED',
      refund_status: 'NOT_INITIATED',
      device_id: 'DEV_ANANYA_PHONE',
      idempotency_key: 'IDEMP-RISK-06',
      created_at: minutesAgo(1),
      updated_at: minutesAgo(1),
      scenario_id: 'NEW_BENEFICIARY_HIGH_VALUE',
      note: 'High-value transfer to a brand-new beneficiary — awaiting risk clearance',
    },

    // 7) HIGH_RISK_BLOCK — ₹3,00,000, new device, high velocity, brand
    //    new beneficiary. Expected risk 91-97/100 → hard block, human review.
    {
      transaction_id: 'TXN_HIGHRISK_07',
      sender_id: 'USR_SELF',
      receiver_id: 'BEN_UNKNOWN_RISKY',
      amount: 300000,
      currency: 'INR',
      timestamp: minutesAgo(1),
      payment_status: 'PENDING',
      bank_status: 'NOT_DEBITED',
      upi_status: 'NOT_INITIATED',
      receiver_status: 'NOT_RECEIVED',
      refund_status: 'NOT_INITIATED',
      device_id: 'DEV_UNKNOWN_NEW',
      idempotency_key: 'IDEMP-HIGHRISK-07',
      created_at: minutesAgo(1),
      updated_at: minutesAgo(1),
      scenario_id: 'HIGH_RISK_BLOCK',
      note: 'New device + high velocity + brand-new beneficiary + large amount',
    },

    // 8) BENEFICIARY_HISTORY_DECAY — ₹8,000 to Amit while Amit is still
    //    "new" (0 transactions). The demo button ages Amit's profile to
    //    show risk dropping from ~78 to ~24 once history exists.
    {
      transaction_id: 'TXN_HISTORY_08',
      sender_id: 'USR_SELF',
      receiver_id: 'BEN_AMIT',
      amount: 8000,
      currency: 'INR',
      timestamp: minutesAgo(1),
      payment_status: 'PENDING',
      bank_status: 'NOT_DEBITED',
      upi_status: 'NOT_INITIATED',
      receiver_status: 'NOT_RECEIVED',
      refund_status: 'NOT_INITIATED',
      device_id: 'DEV_ANANYA_PHONE',
      idempotency_key: 'IDEMP-HISTORY-08',
      created_at: minutesAgo(1),
      updated_at: minutesAgo(1),
      scenario_id: 'BENEFICIARY_HISTORY_DECAY',
      note: 'Payment to Amit — risk profile depends on beneficiary history state',
    },

    // -- Plain historical successes (not scenario records) for a
    //    believable transaction history list. --
    {
      transaction_id: 'TXN_HIST_A',
      sender_id: 'USR_SELF',
      receiver_id: 'BEN_RAHUL',
      amount: 1200,
      currency: 'INR',
      timestamp: daysAgo(2),
      payment_status: 'SUCCESS',
      bank_status: 'DEBITED',
      upi_status: 'SUCCESS',
      receiver_status: 'CREDITED',
      refund_status: 'NOT_INITIATED',
      device_id: 'DEV_ANANYA_PHONE',
      idempotency_key: 'IDEMP-HIST-A',
      created_at: daysAgo(2),
      updated_at: daysAgo(2),
      is_closed: true,
    },
    {
      transaction_id: 'TXN_HIST_B',
      sender_id: 'USR_SELF',
      receiver_id: 'BEN_SURESH',
      amount: 4500,
      currency: 'INR',
      timestamp: daysAgo(5),
      payment_status: 'SUCCESS',
      bank_status: 'DEBITED',
      upi_status: 'SUCCESS',
      receiver_status: 'CREDITED',
      refund_status: 'NOT_INITIATED',
      device_id: 'DEV_ANANYA_PHONE',
      idempotency_key: 'IDEMP-HIST-B',
      created_at: daysAgo(5),
      updated_at: daysAgo(5),
      is_closed: true,
    },
  ];

  // --------------------------------------------------------------------
  // AUDIT TRAIL — seed one narrative "state observed" event per scenario
  // transaction so the Activity Timeline has something real to show even
  // before the AI Teammate is invoked.
  // --------------------------------------------------------------------
  const auditTrail: Record<string, AuditTrailEvent[]> = {};

  const seedNarratives: Array<[string, string]> = [
    ['TXN_NET_01', 'Payment gateway timeout detected after bank debit was confirmed.'],
    ['TXN_DEBIT_02', 'UPI switch returned an explicit failure after the bank leg completed.'],
    ['TXN_PEND_03', 'NPCI settlement window still open; transaction remains pending.'],
    ['TXN_DUP_04', 'Original transaction detected active; duplicate-payment guard is armed.'],
    ['TXN_CONF_05', 'Bank, UPI, and receiver ledgers disagree on outcome for this transaction.'],
    ['TXN_RISK_06', 'Large-value transfer queued to a beneficiary added minutes ago.'],
    ['TXN_HIGHRISK_07', 'Transfer queued from an unrecognized device with unusual velocity.'],
    ['TXN_HISTORY_08', 'Transfer queued to a beneficiary with no prior transaction history.'],
  ];

  for (const [transactionId, description] of seedNarratives) {
    auditTrail[transactionId] = [
      buildAuditEvent(transactionId, 'SYSTEM', 'STATE_CHANGE', description),
    ];
  }
  auditTrail['TXN_HIST_A'] = [
    buildAuditEvent('TXN_HIST_A', 'SYSTEM', 'RESOLUTION', 'Payment completed successfully end-to-end.'),
  ];
  auditTrail['TXN_HIST_B'] = [
    buildAuditEvent('TXN_HIST_B', 'SYSTEM', 'RESOLUTION', 'Payment completed successfully end-to-end.'),
  ];

  // --------------------------------------------------------------------
  // SUPPORT CASES — the conflicting-state scenario ships with a
  // pre-existing escalation, exactly as referenced across the plan
  // (#SUP-48291).
  // --------------------------------------------------------------------
  const supportCases: SupportCase[] = [
    {
      case_id: 'SUP-48291',
      transaction_id: 'TXN_CONF_05',
      customer_id: 'USR_SELF',
      reason: 'Conflicting transaction states across bank, UPI switch, and receiver ledger.',
      priority: 'HIGH',
      investigation_timeline: [
        buildAuditEvent(
          'TXN_CONF_05',
          'SYSTEM',
          'COMPLAINT_RECEIVED',
          'Customer reported money debited but not delivered.',
        ),
      ],
      evidence: {
        bank_status: 'DEBITED',
        upi_status: 'UNKNOWN',
        receiver_status: 'NOT_RECEIVED',
        refund_status: 'UNKNOWN',
      },
      diagnosis: 'Conflicting transaction states across bank, UPI switch, and receiver ledger — cannot safely auto-resolve.',
      actions_taken: ['Retry blocked pending human reconciliation.'],
      recommended_action: 'Human reconciliation required.',
      customer_instruction: 'Do not retry this payment while the case is open.',
      status: 'ESCALATED',
      created_at: hoursAgo(2),
      updated_at: hoursAgo(2),
    },
  ];

  return { transactions, customers, beneficiaries, supportCases, auditTrail };
}

// ============================================================================
// LIVE, MUTABLE STORE
// ============================================================================

let transactionsById: Map<string, Transaction>;
let customersById: Map<string, Customer>;
let beneficiariesById: Map<string, Beneficiary>;
let supportCasesById: Map<string, SupportCase>;
let auditTrailByTransactionId: Map<string, AuditTrailEvent[]>;

/** operation_id -> previously computed result, for idempotent financial ops. */
export const idempotencyStore: Map<string, unknown> = new Map();

/**
 * A duplicate-payment attempt leaves no record of its own once blocked —
 * there is nothing to count in `listTransactions()` after the fact. This
 * tiny counter is the one metric genuinely too ephemeral to derive from
 * current DB state, so it is tracked explicitly (and zeroed by
 * resetDatabase(), same as everything else here).
 */
let duplicatePaymentsPreventedCount = 0;

export function incrementDuplicatePaymentsPrevented(): void {
  duplicatePaymentsPreventedCount += 1;
}

export function getDuplicatePaymentsPreventedCount(): number {
  return duplicatePaymentsPreventedCount;
}

function loadFromSeed(seed: SeedData) {
  transactionsById = new Map(seed.transactions.map((t) => [t.transaction_id, t]));
  customersById = new Map(seed.customers.map((c) => [c.user_id, c]));
  beneficiariesById = new Map(seed.beneficiaries.map((b) => [b.beneficiary_id, b]));
  supportCasesById = new Map(seed.supportCases.map((c) => [c.case_id, c]));
  auditTrailByTransactionId = new Map(
    Object.entries(seed.auditTrail).map(([txnId, events]) => [txnId, [...events]]),
  );
}

// Initial load at module import time.
loadFromSeed(buildSeedData());

/**
 * Restores the entire in-memory database to its pristine seed state.
 * Used by the "Reset Scenario" demo control so every demo run is
 * deterministic and repeatable.
 */
export function resetDatabase(): void {
  auditEventCounter = 0;
  operationCounter = 0;
  duplicatePaymentsPreventedCount = 0;
  idempotencyStore.clear();
  loadFromSeed(buildSeedData());
}

// ============================================================================
// REPOSITORY API — TRANSACTIONS
// ============================================================================

export function listTransactions(): Transaction[] {
  return Array.from(transactionsById.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

export function getTransaction(transactionId: string): Transaction | undefined {
  return transactionsById.get(transactionId);
}

export function listTransactionsBySender(senderId: string): Transaction[] {
  return listTransactions().filter((t) => t.sender_id === senderId);
}

export function listTransactionsByScenario(scenarioId: ScenarioId): Transaction[] {
  return listTransactions().filter((t) => t.scenario_id === scenarioId);
}

export function addTransaction(transaction: Transaction): Transaction {
  transactionsById.set(transaction.transaction_id, transaction);
  const customer = customersById.get(transaction.sender_id);
  if (customer && !customer.transaction_history.includes(transaction.transaction_id)) {
    customer.transaction_history.unshift(transaction.transaction_id);
  }
  return transaction;
}

export function updateTransaction(
  transactionId: string,
  patch: Partial<Omit<Transaction, 'transaction_id'>>,
): Transaction | undefined {
  const existing = transactionsById.get(transactionId);
  if (!existing) return undefined;
  const updated: Transaction = {
    ...existing,
    ...patch,
    updated_at: nowIso(),
  };
  transactionsById.set(transactionId, updated);
  return updated;
}

// ============================================================================
// REPOSITORY API — CUSTOMERS
// ============================================================================

export function listCustomers(): Customer[] {
  return Array.from(customersById.values());
}

export function getCustomer(userId: string): Customer | undefined {
  return customersById.get(userId);
}

export function updateCustomer(
  userId: string,
  patch: Partial<Omit<Customer, 'user_id'>>,
): Customer | undefined {
  const existing = customersById.get(userId);
  if (!existing) return undefined;
  const updated: Customer = { ...existing, ...patch };
  customersById.set(userId, updated);
  return updated;
}

// ============================================================================
// REPOSITORY API — BENEFICIARIES
// ============================================================================

export function listBeneficiaries(): Beneficiary[] {
  return Array.from(beneficiariesById.values());
}

export function getBeneficiary(beneficiaryId: string): Beneficiary | undefined {
  return beneficiariesById.get(beneficiaryId);
}

export function listBeneficiariesForCustomer(userId: string): Beneficiary[] {
  const customer = customersById.get(userId);
  if (!customer) return [];
  return customer.beneficiaries
    .map((id) => beneficiariesById.get(id))
    .filter((b): b is Beneficiary => Boolean(b));
}

export function updateBeneficiary(
  beneficiaryId: string,
  patch: Partial<Omit<Beneficiary, 'beneficiary_id'>>,
): Beneficiary | undefined {
  const existing = beneficiariesById.get(beneficiaryId);
  if (!existing) return undefined;
  const updated: Beneficiary = { ...existing, ...patch };
  beneficiariesById.set(beneficiaryId, updated);
  return updated;
}

/** Case-insensitive lookup by UPI ID, scoped to one customer's own saved
 * beneficiaries — used so paying the same new number twice reuses the same
 * beneficiary record (and its accumulating history) instead of minting a
 * fresh "just now" beneficiary, and therefore a fresh high-risk score, every
 * single time. */
export function findBeneficiaryByUpiIdForCustomer(userId: string, upiId: string): Beneficiary | undefined {
  const normalized = upiId.trim().toLowerCase();
  return listBeneficiariesForCustomer(userId).find((b) => b.upi_id.trim().toLowerCase() === normalized);
}

/** Registers a brand-new beneficiary (a phone number / UPI ID the customer
 * typed directly, not one of the pre-seeded demo contacts) and attaches it
 * to that customer's own beneficiary list, so it appears in their directory
 * and its "account age" is honestly measured from the moment it was added. */
export function addBeneficiary(beneficiary: Beneficiary, ownerUserId: string): Beneficiary {
  beneficiariesById.set(beneficiary.beneficiary_id, beneficiary);
  const customer = customersById.get(ownerUserId);
  if (customer && !customer.beneficiaries.includes(beneficiary.beneficiary_id)) {
    customer.beneficiaries.push(beneficiary.beneficiary_id);
  }
  return beneficiary;
}

/** Derived "account age in minutes" helper — used heavily by the risk engine. */
export function getBeneficiaryAgeMinutes(beneficiaryId: string): number | undefined {
  const beneficiary = beneficiariesById.get(beneficiaryId);
  if (!beneficiary) return undefined;
  return Math.floor((NOW() - new Date(beneficiary.account_created_at).getTime()) / 60_000);
}

// ============================================================================
// REPOSITORY API — SUPPORT CASES (CRM)
// ============================================================================

export function listSupportCases(): SupportCase[] {
  return Array.from(supportCasesById.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export function getSupportCase(caseId: string): SupportCase | undefined {
  return supportCasesById.get(caseId);
}

export function generateSupportCaseId(): string {
  const rand = Math.floor(10000 + Math.random() * 89999);
  return `SUP-${rand}`;
}

export function addSupportCase(supportCase: SupportCase): SupportCase {
  supportCasesById.set(supportCase.case_id, supportCase);
  return supportCase;
}

export function updateSupportCase(
  caseId: string,
  patch: Partial<Omit<SupportCase, 'case_id'>>,
): SupportCase | undefined {
  const existing = supportCasesById.get(caseId);
  if (!existing) return undefined;
  const updated: SupportCase = { ...existing, ...patch, updated_at: nowIso() };
  supportCasesById.set(caseId, updated);
  return updated;
}

// ============================================================================
// REPOSITORY API — AUDIT TRAIL
// ============================================================================

export function getAuditTrail(transactionId: string): AuditTrailEvent[] {
  return auditTrailByTransactionId.get(transactionId) ?? [];
}

export function appendAuditEvent(
  transactionId: string,
  actor: AuditTrailEvent['actor'],
  type: AuditTrailEvent['type'],
  description: string,
  metadata?: Record<string, unknown>,
): AuditTrailEvent {
  const event = buildAuditEvent(transactionId, actor, type, description, metadata);
  const existing = auditTrailByTransactionId.get(transactionId) ?? [];
  existing.push(event);
  auditTrailByTransactionId.set(transactionId, existing);
  return event;
}

// ============================================================================
// REPOSITORY API — IDEMPOTENCY (raw storage only; enforcement lives in the
// action gate / decision engine built in a later step)
// ============================================================================

export function reserveOperationId(): string {
  return nextOperationId();
}

export function getIdempotentResult<T = unknown>(operationId: string): T | undefined {
  return idempotencyStore.get(operationId) as T | undefined;
}

export function storeIdempotentResult(operationId: string, result: unknown): void {
  idempotencyStore.set(operationId, result);
}
