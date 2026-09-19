/**
 * PaytmResolve AI — Promotional Pop-up
 * ---------------------------------------------------------------------------
 * Real Paytm-style apps show a dismissible promo pop-up shortly after
 * opening the home screen. This is an original, fictional cashback offer —
 * invented copy and design, no real brand names or artwork — shown once per
 * session a few seconds after the app loads, closable with the X or the
 * backdrop.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { Gift, X } from 'lucide-react';

const SHOW_AFTER_MS = 2500;

export default function AdPopup() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  if (dismissed || !visible) return null;

  function close() {
    setVisible(false);
    setDismissed(true);
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div
        className="w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-gradient-to-br from-amber-400 to-orange-500 p-5 text-center text-white">
          <button
            type="button"
            onClick={close}
            className="absolute right-2 top-2 rounded-full p-1 text-white/90 hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
          <Gift className="mx-auto mb-2 h-9 w-9" />
          <div className="text-lg font-extrabold font-display">Get ₹51 Cashback*</div>
          <div className="mt-1 text-xs text-white/90">On your first payment through this demo today</div>
        </div>
        <div className="p-4 text-center">
          <p className="text-sm text-slate-500">
            *Simulated promotional offer for this hackathon demo — no real cashback is issued.
          </p>
          <button
            type="button"
            onClick={close}
            className="mt-3 w-full rounded-lg bg-paytm-cyan px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
