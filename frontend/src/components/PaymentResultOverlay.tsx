/**
 * PaytmResolve AI — Payment Result Overlay
 * ---------------------------------------------------------------------------
 * Every real UPI app gives you an unmistakable animated + audible signal
 * right after you pay: a green pulse and a chime for success, a red pulse
 * and a low tone for failure. This overlay reproduces that moment —
 * a full-screen animated status icon (pop + expanding ring pulse) plus a
 * short procedurally-generated tone (Web Audio API oscillator; no external
 * audio asset needed, so there is nothing to fail to load) — then
 * auto-dismisses after a couple of seconds.
 *
 * The tone is played through a shared, pre-primed AudioContext (see
 * ../lib/audio.ts) that gets unlocked synchronously back in PinPad.tsx's
 * real tap/click handlers — by the time this overlay mounts we're several
 * async hops removed from that original gesture, which is exactly the
 * situation browsers' autoplay policies are suspicious of, so priming
 * early is what makes the sound reliably audible here.
 * ---------------------------------------------------------------------------
 */

import { useEffect } from 'react';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { playResultTone, type PaymentResultKind } from '../lib/audio';

export type { PaymentResultKind };

export interface PaymentResultOverlayProps {
  kind: PaymentResultKind;
  amountLabel: string;
  onDone: () => void;
}

// Real payment apps hold the success/failure moment on screen for a good
// couple of seconds — long enough to actually register, not just flash by.
const AUTO_DISMISS_MS = 3400;

const THEME: Record<PaymentResultKind, { icon: typeof CheckCircle2; ring: string; pulseRing: string; iconColor: string; label: string }> = {
  SUCCESS: { icon: CheckCircle2, ring: 'bg-emerald-500', pulseRing: 'border-emerald-400', iconColor: 'text-white', label: 'Payment Successful' },
  FAILED: { icon: XCircle, ring: 'bg-red-500', pulseRing: 'border-red-400', iconColor: 'text-white', label: 'Payment Failed' },
  PENDING: { icon: Clock, ring: 'bg-amber-500', pulseRing: 'border-amber-400', iconColor: 'text-white', label: 'Payment Pending' },
};

export default function PaymentResultOverlay({ kind, amountLabel, onDone }: PaymentResultOverlayProps) {
  useEffect(() => {
    playResultTone(kind);
    const timer = setTimeout(onDone, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const theme = THEME[kind];
  const Icon = theme.icon;

  return (
    <div className="fixed inset-0 z-[95] flex flex-col items-center justify-center gap-5 bg-black/60 backdrop-blur-sm">
      <div className="relative flex h-28 w-28 items-center justify-center">
        {kind === 'SUCCESS' && (
          <>
            <span className={`absolute inset-0 rounded-full border-4 ${theme.pulseRing} payment-result-ring`} />
            <span
              className={`absolute inset-0 rounded-full border-4 ${theme.pulseRing} payment-result-ring`}
              style={{ animationDelay: '0.35s' }}
            />
          </>
        )}
        <div className={`relative flex h-24 w-24 items-center justify-center rounded-full ${theme.ring} payment-result-pop shadow-2xl`}>
          <Icon className={`h-14 w-14 ${theme.iconColor} ${kind === 'SUCCESS' ? 'payment-result-check' : ''}`} strokeWidth={2.4} />
        </div>
      </div>
      <div className="text-center text-white payment-result-fade-in">
        <div className="text-xl font-bold font-display">{theme.label}</div>
        <div className="mt-1 text-sm text-white/80">{amountLabel}</div>
      </div>
    </div>
  );
}
