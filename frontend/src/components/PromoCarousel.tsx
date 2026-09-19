/**
 * PaytmResolve AI — Sliding Promo Carousel
 * ---------------------------------------------------------------------------
 * Real Paytm-style home screens open with an auto-sliding banner strip.
 * This is an ORIGINAL carousel in that spirit — its own slide designs,
 * copy, colors, and hand-drawn SVG backgrounds — not a reproduction of any
 * real company's actual promotional artwork, logo, or event branding. All
 * three slides now share the same "premium hero card" treatment: a drifting
 * glow, a light shimmer sweep, and an original abstract background pattern,
 * themed to what each slide is actually about. No real sponsor names, no
 * real logos, no real event QR code — everything here is built from
 * scratch. Auto-advances every 4s, with manual dot navigation and
 * swipe-free tap-through for demo convenience.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { Code2, Heart, ShieldCheck, type LucideIcon } from 'lucide-react';

interface Slide {
  id: string;
  gradient: string;
  badgeIcon: LucideIcon;
  badgeLabel: string;
  heading: string[];
  subtitle: string;
  pattern: 'skyline' | 'network' | 'shield';
}

const SLIDES: Slide[] = [
  {
    id: 'hackathon',
    gradient: 'from-orange-500 via-rose-500 to-indigo-700',
    badgeIcon: Heart,
    badgeLabel: 'AI Hackathon',
    heading: ['IGNITE IDEAS.', 'BUILD SOLUTIONS.'],
    subtitle: 'Made in Delhi, for a payments hackathon demo.',
    pattern: 'skyline',
  },
  {
    id: 'resolution',
    gradient: 'from-indigo-600 via-blue-600 to-paytm-cyan',
    badgeIcon: Code2,
    badgeLabel: 'Round 2',
    heading: ['RESOLUTION', 'ENGINE'],
    subtitle: 'Watch the AI Teammate investigate a stuck payment live, with a real audit trail.',
    pattern: 'network',
  },
  {
    id: 'safety',
    gradient: 'from-emerald-600 via-teal-600 to-paytm-cyan',
    badgeIcon: ShieldCheck,
    badgeLabel: 'Round 3',
    heading: ['SAFETY', 'FIRST'],
    subtitle: 'Every risky action still goes through a human-authored policy gate — never a model guess.',
    pattern: 'shield',
  },
];

const SLIDE_INTERVAL_MS = 4000;

/** An original, hand-drawn silhouette evoking a Delhi skyline at sunset —
 * a generic triumphal-arch monument shape and a domed building, both
 * simplified enough that they read as "Delhi, golden hour" without
 * reproducing any specific structure's actual architecture. */
function SkylinePattern() {
  return (
    <svg viewBox="0 0 400 120" className="absolute inset-x-0 bottom-0 h-full w-full" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <path
        d="M0 120 L0 96 L18 96 L18 84 L26 84 L26 96 L40 96 L40 72 L48 72 L48 96 L70 96 L70 60 L78 60 L78 52 L86 52 L86 60 L94 60 L94 96
           L120 96 L120 70 C120 55 132 44 150 44 C168 44 180 55 180 70 L180 96
           L205 96 L205 80 L213 80 L213 68 L221 68 L221 80 L229 80 L229 96
           L255 96 L255 66 L263 66 L263 56 L271 56 L271 66 L279 66 L279 96
           L305 96 L305 78 C305 66 314 58 326 58 C338 58 347 66 347 78 L347 96
           L370 96 L370 88 L378 88 L378 96 L400 96 L400 120 Z"
        fill="rgba(255,255,255,0.16)"
      />
      <path
        d="M150 44 C132 44 120 55 120 70 L120 44 L124 30 L128 44 L132 26 L136 44 L140 22 L144 44 L150 18 L156 44 L160 22 L164 44 L168 26 L172 44 L176 30 L180 44 L180 70 C180 55 168 44 150 44 Z"
        fill="rgba(255,255,255,0.24)"
      />
      <circle cx="326" cy="52" r="9" fill="rgba(255,255,255,0.24)" />
    </svg>
  );
}

