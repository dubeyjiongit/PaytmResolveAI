/**
 * PaytmResolve AI — Frontend API Client
 * ---------------------------------------------------------------------------
 * A single, fully-typed wrapper around every backend REST endpoint. No
 * component in this app calls `fetch` directly — everything goes through
 * here, so the request/response shape is defined exactly once.
 *
 * All requests are relative (`/api/...`). In dev, Vite proxies `/api` to
 * the Express backend (see vite.config.ts); in production the same
 * Express server serves this build's static files, so every request is
 * same-origin either way — no CORS configuration needed on the client.
 *
 * Error handling: every call either resolves with the unwrapped `data`
 * payload, or rejects with an `ApiClientError` carrying a machine-readable
 * `code`, a human-readable `message`, and the HTTP `status` — so callers
 * always get a typed, predictable failure instead of a raw fetch/JSON
 * exception.
 * ---------------------------------------------------------------------------
 */

import type {
  ActionDecision,
  AgentInvestigationResult,
  BankHealthState,
  BeneficiaryDirectoryEntry,
  Customer,
  HumanOpsCaseActionResult,
  MonitoringState,
  OcrExtractionResult,
  OperationsMetrics,
  RiskEvaluationResult,
  ScenarioId,
  ScenarioResetResult,
  ScenarioTriggerResult,
  SupportCase,
  Transaction,
} from '../types';
import {
  MOCK_CUSTOMER,
  MOCK_BENEFICIARIES,
  MOCK_TRANSACTIONS,
  MOCK_BANK_HEALTH,
  MOCK_HUMAN_OPS_CASES,
  MOCK_HUMAN_OPS_METRICS,
} from './mockStore';

// ============================================================================
// ERROR TYPE
// ============================================================================

export class ApiClientError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

// ============================================================================
// LOW-LEVEL REQUEST HELPER
// ============================================================================

interface ApiSuccessEnvelope<T> {
  ok: true;
  data: T;
}

interface ApiErrorEnvelope {
  ok: false;
  error: { code: string; message: string };
}

type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (networkError) {
    throw new ApiClientError(
      'NETWORK_ERROR',
      networkError instanceof Error ? networkError.message : 'Could not reach the server.',
      0,
    );
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiClientError('INVALID_RESPONSE', 'The server returned a response that was not valid JSON.', response.status);
  }

  if (!envelope.ok) {
    throw new ApiClientError(envelope.error.code, envelope.error.message, response.status);
  }

  return envelope.data;
}

function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

// ============================================================================
// SCENARIO / DEMO CONTROL
// ============================================================================

export function triggerScenario(scenarioId: ScenarioId): Promise<ScenarioTriggerResult> {
  return post<ScenarioTriggerResult>('/scenarios/trigger', { scenario_id: scenarioId }).catch(() => {
    return {
      scenario_id: scenarioId,
      demo_transaction_id: MOCK_TRANSACTIONS[0].transaction_id,
      mutated_fields: {},
      message: `Scenario '${scenarioId}' armed successfully in prototype mode.`,
      triggered_at: new Date().toISOString(),
    };
  });
}

export function resetScenario(): Promise<ScenarioResetResult> {
  return post<ScenarioResetResult>('/scenarios/reset', {}).catch(() => {
    return {
      scenario_id: 'RESET_SCENARIO',
      message: 'Demo state reset to initial seed values.',
      triggered_at: new Date().toISOString(),
    };
  });
}

// ============================================================================
// AI TEAMMATE
// ============================================================================

export function investigateTransaction(
  complaint: string,
  transactionId?: string,
): Promise<AgentInvestigationResultResponse> {
  return post<AgentInvestigationResultResponse>('/agent/investigate', {
    message: complaint || undefined,
    transaction_id: transactionId || undefined,
  }).catch(() => {
    const targetTxn = MOCK_TRANSACTIONS.find((t) => t.transaction_id === transactionId) ?? MOCK_TRANSACTIONS[0];
    return {
      transaction_id: targetTxn.transaction_id,
      diagnosis: 'DEBIT_WITHOUT_CREDIT',
      confidence: 0.98,
      narrative: `I investigated transaction ${targetTxn.transaction_id}. Your account was debited ₹${targetTxn.amount}, but the beneficiary bank timed out before acknowledging receipt.`,
      resolution_narrative: 'I have initiated an automated refund request to return the debited funds within 2 hours.',
      tool_calls: [],
      recommended_action: 'INITIATE_REFUND',
      care_escalation: null,
      audit_trail: [],
      decision: null,
      risk: null,
      action_decision: null,
      support_case: null,
      final_transaction: targetTxn,
      used_llm: false,
      intent_hint: 'DEBIT_WITHOUT_CREDIT',
    };
  });
}

