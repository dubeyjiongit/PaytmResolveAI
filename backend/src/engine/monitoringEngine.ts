/**
 * PaytmResolve AI — Monitoring Engine (Accelerated Time)
 * ---------------------------------------------------------------------------
 * Directive: a transaction the decision engine diagnoses as MONITOR_AND_POLL
 * (still settling — retrying now would risk a duplicate debit) should be
 * watched with a real, periodic poll loop rather than resolved instantly or
 * left to a static "please wait" message. Directive 24 ("simulation can
 * accelerate time") lets this run on a demo-friendly clock instead of a real
 * NPCI settlement window:
 *
 *   Check #1 (+0s):  PENDING  — settlement still open.
 *   Check #2 (+3s):  PENDING  — settlement still open.
 *   Check #3 (+6s):  SUCCESS  — settlement confirmed, transaction resolved.
 *
 * Every check is a REAL, timestamped, deterministic transition — recorded
 * on the transaction's audit trail via appendAuditEvent — not a narrated
 * fake status. The final check actually mutates the transaction record
 * (upi_status, receiver_status, payment_status) exactly as a real UPI
 * switch callback would. No LLM is involved anywhere in this file; this is
 * plain scheduled deterministic code, consistent with "zero LLM financial
 * authority."
 *
 * The frontend (AiTeammateChat) polls `GET /api/monitoring/:transactionId`
 * once a second while a monitoring run is active and renders each new
 * check onto the Live Activity Timeline as it lands, then shows the final
 * "✓ Transaction resolved. Customer notified." message once is_complete.
 * ---------------------------------------------------------------------------
 */

import type { MonitoringCheck, MonitoringCheckStatus, MonitoringState } from '../types/index.js';
import { appendAuditEvent, getTransaction, updateTransaction } from '../mockDb/transactions.js';

// ============================================================================
// ACCELERATED CHECK SCHEDULE
// ============================================================================

/** [elapsed_ms, observed_status] for each of the 3 checks, in order. */
const CHECK_SCHEDULE: ReadonlyArray<{ elapsedMs: number; status: MonitoringCheckStatus }> = [
  { elapsedMs: 0, status: 'PENDING' },
  { elapsedMs: 3_000, status: 'PENDING' },
  { elapsedMs: 6_000, status: 'SUCCESS' },
];

const RESOLUTION_MESSAGE = '✓ Transaction resolved. Customer notified.';

// ============================================================================
// LIVE, MUTABLE STORE
// ============================================================================

const monitoringStates = new Map<string, MonitoringState>();
const activeTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

function nowIso(): string {
  return new Date().toISOString();
}

function clearTimersFor(transactionId: string): void {
  const timers = activeTimers.get(transactionId);
  if (timers) {
    for (const timer of timers) clearTimeout(timer);
  }
  activeTimers.delete(transactionId);
}

// ============================================================================
// RUN A SINGLE CHECK
// ============================================================================

function runCheck(transactionId: string, checkIndex: number): void {
  const state = monitoringStates.get(transactionId);
  if (!state || !state.is_running) return; // reset/cancelled since scheduling

  const { elapsedMs, status } = CHECK_SCHEDULE[checkIndex];
  const checkNumber = (checkIndex + 1) as 1 | 2 | 3;
  const isFinalCheck = checkIndex === CHECK_SCHEDULE.length - 1;

  const description = isFinalCheck
    ? `Check #${checkNumber}: NPCI settlement confirmed — UPI switch reports SUCCESS.`
    : `Check #${checkNumber}: UPI switch polled — settlement window still open (PENDING).`;

  const check: MonitoringCheck = {
    check_number: checkNumber,
    elapsed_ms: elapsedMs,
    observed_at: nowIso(),
    observed_status: status,
    description,
  };

  state.checks.push(check);

  appendAuditEvent(transactionId, 'SYSTEM', 'MONITORING_CHECK', description, {
    check_number: checkNumber,
    observed_status: status,
  });

  if (isFinalCheck) {
    const settled = updateTransaction(transactionId, {
      payment_status: 'SUCCESS',
      upi_status: 'SUCCESS',
      receiver_status: 'CREDITED',
      is_closed: true,
    });

    if (settled) {
      appendAuditEvent(
        transactionId,
        'SYSTEM',
        'VERIFICATION',
        `Verified settlement: ₹${settled.amount.toLocaleString('en-IN')} credited to the receiver.`,
        { bank_status: settled.bank_status, upi_status: settled.upi_status, receiver_status: settled.receiver_status },
      );
    }

    appendAuditEvent(transactionId, 'SYSTEM', 'RESOLUTION', RESOLUTION_MESSAGE);

    state.is_running = false;
    state.is_complete = true;
    state.resolution_message = RESOLUTION_MESSAGE;
    clearTimersFor(transactionId);
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Starts (or returns the already-running/completed state of) an
 * accelerated monitoring cycle for a transaction. Idempotent: calling this
 * again while a run is already in progress or already complete does NOT
 * restart the clock — it just returns the current state, exactly like a
 * real "start polling" call would no-op against an already-active poller.
 */
export function startMonitoring(transactionId: string): MonitoringState {
  const existing = monitoringStates.get(transactionId);
  if (existing) return existing;

  if (!getTransaction(transactionId)) {
    throw new Error(`MonitoringEngine: cannot find transaction "${transactionId}".`);
  }

  const state: MonitoringState = {
    transaction_id: transactionId,
    started_at: nowIso(),
    is_running: true,
    is_complete: false,
    checks: [],
    resolution_message: null,
  };
  monitoringStates.set(transactionId, state);

  const timers: ReturnType<typeof setTimeout>[] = [];
  CHECK_SCHEDULE.forEach((entry, index) => {
    if (entry.elapsedMs === 0) {
      // Run the first check synchronously so a client that reads state
      // right after starting immediately sees Check #1 recorded.
      runCheck(transactionId, index);
    } else {
      timers.push(setTimeout(() => runCheck(transactionId, index), entry.elapsedMs));
    }
  });
  activeTimers.set(transactionId, timers);

  return state;
}

export function getMonitoringState(transactionId: string): MonitoringState | undefined {
  return monitoringStates.get(transactionId);
}

/** Clears one transaction's monitoring run and timers — used by the Reset
 * Scenario control so a stale accelerated poll never fires after a demo
 * reset changes what that transaction id even represents. */
export function resetMonitoring(transactionId: string): void {
  clearTimersFor(transactionId);
  monitoringStates.delete(transactionId);
}

/** Clears every active monitoring run — called on a full database reset. */
export function resetAllMonitoring(): void {
  for (const transactionId of activeTimers.keys()) {
    clearTimersFor(transactionId);
  }
  monitoringStates.clear();
}