/** An original abstract "network" pattern — nodes and connecting lines,
 * evoking the live audit trail / multi-system investigation the Resolution
 * Engine slide is about. Pure geometry, nothing borrowed. */
function NetworkPattern() {
  const nodes = [
    [30, 30], [90, 18], [150, 42], [210, 20], [270, 48], [330, 24], [370, 50],
    [50, 80], [130, 92], [200, 78], [280, 96], [350, 82],
  ];
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
    [0, 7], [1, 8], [2, 8], [3, 9], [4, 10], [5, 11], [6, 11],
    [7, 8], [8, 9], [9, 10], [10, 11],
  ];
  return (
    <svg viewBox="0 0 400 120" className="absolute inset-0 h-full w-full opacity-60" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]}
          y1={nodes[a][1]}
          x2={nodes[b][0]}
          y2={nodes[b][1]}
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="1"
        />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 3.5 : 2.2} fill="rgba(255,255,255,0.4)" />
      ))}
    </svg>
  );
}

/** An original abstract "shield lattice" pattern — overlapping outlined
 * shield shapes, evoking the layered policy-gate checks the Safety First
 * slide is about. Pure geometry, nothing borrowed. */
function ShieldPattern() {
  const shields = [
    { x: 40, y: 60, s: 1 },
    { x: 110, y: 30, s: 0.7 },
    { x: 190, y: 70, s: 1.2 },
    { x: 270, y: 28, s: 0.8 },
    { x: 340, y: 62, s: 0.9 },
  ];
  return (
    <svg viewBox="0 0 400 120" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {shields.map(({ x, y, s }, i) => (
        <path
          key={i}
          d="M0 -14 L12 -9 L12 3 C12 13 6 19 0 22 C-6 19 -12 13 -12 3 L-12 -9 Z"
          transform={`translate(${x} ${y}) scale(${s})`}
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="1.4"
        />
      ))}
    </svg>
  );
}

const PATTERNS: Record<Slide['pattern'], () => JSX.Element> = {
  skyline: SkylinePattern,
  network: NetworkPattern,
  shield: ShieldPattern,
};

function HeroPromoSlide({ slide }: { slide: Slide }) {
  const Pattern = PATTERNS[slide.pattern];
  const BadgeIcon = slide.badgeIcon;
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br ${slide.gradient} px-4 pb-4 pt-4 text-white`}>
      {/* Soft drifting glow — original, no photograph, no real monument/logo */}
      <div className="promo-glow-drift pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-yellow-200/30 blur-2xl" />
      <Pattern />
      {/* Premium-card shimmer sweep */}
      <div className="promo-shimmer-sweep pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent" />

      <div className="relative z-10">
        <div className="flex items-center gap-1.5">
          <div className="promo-float flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
            <Heart className="h-3.5 w-3.5 fill-white text-white" />
          </div>
          <span className="text-xs font-bold tracking-wide">ResolvePay AI</span>
          <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">
            <BadgeIcon className="h-2.5 w-2.5" /> {slide.badgeLabel}
          </span>
        </div>
        <div className="mt-2 text-xl font-extrabold leading-tight tracking-tight font-display">
          {slide.heading.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
        <p className="mt-1 text-xs font-medium text-white/90">{slide.subtitle}</p>
      </div>
    </div>
  );
}

export default function PromoCarousel() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), SLIDE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const slide = SLIDES[index];

  return (
    <div className="overflow-hidden rounded-2xl shadow-card">
      <HeroPromoSlide key={slide.id} slide={slide} />
      <div className="flex justify-center gap-1.5 bg-white py-1.5">
        {SLIDES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show slide ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-paytm-cyan' : 'w-1.5 bg-slate-200'}`}
          />
        ))}
      </div>
    </div>
  );
}
