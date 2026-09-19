/**
 * PaytmResolve AI — Demo Control Panel
 * ---------------------------------------------------------------------------
 * The sticky judge toolbar. Directive: these buttons are ENVIRONMENT
 * CONTROLS, not "AI actions" — clicking one mutates the mock backend's
 * state (via POST /api/scenarios/trigger) so that when the judge then
 * interacts with the app normally, the AI has a real, freshly-mutated
 * environment to investigate. Nothing here writes a canned chat message.
 * ---------------------------------------------------------------------------
 */

import { useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Clock,
  FlaskConical,
  Loader2,
  RotateCcw,
  ShieldAlert,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import * as api from '../services/api';
import type { ScenarioId, ScenarioResetResult, ScenarioTriggerResult } from '../types';

// ============================================================================
// SCENARIO BUTTON CONFIG
// ============================================================================

interface ScenarioButtonConfig {
  id: ScenarioId;
  label: string;
  emoji: string;
  icon: LucideIcon;
  /** 'ARM' = nothing changes yet; the NEXT real payment you send is the one
   * that gets this outcome. 'IMMEDIATE' = this scenario mutates environment
   * state (a beneficiary's history, bank health) right away because that's
   * what it's demonstrating — there's no "next payment" to wait for. */
  mode: 'ARM' | 'IMMEDIATE';
  caption: string;
  iconClass: string;
  ringClass: string;
}

const SCENARIOS: ScenarioButtonConfig[] = [
  {
    id: 'NETWORK_FAILURE',
    label: 'Network Failure',
    emoji: '⚡',
    icon: Zap,
    mode: 'ARM',
    caption: 'Arms your next payment',
    iconClass: 'text-amber-600',
    ringClass: 'ring-amber-400',
  },
  {
    id: 'DEBIT_NO_CREDIT',
    label: 'Debit + No Credit',
    emoji: '💸',
    icon: Banknote,
    mode: 'ARM',
    caption: 'Arms your next payment',
    iconClass: 'text-red-600',
    ringClass: 'ring-red-400',
  },
  {
    id: 'PENDING_TIMEOUT',
    label: 'Pending Timeout',
    emoji: '⏳',
    icon: Clock,
    mode: 'ARM',
    caption: 'Arms your next payment',
    iconClass: 'text-blue-600',
    ringClass: 'ring-blue-400',
  },
  {
    id: 'NEW_BENEFICIARY_HIGH_VALUE',
    label: '₹2L Step-Up',
    emoji: '⚠️',
    icon: AlertTriangle,
    mode: 'ARM',
    caption: 'Arms Vikram Singh',
    iconClass: 'text-orange-600',
    ringClass: 'ring-orange-400',
  },
  {
    id: 'HIGH_RISK_BLOCK',
    label: 'Hard Fraud Block',
    emoji: '🛡️',
    icon: ShieldAlert,
    mode: 'ARM',
    caption: 'Arms Rohit M.',
    iconClass: 'text-red-700',
    ringClass: 'ring-red-500',
  },
  {
    id: 'BANK_TIMEOUT_SPIKE',
    label: 'Bank Timeout Spike',
    emoji: '📈',
    icon: TrendingUp,
    mode: 'IMMEDIATE',
    caption: 'Bank health banner',
    iconClass: 'text-orange-600',
    ringClass: 'ring-orange-400',
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

export interface DemoControlPanelProps {
  onScenarioTriggered: (result: ScenarioTriggerResult) => void;
  onReset: (result: ScenarioResetResult) => void;
}

export default function DemoControlPanel({ onScenarioTriggered, onReset }: DemoControlPanelProps) {
  const [activeScenario, setActiveScenario] = useState<ScenarioId | null>(null);
  const [busyId, setBusyId] = useState<ScenarioId | 'RESET' | null>(null);
  // Only a real failure gets a banner here now — the verbose "Armed: your
  // NEXT payment will simulate…" success explanation was removed since it
  // duplicated each button's own caption. A genuine error (network/API
  // failure) still needs to surface somewhere, so that part stays.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Always expanded — judges/evaluators looking at the submitted prototype
  // need to see the demo controls immediately, with no click required, so
  // this no longer starts collapsed. Kept compact (smaller padding/text)
  // so it doesn't eat vertical space above the real app content.

  async function handleScenarioClick(scenario: ScenarioButtonConfig) {
    if (busyId) return;
    setBusyId(scenario.id);
    setErrorMessage(null);
    try {
      const result = await api.triggerScenario(scenario.id);
      setActiveScenario(scenario.id);
      onScenarioTriggered(result);
    } catch (error) {
      setErrorMessage(error instanceof api.ApiClientError ? error.message : 'Failed to trigger scenario.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleResetClick() {
    if (busyId) return;
    setBusyId('RESET');
    setErrorMessage(null);
    try {
      const result = await api.resetScenario();
      setActiveScenario(null);
      onReset(result);
    } catch (error) {
      setErrorMessage(error instanceof api.ApiClientError ? error.message : 'Failed to reset scenario.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="border-b border-slate-200 bg-gradient-to-r from-amber-50 to-orange-50">
      <div className="mx-auto max-w-md px-3 py-1.5 sm:max-w-2xl">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-orange-300 bg-white px-2.5 py-1 text-orange-700 shadow-sm">
          <span className="flex items-center gap-1.5 text-[11px] font-bold">
            <FlaskConical className="h-3.5 w-3.5" />
            Demo Scenario Control
          </span>
          <button
            type="button"
            onClick={handleResetClick}
            disabled={busyId !== null}
            className="flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyId === 'RESET' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            Reset
          </button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 pt-1.5 thin-scrollbar">
          {SCENARIOS.map((scenario) => {
            const isActive = activeScenario === scenario.id;
            const isBusy = busyId === scenario.id;
            const Icon = scenario.icon;
            return (
              <button
                key={scenario.id}
                type="button"
                onClick={() => handleScenarioClick(scenario)}
                disabled={busyId !== null}
                title={
                  scenario.mode === 'ARM'
                    ? `Arms "${scenario.label}" — nothing happens until you make a real payment next.`
                    : `Sets up "${scenario.label}" in the environment now.`
                }
                className={[
                  'flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
                  isActive
                    ? `border-transparent bg-slate-900 text-white ring-2 ${scenario.ringClass}`
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                ].join(' ')}
              >
                {isBusy ? (
                  <Loader2 className={`h-3.5 w-3.5 shrink-0 animate-spin ${isActive ? 'text-white' : scenario.iconClass}`} />
                ) : (
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-white' : scenario.iconClass}`} />
                )}
                <span className="flex flex-col">
                  <span className="text-[10.5px] font-semibold leading-tight">
                    {scenario.emoji} {scenario.label}
                  </span>
                  <span className={`text-[9.5px] leading-tight ${isActive ? 'text-slate-300' : 'text-slate-400'}`}>
                    {scenario.caption}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {errorMessage && (
          <div className="mb-1 rounded-md bg-red-50 px-2.5 py-1 text-[10px] text-red-700">{errorMessage}</div>
        )}
      </div>
    </div>
  );
}