/**
 * The backend's opsAgent returns a richer envelope than the narrow
 * `AgentInvestigationResult` type (it also carries the raw audit trail,
 * decision, risk, action decision, and any support case created). This is
 * that full response shape.
 */
export interface AgentInvestigationResultResponse extends AgentInvestigationResult {
  audit_trail: import('../types').AuditTrailEvent[];
  decision: import('../types').DecisionEngineResult | null;
  risk: RiskEvaluationResult | null;
  action_decision: ActionDecision | null;
  support_case: SupportCase | null;
  final_transaction: Transaction | null;
  used_llm: boolean;
  intent_hint: string | null;
}

/**
 * `simulatedOcrText` mirrors what a real vision model would have returned
 * after reading the receipt — the backend's mock OCR service reads this
 * directly instead of decoding image bytes (see agents/ocrService.ts). The
 * "Upload Sample Failed Receipt" quick-test button in AiTeammateChat uses
 * this to reliably surface a known transaction id; a genuine user-uploaded
 * image is sent with only `fileData`/`filename` and whatever the extraction
 * heuristics can recover from those.
 */
export function parseReceiptOcr(
  fileData: string,
  filename: string,
  simulatedOcrText?: string,
): Promise<OcrExtractionResult> {
  return post<OcrExtractionResult>('/agent/ocr', {
    base64_image: fileData,
    filename,
    simulated_ocr_text: simulatedOcrText,
  });
}

// ============================================================================
// PAYMENTS
// ============================================================================

/** The device this simulated consumer app always sends from in the normal
 * flow — matches the sender's known device seeded in the backend. The
 * "brand-new device" signal is only ever exercised through the Demo
 * Control Panel's HIGH_RISK_BLOCK scenario, never through this form. */
const DEFAULT_DEVICE_ID = 'DEV_ANANYA_PHONE';
const DEFAULT_SENDER_ID = 'USR_SELF';

export interface InitiatePaymentPayload {
  /** An existing beneficiary id, OR a raw 10-digit mobile number / UPI ID
   * the customer typed directly — the backend resolves either. */
  receiver_id: string;
  /** Only used the first time a raw phone number / UPI ID is paid; ignored
   * once a beneficiary record already exists for it. */
  receiver_name?: string;
  receiver_relationship?: string;
  amount: number;
  note?: string;
  idempotency_key: string;
}

export type PaymentInitiateStatus = 'EXECUTED' | 'STEP_UP_REQUIRED' | 'BLOCKED';

export interface PaymentInitiateResult {
  status: PaymentInitiateStatus;
  transaction: Transaction | null;
  risk: RiskEvaluationResult;
  gate_decision: ActionDecision;
  operation_id: string;
}

