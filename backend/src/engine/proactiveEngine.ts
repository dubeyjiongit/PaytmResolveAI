/**
 * PaytmResolve AI — Proactive Outage Detector
 * ---------------------------------------------------------------------------
 * Directive: don't just react to a failed payment after the fact — detect
 * a degraded bank/gateway BEFORE the customer sends money into it, and
 * warn them up front. This engine tracks one partner bank's simulated
 * timeout health. The "Bank Timeout Spike" Demo Control Panel button is an
 * ENVIRONMENT CONTROL (same category as every other scenario button): it
 * mutates this backend's bank-health record, and the customer-facing
 * banner in PaymentApp.tsx then reads that real state — it is never a
 * canned warning written directly into the frontend.
 *
 * "Bank X" is this mock app's placeholder name for a partner bank/UPI
 * remitter — it does not refer to any real financial institution.
 * ---------------------------------------------------------------------------
 */

import type { BankHealthState } from '../types/index.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const BANK_NAME = 'Bank X';
const BASELINE_TIMEOUT_RATE = 0.05; // 5% is considered a healthy baseline
const SPIKE_SURGE_PERCENT = 340; // Directive's own illustrative figure

function nowIso(): string {
  return new Date().toISOString();
}

function computeDegradedRate(baseline: number, surgePercent: number): number {
  return Math.min(1, baseline * (1 + surgePercent / 100));
}

// ============================================================================
// LIVE, MUTABLE STATE
// ============================================================================

function buildNominalState(): BankHealthState {
  return {
    bank_name: BANK_NAME,
    status: 'NOMINAL',
    baseline_timeout_rate: BASELINE_TIMEOUT_RATE,
    current_timeout_rate: BASELINE_TIMEOUT_RATE,
    surge_percent: 0,
    message: `${BANK_NAME} timeout rate is nominal. No proactive alerts active.`,
    updated_at: nowIso(),
  };
}

let bankHealthState: BankHealthState = buildNominalState();

// ============================================================================
// PUBLIC API
// ============================================================================

export function getBankHealth(): BankHealthState {
  return bankHealthState;
}

/** Triggered by the "Bank Timeout Spike" Demo Control Panel button. */
export function triggerBankTimeoutSpike(): BankHealthState {
  const degradedRate = computeDegradedRate(BASELINE_TIMEOUT_RATE, SPIKE_SURGE_PERCENT);
  bankHealthState = {
    bank_name: BANK_NAME,
    status: 'DEGRADED',
    baseline_timeout_rate: BASELINE_TIMEOUT_RATE,
    current_timeout_rate: degradedRate,
    surge_percent: SPIKE_SURGE_PERCENT,
    message: `${BANK_NAME} timeout rate ↑ ${SPIKE_SURGE_PERCENT}% (DEGRADED). Proactive user alerts are now active for payments routed through ${BANK_NAME}.`,
    updated_at: nowIso(),
  };
  return bankHealthState;
}

/** Restores nominal bank health — called by Reset Scenario. */
export function resetBankHealth(): BankHealthState {
  bankHealthState = buildNominalState();
  return bankHealthState;
}
