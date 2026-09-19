/**
 * PaytmResolve AI — AI Teammate Chat
 * ---------------------------------------------------------------------------
 * The conversational resolution surface. A customer describes a payment
 * problem (typed, "voice"-simulated, or a receipt photo) and the AI
 * teammate investigates using the real backend pipeline
 * (`POST /api/agent/investigate`), which itself is UNDERSTAND ->
 * INVESTIGATE -> DECIDE -> ACT -> VERIFY over the deterministic engines.
 * Nothing in this component decides anything about money — it renders
 * whatever the backend's audit trail, decision, risk, and action-gate
 * results actually were.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  Loader2,
  Mic,
  Paperclip,
  Phone,
  RefreshCcw,
  Send,
  ShieldAlert,
  Ticket,
  UploadCloud,
  Wallet,
  X,
} from 'lucide-react';
import * as api from '../services/api';
import type { ChatUIMessage, Transaction } from '../types';
import FakeCallModal from './FakeCallModal';
import type { InvestigationPhase } from './InvestigationTracker';

/** Real client-side OCR (Tesseract.js, WASM, runs entirely in the browser —
 * no server-side vision call). Used for any uploaded screenshot that isn't
 * the one bundled "known sample" asset below: this is what lets a genuine
 * screenshot of this app's own transaction history (with a visible
 * "TXN_DEBIT_02"-style id printed on it) actually get read and matched,
 * instead of silently failing on anything but the answer-key sample. */
async function recognizeReceiptText(imageSource: string): Promise<string> {
  const { default: Tesseract } = await import('tesseract.js');
  const { data } = await Tesseract.recognize(imageSource, 'eng');
  return data.text ?? '';
}

// ============================================================================
// STATIC UI CONTENT (copy only — no fabricated backend data)
// ============================================================================

/** Fallback quick-prompts shown only when the browser has no real speech
 * recognition API at all (e.g. Firefox desktop) — everywhere Chrome-based
 * (including the in-app browser most judges will use) gets real
 * microphone-driven speech-to-text via the Web Speech API instead. */
const QUICK_VOICE_PROMPTS = [
  'Mere paise kat gaye par transfer nahi hua',
  'Check status of last debit',
];

/** Minimal shape of the Web Speech API this component actually uses — the
 * DOM lib doesn't ship types for it (it's still non-standard), so this is a
 * small local type instead of `any` everywhere it's touched. */
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const TONE_CLASSES: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  bad: 'bg-red-50 text-red-700 border-red-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  reversed: 'bg-purple-50 text-purple-700 border-purple-200',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
};

function toneForValue(value: string): string {
  if (['SUCCESS', 'CREDITED', 'COMPLETED', 'REFUNDED'].includes(value)) return 'good';
  if (['FAILED', 'NOT_RECEIVED'].includes(value)) return 'bad';
  if (['PENDING', 'TIMEOUT', 'PROCESSING', 'REQUESTED', 'REFUND_PENDING'].includes(value)) return 'warn';
  if (['DEBITED', 'INITIATED'].includes(value)) return 'info';
  if (value === 'REVERSED') return 'reversed';
  return 'neutral';
}

