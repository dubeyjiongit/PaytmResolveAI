/**
 * PaytmResolve AI — Loans Section
 * ---------------------------------------------------------------------------
 * Real Paytm shows a Loans section (personal loans, merchant loans, "Paytm
 * Postpaid"-style credit) fronting partner NBFC/bank products — the app
 * itself is a distribution surface, not the lender. This is an ORIGINAL,
 * clearly-labelled simulation of that surface with realistic figures (loan
 * amounts, interest rate ranges, tenures) and its own decorative partner
 * bank names — nothing here is a real financial product, nothing submits an
 * actual application, and nothing in this file touches money, a real
 * lender, or the app's own risk/decision engines. It exists so "check the
 * Loans section" (what the AI Teammate now tells a customer who asks it for
 * a loan) actually leads somewhere real instead of a dead end.
 * ---------------------------------------------------------------------------
 */

import { useState } from 'react';
import {
  Banknote,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Landmark,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';

export interface LoansModalProps {
  customerName: string;
  onClose: () => void;
}

interface LoanProduct {
  id: string;
  name: string;
  icon: typeof Banknote;
  gradient: string;
  tagline: string;
  amountRange: string;
  interestRange: string;
  tenureRange: string;
  processingFee: string;
  partner: string;
}

const LOAN_PRODUCTS: LoanProduct[] = [
  {
    id: 'personal',
    name: 'Personal Loan',
    icon: Wallet,
    gradient: 'from-sky-500 to-blue-600',
    tagline: 'Instant approval, money in your account within minutes',
    amountRange: '₹10,000 – ₹5,00,000',
    interestRange: '10.5% – 24% p.a.',
    tenureRange: '3 – 36 months',
    processingFee: 'Up to 2.5% + GST',
    partner: 'Partner NBFC: Nova Finserv',
  },
  {
    id: 'postpaid',
    name: 'Postpaid (Pay Later)',
    icon: Smartphone,
    gradient: 'from-violet-500 to-purple-600',
    tagline: 'Buy now, pay next month — no interest if paid on time',
    amountRange: '₹500 – ₹50,000 credit limit',
    interestRange: '0% (on-time) · 36% p.a. (overdue)',
    tenureRange: 'Billed monthly',
    processingFee: 'No processing fee',
    partner: 'Partner NBFC: Clearline Capital',
  },
  {
    id: 'business',
    name: 'Business Loan',
    icon: Briefcase,
    gradient: 'from-emerald-500 to-teal-600',
    tagline: 'Working capital for merchants, based on your payment history',
    amountRange: '₹25,000 – ₹20,00,000',
    interestRange: '14% – 26% p.a.',
    tenureRange: '6 – 24 months',
    processingFee: 'Up to 3% + GST',
    partner: 'Partner Bank: Suryoday Trust Bank',
  },
];

const ELIGIBILITY_CHECKLIST = [
  'Age 21–58 years',
  'Indian resident with a valid PAN',
  'Active bank account for disbursal',
  'Minimum 6 months of transaction history on this app',
];

function ProductCard({ product, onCheckEligibility }: { product: LoanProduct; onCheckEligibility: (product: LoanProduct) => void }) {
  const Icon = product.icon;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className={`flex items-center gap-3 bg-gradient-to-br ${product.gradient} px-4 py-3.5 text-white`}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
          <Icon className="h-5 w-5" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold">{product.name}</div>
          <div className="text-xs text-white/85">{product.tagline}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 text-xs">
        <div>
          <div className="text-slate-400">Loan amount</div>
          <div className="font-semibold text-slate-700">{product.amountRange}</div>
        </div>
        <div>
          <div className="text-slate-400">Interest rate</div>
          <div className="font-semibold text-slate-700">{product.interestRange}</div>
        </div>
        <div>
          <div className="text-slate-400">Tenure</div>
          <div className="font-semibold text-slate-700">{product.tenureRange}</div>
        </div>
        <div>
          <div className="text-slate-400">Processing fee</div>
          <div className="font-semibold text-slate-700">{product.processingFee}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
        <span className="text-[11px] text-slate-400">{product.partner}</span>
        <button
          type="button"
          onClick={() => onCheckEligibility(product)}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
        >
          Check Eligibility <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function LoansModal({ customerName, onClose }: LoansModalProps) {
  const [eligibilityFor, setEligibilityFor] = useState<LoanProduct | null>(null);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center">
      <div className="flex h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-[85vh] sm:rounded-2xl">
        {/* ---- Header --------------------------------------------------- */}
        <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800 px-4 py-3.5 text-white">
          <div className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            <span className="text-sm font-bold font-display">Loans</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-white/80 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto thin-scrollbar">
          {/* ---- Pre-approved hero banner --------------------------------
              Real lending apps lead with a headline pre-approved figure —
              this one is clearly framed as an offer to check, not money
              already sitting in the account. */}
          <div className="relative overflow-hidden bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 px-4 py-4 text-white">
            <Sparkles className="pointer-events-none absolute -right-3 -top-3 h-16 w-16 text-white/20" />
            <div className="text-xs font-semibold uppercase tracking-wide text-white/80">Pre-approved offer for {customerName}</div>
            <div className="mt-1 text-2xl font-extrabold font-display">Up to ₹3,00,000</div>
            <div className="mt-1 text-xs text-white/85">
              Based on your payment history on this app · Subject to final eligibility check
            </div>
          </div>

          <div className="space-y-3 p-4">
            <p className="text-xs leading-relaxed text-slate-500">
              These are simulated loan offers for this demo — PaytmResolve AI itself never lends money; it only
              fronts partner banks/NBFCs, same as a real payments app. Nothing below submits a real application.
            </p>

            {LOAN_PRODUCTS.map((product) => (
              <ProductCard key={product.id} product={product} onCheckEligibility={setEligibilityFor} />
            ))}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5" /> Basic eligibility
              </div>
              <ul className="space-y-1">
                {ELIGIBILITY_CHECKLIST.map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-xs text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Eligibility result — a decorative, deterministic outcome, not
          a real underwriting decision. Closing this returns to the list. */}
      {eligibilityFor && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setEligibilityFor(null)}
        >
          <div
            className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <h3 className="mt-3 text-sm font-bold text-slate-800">You're pre-qualified!</h3>
            <p className="mt-1 text-xs text-slate-500">
              Based on your simulated profile, you're eligible for a {eligibilityFor.name.toLowerCase()} of up to{' '}
              <span className="font-semibold text-slate-700">{eligibilityFor.amountRange.split('–')[1]?.trim()}</span> at{' '}
              {eligibilityFor.interestRange.split('–')[0]?.trim()} onwards.
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              Demo only — this doesn't submit a real application or connect to an actual lender.
            </p>
            <button
              type="button"
              onClick={() => setEligibilityFor(null)}
              className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
