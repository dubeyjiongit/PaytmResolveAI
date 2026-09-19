/**
 * PaytmResolve AI — Backend Shared Type Definitions
 * ---------------------------------------------------------------------------
 * Single source of truth for every domain object, state-machine enum,
 * engine contract, and AI-tool contract used across the backend.
 *
 * MIRROR NOTE: frontend/src/types/index.ts intentionally duplicates the
 * domain-facing subset of these types (frontend and backend are separate
 * npm packages with no shared workspace). If you change a domain type here,
 * change it there too.
 *
 * Nothing in this file performs any logic. It is pure type/interface/enum
 * declaration so that mockDb, engines, agents, and routes all agree on
 * shape.
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// 1. CORE STATE MACHINE — the 4 independently-tracked transaction rails
// ============================================================================

/** Money-rail: did the sender's bank actually move funds out? */
export type BankStatus = 'NOT_DEBITED' | 'DEBITED' | 'REVERSED' | 'UNKNOWN';

/** Switch-rail: what did the UPI/payment switch report back? */
export type UpiStatus =
  | 'NOT_INITIATED'
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN';

/** Credit-rail: did the beneficiary's account actually receive funds? */
export type ReceiverStatus = 'NOT_RECEIVED' | 'CREDITED' | 'UNKNOWN';

/** Recovery-rail: lifecycle of a refund/reversal for this transaction. */
export type RefundStatus =
  | 'NOT_INITIATED'
  | 'REQUESTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'UNKNOWN';

/**
 * The single "headline" status shown to the user. This is a DERIVED /
 * ASSIGNED label — it never replaces the 4 independent rails above, it just
 * summarizes them for simple UI surfaces (transaction list rows, etc).
 */
export type PaymentStatus =
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'DEBITED'
  | 'REVERSED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'UNKNOWN'
  /** Deliberately separate from FAILED: the bank/UPI switch never touched
   * this payment at all (nothing was debited) — it was stopped on purpose
   * by our own risk/compliance policy before it could be sent, not by a
   * technical glitch. Keeping it its own status is what lets the AI
   * Teammate tell the customer the true story instead of "something went
   * wrong, retrying might help." */
  | 'BLOCKED';

// ============================================================================
// 2. TRANSACTION
// ============================================================================

export interface Transaction {
  transaction_id: string;
  sender_id: string;
  receiver_id: string; // beneficiary_id
  amount: number;
  currency: 'INR';
  timestamp: string; // ISO-8601, when the payment attempt was made

  // The 4-way decoupled state machine
  payment_status: PaymentStatus;
  bank_status: BankStatus;
  upi_status: UpiStatus;
  receiver_status: ReceiverStatus;
  refund_status: RefundStatus;

  device_id: string;
  idempotency_key: string;

  created_at: string; // ISO-8601
  updated_at: string; // ISO-8601

  /** Tag identifying which demo/causal scenario produced this record, if any. */
  scenario_id?: ScenarioId;

  /** Free-text operator/AI note surfaced in transaction history rows. */
  note?: string;

  /** If this transaction is suspected to be a re-send of another, its id. */
  is_duplicate_candidate_of?: string;

  /** True once a human or the AI has confirmed this transaction is closed. */
  is_closed?: boolean;

  /** True once a Human Ops operator has run "Reconcile Ledger" on the case
   * covering this transaction. This is deliberately kept SEPARATE from
   * bank_status/upi_status/receiver_status/refund_status — it records that
   * a human has reviewed and reconciled the ledger, not a new value of any
   * of the 4 canonical rails, preserving those as the single source of
   * truth for the state machine. */
  is_ledger_reconciled?: boolean;

  /** Set only when payment_status === 'BLOCKED'. The exact policy reason
   * this payment was stopped (e.g. "Risk score 92/100 exceeds the
   * hard-block threshold..."), carried straight from the action gate's
   * decision so the AI Teammate can repeat the real reason back to the
   * customer instead of inventing one. */
  policy_block_reason?: string;
}

// ============================================================================
// 3. CUSTOMER (sender-side account holder)
// ============================================================================

