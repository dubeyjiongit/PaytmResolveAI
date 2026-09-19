/**
 * PaytmResolve AI — Frontend Shared Type Definitions
 * ---------------------------------------------------------------------------
 * MIRROR NOTE: This file intentionally duplicates the domain-facing types
 * from backend/src/types/index.ts. The frontend (Vite/React) and backend
 * (Node/Express) are separate npm packages with no shared workspace, so the
 * wire-format contract is kept in sync by hand across both files. If you
 * change a domain type in one, change it in the other.
 *
 * This file also adds a small number of UI-only types at the bottom
 * (clearly marked) that have no backend equivalent.
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// 1. CORE STATE MACHINE — the 4 independently-tracked transaction rails
// ============================================================================

export type BankStatus = 'NOT_DEBITED' | 'DEBITED' | 'REVERSED' | 'UNKNOWN';

export type UpiStatus =
  | 'NOT_INITIATED'
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN';

export type ReceiverStatus = 'NOT_RECEIVED' | 'CREDITED' | 'UNKNOWN';

export type RefundStatus =
  | 'NOT_INITIATED'
  | 'REQUESTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'UNKNOWN';

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
  /** Stopped on purpose by risk/compliance policy before the bank ever saw
   * it — not a technical failure, so kept distinct from FAILED. */
  | 'BLOCKED';

// ============================================================================
// 2. TRANSACTION
// ============================================================================

export interface Transaction {
  transaction_id: string;
  sender_id: string;
  receiver_id: string;
  amount: number;
  currency: 'INR';
  timestamp: string;

  payment_status: PaymentStatus;
  bank_status: BankStatus;
  upi_status: UpiStatus;
  receiver_status: ReceiverStatus;
  refund_status: RefundStatus;

  device_id: string;
  idempotency_key: string;

  created_at: string;
  updated_at: string;

  scenario_id?: ScenarioId;
  note?: string;
  is_duplicate_candidate_of?: string;
  is_closed?: boolean;
  is_ledger_reconciled?: boolean;

  /** Set only when payment_status === 'BLOCKED'. The real policy reason
   * this payment was stopped, straight from the action gate. */
  policy_block_reason?: string;
}

// ============================================================================
// 3. CUSTOMER
// ============================================================================

export interface Customer {
  user_id: string;
  name: string;
  email: string;
  phone: string;
  balance: number;
  normal_transaction_amount: number;
  transaction_history: string[];
  known_devices: string[];
  beneficiaries: string[];
  created_at: string;
}

// ============================================================================
// 4. BENEFICIARY
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
  account_created_at: string;
  previous_transactions: number;
  average_received_amount: number;
  dispute_count: number;
  risk_signals: BeneficiaryRiskSignal[];
  relationship: BeneficiaryRelationship;
}

// ============================================================================
// 5. AUDIT TRAIL
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
  timestamp: string;
  actor: AuditActor;
  type: AuditEventType;
  description: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 6. SUPPORT CASE (CRM)
// ============================================================================

export type SupportCasePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type SupportCaseStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'CLOSED';

export interface SupportCase {
  case_id: string;
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
  risk_score: number;
  risk_level: RiskLevel;
  signals: RiskSignalResult[];
  requires_step_up_verification: boolean;
  requires_human_review: boolean;
  evaluated_at: string;
}

export const RISK_THRESHOLDS: Record<RiskLevel, { min: number; max: number }> = {
  LOW: { min: 0, max: 20 },
  MODERATE: { min: 21, max: 50 },
  HIGH: { min: 51, max: 75 },
  CRITICAL: { min: 76, max: 100 },
};

// ============================================================================
// 8. ACTION GATE
// ============================================================================

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
  operation_id?: string;
  user_confirmation?: boolean;
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
// 9. AI TEAMMATE — chat + tool-calling contracts
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
  /** Not a transaction investigation at all — a general in-domain question
   * (how UPI works, why step-up triggered, etc.) answered from a small
   * built-in knowledge base instead of a transaction search. */
  | 'GENERAL_QUESTION_ANSWERED'
  /** Qualitative, high-liability, legal, or human-dependent case (fraud,
   * wrong-beneficiary transfer, account takeover, merchant dispute,
   * regulatory/severe distress). The AI halts and hands off to Customer
   * Care instead of attempting any automated resolution. */
  | 'ESCALATED_TO_CUSTOMER_CARE'
  /** This payment was deliberately stopped by risk/compliance policy
   * before it ever reached the bank — never a bug to fix or a network
   * hiccup to retry. */
  | 'POLICY_BLOCKED';