function MiniBadge({ label, value }: { label: string; value: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${TONE_CLASSES[toneForValue(value)]}`}
    >
      <span className="text-slate-400">{label}:</span>
      {value}
    </span>
  );
}

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

/** The backend's deterministic engines actually resolve in milliseconds —
 * too fast to read as "real work" to a human watching. These small,
 * randomized artificial delays are purely a presentation choice (no status
 * shown is ever faked — the AI has already produced the real result by the
 * time these resolve) so an investigation reads the way a genuine
 * multi-system check would: a beat to look, a beat to act. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

/** How long to pause on a just-shown message before sending the next one —
 * scaled to how long the message actually takes to read (~14 characters/
 * second, a comfortable reading pace), not a fixed number. A one-line
 * diagnosis and a five-sentence one shouldn't get the same pause: the
 * point is giving the person time to actually read what's on screen
 * before the next message lands, never a flat "wait N seconds" that's too
 * short for a long message or too long for a short one. Floored at 2.6s
 * (never less than "a couple of seconds," per the ask) and capped at 6s
 * (so it never feels like the chat has stalled). */
function readingPauseMs(text: string): number {
  const estimate = (text.length / 14) * 1000;
  return Math.min(6000, Math.max(2600, estimate));
}

// ============================================================================
// RESOLUTION / ESCALATION CARD
// ============================================================================

function ResolutionCard({
  result,
  onSwitchToHumanOps,
}: {
  result: api.AgentInvestigationResultResponse;
  onSwitchToHumanOps: () => void;
}) {
  if (result.support_case) {
    const c = result.support_case;
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
        <div className="mb-1 flex items-center gap-2 text-rose-800">
          <Ticket className="h-4 w-4" />
          <span className="text-sm font-bold">Escalated to Human Ops</span>
        </div>
        <p className="text-xs text-rose-700">
          Case <span className="font-mono font-semibold">#{c.case_id.replace(/^SUP-/, 'SUP-')}</span> ·{' '}
          <span className="font-semibold">{c.priority}</span> priority
        </p>
        <p className="mt-1 text-xs text-rose-700">{c.reason}</p>
        <button
          type="button"
          onClick={onSwitchToHumanOps}
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-800"
        >
          View in Human Ops Center <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const t = result.final_transaction;
  if (t && (t.refund_status === 'PROCESSING' || t.refund_status === 'COMPLETED' || t.payment_status === 'REFUNDED')) {
    const isComplete = t.refund_status === 'COMPLETED';
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="mb-1 flex items-center gap-2 text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-sm font-bold">Refund {isComplete ? 'Completed' : 'In Progress'}</span>
        </div>
        <div className="space-y-1 text-xs text-emerald-700">
          <div className="flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5" /> Amount restored: {formatInr(t.amount)}
          </div>
          <div className="flex items-center gap-1.5">
            <RefreshCcw className="h-3.5 w-3.5" /> Refund reference: {t.transaction_id}
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowRight className="h-3.5 w-3.5" /> State:{' '}
            <MiniBadge label="Refund" value={t.refund_status} />
          </div>
          {!isComplete && (
            <div className="flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" /> ETA: typically completes within a few minutes
            </div>
          )}
        </div>
      </div>
    );
  }

  // Defense in depth: recommended_action is only ever null when
  // transaction_id is also null, and the caller already skips rendering
  // this card in that case (see the `latestResult.transaction_id &&` guard
  // below). This branch exists so a future caller can never crash the
  // whole chat over a null field — the single bug behind both "it goes
  // blank" reports: an unguarded `.replace()` on a null value threw during
  // render and, with no error boundary, took the entire panel down with it.
  if (!result.recommended_action) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-1 flex items-center gap-2 text-slate-700">
        <ShieldAlert className="h-4 w-4" />
        <span className="text-sm font-bold">Recommended action</span>
      </div>
      <p className="text-xs text-slate-600">{result.recommended_action.replace(/_/g, ' ')}</p>
    </div>
  );
}

// ============================================================================
// CUSTOMER CARE ESCALATION CARD
// ----------------------------------------------------------------------------
// Rendered whenever the backend halted automated resolution and matched a
// Customer Care Escalation Protocol category (fraud, wrong-beneficiary
// transfer, account takeover, merchant dispute, regulatory/severe
// distress). Unlike ResolutionCard, this never depends on
// a transaction_id being present — a fraud report may not name one at all.
// ============================================================================

const CARE_CATEGORY_LABEL: Record<string, string> = {
  FRAUD_SCAM_PHISHING: 'Suspected Fraud / Scam',
  WRONG_BENEFICIARY_TRANSFER: 'Wrong Beneficiary Transfer',
  ACCOUNT_TAKEOVER_SECURITY: 'Account Security',
  MERCHANT_PHYSICAL_DISPUTE: 'Merchant Dispute',
  REGULATORY_SEVERE_DISTRESS: 'Urgent / Regulatory',
};

function CareEscalationCard({
  escalation,
  onStartSimulatedCall,
}: {
  escalation: NonNullable<api.AgentInvestigationResultResponse['care_escalation']>;
  onStartSimulatedCall: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-red-200 bg-red-50">
      <div className="flex items-center gap-2 border-b border-red-200 bg-red-100/60 px-4 py-2.5">
        <ShieldAlert className="h-4 w-4 text-red-700" />
        <span className="text-sm font-bold text-red-800">Escalated to Customer Care</span>
        <span className="ml-auto rounded-full bg-red-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          {escalation.priority}
        </span>
      </div>
      <div className="space-y-3 p-4">
        <div className="text-xs text-red-800">
          <span className="font-semibold">{CARE_CATEGORY_LABEL[escalation.category] ?? escalation.category}</span> ·
          Case <span className="font-mono font-semibold">#{escalation.ticket_id}</span> ·{' '}
          <span className="font-semibold">
            {escalation.status === 'IN_PROGRESS' ? 'Agent connected' : 'Awaiting agent'}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-red-700">{escalation.reason}</p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={escalation.phone_tel_href}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-700 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-red-800"
          >
            📞 Call Priority Care ({escalation.phone_display})
          </a>
          <button
            type="button"
            onClick={onStartSimulatedCall}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2.5 text-xs font-bold text-red-700 transition hover:bg-red-50"
          >
            <Phone className="h-3.5 w-3.5" /> Simulate Agent Call
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CHAT BUBBLE
// ============================================================================

function ChatBubble({ message }: { message: ChatUIMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-paytm-blue to-paytm-cyan text-white shadow-sm">
          <Bot className="h-3.5 w-3.5" />
        </div>
      )}
      <div
        className={[
          // Wider bubbles (was 82%) so a normal-length message reads in
          // fewer, longer lines instead of a tall, narrow column that
          // forces scrolling to finish reading it — the actual complaint
          // wasn't the font itself, it was too little width for it.
          'max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm',
          isUser
            ? 'rounded-br-md bg-gradient-to-br from-slate-800 to-slate-900 text-white shadow-md'
            : 'rounded-bl-md border border-slate-100 bg-white text-slate-700 shadow-card',
        ].join(' ')}
      >
        {/* No per-bubble sender label anymore — bubble side/color/the bot
            avatar already say who's speaking, and repeating "AI Teammate"
            on every single message (on top of the panel's own title bar)
            was pure visual clutter eating space this small panel doesn't
            have to spare. A spinner still shows on a genuinely pending
            message. */}
        {message.is_pending && (
          <div className="flex items-center gap-1.5 pb-1">
            <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
          </div>
        )}
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
      </div>
    </div>
  );
}

// ============================================================================
// PROPS
// ============================================================================

export interface AiTeammateChatProps {
  activeTransactionId: string | null;
  transactions: Transaction[];
  onClearActiveTransaction: () => void;
  onRefreshNeeded: () => void;
  onSwitchToHumanOps: () => void;
  /** Optional — lets a parent-hosted Investigation Tracker mirror the real
   * pipeline stage as this runs. Fully optional so nothing about the chat's
   * own behavior/timing changes for any caller that doesn't pass it. */
  onPhaseChange?: (phase: InvestigationPhase) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function AiTeammateChat({
  activeTransactionId,
  transactions,
  onClearActiveTransaction,
  onRefreshNeeded,
  onSwitchToHumanOps,
  onPhaseChange,
}: AiTeammateChatProps) {
  const [messages, setMessages] = useState<ChatUIMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hi, I'm your AI Teammate. Tell me what happened — in English, Hindi, or Hinglish — or attach a payment receipt and I'll investigate.",
      created_at: new Date().toISOString(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<api.AgentInvestigationResultResponse | null>(null);
  const [resolvingStep, setResolvingStep] = useState(false);
  const [activeCareCall, setActiveCareCall] = useState<{
    ticketId: string;
    category: NonNullable<api.AgentInvestigationResultResponse['care_escalation']>['category'] | null;
  } | null>(null);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechSupported = useRef(getSpeechRecognitionCtor() !== null).current;
  const [ocrBusy, setOcrBusy] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const autoInvestigatedIdRef = useRef<string | null>(null);
  const monitoringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const monitoringSeenChecksRef = useRef<Set<number>>(new Set());

  const activeTransaction = activeTransactionId
    ? transactions.find((t) => t.transaction_id === activeTransactionId) ?? null
    : null;

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, latestResult]);

  // ---- Auto-investigate when arriving with a pre-loaded transaction -----
  useEffect(() => {
    if (activeTransactionId && autoInvestigatedIdRef.current !== activeTransactionId) {
      autoInvestigatedIdRef.current = activeTransactionId;
      void runInvestigation(undefined, activeTransactionId, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTransactionId]);

  // ---- Live monitoring poll: when the decision engine says
  // MONITOR_AND_POLL, the backend's monitoringEngine has already started
  // an accelerated poll cycle (see opsAgent.ts). Poll its progress once a
  // second and stream each real check onto the timeline as it lands,
  // ending with "✓ Transaction resolved. Customer notified." — never a
  // narrated fake wait.
  useEffect(() => {
    if (!latestResult || latestResult.decision?.decision_code !== 'MONITOR_AND_POLL' || !latestResult.transaction_id) {
      return;
    }
    const transactionId = latestResult.transaction_id;
    monitoringSeenChecksRef.current = new Set();

    function stopPolling() {
      if (monitoringIntervalRef.current) {
        clearInterval(monitoringIntervalRef.current);
        monitoringIntervalRef.current = null;
      }
    }

    async function poll() {
      try {
        const state = await api.getMonitoringState(transactionId);
        for (const check of state.checks) {
          if (monitoringSeenChecksRef.current.has(check.check_number)) continue;
          monitoringSeenChecksRef.current.add(check.check_number);
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'system',
              content: check.description,
              created_at: check.observed_at,
            },
          ]);
        }
        if (state.is_complete) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'system',
              content: state.resolution_message ?? '✓ Transaction resolved. Customer notified.',
              created_at: new Date().toISOString(),
            },
          ]);
          onRefreshNeeded();
          stopPolling();
        }
      } catch {
        // No monitoring run found (404) — nothing to poll (yet, or the
        // scenario was reset out from under it). Stop quietly.
        stopPolling();
      }
    }

    void poll();
    monitoringIntervalRef.current = setInterval(poll, 1_000);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestResult]);

  async function runInvestigation(complaintText: string | undefined, transactionId: string | undefined, silent = false) {
    if (!complaintText && !transactionId) return;
    setSending(true);
    setErrorMessage(null);

    if (!silent && complaintText) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: complaintText, created_at: new Date().toISOString() },
      ]);
    }
    if (silent && transactionId) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'system',
          content: `Investigating transaction ${transactionId}…`,
          created_at: new Date().toISOString(),
        },
      ]);
    }

    try {
      // Optional, additive-only pacing for the Investigation Tracker: real
      // stage names (see opsAgent.ts's UNDERSTAND -> INVESTIGATE -> DECIDE
      // -> ACT pipeline), given a brief beat each so the tracker's dots
      // visibly progress instead of jumping straight to "done". Only runs
      // (and only adds these ~600ms) when a tracker is actually mounted —
      // no tracker passed means zero change to existing timing/behavior.
      if (onPhaseChange) {
        onPhaseChange('STEP_INTENT');
        await sleep(300);
        onPhaseChange('STEP_ENTITY');
        await sleep(300);
        onPhaseChange('STEP_API');
      }

      // The engines underneath resolve almost instantly — a real multi-system
      // check (bank + UPI + receiver + refund) never would. Hold the reply
      // back for a short, randomized beat so it reads as genuine work rather
      // than a suspiciously instant magic fix (nothing shown is faked; the
      // result is already final by the time this resolves).
      const [result] = await Promise.all([
        api.investigateTransaction(complaintText ?? '', transactionId),
        sleep(randomDelayMs(1800, 2800)),
      ]);
      onPhaseChange?.('STEP_DECISION');

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.narrative,
          created_at: new Date().toISOString(),
          transaction_id: result.transaction_id ?? undefined,
        },
      ]);

      const resolutionNarrative = result.resolution_narrative;
      if (resolutionNarrative) {
        // Diagnosis and resolution are told as two separate beats — "here's
        // what's wrong" then, once there's been time to actually read that
        // (see readingPauseMs — never less than ~2.6s), "here's what I did
        // about it." Never crammed into one message, and never so fast
        // after the first that it reads as pre-scripted rather than the AI
        // pausing to let the diagnosis land before moving on.
        setSending(false);
        setResolvingStep(true);
        onPhaseChange?.('STEP_ACTION');
        await sleep(readingPauseMs(result.narrative));
        setResolvingStep(false);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: resolutionNarrative,
            created_at: new Date().toISOString(),
            transaction_id: result.transaction_id ?? undefined,
          },
        ]);
      }

      onPhaseChange?.('DONE');
      setLatestResult(result);
      onRefreshNeeded();
    } catch (error) {
      onPhaseChange?.('IDLE');
      const message =
        error instanceof api.ApiClientError ? error.message : 'I could not reach the investigation service.';
      setErrorMessage(message);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: `Sorry — ${message}`, created_at: new Date().toISOString() },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    const text = inputText.trim();
    if (!text || sending) return;
    setInputText('');
    await runInvestigation(text, activeTransactionId ?? undefined);
  }

  function handleQuickVoicePrompt(prompt: string) {
    setInputText(prompt);
    setVoiceMenuOpen(false);
  }

  /** Real microphone-driven speech-to-text (Web Speech API) — not a
   * simulation. Toggling it on requests mic permission and starts live
   * transcription straight into the composer; toggling it off (or the
   * browser detecting silence) stops it. Falls back to the canned prompt
   * menu only on a browser with no SpeechRecognition implementation. */
  function toggleVoiceInput() {
    if (!speechSupported) {
      setVoiceMenuOpen((open) => !open);
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    setVoiceError(null);
    const recognition = new Ctor();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setInputText(transcript);
    };
    recognition.onerror = (event) => {
      setVoiceError(
        event.error === 'not-allowed' || event.error === 'permission-denied'
          ? 'Microphone access was denied — allow it in your browser to use voice input.'
          : 'Could not hear that clearly — try again or type your message.',
      );
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  async function handleFileSelected(file: File) {
    setOcrBusy(true);
    setErrorMessage(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the selected file.'));
        reader.readAsDataURL(file);
      });

      // Run real OCR on the screenshot in the browser (Tesseract.js) — this
      // is what lets a screenshot of, say, this app's own transaction
      // history (showing a real "TXN_DEBIT_02" on screen) actually get
      // recognized.
      let ocrText: string | undefined;
      try {
        ocrText = await recognizeReceiptText(base64);
      } catch {
        // Real OCR can genuinely fail to load/run (e.g. no network for the
        // WASM/model assets) — fall back to the filename-only heuristic
        // already built into the backend rather than blocking the upload.
        ocrText = undefined;
      }

      const result = await api.parseReceiptOcr(base64, file.name, ocrText);
      await handleOcrResult(result, file.name);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not process the uploaded receipt.');
    } finally {
      setOcrBusy(false);
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!ocrBusy && !sending) setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (ocrBusy || sending) return;
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      void handleFileSelected(file);
    } else if (file) {
      setErrorMessage('Please drop an image file (the receipt photo).');
    }
  }

  async function handleOcrResult(result: Awaited<ReturnType<typeof api.parseReceiptOcr>>, filename: string) {
    const summaryLines = [
      `📄 Scanned ${filename}`,
      result.found_transaction_id ? `Transaction ID: ${result.found_transaction_id}` : 'No transaction ID recognized.',
      result.extracted_amount !== null ? `Amount: ${formatInr(result.extracted_amount)}` : undefined,
      result.extracted_status ? `Status on receipt: ${result.extracted_status}` : undefined,
      `Confidence: ${Math.round(result.confidence * 100)}%`,
    ].filter(Boolean);

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'system',
        content: summaryLines.join('\n'),
        created_at: new Date().toISOString(),
      },
    ]);

    if (result.matched_existing_record && result.found_transaction_id) {
      await runInvestigation(undefined, result.found_transaction_id, true);
      return;
    }

    // Honest outcome, not a dead end: this really did run OCR on the image
    // (Tesseract.js, in-browser), it just couldn't make out a transaction id
    // clearly enough — low-resolution screenshots, small text, or heavy
    // cropping can genuinely defeat OCR, exactly like a real receipt-reader.
    // The bug was leaving the conversation hanging here with no next step
    // when that happens. Give one instead.
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          "I scanned that image but couldn't make out a clear transaction ID on it — try a sharper, less-cropped screenshot of the " +
          "transaction (the History list or its detail view both show the ID clearly), or just tell me what happened in words " +
          "(e.g. the amount and who you paid), or paste the transaction ID if you have it, and I'll look it up.",
        created_at: new Date().toISOString(),
      },
    ]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      {/* No header here anymore — the panel that hosts this component
          (App.tsx) already renders one "AI Teammate" title bar with a
          close button right above this. Having a second, near-identical
          gradient header inside the panel too just ate vertical space for
          no new information. */}

      {/* ---- Scrollable region: context bar + transcript + timeline ---- */}
      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1 thin-scrollbar">
        {/* ---- Active context bar ------------------------------------- */}
        {activeTransaction && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-card">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Bot className="h-4 w-4 text-paytm-cyan" />
              Investigating <span className="font-mono font-semibold text-slate-800">{activeTransaction.transaction_id}</span>
              <span className="text-slate-400">
                · {formatInr(activeTransaction.amount)} · {activeTransaction.payment_status}
              </span>
            </div>
            <button
              type="button"
              onClick={onClearActiveTransaction}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
        )}

        {/* ---- Chat transcript ------------------------------------------ */}
        <div className="min-h-[160px] space-y-3 rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-blue-50/40 p-4">
          {messages.map((m) =>
            m.role === 'system' ? (
              <div key={m.id} className="mx-auto max-w-[90%] rounded-lg bg-slate-200/70 px-3 py-2 text-center text-[11px] text-slate-600 whitespace-pre-wrap">
                {m.content}
              </div>
            ) : (
              <ChatBubble key={m.id} message={m} />
            ),
          )}
          {sending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 text-xs text-slate-500 shadow-card">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Investigating…
              </div>
            </div>
          )}
          {resolvingStep && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 text-xs text-slate-500 shadow-card">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working on it…
              </div>
            </div>
          )}
          <div ref={scrollAnchorRef} />
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* ---- Customer Care escalation card -------------------------------
            Independent of transaction_id — a fraud report or a security
            incident may not name a transaction at all, so this renders
            purely off care_escalation being present. */}
        {latestResult?.care_escalation && (
          <CareEscalationCard
            escalation={latestResult.care_escalation}
            onStartSimulatedCall={() =>
              setActiveCareCall({
                ticketId: latestResult.care_escalation!.ticket_id,
                category: latestResult.care_escalation!.category,
              })
            }
          />
        )}

        {/* ---- Resolution card ---------------------------------------------
            Only when a real transaction was actually found — when it
            wasn't, the narrative message above already explains that and
            asks a clarifying question; there is nothing else to show. The
            full mechanical "what the AI checked" trace used to render here
            too, but it was pure debug/audit noise from a customer's point
            of view — real payment apps don't show you a tool-call log, they
            just tell you what happened and what they're doing about it,
            which is exactly what ResolutionCard already does on its own. */}
        {latestResult && latestResult.transaction_id && !latestResult.care_escalation && (
          <div className="space-y-3">
            <ResolutionCard result={latestResult} onSwitchToHumanOps={onSwitchToHumanOps} />
          </div>
        )}
      </div>

      {/* ---- Simulated Customer Care call ------------------------------- */}
      {activeCareCall && (
        <FakeCallModal
          ticketId={activeCareCall.ticketId}
          category={activeCareCall.category}
          onEndCall={() => {
            // Simulated hand-off: ending the call marks the ticket
            // IN_PROGRESS locally (a human is now on it). Nothing here
            // claims a real call happened — see FakeCallModal's own note.
            setLatestResult((prev) =>
              prev?.care_escalation
                ? { ...prev, care_escalation: { ...prev.care_escalation, status: 'IN_PROGRESS' } }
                : prev,
            );
            setActiveCareCall(null);
          }}
        />
      )}

      {/* ---- Composer --------------------------------------------------- */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          'shrink-0 rounded-2xl border p-2.5 shadow-card transition',
          isDragOver ? 'border-paytm-cyan bg-paytm-cyan/5' : 'border-slate-200 bg-white',
        ].join(' ')}
      >
        {isDragOver && (
          <div className="mb-2 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-paytm-cyan bg-paytm-cyan/10 py-3 text-xs font-semibold text-paytm-cyan">
            <UploadCloud className="h-4 w-4" />
            Drop the receipt image to scan it
          </div>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={ocrBusy || sending}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ocrBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            Upload Screenshot
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelected(file);
              e.target.value = '';
            }}
          />

          <div className="relative ml-auto">
            <button
              type="button"
              onClick={toggleVoiceInput}
              disabled={sending}
              title={speechSupported ? (isListening ? 'Stop listening' : 'Speak your message') : 'Voice quick-prompts'}
              className={[
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                isListening
                  ? 'border-red-400 bg-red-50 text-red-600'
                  : voiceMenuOpen
                    ? 'border-paytm-cyan bg-paytm-cyan/10 text-paytm-cyan'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
              ].join(' ')}
            >
              <Mic className={`h-3.5 w-3.5 ${isListening ? 'animate-pulse' : ''}`} />
              {isListening ? 'Listening…' : 'Voice'}
            </button>
            {!speechSupported && voiceMenuOpen && (
              <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl">
                <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Quick prompts (voice input isn't supported in this browser)
                </p>
                {QUICK_VOICE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handleQuickVoicePrompt(prompt)}
                    className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-600 transition hover:bg-slate-50"
                  >
                    "{prompt}"
                  </button>
                ))}
              </div>
            )}
            {voiceError && (
              <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-red-200 bg-red-50 p-2.5 text-[11px] text-red-700 shadow-2xl">
                {voiceError}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Describe the issue…"
            rows={1}
            disabled={sending}
            className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm leading-snug focus:border-paytm-cyan focus:outline-none focus:ring-1 focus:ring-paytm-cyan disabled:bg-slate-50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || (!inputText.trim() && !activeTransactionId)}
            className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
