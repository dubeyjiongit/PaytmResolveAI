/**
 * PaytmResolve AI — Simulated Customer Care Call
 * ---------------------------------------------------------------------------
 * Part of the Customer Care Escalation Protocol: for fraud, wrong-transfer,
 * account-takeover, merchant-dispute, and regulatory/severe-distress cases,
 * the AI Teammate halts automated resolution and hands off to a human. This
 * modal is a SIMULATED preview of what that hand-off call looks like — a
 * demo/prototype device, not a real telephony integration. Nothing here
 * actually places a call; the real "Call Priority Care" button (a plain
 * `tel:` link, rendered by the calling card) is what would ring a real
 * phone. This component exists so a judge/customer can see the shape of the
 * hand-off experience without leaving the app.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import type { CareEscalationCategory } from '../types';

export interface FakeCallModalProps {
  ticketId: string;
  category: CareEscalationCategory | null;
  onEndCall: () => void;
}

type CallPhase = 'ringing' | 'connecting' | 'active';

const RINGING_MS = 1800;
const CONNECTING_MS = 1600;

/** One short, honest line per category — never a promise of a specific
 * outcome, just what a grievance officer would plausibly open with while
 * getting oriented on the case. */
const AGENT_OPENING_LINE: Record<CareEscalationCategory, string> = {
  FRAUD_SCAM_PHISHING:
    'Namaste! I have received your case docket regarding your dispute. Your account has been temporarily secured while our nodal desk coordinates with the bank.',
  WRONG_BENEFICIARY_TRANSFER:
    "Namaste! I've pulled up your transfer details. We're reaching out to the receiving bank now to request a hold on those funds while we sort this out.",
  ACCOUNT_TAKEOVER_SECURITY:
    "Namaste! I can see the security flag on your account. I'm walking through a few checks with you now so we can re-secure it safely.",
  MERCHANT_PHYSICAL_DISPUTE:
    "Namaste! I have your merchant dispute details in front of me. We'll be reaching out to the merchant's acquiring bank as part of this case.",
  REGULATORY_SEVERE_DISTRESS:
    'Namaste! I have received your case docket. This has been marked urgent and I will personally stay on this with you.',
};

const CATEGORY_LABEL: Record<CareEscalationCategory, string> = {
  FRAUD_SCAM_PHISHING: 'Suspected Fraud',
  WRONG_BENEFICIARY_TRANSFER: 'Wrong Beneficiary Transfer',
  ACCOUNT_TAKEOVER_SECURITY: 'Account Security',
  MERCHANT_PHYSICAL_DISPUTE: 'Merchant Dispute',
  REGULATORY_SEVERE_DISTRESS: 'Urgent / Regulatory',
};

function formatTimer(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** A small animated waveform — purely decorative CSS bars, no real audio
 * stream. Bar heights are randomized once per bar so they don't all pulse
 * in lockstep. */
function WaveformVisualizer({ active }: { active: boolean }) {
  const bars = useRef(Array.from({ length: 24 }, () => 6 + Math.round(Math.random() * 20))).current;
  return (
    <div className="flex h-10 items-center justify-center gap-[3px]">
      {bars.map((h, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full bg-emerald-400 ${active ? 'animate-pulse' : ''}`}
          style={{
            height: active ? `${h}px` : '4px',
            animationDuration: `${0.6 + (i % 5) * 0.12}s`,
            animationDelay: `${(i % 7) * 0.07}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function FakeCallModal({ ticketId, category, onEndCall }: FakeCallModalProps) {
  const [phase, setPhase] = useState<CallPhase>('ringing');
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [transcriptVisible, setTranscriptVisible] = useState(false);

  // Ringing -> connecting -> active, purely simulated timing.
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('connecting'), RINGING_MS);
    const t2 = setTimeout(() => setPhase('active'), RINGING_MS + CONNECTING_MS);
    const t3 = setTimeout(() => setTranscriptVisible(true), RINGING_MS + CONNECTING_MS + 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  // Call timer, only while active.
  useEffect(() => {
    if (phase !== 'active') return;
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const openingLine = category ? AGENT_OPENING_LINE[category] : AGENT_OPENING_LINE.FRAUD_SCAM_PHISHING;
  const categoryLabel = category ? CATEGORY_LABEL[category] : 'Priority Care';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-gradient-to-b from-slate-900 to-slate-950 text-white shadow-2xl">
        {/* ---- Header ------------------------------------------------- */}
        <div className="flex flex-col items-center gap-2 px-6 pb-5 pt-8 text-center">
          <div
            className={[
              'flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg',
              phase === 'ringing' ? 'animate-pulse' : '',
            ].join(' ')}
          >
            <ShieldCheck className="h-9 w-9 text-white" />
          </div>
          <div className="mt-1 text-base font-bold font-display">Senior Grievance Officer</div>
          <div className="text-xs text-white/60">{categoryLabel} · Case {ticketId}</div>

          <div className="mt-1 text-sm font-semibold text-emerald-400">
            {phase === 'ringing' && 'Ringing…'}
            {phase === 'connecting' && 'Connecting to Senior Grievance Officer…'}
            {phase === 'active' && `Connected · ${formatTimer(seconds)}`}
          </div>
        </div>

        {/* ---- Waveform -------------------------------------------------- */}
        <div className="px-6 pb-2">
          <WaveformVisualizer active={phase === 'active'} />
        </div>

        {/* ---- Live transcript -------------------------------------------- */}
        <div className="mx-6 mb-5 min-h-[64px] rounded-xl bg-white/5 p-3 text-xs leading-relaxed text-white/80">
          {phase !== 'active' && (
            <span className="text-white/40">
              {phase === 'ringing' ? 'Waiting to connect you to a live agent…' : 'Verifying your case details…'}
            </span>
          )}
          {phase === 'active' && (
            <p className={transcriptVisible ? 'opacity-100 transition-opacity duration-500' : 'opacity-0'}>
              <span className="font-semibold text-emerald-400">Agent: </span>
              {openingLine}
            </p>
          )}
        </div>

        {/* ---- Call controls ----------------------------------------------- */}
        <div className="flex items-center justify-center gap-5 px-6 pb-8">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            disabled={phase !== 'active'}
            className={[
              'flex h-12 w-12 items-center justify-center rounded-full transition disabled:opacity-40',
              muted ? 'bg-white text-slate-900' : 'bg-white/10 text-white hover:bg-white/20',
            ].join(' ')}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={onEndCall}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition hover:bg-red-700"
            aria-label="End call"
          >
            <PhoneOff className="h-6 w-6" />
          </button>

          <button
            type="button"
            onClick={() => setSpeakerOn((s) => !s)}
            disabled={phase !== 'active'}
            className={[
              'flex h-12 w-12 items-center justify-center rounded-full transition disabled:opacity-40',
              speakerOn ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-white text-slate-900',
            ].join(' ')}
            aria-label={speakerOn ? 'Turn off speaker' : 'Turn on speaker'}
          >
            {speakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
        </div>

        <div className="flex items-center justify-center gap-1.5 border-t border-white/10 px-6 py-2.5 text-[10px] text-white/40">
          <Phone className="h-3 w-3" /> Simulated call for demo purposes — no real line is dialed.
        </div>
      </div>
    </div>
  );
}
