/**
 * PaytmResolve AI — Payment Processing Overlay
 * ---------------------------------------------------------------------------
 * Real UPI apps never jump straight from "PIN entered" to "here's your
 * result" — there's always a beat of "Processing your payment…" (a spinner,
 * a bank-verification line) before the success/failure moment lands. Without
 * it, a simulated failure (or a step-up-verified success) just snaps into
 * its final state instantly, which reads as "nothing happened" rather than
 * as an animated, legible event.
 *
 * This is a short, fixed-duration spinner overlay shown BEFORE
 * PaymentResultOverlay — never instead of it. It has no sound of its own
 * (only the final result gets the chime/buzz); it exists purely to give the
 * result its own dramatic beat.
 * ---------------------------------------------------------------------------
 */

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export interface ProcessingOverlayProps {
  label?: string;
  subLabel?: string;
  durationMs?: number;
  onDone: () => void;
}

const DEFAULT_DURATION_MS = 2800;

export default function ProcessingOverlay({
  label = 'Processing your payment…',
  subLabel = "Please don't close the app.",
  durationMs = DEFAULT_DURATION_MS,
  onDone,
}: ProcessingOverlayProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[94] flex flex-col items-center justify-center gap-4 bg-black/60 backdrop-blur-sm">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-4 border-white/15" />
        <Loader2 className="h-14 w-14 animate-spin text-white" strokeWidth={2.2} />
      </div>
      <div className="text-center text-white">
        <div className="text-base font-semibold">{label}</div>
        <div className="mt-1 text-xs text-white/70">{subLabel}</div>
      </div>
    </div>
  );
}
