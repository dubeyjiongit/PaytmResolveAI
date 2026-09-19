/**
 * PaytmResolve AI — Simulated UPI PIN / Fingerprint Pad
 * ---------------------------------------------------------------------------
 * Every real payments app asks for a PIN (or a fingerprint) before it moves
 * money or reveals your balance — this app didn't, which made it feel like
 * a toy. This is a simulated equivalent: there is no real biometric or bank
 * PIN infrastructure behind it (this is a mock backend with no real money),
 * so the "PIN" is a fixed, clearly-labelled demo value and "fingerprint" is
 * an instant simulated success — but the UX beat (confirm your identity
 * before anything happens) is real and always enforced client-side before
 * the caller's `onSuccess` fires.
 * ---------------------------------------------------------------------------
 */

import { useState } from 'react';
import { Delete, Fingerprint, Lock, ShieldCheck, X } from 'lucide-react';
import { primeAudio } from '../lib/audio';

/** Simulated demo PIN. There's no real account security here (mock backend,
 * no real money) — this exists so "enter your PIN" is an honest, working
 * interaction rather than a fake gate that accepts literally anything. */
export const DEMO_PIN = '1234';

const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'DEL'];

export interface PinPadProps {
  title: string;
  subtitle?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function PinPad({ title, subtitle, onSuccess, onCancel }: PinPadProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  function pressDigit(digit: string) {
    if (verifying) return;
    // Unlock the shared AudioContext right here, synchronously, inside the
    // real tap that started this — by the time the success tone actually
    // needs to play (after the verification delay + payment round-trip),
    // the context is already running instead of waiting on a "stale" gesture.
    primeAudio();
    setError(null);
    if (digit === 'DEL') {
      setPin((prev) => prev.slice(0, -1));
      return;
    }
    if (digit === '') return;
    setPin((prev) => {
      const next = (prev + digit).slice(0, 4);
      if (next.length === 4) void checkPin(next);
      return next;
    });
  }

  async function checkPin(candidate: string) {
    setVerifying(true);
    // A short, honest delay — this is a real check against DEMO_PIN, not
    // an instant no-op, so it reads as a real verification step.
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (candidate === DEMO_PIN) {
      onSuccess();
    } else {
      setError('Incorrect PIN. Try the demo PIN shown below.');
      setPin('');
      setVerifying(false);
    }
  }

  function useFingerprint() {
    primeAudio();
    setVerifying(true);
    setError(null);
    // Simulated biometric — a real sensor either matches or it doesn't;
    // here it always succeeds after a brief "scanning" delay.
    setTimeout(onSuccess, 500);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-800">
            <Lock className="h-4 w-4 text-paytm-blue" />
            <h2 className="text-sm font-bold">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={verifying}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {subtitle && <p className="mb-4 text-xs text-slate-500">{subtitle}</p>}

        <div className="mb-4 flex justify-center gap-3">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={[
                'h-4 w-4 rounded-full border-2 transition',
                i < pin.length ? 'border-paytm-blue bg-paytm-blue' : 'border-slate-300 bg-white',
              ].join(' ')}
            />
          ))}
        </div>

        {error && <p className="mb-3 text-center text-xs font-semibold text-red-600">{error}</p>}

        <div className="mb-4 grid grid-cols-3 gap-2">
          {KEYPAD_DIGITS.map((digit, idx) =>
            digit === '' ? (
              <span key={`blank-${idx}`} />
            ) : (
              <button
                key={digit}
                type="button"
                onClick={() => pressDigit(digit)}
                disabled={verifying}
                className="flex h-12 items-center justify-center rounded-xl bg-slate-100 text-base font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {digit === 'DEL' ? <Delete className="h-4 w-4" /> : digit}
              </button>
            ),
          )}
        </div>

        <button
          type="button"
          onClick={useFingerprint}
          disabled={verifying}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-paytm-blue/20 bg-paytm-light px-4 py-2 text-xs font-semibold text-paytm-blue transition hover:bg-paytm-light/70 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {verifying ? <ShieldCheck className="h-4 w-4 animate-pulse" /> : <Fingerprint className="h-4 w-4" />}
          {verifying ? 'Verifying…' : 'Use Fingerprint Instead'}
        </button>

        <p className="mt-3 text-center text-xs text-slate-400">
          Simulated PIN for this demo — <span className="font-mono font-semibold">{DEMO_PIN}</span>
        </p>
      </div>
    </div>
  );
}
