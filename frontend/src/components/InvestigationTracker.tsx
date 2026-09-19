/**
 * PaytmResolve AI — Investigation Tracker
 * ---------------------------------------------------------------------------
 * Lives in the wide-viewport margin to the left of the centered app column
 * (empty space on any screen wider than the phone-width layout). Shows the
 * real backend pipeline this app's AI Teammate always runs — UNDERSTAND
 * (intent + entities) -> INVESTIGATE (bank/UPI/NPCI checks) -> DECIDE ->
 * ACT — as a Flipkart-style vertical tracker: dots connected by a line that
 * fills green as each stage is actually reached.
 *
 * The stage labels are real (they name the actual pipeline in
 * backend/src/agents/opsAgent.ts), but the fine-grained timing of the first
 * two stages is a presentation beat, not a second network call — the
 * backend resolves intent/entities and the full investigation in one
 * request. Nothing here fabricates an outcome; it only paces how the one
 * real result is revealed, exactly like the existing "reading pause"
 * between chat messages.
 * ---------------------------------------------------------------------------
 */

import { CheckCircle2, Loader2, type LucideIcon } from 'lucide-react';
import { Bot, FileSearch, Gavel, ShieldCheck, Sparkles } from 'lucide-react';

export type InvestigationPhase =
  | 'IDLE'
  | 'STEP_INTENT'
  | 'STEP_ENTITY'
  | 'STEP_API'
  | 'STEP_DECISION'
  | 'STEP_ACTION'
  | 'DONE';

interface StepConfig {
  phase: Exclude<InvestigationPhase, 'IDLE'>;
  label: string;
  caption: string;
  icon: LucideIcon;
}

const STEPS: StepConfig[] = [
  { phase: 'STEP_INTENT', label: 'Intent Detection', caption: 'Understanding what went wrong', icon: Sparkles },
  { phase: 'STEP_ENTITY', label: 'Entity Extraction', caption: 'Finding the transaction, amount, contact', icon: FileSearch },
  { phase: 'STEP_API', label: 'API Investigation', caption: 'Checking bank, UPI switch & NPCI status', icon: ShieldCheck },
  { phase: 'STEP_DECISION', label: 'Decision Engine', caption: 'Matching against recovery rules', icon: Gavel },
  { phase: 'STEP_ACTION', label: 'Action', caption: 'Resolving or escalating to a human', icon: CheckCircle2 },
];

const PHASE_ORDER: InvestigationPhase[] = ['IDLE', 'STEP_INTENT', 'STEP_ENTITY', 'STEP_API', 'STEP_DECISION', 'STEP_ACTION', 'DONE'];

function phaseIndex(phase: InvestigationPhase): number {
  return PHASE_ORDER.indexOf(phase);
}

export interface InvestigationTrackerProps {
  phase: InvestigationPhase;
}

export default function InvestigationTracker({ phase }: InvestigationTrackerProps) {
  const currentIndex = phaseIndex(phase);
  const isIdle = phase === 'IDLE';
  const isDone = phase === 'DONE';

  return (
    <div className="hidden xl:flex fixed left-8 top-24 bottom-8 w-72 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-white shadow-2xl backdrop-blur">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-paytm-blue to-paytm-cyan">
          <Bot className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-bold">Live Investigation</div>
          <div className="text-[10px] text-white/40">Real pipeline, not a canned demo</div>
        </div>
      </div>

      {isIdle ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <Loader2 className="h-5 w-5 text-white/20" />
          <p className="text-xs text-white/40">Ask the AI Teammate something in the chat to watch it investigate here.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-1 thin-scrollbar">
          {STEPS.map((step, idx) => {
            const stepIndex = phaseIndex(step.phase);
            const isComplete = currentIndex > stepIndex || isDone;
            const isCurrent = !isDone && currentIndex === stepIndex;
            const isLast = idx === STEPS.length - 1;
            const Icon = step.icon;
            return (
              <div key={step.phase} className="relative flex gap-3 pb-6 last:pb-0">
                {!isLast && (
                  <span
                    className={[
                      'absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-0.5 transition-colors duration-500',
                      isComplete ? 'bg-emerald-400' : 'bg-white/10',
                    ].join(' ')}
                  />
                )}
                <div
                  className={[
                    'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300',
                    isComplete
                      ? 'border-emerald-400 bg-emerald-400 text-slate-900'
                      : isCurrent
                        ? 'border-paytm-cyan bg-slate-900 text-paytm-cyan'
                        : 'border-white/15 bg-slate-900 text-white/25',
                  ].join(' ')}
                >
                  {isComplete ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : isCurrent ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="pt-1">
                  <div
                    className={[
                      'text-xs font-bold leading-tight',
                      isComplete ? 'text-emerald-300' : isCurrent ? 'text-white' : 'text-white/30',
                    ].join(' ')}
                  >
                    {step.label}
                  </div>
                  <div className={`mt-0.5 text-[10.5px] leading-snug ${isCurrent || isComplete ? 'text-white/50' : 'text-white/20'}`}>
                    {step.caption}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