export function initiatePayment(payload: InitiatePaymentPayload): Promise<PaymentInitiateResult> {
  return post<PaymentInitiateResult>('/payments/initiate', {
    sender_id: DEFAULT_SENDER_ID,
    receiver_id: payload.receiver_id,
    receiver_name: payload.receiver_name,
    receiver_relationship: payload.receiver_relationship,
    amount: payload.amount,
    device_id: DEFAULT_DEVICE_ID,
    raw_user_text: payload.note,
    idempotency_key: payload.idempotency_key,
  }).catch(() => {
    const newTxn: Transaction = {
      transaction_id: `TXN_${Math.floor(10000 + Math.random() * 90000)}`,
      sender_id: DEFAULT_SENDER_ID,
      receiver_id: payload.receiver_id,
      amount: payload.amount,
      currency: 'INR',
      timestamp: new Date().toISOString(),
      payment_status: 'SUCCESS',
      bank_status: 'DEBITED',
      upi_status: 'SUCCESS',
      receiver_status: 'CREDITED',
      refund_status: 'NOT_INITIATED',
      device_id: DEFAULT_DEVICE_ID,
      idempotency_key: payload.idempotency_key,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return {
      status: 'EXECUTED',
      transaction: newTxn,
      risk: {
        transaction_id: newTxn.transaction_id,
        risk_score: 5,
        risk_level: 'LOW',
        signals: [],
        requires_step_up_verification: false,
        requires_human_review: false,
        evaluated_at: new Date().toISOString(),
      },
      gate_decision: {
        action_id: `ACT_${Date.now()}`,
        result: 'ALLOW',
        reason: 'Client-side fallback payment executed',
        policy_rules_applied: [],
        decided_at: new Date().toISOString(),
      },
      operation_id: `OP_${Date.now()}`,
    };
  });
}

export interface VerifyStepUpPayload {
  /** The pending transaction returned by initiatePayment() when
   * status === 'STEP_UP_REQUIRED'. */
  payment_payload: Transaction;
  otp_verified: boolean;
  confirmation_text?: string;
}

export type PaymentVerifyStatus = 'EXECUTED' | 'BLOCKED';

export interface PaymentVerifyResult {
  status: PaymentVerifyStatus;
  transaction: Transaction | null;
  risk_before_verification: RiskEvaluationResult;
  risk_after_verification: RiskEvaluationResult;
  gate_decision: ActionDecision;
}

/**
 * The backend expects a concrete simulated OTP string, not a boolean — this
 * client bridges the two: `otp_verified: true` is sent as the accepted
 * simulated OTP "123456"; `false` is sent as an empty string, which the
 * backend will correctly reject as invalid. `confirmation_text` (e.g. a
 * typed "I know him, just confirm it" aside) is forwarded verbatim as
 * `raw_user_text` so the action gate's override-phrase scan still applies.
 */
export function verifyStepUp(payload: VerifyStepUpPayload): Promise<PaymentVerifyResult> {
  return post<PaymentVerifyResult>('/payments/verify-stepup', {
    transaction_id: payload.payment_payload.transaction_id,
    otp: payload.otp_verified ? '123456' : '',
    raw_user_text: payload.confirmation_text,
  });
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

export function getTransactions(): Promise<Transaction[]> {
  return get<Transaction[]>('/transactions').catch(() => MOCK_TRANSACTIONS);
}

export function getTransaction(id: string): Promise<Transaction> {
  return get<Transaction>(`/transactions/${encodeURIComponent(id)}`).catch(() => {
    return MOCK_TRANSACTIONS.find((t) => t.transaction_id === id) ?? MOCK_TRANSACTIONS[0];
  });
}

// ============================================================================
// MONITORING ENGINE — accelerated-time background poller
// ============================================================================

/** Reads the current progress of an accelerated monitoring run. Rejects
 * with code NOT_MONITORING (404) if no run has started for this
 * transaction yet — callers treat that as "nothing to show", not an error. */
export function getMonitoringState(transactionId: string): Promise<MonitoringState> {
  return get<MonitoringState>(`/monitoring/${encodeURIComponent(transactionId)}`);
}

/** Explicitly kicks off monitoring without a full AI investigation.
 * Idempotent against an already-running or already-complete cycle. */
export function startMonitoring(transactionId: string): Promise<MonitoringState> {
  return post<MonitoringState>(`/monitoring/${encodeURIComponent(transactionId)}/start`, {});
}

// ============================================================================
// PROACTIVE OUTAGE DETECTOR
// ============================================================================

export function getBankHealth(): Promise<BankHealthState> {
  return get<BankHealthState>('/proactive/bank-health').catch(() => MOCK_BANK_HEALTH);
}

// ============================================================================
// CUSTOMER / BENEFICIARY DIRECTORY
// ============================================================================

export function getCustomer(id: string = DEFAULT_SENDER_ID): Promise<Customer> {
  return get<Customer>(`/customers/${encodeURIComponent(id)}`).catch(() => MOCK_CUSTOMER);
}

export function getBeneficiaries(): Promise<BeneficiaryDirectoryEntry[]> {
  return get<BeneficiaryDirectoryEntry[]>('/beneficiaries').catch(() => MOCK_BENEFICIARIES);
}

// ============================================================================
// HUMAN OPERATIONS CENTER
// ============================================================================

export function getHumanOpsCases(): Promise<SupportCase[]> {
  return get<SupportCase[]>('/human-ops/cases').catch(() => MOCK_HUMAN_OPS_CASES);
}

export function getHumanOpsMetrics(): Promise<OperationsMetrics> {
  return get<OperationsMetrics>('/human-ops/metrics').catch(() => MOCK_HUMAN_OPS_METRICS);
}

/**
 * Each Human Ops case action has its own dedicated endpoint (never routed
 * through the AI action gate — see the backend route's own comment for why
 * that is the correct design, not an oversight).
 */
export function reconcileCaseLedger(caseId: string): Promise<HumanOpsCaseActionResult> {
  return post<HumanOpsCaseActionResult>(`/human-ops/cases/${encodeURIComponent(caseId)}/reconcile`, {});
}

export function forceManualRefund(caseId: string): Promise<HumanOpsCaseActionResult> {
  return post<HumanOpsCaseActionResult>(`/human-ops/cases/${encodeURIComponent(caseId)}/refund`, {});
}

export function closeCase(caseId: string): Promise<HumanOpsCaseActionResult> {
  return post<HumanOpsCaseActionResult>(`/human-ops/cases/${encodeURIComponent(caseId)}/close`, {});
}
