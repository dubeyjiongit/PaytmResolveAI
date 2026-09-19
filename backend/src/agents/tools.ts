/**
 * PaytmResolve AI — Investigation Tools
 * ---------------------------------------------------------------------------
 * These are the AI Teammate's READ tools. Directive: "The AI should
 * actually call these. That is important for the PROOF model."
 *
 * Every tool wraps a mock-DB read and returns a fully-typed
 * `AgentToolCallRecord` — call id, tool name, arguments, result, and a
 * timestamp — ready to be pushed straight onto a chat message's
 * `tool_calls[]` array and appended to the transaction's audit trail. No
 * tool here ever mutates state and no tool here ever moves money; that is
 * exactly the point of the "LLM proposes, deterministic code decides"
 * architecture. Action-taking tools (propose_action) are wired up in
 * opsAgent.ts, on top of the actionGate — deliberately not here.
 * ---------------------------------------------------------------------------
 */

import type { AgentToolCallRecord, AgentToolName } from '../types/index.js';
import {
  getBeneficiary,
  getBeneficiaryAgeMinutes,
  getTransaction,
} from '../mockDb/transactions.js';

// ============================================================================
// CALL-ID GENERATION
// ============================================================================

let toolCallCounter = 0;

function nextCallId(): string {
  toolCallCounter += 1;
  return `TOOLCALL-${String(toolCallCounter).padStart(5, '0')}`;
}

function buildRecord(
  toolName: AgentToolName,
  args: Record<string, unknown>,
  result: unknown,
): AgentToolCallRecord {
  return {
    call_id: nextCallId(),
    tool_name: toolName,
    arguments: args,
    result,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// TOOL: get_transaction
// ============================================================================

export function getTransactionTool(args: { transaction_id: string }): AgentToolCallRecord {
  const transaction = getTransaction(args.transaction_id);
  const result = transaction
    ? { found: true, transaction }
    : { found: false, error: `No transaction found with id "${args.transaction_id}".` };
  return buildRecord('get_transaction', args, result);
}

// ============================================================================
// TOOL: get_bank_status
// ============================================================================

export function getBankStatusTool(args: { transaction_id: string }): AgentToolCallRecord {
  const transaction = getTransaction(args.transaction_id);
  const result = transaction
    ? {
        found: true,
        transaction_id: transaction.transaction_id,
        bank_status: transaction.bank_status,
        amount: transaction.amount,
        updated_at: transaction.updated_at,
      }
    : { found: false, error: `No transaction found with id "${args.transaction_id}".` };
  return buildRecord('get_bank_status', args, result);
}

// ============================================================================
// TOOL: get_upi_status
// ============================================================================

export function getUpiStatusTool(args: { transaction_id: string }): AgentToolCallRecord {
  const transaction = getTransaction(args.transaction_id);
  const result = transaction
    ? {
        found: true,
        transaction_id: transaction.transaction_id,
        upi_status: transaction.upi_status,
        updated_at: transaction.updated_at,
      }
    : { found: false, error: `No transaction found with id "${args.transaction_id}".` };
  return buildRecord('get_upi_status', args, result);
}

// ============================================================================
// TOOL: get_receiver_status
// ============================================================================

export function getReceiverStatusTool(args: { transaction_id: string }): AgentToolCallRecord {
  const transaction = getTransaction(args.transaction_id);
  const result = transaction
    ? {
        found: true,
        transaction_id: transaction.transaction_id,
        receiver_status: transaction.receiver_status,
        receiver_id: transaction.receiver_id,
        updated_at: transaction.updated_at,
      }
    : { found: false, error: `No transaction found with id "${args.transaction_id}".` };
  return buildRecord('get_receiver_status', args, result);
}

// ============================================================================
// TOOL: get_refund_status
// ============================================================================

export function getRefundStatusTool(args: { transaction_id: string }): AgentToolCallRecord {
  const transaction = getTransaction(args.transaction_id);
  const result = transaction
    ? {
        found: true,
        transaction_id: transaction.transaction_id,
        refund_status: transaction.refund_status,
        updated_at: transaction.updated_at,
      }
    : { found: false, error: `No transaction found with id "${args.transaction_id}".` };
  return buildRecord('get_refund_status', args, result);
}

// ============================================================================
// TOOL: get_beneficiary (beneficiary profile, including derived age)
// ============================================================================

export function getBeneficiaryProfileTool(args: { beneficiary_id: string }): AgentToolCallRecord {
  const beneficiary = getBeneficiary(args.beneficiary_id);
  const ageMinutes = getBeneficiaryAgeMinutes(args.beneficiary_id);
  const result = beneficiary
    ? {
        found: true,
        beneficiary,
        account_age_minutes: ageMinutes,
      }
    : { found: false, error: `No beneficiary found with id "${args.beneficiary_id}".` };
  return buildRecord('get_beneficiary', args, result);
}

// ============================================================================
// TOOL REGISTRY — convenience lookup for opsAgent.ts's tool-call loop
// ============================================================================

export const TOOL_REGISTRY: Record<
  Extract<
    AgentToolName,
    | 'get_transaction'
    | 'get_bank_status'
    | 'get_upi_status'
    | 'get_receiver_status'
    | 'get_refund_status'
    | 'get_beneficiary'
  >,
  (args: Record<string, unknown>) => AgentToolCallRecord
> = {
  get_transaction: (args) => getTransactionTool(args as { transaction_id: string }),
  get_bank_status: (args) => getBankStatusTool(args as { transaction_id: string }),
  get_upi_status: (args) => getUpiStatusTool(args as { transaction_id: string }),
  get_receiver_status: (args) => getReceiverStatusTool(args as { transaction_id: string }),
  get_refund_status: (args) => getRefundStatusTool(args as { transaction_id: string }),
  get_beneficiary: (args) => getBeneficiaryProfileTool(args as { beneficiary_id: string }),
};
