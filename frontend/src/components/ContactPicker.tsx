/**
 * PaytmResolve AI — Contact Picker
 * ---------------------------------------------------------------------------
 * Real UPI apps don't make you type a beneficiary into a plain dropdown —
 * tapping "Pay Contacts" opens your phone's contact list, and each entry
 * is either already on the app (pay instantly) or isn't (you're offered an
 * invite instead of a payment). This is a full-screen picker that imitates
 * that: a search bar, an avatar list, and an honest "not on PaytmResolve
 * AI" state for names that aren't real beneficiaries in this demo's data.
 *
 * The "not on app" contacts are entirely synthetic and local to this file —
 * there is no real phone-contacts API to read from in a hackathon demo, so
 * this simulates the shape of it with a small fixed list, clearly fictional
 * names and numbers, mixed in alongside the real seeded beneficiaries.
 * ---------------------------------------------------------------------------
 */

import { useMemo, useState } from 'react';
import { Search, UserPlus, UserRound, X } from 'lucide-react';
import type { BeneficiaryDirectoryEntry } from '../types';

export interface ContactPickerProps {
  beneficiaries: BeneficiaryDirectoryEntry[];
  onClose: () => void;
  /** Fires when the person taps a contact who's already on the app. */
  onSelectOnAppContact: (beneficiaryId: string) => void;
  /** Fires when the person taps a contact who ISN'T on the app but wants to
   * pay them anyway — hands back a phone number so the caller can drop
   * straight into the "Mobile Number / UPI ID" flow pre-filled. */
  onPayByNumberAnyway: (phone: string, name: string) => void;
}

interface ContactRow {
  key: string;
  name: string;
  phoneDisplay: string;
  onApp: boolean;
  beneficiaryId?: string;
  accountAgeMinutes?: number;
}

/** Purely decorative contacts to make the picker feel like a real address
 * book instead of a 5-row list. Clearly fictional names/numbers, never real
 * people — same spirit as the rest of this demo's seed data. None of these
 * exist in the backend's beneficiary directory, so they always render as
 * "not on PaytmResolve AI". */
const OFF_APP_CONTACTS: Array<{ name: string; phone: string }> = [
  { name: 'Priya Sharma', phone: '9821004455' },
  { name: 'Karan Mehta', phone: '9900112233' },
  { name: 'Neha Gupta', phone: '9871234567' },
  { name: 'Sanjay Rao', phone: '9845098450' },
  { name: 'Fatima Sheikh', phone: '9765432109' },
  { name: 'Arjun Nair', phone: '9988776655' },
];

/** Cycled avatar palette, picked deterministically from the name so the
 * same contact always gets the same color across renders — exactly like a
 * real contacts app. */
const AVATAR_PALETTE = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-fuchsia-500',
  'bg-pink-500',
];

function avatarColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function formatPhoneDisplay(phone: string): string {
  if (phone.length !== 10) return phone;
  return `${phone.slice(0, 5)} ${phone.slice(5)}`;
}

export default function ContactPicker({ beneficiaries, onClose, onSelectOnAppContact, onPayByNumberAnyway }: ContactPickerProps) {
  const [query, setQuery] = useState('');

  const allContacts = useMemo<ContactRow[]>(() => {
    const onApp: ContactRow[] = beneficiaries.map(({ beneficiary, account_age_minutes }) => ({
      key: beneficiary.beneficiary_id,
      name: beneficiary.name,
      phoneDisplay: beneficiary.upi_id,
      onApp: true,
      beneficiaryId: beneficiary.beneficiary_id,
      accountAgeMinutes: account_age_minutes,
    }));
    const offApp: ContactRow[] = OFF_APP_CONTACTS.map((c) => ({
      key: `OFF_${c.phone}`,
      name: c.name,
      phoneDisplay: formatPhoneDisplay(c.phone),
      onApp: false,
    }));
    return [...onApp, ...offApp].sort((a, b) => a.name.localeCompare(b.name));
  }, [beneficiaries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allContacts;
    return allContacts.filter((c) => c.name.toLowerCase().includes(q) || c.phoneDisplay.replace(/\s/g, '').includes(q));
  }, [allContacts, query]);

  const [notOnAppTarget, setNotOnAppTarget] = useState<ContactRow | null>(null);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center">
      <div className="flex h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:h-[80vh] sm:rounded-3xl">
        {/* ---- Header ------------------------------------------------- */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-gradient-to-r from-paytm-blue to-paytm-cyan px-5 py-4 text-white">
          <div>
            <div className="text-sm font-bold font-display">Pay Contacts</div>
            <div className="text-xs text-white/70">Choose someone to pay</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ---- Search --------------------------------------------------- */}
        <div className="shrink-0 border-b border-slate-100 px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or number"
              className="w-full rounded-full border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm focus:border-paytm-cyan focus:outline-none focus:ring-1 focus:ring-paytm-cyan"
            />
          </div>
        </div>

        {/* ---- Contact list ----------------------------------------------- */}
        <div className="flex-1 overflow-y-auto thin-scrollbar">
          {filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">No contacts match "{query}".</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {filtered.map((c) => (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => {
                      if (c.onApp && c.beneficiaryId) {
                        onSelectOnAppContact(c.beneficiaryId);
                      } else {
                        setNotOnAppTarget(c);
                      }
                    }}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50"
                  >
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColorFor(c.name)}`}
                    >
                      {initialsOf(c.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-slate-800">{c.name}</span>
                        {c.onApp && c.accountAgeMinutes !== undefined && c.accountAgeMinutes < 60 && (
                          <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
                            NEW
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400">{c.phoneDisplay}</span>
                    </div>
                    {c.onApp ? (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-600">
                        On PaytmResolve
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                        Not on app
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---- "Not on the app" follow-up ------------------------------- */}
      {notOnAppTarget && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setNotOnAppTarget(null)}
        >
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <UserRound className="h-6 w-6 text-slate-400" />
            </div>
            <div className="mt-3 text-sm font-bold text-slate-800">{notOnAppTarget.name} isn't on PaytmResolve AI</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              They haven't set up an account yet, so they can't be paid as a saved contact. You can still send money
              straight to their mobile number, or invite them to join.
            </p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => {
                  onPayByNumberAnyway(notOnAppTarget.phoneDisplay.replace(/\s/g, ''), notOnAppTarget.name);
                  setNotOnAppTarget(null);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Pay by mobile number
              </button>
              <button
                type="button"
                title="Decorative — not wired up in this demo"
                className="flex w-full cursor-default items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500"
              >
                <UserPlus className="h-4 w-4" /> Invite to PaytmResolve AI
              </button>
              <button
                type="button"
                onClick={() => setNotOnAppTarget(null)}
                className="w-full rounded-lg px-4 py-2 text-xs font-semibold text-slate-400 transition hover:text-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