export interface Customer {
  user_id: string;
  name: string;
  email: string;
  phone: string;
  balance: number;
  normal_transaction_amount: number;
  /** transaction_ids, most recent first */
  transaction_history: string[];
  known_devices: string[];
  /** beneficiary_ids this customer has saved/sent to */
  beneficiaries: string[];
  created_at: string;
}

// ============================================================================
// 4. BENEFICIARY (receiver-side profile + risk memory)
// ============================================================================

export type BeneficiaryRelationship =
  | 'PERSONAL_CONTACT'
  | 'BUSINESS_VENDOR'
  | 'RECENTLY_CHANGED_ACCOUNT'
  | 'OTHER';

export type BeneficiaryRiskSignal =
  | 'NEW_BENEFICIARY'
  | 'NO_TRANSACTION_HISTORY'
  | 'UNUSUAL_TIME'
  | 'HIGH_VELOCITY_RECEIVER'
  | 'ACCOUNT_RECENTLY_CHANGED'
  | 'PRIOR_DISPUTE';

export interface Beneficiary {
  beneficiary_id: string;
  name: string;
  upi_id: string;
  /** ISO-8601 — beneficiary "age" is derived from this at read-time. */
  account_created_at: string;
  previous_transactions: number;
  average_received_amount: number;
  dispute_count: number;
  risk_signals: BeneficiaryRiskSignal[];
  relationship: BeneficiaryRelationship;
}

// ============================================================================
// 5. AUDIT TRAIL — the append-only proof log ("what the AI actually did")
// ============================================================================

export type AuditActor = 'USER' | 'AI' | 'SYSTEM' | 'HUMAN';

export type AuditEventType =
  | 'COMPLAINT_RECEIVED'
  | 'USER_INPUT'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'STATE_CHANGE'
  | 'RISK_EVALUATED'
  | 'DECISION'
  | 'ACTION_PROPOSED'
  | 'ACTION_GATE_BLOCKED'
  | 'ACTION_GATE_ALLOWED'
  | 'ACTION_EXECUTED'
  | 'VERIFICATION'
  | 'ESCALATION'
  | 'NOTIFICATION'
  | 'MONITORING_CHECK'
  | 'RESOLUTION'
  | 'PROMPT_INJECTION_BLOCKED';

