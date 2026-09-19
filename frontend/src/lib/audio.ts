/**
 * PaytmResolve AI — Shared audio module
 * ---------------------------------------------------------------------------
 * Browsers only let an AudioContext actually make sound if it was created
 * (or resumed) inside the synchronous call stack of a real user gesture
 * (a click/tap handler). Our payment flow is: user taps a PIN digit →
 * ~350ms verification delay → executePayment() network round-trip →
 * PaymentResultOverlay mounts → THEN tries to create an AudioContext and
 * play a tone. By that point we're several async hops away from the
 * original tap, and some browsers/webviews silently refuse to let a
 * "stale" gesture unlock audio — the tone is built correctly but never
 * actually audible.
 *
 * The fix: create ONE AudioContext up front, and "prime" (resume) it
 * synchronously inside the real click handlers in PinPad.tsx — the actual
 * user gesture — the moment the user taps a digit or the fingerprint
 * button. By the time PaymentResultOverlay wants to play a tone later,
 * the context is already running, so audio.resume() there is a no-op and
 * playback goes through.
 * ---------------------------------------------------------------------------
 */

let sharedCtx: AudioContext | null = null;

function getAudioCtxCtor(): typeof AudioContext | null {
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

/** Call this synchronously inside a real click/tap handler (never after an
 * await) to create-and-unlock the shared AudioContext at the moment of an
 * actual user gesture. Safe to call many times — it reuses the same
 * context and is a cheap no-op once already running. */
export function primeAudio(): void {
  try {
    if (!sharedCtx) {
      const Ctor = getAudioCtxCtor();
      if (!Ctor) return;
      sharedCtx = new Ctor();
    }
    if (sharedCtx.state === 'suspended') {
      void sharedCtx.resume();
    }
  } catch {
    // Audio is a nice-to-have — never let priming throw into the UI flow.
  }
}

export type PaymentResultKind = 'SUCCESS' | 'FAILED' | 'PENDING';

/** Plays a short, honest procedurally-generated tone using the shared,
 * already-primed AudioContext (falls back to creating one on the spot if
 * priming never happened, e.g. some other flow that skips PinPad). No
 * external MP3/WAV asset — nothing to fail to load, nothing to bundle.
 * Silently no-ops on any failure; a missing sound should never break the
 * payment flow. */
export function playResultTone(kind: PaymentResultKind): void {
  try {
    if (!sharedCtx) {
      const Ctor = getAudioCtxCtor();
      if (!Ctor) return;
      sharedCtx = new Ctor();
    }
    const ctx = sharedCtx;
    void ctx.resume();

    function tone(freq: number, startOffset: number, duration: number, type: OscillatorType, peakGain: number) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const startTime = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    }

    if (kind === 'SUCCESS') {
      // A bright, unmistakable 4-note major arpeggio (C6 - E6 - G6 - C7) —
      // the classic "cha-ching" shape real payment apps use.
      tone(1046.5, 0, 0.16, 'sine', 0.3);
      tone(1318.5, 0.1, 0.16, 'sine', 0.3);
      tone(1568.0, 0.2, 0.16, 'sine', 0.3);
      tone(2093.0, 0.32, 0.45, 'sine', 0.34);
      // A soft triangle-wave layer under the top notes gives the chime a
      // rounder, bell-like body instead of a thin single sine beep.
      tone(1046.5, 0, 0.55, 'triangle', 0.08);
    } else if (kind === 'FAILED') {
      tone(220, 0, 0.32, 'sawtooth', 0.18);
    } else {
      tone(660, 0, 0.09, 'sine', 0.15);
      tone(660, 0.16, 0.09, 'sine', 0.15);
    }
    // NB: we intentionally never close() the shared context — it's reused
    // for the lifetime of the page so later tones stay "primed" too.
  } catch {
    // Audio is a nice-to-have here — never let it throw into the payment flow.
  }
}
