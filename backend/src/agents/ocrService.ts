/**
 * PaytmResolve AI — OCR / Receipt-Vision Service
 * ---------------------------------------------------------------------------
 * Directive 27 (plan): "Once the core flow works, add vision. User uploads
 * payment_receipt.png. AI extracts Transaction ID / Amount / Receiver /
 * Timestamp / Status. Then automatically TXN82931 identified and begins
 * investigation."
 *
 * This is a MOCK vision parser — there is no external OCR/vision API call,
 * consistent with "Zero External DB Dependencies" and the hackathon's
 * no-network-dependency requirement. Instead of decoding real image bytes,
 * this service reads whatever textual hints accompany the upload:
 *
 *   1. `simulated_ocr_text` — the text a real vision model would have
 *      returned after reading the receipt (this is what the frontend's
 *      screenshot-upload flow sends; it can be typed by the demo operator
 *      to simulate "what the receipt says").
 *   2. `filename` — a fallback hint (e.g. "receipt_TXN_NET_01.png").
 *
 * Extraction is done with plain, deterministic regex + lookups against the
 * mock database — no placeholders, no external calls, fully offline. If a
 * transaction id is recovered and it matches a real seeded/live record, the
 * remaining fields are authoritatively filled in from that record (a real
 * vision model would only ever be as good as what's printed on the
 * receipt; once we have the ID, the database is the source of truth).
 * ---------------------------------------------------------------------------
 */

import type { OcrExtractionResult, PaymentStatus } from '../types/index.js';
import { getBeneficiary, getTransaction, listBeneficiaries } from '../mockDb/transactions.js';

// ============================================================================
// INPUT CONTRACT
// ============================================================================

export interface OcrParseInput {
  filename?: string;
  /** Base64 image payload. Only its presence/length is used (no real decoding). */
  base64_image?: string;
  /** What a vision model would have OCR'd off the receipt image. */
  simulated_ocr_text?: string;
}

// ============================================================================
// REGEX / LOOKUP HELPERS
// ============================================================================

const TRANSACTION_ID_PATTERN = /TXN[_A-Z0-9]{2,}/i;
const AMOUNT_PATTERN = /(?:₹|rs\.?|inr)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
const STATUS_KEYWORDS: Array<{ pattern: RegExp; status: PaymentStatus }> = [
  { pattern: /\bfailed\b/i, status: 'FAILED' },
  { pattern: /\btimeout\b/i, status: 'FAILED' },
  { pattern: /\bsuccess(ful)?\b/i, status: 'SUCCESS' },
  { pattern: /\bpending\b/i, status: 'PENDING' },
  { pattern: /\bdebited\b/i, status: 'DEBITED' },
  { pattern: /\breversed\b/i, status: 'REVERSED' },
  { pattern: /\brefunded\b/i, status: 'REFUNDED' },
];
const ISO_DATE_PATTERN = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/;
const RECEIVER_LINE_PATTERN = /(?:to|paid to|receiver|beneficiary)\s*[:\-]?\s*([A-Za-z][A-Za-z .]{1,40})/i;

function buildReadableText(input: OcrParseInput): string {
  if (input.simulated_ocr_text && input.simulated_ocr_text.trim().length > 0) {
    return input.simulated_ocr_text;
  }
  if (input.filename) {
    return input.filename.replace(/\.(png|jpg|jpeg|pdf|webp)$/i, '').replace(/[_-]+/g, ' ');
  }
  return '';
}

function findReceiverIdByName(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  const match = listBeneficiaries().find((b) => {
    const beneficiaryName = b.name.toLowerCase();
    return beneficiaryName.includes(normalized) || normalized.includes(beneficiaryName.split(' ')[0]);
  });
  return match?.beneficiary_id ?? null;
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export function parseReceipt(input: OcrParseInput): OcrExtractionResult {
  const readableText = buildReadableText(input);
  const hasAnyInput = Boolean(input.simulated_ocr_text || input.filename || input.base64_image);

  if (!hasAnyInput) {
    return {
      found_transaction_id: null,
      extracted_amount: null,
      extracted_receiver_id: null,
      extracted_receiver_name: null,
      extracted_timestamp: null,
      extracted_status: null,
      confidence: 0,
      raw_source: 'No file, filename, or OCR text was provided.',
      matched_existing_record: false,
    };
  }

  // --- 1. Transaction ID -------------------------------------------------
  const idMatch = readableText.match(TRANSACTION_ID_PATTERN);
  const candidateId = idMatch ? idMatch[0].toUpperCase() : null;
  const existingRecord = candidateId ? getTransaction(candidateId) : undefined;

  // If we found a real record, the database is the authoritative source
  // for every field a genuine vision model would only ever approximate —
  // exactly like a real receipt-reader would be double-checked against
  // the ledger before an AI acts on it.
  if (existingRecord) {
    const beneficiary = getBeneficiary(existingRecord.receiver_id);
    return {
      found_transaction_id: existingRecord.transaction_id,
      extracted_amount: existingRecord.amount,
      extracted_receiver_id: existingRecord.receiver_id,
      extracted_receiver_name: beneficiary?.name ?? null,
      extracted_timestamp: existingRecord.timestamp,
      extracted_status: existingRecord.payment_status,
      confidence: 0.97,
      raw_source: readableText || (input.filename ?? 'uploaded receipt image'),
      matched_existing_record: true,
    };
  }

  // --- 2. No DB match — extract whatever we can straight from the text ---
  let fieldsFound = 0;

  const amountMatch = readableText.match(AMOUNT_PATTERN);
  const extractedAmount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null;
  if (extractedAmount !== null && !Number.isNaN(extractedAmount)) fieldsFound += 1;

  const dateMatch = readableText.match(ISO_DATE_PATTERN);
  const extractedTimestamp = dateMatch ? new Date(dateMatch[0]).toISOString() : null;
  if (extractedTimestamp) fieldsFound += 1;

  const statusEntry = STATUS_KEYWORDS.find((entry) => entry.pattern.test(readableText));
  const extractedStatus = statusEntry?.status ?? null;
  if (extractedStatus) fieldsFound += 1;

  const receiverNameMatch = readableText.match(RECEIVER_LINE_PATTERN);
  const extractedReceiverName = receiverNameMatch ? receiverNameMatch[1].trim() : null;
  const extractedReceiverId = extractedReceiverName ? findReceiverIdByName(extractedReceiverName) : null;
  if (extractedReceiverId) fieldsFound += 1;

  if (candidateId) fieldsFound += 1; // an unrecognised-but-TXN-shaped id still counts as a partial read

  const confidence = candidateId ? Math.min(0.6 + fieldsFound * 0.08, 0.85) : Math.min(fieldsFound * 0.15, 0.5);

  return {
    found_transaction_id: candidateId,
    extracted_amount: extractedAmount,
    extracted_receiver_id: extractedReceiverId,
    extracted_receiver_name: extractedReceiverName,
    extracted_timestamp: extractedTimestamp,
    extracted_status: extractedStatus,
    confidence,
    raw_source: readableText || (input.filename ?? 'uploaded receipt image'),
    matched_existing_record: false,
  };
}