export type CareEscalationCategory =
  | 'FRAUD_SCAM_PHISHING'
  | 'WRONG_BENEFICIARY_TRANSFER'
  | 'ACCOUNT_TAKEOVER_SECURITY'
  | 'MERCHANT_PHYSICAL_DISPUTE'
  | 'REGULATORY_SEVERE_DISTRESS';

export type CareEscalationStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export interface CareEscalation {
  ticket_id: string;
  category: CareEscalationCategory;
  reason: string;
  priority: 'URGENT';
  phone_display: string;
  phone_tel_href: string;
  status: CareEscalationStatus;
  created_at: string;
}

export interface AgentInvestigationResult {
  /** Null when the AI couldn't match the complaint to a real transaction —
   * a legitimate, honest outcome (see opsAgent.ts), not an error. Every
   * consumer of this type MUST handle the null case; it is not optional. */
  transaction_id: string | null;
  diagnosis: AgentDiagnosisLabel;
  confidence: number;
  /** The "what I found" half — sent as the first chat message. */
  narrative: string;
  /** The "what I did about it" half — null when there's nothing further to
   * report. Sent as a second chat message a short beat after the first. */
  resolution_narrative: string | null;
  tool_calls: AgentToolCallRecord[];
  /** Null exactly when transaction_id is null — there is nothing to
   * recommend when no transaction was found. */
  recommended_action: ProposedActionType | null;
  /** Non-null exactly when diagnosis === 'ESCALATED_TO_CUSTOMER_CARE'. */
  care_escalation: CareEscalation | null;
}

// ============================================================================
// 9b. DECISION ENGINE — deterministic recovery / escalation matrix over the
//     4-way transaction state machine
// ============================================================================

export type DecisionCode =
  | 'REVERSAL_WORKFLOW'
  | 'HUMAN_ESCALATION'
  | 'MONITOR_AND_POLL'
  | 'DUPLICATE_BLOCKED'
  | 'ALREADY_RESOLVED'
  | 'SAFE_TO_PROCEED'
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
  confidence: number;
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
// 12b. HUMAN OPS CENTER — case dossier actions
// ============================================================================

export type HumanOpsCaseAction = 'RECONCILE_LEDGER' | 'FORCE_MANUAL_REFUND' | 'CLOSE_CASE';

export interface HumanOpsCaseActionResult {
  case: SupportCase;
  transaction: Transaction | null;
  message: string;
}

// ============================================================================
// 13. MONITORING ENGINE — accelerated-time background poller
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
// 14. PROACTIVE OUTAGE DETECTOR
// ============================================================================

export type BankHealthStatus = 'NOMINAL' | 'DEGRADED';

export interface BankHealthState {
  bank_name: string;
  status: BankHealthStatus;
  baseline_timeout_rate: number;
  current_timeout_rate: number;
  surge_percent: number;
  message: string;
  updated_at: string;
}

// ============================================================================
// 13. FRONTEND-ONLY UI TYPES (no backend equivalent)
// ============================================================================

/** One line item rendered in the live "AI Activity" timeline panel. */
export interface ActivityTimelineItem {
  event_id: string;
  timestamp: string;
  actor: AuditActor;
  type: AuditEventType;
  description: string;
  /** Small icon/checkmark hint for the timeline UI. */
  status: 'DONE' | 'IN_PROGRESS' | 'BLOCKED' | 'WARNING';
}

/** Props-friendly shape for rendering one Demo Control Panel button. */
export interface DemoScenarioButtonViewModel extends DemoScenarioConfig {
  is_active: boolean;
}

/** Local chat UI state wrapper around ChatMessage (adds pending/streaming flag). */
export interface ChatUIMessage extends ChatMessage {
  is_pending?: boolean;
}
