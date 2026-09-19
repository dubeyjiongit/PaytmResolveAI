/**
 * PaytmResolve AI — Simulated Consumer Payment App
 * ---------------------------------------------------------------------------
 * The "Paytm-like" surface a customer actually uses: balance header, Send
 * Money form, and a live transaction history feed with the 4-way decoupled
 * status badges front and center (bank / UPI / receiver / refund) — the
 * whole point of the demo is that these are visibly independent, not one
 * flattened "status" pill.
 *
 * All server communication goes through services/api.ts. This component
 * owns none of the shared data (customer, transactions, beneficiaries) —
 * that lives in App.tsx, the master state orchestrator — but it owns all
 * of its own form/modal UI state.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  ChevronRight,
  Clock,
  Contact,
  Eye,
  EyeOff,
  History,
  Landmark,
  Loader2,
  MessageCircle,
  Phone,
  QrCode,
  Receipt,
  RotateCcw,
  Smartphone,
  TrendingUp,
  Wallet,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import * as api from '../services/api';
import type { BankHealthState, BeneficiaryDirectoryEntry, Customer, RiskEvaluationResult, Transaction } from '../types';
import PinPad from './PinPad';
import QrScanner from './QrScanner';
import PromoCarousel from './PromoCarousel';
import AdPopup from './AdPopup';
import TransactionSlip from './TransactionSlip';
import ContactPicker from './ContactPicker';
import LoansModal from './LoansModal';
import PaymentResultOverlay, { type PaymentResultKind } from './PaymentResultOverlay';
import ProcessingOverlay from './ProcessingOverlay';

/** Purely decorative — a real Paytm-style home screen always shows a row of
 * quick actions, each with its own bright, flat-colored icon badge (never
 * one repeated tint for everything — that's what read as "not attractive").
 * "To Mobile / UPI ID" and "Scan QR Code" are wired to something real; the
 * rest are labeled plainly so nobody mistakes them for working features. */
const QUICK_ACTIONS: Array<{
  label: string;
  icon: typeof Smartphone;
  note?: string;
  action: 'TO_NUMBER' | 'SCAN_QR' | 'LOANS' | 'NONE';
  /** Tailwind gradient classes for this action's own icon badge. */
  gradient: string;
}> = [
  { label: 'To Mobile / UPI ID', icon: Smartphone, action: 'TO_NUMBER', gradient: 'from-sky-400 to-blue-600' },
  { label: 'Scan QR Code', icon: QrCode, action: 'SCAN_QR', gradient: 'from-violet-400 to-purple-600' },
  { label: 'Loans', icon: Landmark, action: 'LOANS', gradient: 'from-amber-400 to-orange-600' },
  { label: 'Mobile Recharge', icon: Phone, note: 'Not wired up in this demo', action: 'NONE', gradient: 'from-emerald-400 to-teal-600' },
  { label: 'Electricity Bill', icon: Zap, note: 'Not wired up in this demo', action: 'NONE', gradient: 'from-rose-400 to-pink-600' },
  { label: 'Receipts', icon: Receipt, note: 'Not wired up in this demo', action: 'NONE', gradient: 'from-fuchsia-400 to-purple-600' },
];

/** Parses a real UPI payment QR payload, e.g.
 * "upi://pay?pa=hitesh@upi&pn=Hitesh&am=500&cu=INR" into the fields the
 * Send Money form needs. Returns null for anything that isn't a UPI
 * payment URI (a plain URL, arbitrary text, etc.) — those are still
 * genuinely decoded by the scanner, just not something we can pre-fill a
 * payment from. */
function parseUpiPaymentQr(text: string): { payeeAddress: string; payeeName?: string; amount?: string } | null {
  try {
    if (!/^upi:\/\//i.test(text)) return null;
    const query = text.slice(text.indexOf('?') + 1);
    const params = new URLSearchParams(query);
    const payeeAddress = params.get('pa');
    if (!payeeAddress) return null;
    return {
      payeeAddress,
      payeeName: params.get('pn') ?? undefined,
      amount: params.get('am') ?? undefined,
    };
  } catch {
    return null;
  }
}

/** How often PaymentApp polls bank health while it's mounted. The Demo
 * Control Panel is always visible above every tab, so a judge can click
 * "Bank Timeout Spike" while looking at any screen — this short poll is
 * what makes the banner appear here promptly without needing a websocket. */
const BANK_HEALTH_POLL_MS = 3_000;

/** Real UPI apps don't refuse a large payment outright — they just make you
 * pause and confirm you meant it, in the spirit of RBI's push for extra
 * friction on large transfers. Nothing above this amount is ever blocked
 * by the frontend; it only asks "are you sure?" once, then lets the payment
 * proceed exactly as any other would (still subject to the backend's own
 * risk-based step-up/escalation, same as any amount). */
const LARGE_AMOUNT_CONFIRM_THRESHOLD = 50_000;

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}