export interface AuditTrailEvent {
  event_id: string;
  transaction_id: string;
  timestamp: string; // ISO-8601
  actor: AuditActor;
  type: AuditEventType;
  description: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 6. SUPPORT CASE (CRM) — human escalation record
// ============================================================================

export type SupportCasePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type SupportCaseStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'CLOSED';

export interface SupportCase {
  case_id: string; // e.g. "SUP-48291"
  transaction_id: string;
  customer_id: string;
  reason: string;
  priority: SupportCasePriority;
  investigation_timeline: AuditTrailEvent[];
  evidence: Record<string, unknown>;
  diagnosis: string;
  actions_taken: string[];
  recommended_action: string;
  customer_instruction: string;
  status: SupportCaseStatus;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 7. RISK ENGINE
// ============================================================================

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export type RiskSignalName =
  | 'AMOUNT_ANOMALY'
  | 'NEW_BENEFICIARY'
  | 'BENEFICIARY_AGE'
  | 'BENEFICIARY_HISTORY'
  | 'VELOCITY'
  | 'DEVICE_CHANGE'
  | 'TIME_CONTEXT'
  | 'ACCOUNT_HISTORY'
  | 'RECEIVER_BEHAVIOUR'
  | 'TRANSACTION_INTEGRITY';

export interface RiskSignalResult {
  name: RiskSignalName;
  label: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  score_contribution: number;
  detail: string;
}

export interface RiskEvaluationResult {
  transaction_id: string;
  risk_score: number; // 0-100
  risk_level: RiskLevel;
  signals: RiskSignalResult[];
  requires_step_up_verification: boolean;
  requires_human_review: boolean;
  evaluated_at: string;
}

/** Prototype policy thresholds — labelled explicitly, never hidden magic numbers. */
export const RISK_THRESHOLDS: Record<RiskLevel, { min: number; max: number }> = {
  LOW: { min: 0, max: 20 },
  MODERATE: { min: 21, max: 50 },
  HIGH: { min: 51, max: 75 },
  CRITICAL: { min: 76, max: 100 },
};

// ============================================================================
// 8. ACTION GATE — the deterministic wall between LLM proposals and money
// ============================================================================

/**
 * Level 0 Observe   — read-only, no gate needed
 * Level 1 Low-Risk   — reversible / small-amount actions, auto-allowed if policy passes
 * Level 2 Step-Up    — requires simulated OTP + explicit user confirmation
 * Level 3 Blocked    — human-operations-only, AI cannot execute regardless of confirmation
 */
export type PermissionLevel = 0 | 1 | 2 | 3;

export type ProposedActionType =
  | 'RETRY_PAYMENT'
  | 'NEW_PAYMENT'
  | 'INITIATE_REFUND'
  | 'REVERSE_DEBIT'
  | 'CREATE_SUPPORT_CASE'
  | 'SEND_NOTIFICATION'
  | 'REQUEST_STEP_UP_VERIFICATION'
  | 'CONFIRM_AND_EXECUTE_PAYMENT'
  | 'MONITOR_TRANSACTION'
  | 'ESCALATE_TO_HUMAN'
  | 'BLOCK_ACTION';

export interface ActionRequest {
  action_id: string;
  transaction_id?: string;
  type: ProposedActionType;
  proposed_by: 'AI' | 'USER' | 'SYSTEM';
  payload: Record<string, unknown>;
  requested_at: string;
  /** Idempotency key supplied by the caller for financial operations. */
  operation_id?: string;
  user_confirmation?: boolean;
  /** Raw text the user typed, retained so the gate can scan for override phrases. */
  raw_user_text?: string;
  override_attempt_detected?: boolean;
}

export type ActionDecisionResult =
  | 'ALLOW'
  | 'BLOCK'
  | 'REQUIRE_STEP_UP'
  | 'ESCALATE'
  | 'BLOCKED_BY_POLICY';

export interface ActionDecision {
  action_id: string;
  result: ActionDecisionResult;
  reason: string;
  policy_rules_applied: string[];
  risk_score?: number;
  decided_at: string;
}

// ============================================================================
// 9. AI TEAMMATE (opsAgent) — chat + tool-calling contracts
// ============================================================================

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  created_at: string;
  transaction_id?: string;
  tool_calls?: AgentToolCallRecord[];
}

export type AgentToolName =
  | 'get_transaction'
  | 'get_bank_status'
  | 'get_upi_status'
  | 'get_receiver_status'
  | 'get_refund_status'
  | 'get_customer'
  | 'get_beneficiary'
  | 'get_risk_evaluation'
  | 'propose_action';

export interface AgentToolCallRecord {
  call_id: string;
  tool_name: AgentToolName;
  arguments: Record<string, unknown>;
  result?: unknown;
  timestamp: string;
}

export type AgentDiagnosisLabel =
  | 'TRANSACTION_HEALTHY'
  | 'NETWORK_TIMEOUT_POST_DEBIT'
  | 'DEBIT_WITHOUT_CREDIT'
  | 'SETTLEMENT_PENDING'
  | 'POSSIBLE_DUPLICATE'
  | 'CONFLICTING_STATE_UNSAFE'
  | 'HIGH_RISK_NEW_BENEFICIARY'
  | 'REFUND_IN_PROGRESS'
  | 'REFUND_COMPLETE'
  | 'TRANSACTION_NOT_FOUND'
  /** Not a transaction investigation at all — a general question about how
   * this app / UPI / the risk engine works, answered from a small built-in
   * knowledge base instead of a (nonsensical) transaction search. */
  | 'GENERAL_QUESTION_ANSWERED'
  /** Qualitative, high-liability, legal, or human-dependent case (fraud,
   * wrong-beneficiary transfer, account takeover, merchant dispute,
   * regulatory/severe distress). The AI never attempts automated
   * resolution for these — it halts and hands off to Customer Care. */
  | 'ESCALATED_TO_CUSTOMER_CARE'
  /** This payment was deliberately stopped by risk/compliance policy
   * before it ever reached the bank — never a bug to fix or a network
   * hiccup to retry. The AI explains the real reason and hands it to
   * human ops for manual clearance instead of attempting anything
   * automatic. */
  | 'POLICY_BLOCKED';

// ============================================================================
// 6b. CUSTOMER CARE ESCALATION — human-only edge cases
// ----------------------------------------------------------------------------
// A small, separate concept from SupportCase (which is always tied to one
// transaction and represents "the AI investigated and a human needs to
// finish the job"). A care escalation instead means "the AI never started
// — this category of problem needs a human from the first message," and it
// may have no transaction at all (e.g. "someone is trying to scam me").
// ============================================================================

export type CareEscalationCategory =
  | 'FRAUD_SCAM_PHISHING'
  | 'WRONG_BENEFICIARY_TRANSFER'
  | 'ACCOUNT_TAKEOVER_SECURITY'
  | 'MERCHANT_PHYSICAL_DISPUTE'
  | 'REGULATORY_SEVERE_DISTRESS';

export type CareEscalationStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export interface CareEscalation {
  ticket_id: string; // e.g. "CARE-78219"
  category: CareEscalationCategory;
  reason: string;
  /** Every category this protocol intercepts is, by definition, one the AI
   * won't touch automatically — so priority is always URGENT. Kept as a
   * literal (not a general SupportCasePriority) so that's explicit in the
   * type itself, not just convention. */
  priority: 'URGENT';
  /** Placeholder Customer Care number — replace with a real support line
   * before this ever reaches production. Never a claim that this number is
   * staffed; the whole flow is a simulated hand-off for demo purposes. */
  phone_display: string;
  phone_tel_href: string;
  status: CareEscalationStatus;
  created_at: string;
}

export interface AgentInvestigationResult {
  transaction_id: string;
  diagnosis: AgentDiagnosisLabel;
  confidence: number; // 0-1
  narrative: string;
  tool_calls: AgentToolCallRecord[];
  recommended_action: ProposedActionType;
}

// ============================================================================
// 9b. DECISION ENGINE — deterministic recovery / escalation matrix over the
//     4-way transaction state machine (Directive: "This should be
//     deterministic code, not just LLM reasoning.")
// ============================================================================

export type DecisionCode =
  | 'REVERSAL_WORKFLOW'
  | 'HUMAN_ESCALATION'
  | 'MONITOR_AND_POLL'
  | 'DUPLICATE_BLOCKED'
  | 'ALREADY_RESOLVED'
  | 'SAFE_TO_PROCEED'
  /** payment_status === 'BLOCKED': the payment was stopped by policy before
   * it reached the bank. Distinct from HUMAN_ESCALATION (which fires on a
   * technical state the engine can't safely interpret) — here the state is
   * perfectly clear, the AI just isn't the one authorized to override it. */
  | 'POLICY_BLOCKED';

export interface DecisionEngineResult {
  transaction_id: string;
  decision_code: DecisionCode;
  recommended_action: ProposedActionType;
  allow_retry: boolean;
  reason: string;
  rules_applied: string[];
  evaluated_at: string;
}

// ============================================================================
// 10. DEMO / SIMULATION ENGINE
// ============================================================================

export type ScenarioId =
  | 'NETWORK_FAILURE'
  | 'DEBIT_NO_CREDIT'
  | 'PENDING_TIMEOUT'
  | 'DUPLICATE_PAYMENT'
  | 'CONFLICTING_STATES'
  | 'NEW_BENEFICIARY_HIGH_VALUE'
  | 'HIGH_RISK_BLOCK'
  | 'BENEFICIARY_HISTORY_DECAY'
  | 'BANK_TIMEOUT_SPIKE';

export type DemoControlAction = ScenarioId | 'RESET_SCENARIO';

export interface DemoScenarioConfig {
  scenario_id: ScenarioId;
  button_label: string;
  description: string;
  backend_effect: string;
  demo_transaction_id: string;
}

/** Result of a Demo Control Panel button mutating the mock environment. */
export interface ScenarioTriggerResult {
  scenario_id: ScenarioId;
  demo_transaction_id: string;
  mutated_fields: Partial<Transaction>;
  message: string;
  triggered_at: string;
}

/** Result of the "Reset Scenario" control — restores the pristine seed state. */
export interface ScenarioResetResult {
  scenario_id: 'RESET_SCENARIO';
  message: string;
  triggered_at: string;
}

// ============================================================================
// 11. GENERIC API ENVELOPES
// ============================================================================

export interface ApiSuccessResponse<T> {
  ok: true;
  data: T;
}

export interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ============================================================================
// 10b. BENEFICIARY DIRECTORY — enriched listing for UI dropdowns
// ============================================================================

export interface BeneficiaryDirectoryEntry {
  beneficiary: Beneficiary;
  account_age_minutes: number;
}

// ============================================================================
// 11b. OCR / RECEIPT-VISION SERVICE
// ============================================================================

export interface OcrExtractionResult {
  found_transaction_id: string | null;
  extracted_amount: number | null;
  extracted_receiver_id: string | null;
  extracted_receiver_name: string | null;
  extracted_timestamp: string | null;
  extracted_status: PaymentStatus | null;
  confidence: number; // 0-1
  raw_source: string;
  matched_existing_record: boolean;
}

// ============================================================================
// 12. OBSERVABILITY DASHBOARD
// ============================================================================

export interface OperationsMetrics {
  cases_handled: number;
  auto_resolved: number;
  escalated: number;
  average_resolution_seconds: number;
  duplicate_payments_prevented: number;
  refund_workflows: number;
  human_interventions: number;
}

// ============================================================================
// 13. HUMAN OPS CENTER — case dossier actions
// ----------------------------------------------------------------------------
// A human operator's manual actions on an escalated support case. These are
// NOT AI actions and are never routed through the AI action gate — a human
// operator explicitly clicking a button in the Human Ops Center is the
// deterministic, authorized override the whole escalation path exists to
// reach. Each action is still applied by fully deterministic backend code,
// never a text description of what would happen.
// ============================================================================

export type HumanOpsCaseAction = 'RECONCILE_LEDGER' | 'FORCE_MANUAL_REFUND' | 'CLOSE_CASE';

/** Shared response shape for all three dedicated case-action endpoints
 * (/reconcile, /refund, /close) — each mutates the case and/or transaction
 * and returns both plus a human-readable summary. */
export interface HumanOpsCaseActionResult {
  case: SupportCase;
  transaction: Transaction | null;
  message: string;
}

// ============================================================================
// 14. MONITORING ENGINE — accelerated-time background poller for
//     still-settling ("PENDING") transactions.
// ----------------------------------------------------------------------------
// Directive: simulate a real polling loop (bank/UPI switch checked
// periodically) but on an accelerated demo clock so a judge doesn't have to
// wait for real settlement windows. Every check is still a real, timestamped,
// deterministic state transition recorded on the transaction and its audit
// trail — nothing here is narrated without actually happening.
// ============================================================================

export type MonitoringCheckStatus = 'PENDING' | 'SUCCESS';

export interface MonitoringCheck {
  check_number: 1 | 2 | 3;
  elapsed_ms: number;
  observed_at: string;
  observed_status: MonitoringCheckStatus;
  description: string;
}

export interface MonitoringState {
  transaction_id: string;
  started_at: string;
  is_running: boolean;
  is_complete: boolean;
  checks: MonitoringCheck[];
  resolution_message: string | null;
}

// ============================================================================
// 15. PROACTIVE OUTAGE DETECTOR — bank/gateway health used to warn
//     customers BEFORE they initiate a payment, not just after it fails.
// ============================================================================

export type BankHealthStatus = 'NOMINAL' | 'DEGRADED';

export interface BankHealthState {
  bank_name: string;
  status: BankHealthStatus;
  baseline_timeout_rate: number; // 0-1
  current_timeout_rate: number; // 0-1
  surge_percent: number; // e.g. 340 means +340% over baseline
  message: string;
  updated_at: string;
}
