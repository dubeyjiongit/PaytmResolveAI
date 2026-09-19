/**
 * PaytmResolve AI — App Shell / Master State Orchestrator
 * ---------------------------------------------------------------------------
 * The top-level layout: a sticky Demo Control Panel (judge environment
 * controls) above a tab switcher between the two surfaces of the demo:
 *
 *   1. Consumer App        — PaymentApp.tsx (the simulated Paytm UI)
 *   2. Human Ops Center    — HumanOpsCenter.tsx (support queue + metrics)
 *
 * The AI Teammate is a floating chat widget (corner bubble -> slide-over
 * panel), available from either tab. On wide viewports, the empty margin to
 * the left of the centered app column hosts a live Investigation Tracker
 * (InvestigationTracker.tsx) that mirrors the real backend pipeline stage
 * while the chat is investigating — a Flipkart-style vertical progress line,
 * driven by real state transitions from AiTeammateChat, not a fake timer.
 *
 * This component owns the shared server state (customer, transactions,
 * beneficiaries) and re-fetches it centrally whenever any child reports
 * that the backend may have changed (a scenario was triggered, a payment
 * was made, the AI teammate took an action, a human operator resolved a
 * case). It also owns the cross-component state the plan calls for:
 *
 *   - `activeTransactionId`: when the consumer clicks "Ask AI Teammate" on
 *     a transaction in PaymentApp, this switches to the AI Teammate tab
 *     with that transaction pre-loaded.
 *   - `stepUpContext`: when PaymentApp's "Pay Now" comes back
 *     STEP_UP_REQUIRED, this opens the Risk Center Modal over whichever
 *     tab is currently active, exactly as a real risk-gated payment flow
 *     would interrupt the customer regardless of where they are.
 *   - `investigationPhase`: the AI Teammate chat's real pipeline stage,
 *     lifted here so the Investigation Tracker can reflect it even though
 *     the chat panel itself unmounts when closed.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  Bot,
  CreditCard,
  Headset,
  Loader2,
  MessageCircleMore,
  QrCode,
  Receipt as ReceiptIcon,
  Search,
  Smartphone,
  TriangleAlert,
  User,
  X,
} from 'lucide-react';
import * as api from './services/api';
import DemoControlPanel from './components/DemoControlPanel';
import PaymentApp from './components/PaymentApp';
import AiTeammateChat from './components/AiTeammateChat';
import HumanOpsCenter from './components/HumanOpsCenter';
import RiskCenterModal from './components/RiskCenterModal';
import ErrorBoundary from './components/ErrorBoundary';
import InvestigationTracker, { type InvestigationPhase } from './components/InvestigationTracker';
import type {
  BeneficiaryDirectoryEntry,
  Customer,
  RiskEvaluationResult,
  ScenarioResetResult,
  ScenarioTriggerResult,
  Transaction,
} from './types';

// ============================================================================
// BRAND MARK — an original wordmark for this app (not a copy of any real
// company's logo artwork). It borrows the visual register a fintech app
// lives in — a rounded badge, a confident two-tone wordmark, the blue/cyan
// this whole UI already uses — without reproducing anyone's actual mark.
// ============================================================================

function BrandMark() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/15 text-base font-extrabold text-white font-display">
        ₹
      </div>
      <div className="font-display leading-none">
        <span className="text-[15px] font-bold text-white">Resolve</span>
        <span className="text-[15px] font-bold text-paytm-light/70">Pay</span>
        <span className="ml-1 rounded-full bg-white/15 px-1.5 py-0.5 text-sm font-bold uppercase tracking-wide text-white/90 align-middle">
          AI
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// TABS (bottom app-nav — mirrors the tab-bar pattern of a real payments app)
// ============================================================================

type TabId = 'CONSUMER_APP' | 'HUMAN_OPS';

interface TabConfig {
  id: TabId | null;
  label: string;
  icon: typeof Smartphone;
  note?: string;
}

// Real Paytm-style bottom nav has more than two tabs. Only Home and Ops
// Console are wired to anything real in this demo — the rest (`id: null`)
// are here purely so the tab bar reads like a full payments app; they're
// disabled and labelled so nobody mistakes them for working features,
// same convention as the Quick Actions row on the home screen.
const TABS: TabConfig[] = [
  { id: 'CONSUMER_APP', label: 'Home', icon: Smartphone },
  { id: null, label: 'Recharge', icon: CreditCard, note: 'Not wired up in this demo' },
  { id: null, label: 'Passbook', icon: ReceiptIcon, note: 'Not wired up in this demo' },
  { id: 'HUMAN_OPS', label: 'Ops Console', icon: Headset },
];

// ============================================================================
// SHARED DATA STATE
// ============================================================================

interface SharedData {
  customer: Customer | null;
  transactions: Transaction[];
  beneficiaries: BeneficiaryDirectoryEntry[];
  loading: boolean;
  error: string | null;
}

const INITIAL_SHARED_DATA: SharedData = {
  customer: null,
  transactions: [],
  beneficiaries: [],
  loading: true,
  error: null,
};

interface StepUpContext {
  transaction: Transaction;
  risk: RiskEvaluationResult;
  gateReason: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('CONSUMER_APP');
  const [activeTransactionId, setActiveTransactionId] = useState<string | null>(null);
  const [data, setData] = useState<SharedData>(INITIAL_SHARED_DATA);
  const [lastScenarioMessage, setLastScenarioMessage] = useState<string | null>(null);
  const [stepUpContext, setStepUpContext] = useState<StepUpContext | null>(null);
  // The AI Teammate is a floating chat widget now (Directive: corner bubble,
  // not a full tab) — open state lives here so PaymentApp's "Ask AI
  // Teammate" button can pop it open from anywhere.
  const [isChatOpen, setIsChatOpen] = useState(false);
  // Real pipeline stage of the AI Teammate's current investigation, lifted
  // up so the Investigation Tracker (rendered outside the chat panel) can
  // keep showing it even across the chat panel unmounting/remounting.
  const [investigationPhase, setInvestigationPhase] = useState<InvestigationPhase>('IDLE');

  // ---- Central data fetch --------------------------------------------------
  const refreshAll = useCallback(async () => {
    setData((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [customer, transactions, beneficiaries] = await Promise.all([
        api.getCustomer(),
        api.getTransactions(),
        api.getBeneficiaries(),
      ]);
      setData({ customer, transactions, beneficiaries, loading: false, error: null });
    } catch (error) {
      setData((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof api.ApiClientError ? error.message : 'Failed to load account data.',
      }));
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // ---- Demo Control Panel callbacks ---------------------------------------
  function handleScenarioTriggered(result: ScenarioTriggerResult) {
    setLastScenarioMessage(result.message);
    void refreshAll();
  }

  function handleReset(result: ScenarioResetResult) {
    setLastScenarioMessage(result.message);
    setActiveTransactionId(null);
    setStepUpContext(null);
    setIsChatOpen(false);
    setInvestigationPhase('IDLE');
    void refreshAll();
  }

  // ---- Cross-component handoff: PaymentApp -> AI Teammate chat widget ----
  function handleAskAiTeammate(transactionId: string) {
    setActiveTransactionId(transactionId);
    setIsChatOpen(true);
  }

  // Closing the chat also clears the "pending" transaction handoff. Without
  // this, activeTransactionId stayed set after the chat closed, which did
  // two unwanted things: the unread badge kept showing on the floating
  // bubble forever (nothing new had actually happened), and reopening the
  // chat later — even just to say hi — would silently re-run a full
  // investigation on that old transaction, because the chat panel is
  // unmounted on close and its "already auto-investigated" guard resets
  // with it. The chat should only investigate when the person explicitly
  // asks it to (typing a message) or explicitly hands it a transaction via
  // "Ask AI Teammate" — never just because the panel got reopened.
  function closeChat() {
    setIsChatOpen(false);
    setActiveTransactionId(null);
    setInvestigationPhase('IDLE');
  }

  // ---- Cross-component handoff: PaymentApp -> Risk Center Modal ----------
  function handleStepUpRequired(transaction: Transaction, risk: RiskEvaluationResult, gateReason: string) {
    setStepUpContext({ transaction, risk, gateReason });
  }

  function handleStepUpResolved(result: { transaction: Transaction; message: string }) {
    setLastScenarioMessage(result.message);
    setStepUpContext(null);
    void refreshAll();
  }

  const beneficiaryEntryForStepUp = stepUpContext
    ? data.beneficiaries.find((entry) => entry.beneficiary.beneficiary_id === stepUpContext.transaction.receiver_id)
    : undefined;

  return (
    <div className="min-h-screen bg-transparent pb-20">
      {/* ---- Live Investigation Tracker — the empty margin to the left of
          the centered app column on wide screens. Purely a mirror of the
          AI Teammate chat's real pipeline stage; hidden on narrower
          viewports where that margin doesn't exist. */}
      <InvestigationTracker phase={investigationPhase} />

      {/* ---- App header — the "open like a real payments app" surface -- */}
      <header className="sticky top-0 z-40 bg-gradient-to-r from-paytm-blue via-paytm-blue to-slate-800 shadow-card">
        <div className="mx-auto flex max-w-md items-center justify-between gap-2 px-4 pt-2 sm:max-w-2xl">
          <BrandMark />
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-full p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white"
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white/90 transition hover:bg-white/20"
              title={data.customer?.name ?? 'Account'}
            >
              <User className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {/* Decorative search bar — the real search-driven service directory
            isn't part of this demo's scope, but a Paytm-style home screen
            always opens with this bar right under the brand row. Kept short
            (tight padding) so the header band doesn't eat too much vertical
            space above the actual app content. */}
        <div className="mx-auto max-w-md px-4 pb-2 pt-1.5 sm:max-w-2xl">
          <div className="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-1.5 text-white/70">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate text-xs">Search for services, contacts, UPI ID…</span>
            <button
              type="button"
              title="Scan QR — use Scan QR Code under Quick Actions on Home"
              className="ml-auto shrink-0 rounded-lg bg-white/15 p-1.5 text-white/90 transition hover:bg-white/25"
            >
              <QrCode className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <DemoControlPanel onScenarioTriggered={handleScenarioTriggered} onReset={handleReset} />

      {lastScenarioMessage && (
        <div className="mx-auto max-w-md px-3 pt-2 sm:max-w-2xl">
          <div className="rounded-lg bg-slate-900/5 px-3 py-1.5 text-sm text-slate-500">{lastScenarioMessage}</div>
        </div>
      )}

      {/* ---- Global loading / error states ------------------------------ */}
      {data.loading && data.transactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-24 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Loading account data…</span>
        </div>
      ) : data.error && data.transactions.length === 0 ? (
        <div className="mx-auto max-w-md py-24 text-center">
          <TriangleAlert className="mx-auto mb-3 h-8 w-8 text-red-500" />
          <p className="text-sm font-semibold text-slate-700">Could not load account data</p>
          <p className="mt-1 text-xs text-slate-500">{data.error}</p>
          <button
            type="button"
            onClick={() => void refreshAll()}
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      ) : (
        <main>
          <ErrorBoundary label={activeTab === 'CONSUMER_APP' ? 'Home' : 'Ops Console'}>
            {activeTab === 'CONSUMER_APP' && (
              <PaymentApp
                customer={data.customer}
                transactions={data.transactions}
                beneficiaries={data.beneficiaries}
                onRefreshNeeded={refreshAll}
                onAskAiTeammate={handleAskAiTeammate}
                onStepUpRequired={handleStepUpRequired}
              />
            )}

            {activeTab === 'HUMAN_OPS' && (
              <HumanOpsCenter transactions={data.transactions} onRefreshNeeded={refreshAll} />
            )}
          </ErrorBoundary>
        </main>
      )}

      {/* ---- Bottom app-nav — the tab bar of a real payments app -------- */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-md sm:max-w-2xl">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id !== null && activeTab === tab.id;
            const isWired = tab.id !== null;
            return (
              <button
                key={tab.label}
                type="button"
                title={tab.note}
                onClick={isWired ? () => setActiveTab(tab.id as TabId) : undefined}
                className={[
                  'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-sm font-semibold transition',
                  isActive
                    ? 'text-paytm-cyan'
                    : isWired
                      ? 'text-slate-400 hover:text-slate-600'
                      : 'cursor-default text-slate-300',
                ].join(' ')}
              >
                <Icon className="h-5 w-5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ---- Floating AI Teammate chat bubble ---------------------------
          Directive: the chat lives in a corner of the app, fixed-position
          (never scrolls away), sitting just above the bottom nav so it's
          always within thumb's reach — not tucked far down the page. A
          soft pulse ring and a "Chat with us" label (GFG-style corner
          widget) make it impossible to miss on first load. */}
      {/* Hidden entirely while the chat panel is open — the panel's own
          header already has a close (X) button right there, so a second
          close control floating below it was pure redundancy, and it was
          eating space the panel itself could use. Hiding it here (rather
          than just re-labelling it) is what lets the panel's bottom anchor
          extend all the way down below, instead of stopping short to leave
          room for a button nobody needs while the panel is open. */}
      {!isChatOpen && (
        <div className="fixed bottom-24 right-4 z-50 flex flex-col items-end gap-2 sm:right-6">
          <span className="hidden select-none rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg sm:block">
            Chat with us
          </span>
          <button
            type="button"
            onClick={() => setIsChatOpen(true)}
            className="relative flex h-16 w-16 items-center justify-center rounded-full bg-paytm-cyan text-white shadow-2xl transition hover:brightness-95"
            title="Chat with AI Teammate"
          >
            <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-paytm-cyan/60" />
            <MessageCircleMore className="h-7 w-7" />
            {activeTransactionId && (
              <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white ring-2 ring-white">
                1
              </span>
            )}
          </button>
        </div>
      )}

      {/* top-4 + bottom-4 (instead of a capped h-[...], or the old
          bottom-40 that reserved space for the now-hidden floating bubble)
          means the panel's height is whatever's actually available between
          the top and bottom of the screen, with a small even margin on
          both sides — it fills the full usable length of the viewport on
          any device, rather than stopping short at a fixed px/vh cap or
          leaving dead space below it for a button that isn't there while
          the panel is open. */}
      {isChatOpen && (
        <div className="fixed top-4 bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-[440px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-b from-amber-50/70 via-white to-white shadow-2xl sm:right-6">
          <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-paytm-blue to-paytm-cyan px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <span className="text-sm font-bold font-display">AI Teammate</span>
            </div>
            <button
              type="button"
              onClick={closeChat}
              className="rounded-full p-1 text-white/80 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ErrorBoundary label="AI Teammate chat">
              <AiTeammateChat
                activeTransactionId={activeTransactionId}
                transactions={data.transactions}
                onClearActiveTransaction={() => setActiveTransactionId(null)}
                onRefreshNeeded={refreshAll}
                onSwitchToHumanOps={() => {
                  setActiveTab('HUMAN_OPS');
                  closeChat();
                }}
                onPhaseChange={setInvestigationPhase}
              />
            </ErrorBoundary>
          </div>
        </div>
      )}

      {/* ---- Risk Center Modal — floats above whichever tab is active --- */}
      {stepUpContext && (
        <RiskCenterModal
          transaction={stepUpContext.transaction}
          risk={stepUpContext.risk}
          gateReason={stepUpContext.gateReason}
          beneficiaryEntry={beneficiaryEntryForStepUp}
          onClose={() => {
            setStepUpContext(null);
            // A "blocked after step-up" attempt already updated the
            // transaction on the backend (payment_status now BLOCKED)
            // even though the customer is just closing the modal — pull
            // that change into History rather than leaving the row stale.
            void refreshAll();
          }}
          onResolved={handleStepUpResolved}
        />
      )}
    </div>
  );
}