/** Simplified, row-level outcome used for the History list's avatar/amount
 * color and icon — a real payment app never shows you four separate rail
 * badges in a list row; that detail belongs in the full slip. */
type RowOutcome = 'success' | 'failed' | 'refunded' | 'pending' | 'blocked';

/** A REFUNDED transaction never actually reached the beneficiary — the
 * payment failed and the money came back to the sender. Grouping it with
 * SUCCESS (as this used to) made history read as "paid to the vendor,
 * successful," which is the opposite of what happened. It gets its own
 * outcome so history can say what's actually true: the payment failed, and
 * the money is back in your account. */
function rowOutcomeFor(t: Transaction): RowOutcome {
  if (t.payment_status === 'REFUNDED') return 'refunded';
  if (t.payment_status === 'SUCCESS') return 'success';
  // Deliberately its own outcome, not lumped in with 'failed': nothing was
  // debited, nothing technical went wrong, and it wasn't a random glitch —
  // this was risk/compliance policy stopping the payment on purpose before
  // it reached the bank. Grouping it with FAILED would make it read like a
  // network hiccup worth retrying, which it isn't.
  if (t.payment_status === 'BLOCKED') return 'blocked';
  if (t.payment_status === 'FAILED' || t.payment_status === 'UNKNOWN') return 'failed';
  return 'pending';
}

/** One short, honest reason a genuinely failed (not-yet-refunded) payment
 * didn't go through — read straight off the same 4-way status this app
 * already tracks, not a fabricated explanation. Picks a single most-likely
 * cause rather than dumping every status field, matching how the refunded
 * row already reads ("Payment to X failed — money returned"). */
function failureReasonFor(t: Transaction): string {
  if (t.upi_status === 'TIMEOUT') return 'UPI switch timed out';
  if (t.upi_status === 'FAILED') return 'UPI switch declined the payment';
  if (t.bank_status === 'NOT_DEBITED' && t.upi_status === 'NOT_INITIATED') return "Payment couldn't be initiated";
  if (t.bank_status === 'DEBITED' && t.receiver_status === 'NOT_RECEIVED') return "Bank debited you but the receiver wasn't credited";
  if (t.bank_status === 'UNKNOWN' || t.upi_status === 'UNKNOWN') return 'Bank and UPI switch disagree on what happened';
  return "Payment couldn't be completed";
}

/** A real payment app's history screen never dumps every demo/test state at
 * once — a wall of "Pending" rows from every risk scenario a judge has
 * triggered reads as broken, not as a feature. This curates what actually
 * shows: the 5 most recent successful payments, the most recent refund,
 * and the most recent genuinely-failed payment — plus, always, whichever
 * transaction the customer just personally made this session (pinned to
 * the top regardless of its status), so trying a demo scenario right now
 * is still immediately visible. */
function curateHistory(transactions: Transaction[], pinnedTransactionId: string | null): Transaction[] {
  const byRecency = [...transactions].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const pinned = pinnedTransactionId ? byRecency.filter((t) => t.transaction_id === pinnedTransactionId) : [];
  const success = byRecency.filter((t) => t.payment_status === 'SUCCESS').slice(0, 5);
  const refunded = byRecency.filter((t) => t.payment_status === 'REFUNDED').slice(0, 1);
  const failed = byRecency
    .filter((t) => t.payment_status === 'FAILED' || t.payment_status === 'UNKNOWN')
    .slice(0, 1);

  const seen = new Set<string>();
  const curated: Transaction[] = [];
  for (const t of [...pinned, ...success, ...refunded, ...failed]) {
    if (seen.has(t.transaction_id)) continue;
    seen.add(t.transaction_id);
    curated.push(t);
  }
  return curated.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/** All prior payments to one specific beneficiary, most recent first — the
 * "chat history with this person" real UPI apps show the moment you open a
 * contact, so paying someone you've paid before doesn't feel like starting
 * from a blank slate every time. Capped at 8 so it stays a quick glance,
 * not another full history dump. */
function contactHistoryFor(transactions: Transaction[], receiverId: string): Transaction[] {
  if (!receiverId) return [];
  return [...transactions]
    .filter((t) => t.receiver_id === receiverId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8);
}

const ROW_OUTCOME_BADGE: Record<RowOutcome, { icon: typeof CheckCircle2; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-emerald-500' },
  refunded: { icon: RotateCcw, className: 'text-sky-500' },
  failed: { icon: XCircle, className: 'text-red-500' },
  blocked: { icon: Ban, className: 'text-slate-400' },
  pending: { icon: Clock, className: 'text-amber-500' },
};

/** Short, human relative time ("Just now", "12m ago", "3h ago", "2d ago")
 * — real payment apps never show a full ISO-ish timestamp in a list row. */
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ============================================================================
// PROPS
// ============================================================================

export interface PaymentAppProps {
  customer: Customer | null;
  transactions: Transaction[];
  beneficiaries: BeneficiaryDirectoryEntry[];
  onRefreshNeeded: () => void;
  onAskAiTeammate: (transactionId: string) => void;
  /** Fired instead of showing an inline OTP panel when the action gate
   * returns REQUIRE_STEP_UP — App.tsx owns the Risk Center Modal that
   * actually walks the customer through step-up verification. */
  onStepUpRequired: (transaction: Transaction, risk: RiskEvaluationResult, gateReason: string) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function PaymentApp({
  customer,
  transactions,
  beneficiaries,
  onRefreshNeeded,
  onAskAiTeammate,
  onStepUpRequired,
}: PaymentAppProps) {
  // ---- Send Money form state --------------------------------------------
  // 'SAVED' = pick from the beneficiary dropdown (existing behaviour).
  // 'NEW_NUMBER' = type any mobile number / UPI ID directly — a real
  // payments app never restricts who you can pay to a preset contact list.
  const [payMode, setPayMode] = useState<'SAVED' | 'NEW_NUMBER'>('SAVED');
  const [receiverId, setReceiverId] = useState('');
  const [newReceiverInput, setNewReceiverInput] = useState('');
  const [newReceiverName, setNewReceiverName] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [pendingBanner, setPendingBanner] = useState<{ message: string; transactionId: string } | null>(null);

  // A "still settling" banner is only true while it's true. Once the
  // transaction it refers to actually reaches a terminal state (settled,
  // refunded, or failed), the banner is stale — clear it automatically
  // rather than leaving a "still settling" message on screen for something
  // that's already done.
  useEffect(() => {
    if (!pendingBanner) return;
    const current = transactions.find((t) => t.transaction_id === pendingBanner.transactionId);
    if (current && current.payment_status !== 'PENDING') {
      setPendingBanner(null);
    }
  }, [transactions, pendingBanner]);

  // ---- Full-screen success/fail/pending animation + sound ------------------
  // processingResult holds an outcome that's already known but not yet
  // revealed — the ProcessingOverlay spinner shows for a beat first, then
  // handleProcessingDone promotes it into paymentResult, which is what
  // actually triggers PaymentResultOverlay's animation + tone.
  const [processingResult, setProcessingResult] = useState<{ kind: PaymentResultKind; amountLabel: string } | null>(
    null,
  );
  const [paymentResult, setPaymentResult] = useState<{ kind: PaymentResultKind; amountLabel: string } | null>(null);

  function handleProcessingDone() {
    setPaymentResult(processingResult);
    setProcessingResult(null);
  }

  // ---- Transaction detail slide-over --------------------------------------
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  // ---- Contacts picker for "Saved Contact" ----------------------------
  const [showContactPicker, setShowContactPicker] = useState(false);

  // ---- Loans section (decorative — see LoansModal's own header note) ----
  const [showLoansModal, setShowLoansModal] = useState(false);

  // ---- Transaction History is behind a "View Payment History" action now
  // — see curateHistory() above for why the modal's list is curated rather
  // than a raw dump of every demo transaction. lastOwnTransactionId is
  // whichever transaction the customer's own most recent Send Money attempt
  // produced (success, pending, blocked — any of them), so it's always
  // visible in that curated list even if it wouldn't otherwise make the cut.
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [lastOwnTransactionId, setLastOwnTransactionId] = useState<string | null>(null);

  // ---- Proactive Outage Detector banner -----------------------------------
  const [bankHealth, setBankHealth] = useState<BankHealthState | null>(null);

  // ---- Simulated PIN / fingerprint gate -----------------------------------
  // Real payment apps never move money — or show your balance — without a
  // PIN or biometric check first. `pinPadMode` says which flow is waiting
  // on that check: 'PAY' means the (already-validated) Send Money form is
  // waiting to actually call the API; 'BALANCE' means the header's masked
  // balance is waiting to be revealed. Either way, nothing sensitive happens
  // until PinPad's onSuccess fires.
  const [pinPadMode, setPinPadMode] = useState<'PAY' | 'BALANCE' | null>(null);
  const [largeAmountConfirmValue, setLargeAmountConfirmValue] = useState<number | null>(null);
  const [balanceRevealed, setBalanceRevealed] = useState(false);

  // ---- Real QR scanner -----------------------------------------------------
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [qrInfoMessage, setQrInfoMessage] = useState<string | null>(null);

  function handleQrResult(text: string) {
    setShowQrScanner(false);
    const parsed = parseUpiPaymentQr(text);
    if (parsed) {
      setPayMode('NEW_NUMBER');
      setNewReceiverInput(parsed.payeeAddress);
      if (parsed.payeeName) setNewReceiverName(parsed.payeeName);
      if (parsed.amount) setAmount(parsed.amount);
      setQrInfoMessage(`Scanned UPI QR for ${parsed.payeeName ?? parsed.payeeAddress}. Review and hit Pay Now.`);
    } else {
      // An honest outcome: the camera really did decode a QR code, it just
      // isn't a UPI payment QR (e.g. a URL or plain text) — so there's
      // nothing to prefill the payment form with.
      setQrInfoMessage(`Scanned QR content: "${text.slice(0, 120)}" — this isn't a UPI payment QR, so nothing was prefilled.`);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function pollBankHealth() {
      try {
        const health = await api.getBankHealth();
        if (!cancelled) setBankHealth(health);
      } catch {
        // A failed health check should never break the payment screen —
        // simply skip this tick and try again on the next poll.
      }
    }

    void pollBankHealth();
    const interval = setInterval(pollBankHealth, BANK_HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const beneficiaryById = useMemo(() => {
    const map = new Map<string, BeneficiaryDirectoryEntry>();
    for (const entry of beneficiaries) map.set(entry.beneficiary.beneficiary_id, entry);
    return map;
  }, [beneficiaries]);

  function beneficiaryName(id: string): string {
    return beneficiaryById.get(id)?.beneficiary.name ?? id;
  }

  /** Validates the Send Money form and, if it's clean, opens the PIN pad —
   * the actual payment API call only happens from `executePayment()`, once
   * PinPad's onSuccess fires. Nothing about this button press moves money
   * on its own anymore. */
  function handlePayNowClick() {
    setFormError(null);
    setSuccessBanner(null);
    setPendingBanner(null);

    const receiverInput = payMode === 'SAVED' ? receiverId : newReceiverInput.trim();

    if (!receiverInput) {
      setFormError(
        payMode === 'SAVED' ? 'Choose a beneficiary to send money to.' : 'Enter a mobile number or UPI ID to pay.',
      );
      return;
    }
    if (payMode === 'NEW_NUMBER') {
      const digitsOnly = receiverInput.replace(/[\s-]/g, '');
      const looksLikeMobile = /^[6-9]\d{9}$/.test(digitsOnly);
      const looksLikeUpiId = /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z][a-zA-Z0-9]{1,}$/.test(receiverInput);
      if (!looksLikeMobile && !looksLikeUpiId) {
        setFormError('Enter a valid 10-digit mobile number (e.g. 9876543210) or a UPI ID (e.g. name@bank).');
        return;
      }
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFormError('Enter a valid amount greater than ₹0.');
      return;
    }

    // Large amount — pause for an explicit "are you sure?" before the PIN
    // pad, instead of silently refusing to let a valid payment through.
    if (numericAmount > LARGE_AMOUNT_CONFIRM_THRESHOLD) {
      setLargeAmountConfirmValue(numericAmount);
      return;
    }

    // Form is valid — now ask for PIN/fingerprint before touching the API.
    setPinPadMode('PAY');
  }

  function confirmLargeAmountAndContinue() {
    setLargeAmountConfirmValue(null);
    setPinPadMode('PAY');
  }

  /** Runs after the PIN pad confirms identity. Does exactly what the old
   * handlePayNow() did once it got past validation. */
  async function executePayment() {
    setPinPadMode(null);

    const receiverInput = payMode === 'SAVED' ? receiverId : newReceiverInput.trim();
    const numericAmount = Number(amount);

    setSubmitting(true);
    try {
      const result = await api.initiatePayment({
        receiver_id: receiverInput,
        receiver_name: payMode === 'NEW_NUMBER' ? newReceiverName.trim() || undefined : undefined,
        amount: numericAmount,
        note: note || undefined,
        idempotency_key: crypto.randomUUID(),
      });

      // Pin whatever transaction this attempt produced — success, still
      // settling, step-up pending, or blocked — so it's always visible in
      // the curated History view even if it wouldn't otherwise make the cut.
      if (result.transaction) {
        setLastOwnTransactionId(result.transaction.transaction_id);
      }

      const paidToName =
        result.transaction && beneficiaryById.get(result.transaction.receiver_id)
          ? beneficiaryName(result.transaction.receiver_id)
          : payMode === 'NEW_NUMBER'
            ? newReceiverName.trim() || receiverInput
            : beneficiaryName(receiverInput);

      if (result.status === 'EXECUTED' && result.transaction) {
        const finalStatus = result.transaction.payment_status;
        const kind: PaymentResultKind =
          finalStatus === 'SUCCESS' || finalStatus === 'REFUNDED'
            ? 'SUCCESS'
            : finalStatus === 'FAILED' || finalStatus === 'UNKNOWN'
              ? 'FAILED'
              : 'PENDING';
        // Don't reveal the result the instant the API responds — real UPI
        // apps always hold on a "Processing…" spinner for a beat first, so
        // the eventual success/failure lands as a distinct animated event
        // rather than snapping in immediately (this is what makes a
        // simulated failure actually feel like something happened, not
        // like nothing did). setProcessingResult stashes the outcome;
        // handleProcessingDone (below) is what actually reveals it.
        setProcessingResult({ kind, amountLabel: `${formatInr(numericAmount)} to ${paidToName}` });

        if (kind === 'SUCCESS') {
          setSuccessBanner(
            `${formatInr(numericAmount)} sent to ${paidToName}. Transaction ${result.transaction.transaction_id} is complete.`,
          );
        } else if (kind === 'FAILED') {
          // No separate red banner here — the full-screen PaymentResultOverlay
          // (the red X animation) already told the customer this failed, and
          // the AI Teammate auto-investigates a failed payment from History
          // without needing a manual "tap and ask" prompt. A persistent text
          // banner on top of that was redundant and, once the AI resolved it,
          // went stale.
        } else {
          setPendingBanner({
            message:
              `${formatInr(numericAmount)} to ${paidToName} is still settling (${result.transaction.transaction_id}). ` +
              "The AI Teammate is monitoring it — you don't need to retry.",
            transactionId: result.transaction.transaction_id,
          });
        }

        setReceiverId('');
        setNewReceiverInput('');
        setNewReceiverName('');
        setAmount('');
        setNote('');
        onRefreshNeeded();
      } else if (result.status === 'STEP_UP_REQUIRED' && result.transaction) {
        onStepUpRequired(result.transaction, result.risk, result.gate_decision.reason);
        onRefreshNeeded();
      } else {
        setFormError(result.gate_decision.reason);
        onRefreshNeeded();
      }
    } catch (error) {
      setFormError(error instanceof api.ApiClientError ? error.message : 'Something went wrong sending this payment.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      {/* ---- Proactive Outage Detector banner --------------------------- */}
      {bankHealth?.status === 'DEGRADED' && (
        <div className="flex items-start gap-2.5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-orange-800">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-xs">
            <span className="font-bold">
              ▲ Warning: Repeated payment timeouts detected for {bankHealth.bank_name}.
            </span>{' '}
            Timeout rate is up {bankHealth.surge_percent}% over baseline. Payments to accounts using{' '}
            {bankHealth.bank_name} may experience delays before you send.
          </p>
        </div>
      )}

      {/* ---- Account header ------------------------------------------- */}
      <div className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-paytm-blue to-slate-800 p-5 text-white shadow-card">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-sm font-bold font-display">
            {initialsOf(customer?.name ?? 'Ananya Verma')}
          </div>
          <div>
            <div className="text-sm font-semibold">{customer?.name ?? 'Ananya Verma'}</div>
            <div className="text-xs text-white/60">Simulated Paytm Account</div>
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-1.5 text-xs text-white/60">
            <Wallet className="h-4 w-4" /> Balance
          </div>
          <div className="flex items-center justify-end gap-2">
            <div className="text-xl font-bold tracking-tight tabular-nums font-display">
              {balanceRevealed ? formatInr(customer?.balance ?? 500000) : '••••••'}
            </div>
            <button
              type="button"
              onClick={() => {
                if (balanceRevealed) {
                  // Hiding it again never needs a PIN — only revealing does.
                  setBalanceRevealed(false);
                } else {
                  setPinPadMode('BALANCE');
                }
              }}
              className="rounded-full p-1 text-white/70 transition hover:bg-white/10 hover:text-white"
              title={balanceRevealed ? 'Hide balance' : 'Show balance'}
            >
              {balanceRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* ---- Sliding promo carousel (original creative, not real brand art) */}
      <PromoCarousel />

      {/* ---- Quick actions row (decorative except the wired ones) -------
          grid-cols-3 (two rows of three) rather than grid-cols-5 in one
          cramped row — now that there are 6 actions, forcing them all into
          one row would shrink every icon to fit, which is the same
          "uneven/squeezed" look already fixed once on the rewards strip. */}
      <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-card">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          const isWired = action.action !== 'NONE';
          return (
            <button
              key={action.label}
              type="button"
              title={action.note}
              onClick={
                action.action === 'TO_NUMBER'
                  ? () => setPayMode('NEW_NUMBER')
                  : action.action === 'SCAN_QR'
                    ? () => {
                        setQrInfoMessage(null);
                        setShowQrScanner(true);
                      }
                    : action.action === 'LOANS'
                      ? () => setShowLoansModal(true)
                      : undefined
              }
              className={[
                'flex flex-col items-center gap-1.5 rounded-xl p-2 text-center transition',
                isWired ? 'hover:bg-slate-50 active:scale-95' : 'cursor-default opacity-70',
              ].join(' ')}
            >
              <div
                className={[
                  'flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm transition',
                  action.gradient,
                  isWired ? 'hover:shadow-md' : '',
                ].join(' ')}
              >
                <Icon className="h-6 w-6" strokeWidth={2.2} />
              </div>
              <span className="text-[11px] font-semibold leading-tight text-slate-600">{action.label}</span>
            </button>
          );
        })}
      </div>

      {qrInfoMessage && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-700">
          <QrCode className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{qrInfoMessage}</span>
        </div>
      )}

      {/* ---- Rewards / offers strip (decorative, original creative) -----
          A 4-column grid rather than a fixed-width horizontal scroll strip
          — with 4 equal-width cards, every one sizes itself to exactly a
          quarter of the available width, so they're always visually
          uniform and never overflow past the edge the way a 4th
          fixed-width card in a scrollable row could. */}
      <div className="grid grid-cols-4 gap-1.5">
        {[
          { title: 'Scratch Card', subtitle: 'Won on last payment', gradient: 'from-fuchsia-500 to-purple-600' },
          { title: '2% Cashback', subtitle: 'On bill payments', gradient: 'from-sky-500 to-blue-600' },
          { title: 'Refer & Earn', subtitle: 'Get rewards', gradient: 'from-emerald-500 to-teal-600' },
          { title: 'Bill Reminders', subtitle: "Don't miss a date", gradient: 'from-amber-500 to-orange-600' },
        ].map((card) => (
          <div
            key={card.title}
            title="Decorative — not wired up in this demo"
            className={`flex min-w-0 flex-col justify-between rounded-xl bg-gradient-to-br ${card.gradient} p-2 text-white`}
          >
            <span className="truncate text-[11px] font-bold">{card.title}</span>
            <span className="mt-1.5 text-[10px] leading-tight text-white/85">{card.subtitle}</span>
          </div>
        ))}
      </div>

      {/* ---- Send Money form -------------------------------------------- */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-paytm-cyan to-paytm-blue text-white shadow-sm">
            <ArrowUpRight className="h-4 w-4" strokeWidth={2.4} />
          </div>
          <h2 className="text-sm font-bold text-slate-800">Send Money</h2>
        </div>

        {/* ---- Saved contact vs. any number/UPI ID toggle -------------- */}
        <div className="mb-3 flex gap-1.5 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setPayMode('SAVED');
              // A real "Pay Contacts" flow drops straight into the contact
              // list, not a bare dropdown — open the picker the moment this
              // tab is chosen (re-opening it is also always one tap away
              // from the "Change" link on a chosen contact, below).
              setShowContactPicker(true);
            }}
            disabled={submitting}
            className={[
              'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition',
              payMode === 'SAVED' ? 'bg-white text-paytm-blue shadow-card' : 'text-slate-500',
            ].join(' ')}
          >
            <Contact className="h-4 w-4" /> Saved Contact
          </button>
          <button
            type="button"
            onClick={() => setPayMode('NEW_NUMBER')}
            disabled={submitting}
            className={[
              'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition',
              payMode === 'NEW_NUMBER' ? 'bg-white text-paytm-blue shadow-card' : 'text-slate-500',
            ].join(' ')}
          >
            <Smartphone className="h-4 w-4" /> Mobile Number / UPI ID
          </button>
        </div>

        <div className="space-y-3">
          {payMode === 'SAVED' ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Beneficiary</label>
              {receiverId ? (
                <button
                  type="button"
                  onClick={() => setShowContactPicker(true)}
                  disabled={submitting}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:border-paytm-cyan disabled:cursor-not-allowed"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-paytm-cyan to-paytm-blue text-xs font-bold text-white">
                    {initialsOf(beneficiaryName(receiverId))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-800">{beneficiaryName(receiverId)}</div>
                    <div className="text-xs text-slate-400">{beneficiaryById.get(receiverId)?.beneficiary.upi_id}</div>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-paytm-cyan">Change</span>
                </button>
              ) : null}
              {receiverId && contactHistoryFor(transactions, receiverId).length > 0 && (
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                    <MessageCircle className="h-3.5 w-3.5" />
                    Your history with {beneficiaryName(receiverId)}
                  </div>
                  <div className="max-h-40 space-y-1.5 overflow-y-auto thin-scrollbar">
                    {contactHistoryFor(transactions, receiverId).map((t) => {
                      const outcome = rowOutcomeFor(t);
                      const badge = ROW_OUTCOME_BADGE[outcome];
                      const BadgeIcon = badge.icon;
                      return (
                        <button
                          key={t.transaction_id}
                          type="button"
                          onClick={() => setSelectedTransaction(t)}
                          className="flex w-full items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-left shadow-sm transition hover:border-paytm-cyan"
                        >
                          <BadgeIcon className={`h-3.5 w-3.5 shrink-0 ${badge.className}`} />
                          <span className="flex-1 truncate text-xs text-slate-600">
                            {outcome === 'refunded'
                              ? 'Refunded'
                              : outcome === 'failed'
                                ? failureReasonFor(t)
                                : outcome === 'blocked'
                                  ? 'Blocked'
                                  : outcome === 'pending'
                                    ? 'Pending'
                                    : 'Paid'}
                          </span>
                          <span className="shrink-0 text-xs font-semibold text-slate-700">{formatInr(t.amount)}</span>
                          <span className="shrink-0 text-[11px] text-slate-400">{formatRelativeTime(t.timestamp)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {!receiverId && (
                <button
                  type="button"
                  onClick={() => setShowContactPicker(true)}
                  disabled={submitting}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-slate-500 transition hover:border-paytm-cyan hover:text-paytm-blue disabled:cursor-not-allowed"
                >
                  <Contact className="h-4 w-4" />
                  <span className="text-sm font-medium">Choose a contact to pay…</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Mobile number or UPI ID</label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={newReceiverInput}
                    onChange={(e) => setNewReceiverInput(e.target.value)}
                    disabled={submitting}
                    placeholder="9876543210 or name@upi"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-paytm-cyan focus:outline-none focus:ring-1 focus:ring-paytm-cyan disabled:bg-slate-50"
                  />
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  Any 10-digit Indian mobile number or UPI ID works — it doesn't need to be saved first. It's
                  registered as a brand-new contact and scored accordingly by the risk engine.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Their name (optional)</label>
                <input
                  type="text"
                  value={newReceiverName}
                  onChange={(e) => setNewReceiverName(e.target.value)}
                  disabled={submitting}
                  placeholder="e.g. Sarvesh"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-paytm-cyan focus:outline-none focus:ring-1 focus:ring-paytm-cyan disabled:bg-slate-50"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Amount (₹)</label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={submitting}
              placeholder="e.g. 2000"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-paytm-cyan focus:outline-none focus:ring-1 focus:ring-paytm-cyan disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              placeholder="What's this for?"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-paytm-cyan focus:outline-none focus:ring-1 focus:ring-paytm-cyan disabled:bg-slate-50"
            />
          </div>

          {formError && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {successBanner && (
            <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{successBanner}</span>
            </div>
          )}

          {pendingBanner && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              <span>{pendingBanner.message}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handlePayNowClick}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-paytm-cyan px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
            Pay Now
          </button>
        </div>
      </div>

      {/* ---- Transaction History — a real app doesn't dump the raw list on
          the home screen; it's one tap away behind a clean entry point. --- */}
      <button
        type="button"
        onClick={() => setShowHistoryModal(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-card transition hover:border-paytm-cyan"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-paytm-cyan to-paytm-blue text-white">
          <History className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-800">View Payment History</div>
          <div className="text-xs text-slate-400">Your recent payments, refunds &amp; receipts</div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
      </button>

      {/* ---- Full transaction slip — real-payment-app receipt style ----- */}
      {selectedTransaction && (
        <TransactionSlip
          transaction={selectedTransaction}
          receiverName={beneficiaryName(selectedTransaction.receiver_id)}
          onClose={() => setSelectedTransaction(null)}
          onAskAiTeammate={() => {
            onAskAiTeammate(selectedTransaction.transaction_id);
            setSelectedTransaction(null);
          }}
        />
      )}

      {/* ---- Payment History modal — scrollable, curated (see
          curateHistory() above): 5 successful, 1 refund, 1 failed (with its
          reason), plus whatever the customer just personally did. --------- */}
      {showHistoryModal && (
        <div
          className="fixed inset-0 z-[65] flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setShowHistoryModal(false)}
        >
          <div
            className="flex h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:h-[80vh] sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-gradient-to-r from-paytm-blue to-paytm-cyan px-5 py-4 text-white">
              <div>
                <div className="text-sm font-bold font-display">Payment History</div>
                <div className="text-xs text-white/70">Recent payments, refunds &amp; receipts</div>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="rounded-full p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto thin-scrollbar">
              {(() => {
                const curated = curateHistory(transactions, lastOwnTransactionId);
                if (curated.length === 0) {
                  return <p className="px-5 py-10 text-center text-sm text-slate-400">No transactions yet.</p>;
                }
                return (
                  <ul className="divide-y divide-slate-100 px-4">
                    {curated.map((t) => {
                      const outcome = rowOutcomeFor(t);
                      const name = beneficiaryName(t.receiver_id);
                      return (
                        <li key={t.transaction_id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTransaction(t);
                              setShowHistoryModal(false);
                            }}
                            className="flex w-full items-center gap-3 py-3 text-left transition hover:bg-slate-50"
                          >
                            <div
                              className={[
                                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
                                outcome === 'success'
                                  ? 'bg-emerald-500'
                                  : outcome === 'failed'
                                    ? 'bg-red-500'
                                    : outcome === 'refunded'
                                      ? 'bg-purple-500'
                                      : outcome === 'blocked'
                                        ? 'bg-slate-500'
                                        : 'bg-amber-500',
                              ].join(' ')}
                            >
                              {initialsOf(name)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-slate-800">
                                {outcome === 'refunded'
                                  ? `Refund from ${name}`
                                  : outcome === 'blocked'
                                    ? `Blocked payment to ${name}`
                                    : `Paid to ${name}`}
                              </span>
                              <span className="text-xs text-slate-400">
                                {outcome === 'refunded'
                                  ? `Payment to ${name} failed — money returned`
                                  : outcome === 'blocked'
                                    ? (t.policy_block_reason ?? 'Blocked before reaching the bank')
                                    : outcome === 'failed'
                                      ? `Payment failed — ${failureReasonFor(t)}`
                                      : formatRelativeTime(t.timestamp)}
                              </span>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-0.5">
                              <span
                                className={[
                                  'text-sm font-bold',
                                  outcome === 'success'
                                    ? 'text-slate-800'
                                    : outcome === 'failed'
                                      ? 'text-red-600'
                                      : outcome === 'refunded'
                                        ? 'text-emerald-600'
                                        : outcome === 'blocked'
                                          ? 'text-slate-400'
                                          : 'text-amber-600',
                                ].join(' ')}
                              >
                                {outcome === 'refunded' ? '+' : ''}
                                {formatInr(t.amount)}
                              </span>
                              <span className="text-[11px] font-medium text-slate-400">
                                {outcome === 'success'
                                  ? 'Successful'
                                  : outcome === 'failed'
                                    ? 'Failed'
                                    : outcome === 'refunded'
                                      ? 'Refunded to you'
                                      : outcome === 'blocked'
                                        ? 'Blocked'
                                        : 'Pending'}
                              </span>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ---- Contacts picker for "Saved Contact" ------------------------- */}
      {showContactPicker && (
        <ContactPicker
          beneficiaries={beneficiaries}
          onClose={() => setShowContactPicker(false)}
          onSelectOnAppContact={(beneficiaryId) => {
            setReceiverId(beneficiaryId);
            setPayMode('SAVED');
            setShowContactPicker(false);
          }}
          onPayByNumberAnyway={(phone, name) => {
            setPayMode('NEW_NUMBER');
            setNewReceiverInput(phone);
            setNewReceiverName(name);
            setShowContactPicker(false);
          }}
        />
      )}

      {/* ---- Loans section ------------------------------------------------ */}
      {showLoansModal && (
        <LoansModal customerName={customer?.name ?? 'Ananya Verma'} onClose={() => setShowLoansModal(false)} />
      )}

      {/* ---- Large-amount confirmation — a pause, not a block ------------
          Real apps never simply refuse a valid large payment; they ask you
          to confirm you meant it. Cancel just closes this and nothing is
          sent; Continue moves on to the normal PIN step exactly like any
          other amount would. */}
      {largeAmountConfirmValue !== null && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">Large payment</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  You're about to send {formatInr(largeAmountConfirmValue)}. In line with RBI's guidance for large UPI
                  transfers, we just want to make sure — do you still want to go ahead?
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setLargeAmountConfirmValue(null)}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmLargeAmountAndContinue}
                className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Yes, continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Simulated PIN / fingerprint gate ---------------------------- */}
      {pinPadMode && (
        <PinPad
          title={pinPadMode === 'PAY' ? 'Confirm Payment' : 'Verify to View Balance'}
          subtitle={
            pinPadMode === 'PAY'
              ? `Enter your UPI PIN to send ${amount ? formatInr(Number(amount)) : 'this payment'}.`
              : 'Enter your UPI PIN to view your account balance.'
          }
          onSuccess={() => {
            if (pinPadMode === 'PAY') {
              void executePayment();
            } else {
              setBalanceRevealed(true);
              setPinPadMode(null);
            }
          }}
          onCancel={() => setPinPadMode(null)}
        />
      )}

      {/* ---- Real device-camera QR scanner ------------------------------- */}
      {showQrScanner && <QrScanner onResult={handleQrResult} onCancel={() => setShowQrScanner(false)} />}

      {/* ---- Promotional pop-up (original copy, shown once per session) - */}
      <AdPopup />

      {/* ---- Animated + audible success/fail/pending result -------------- */}
      {processingResult && (
        <ProcessingOverlay
          label={processingResult.kind === 'FAILED' ? 'Verifying with your bank…' : 'Processing your payment…'}
          onDone={handleProcessingDone}
        />
      )}
      {paymentResult && (
        <PaymentResultOverlay
          kind={paymentResult.kind}
          amountLabel={paymentResult.amountLabel}
          onDone={() => setPaymentResult(null)}
        />
      )}
    </div>
  );
}
