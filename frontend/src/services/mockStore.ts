import type { Customer, Transaction, BeneficiaryDirectoryEntry, BankHealthState, SupportCase, OperationsMetrics } from '../types';

export const MOCK_CUSTOMER: Customer = {
  user_id: 'USR_SELF',
  name: 'Ananya Verma',
  email: 'ananya.verma@example.com',
  phone: '+91-9821000011',
  balance: 500000,
  normal_transaction_amount: 3200,
  transaction_history: ['TXN_NET_01', 'TXN_DEBIT_02', 'TXN_PEND_03', 'TXN_DUP_04', 'TXN_CONF_05', 'TXN_RISK_06', 'TXN_HIGHRISK_07', 'TXN_HISTORY_08'],
  known_devices: ['DEV_ANANYA_PHONE'],
  beneficiaries: ['BEN_RAHUL', 'BEN_SURESH', 'BEN_VIKRAM_NEW', 'BEN_UNKNOWN_RISKY', 'BEN_AMIT'],
  created_at: new Date().toISOString()
};

export const MOCK_BENEFICIARIES: BeneficiaryDirectoryEntry[] = [
  { beneficiary: { beneficiary_id: 'BEN_RAHUL', name: 'Rahul Sharma', upi_id: 'rahul@paytm', account_created_at: new Date().toISOString(), previous_transactions: 14, average_received_amount: 3200, dispute_count: 0, risk_signals: [], relationship: 'PERSONAL_CONTACT' }, account_age_minutes: 259200 },
  { beneficiary: { beneficiary_id: 'BEN_SURESH', name: 'Suresh Kumar (Vendor)', upi_id: 'suresh.vendor@icici', account_created_at: new Date().toISOString(), previous_transactions: 6, average_received_amount: 3000, dispute_count: 0, risk_signals: [], relationship: 'BUSINESS_VENDOR' }, account_age_minutes: 129600 },
  { beneficiary: { beneficiary_id: 'BEN_VIKRAM_NEW', name: 'Vikram Singh', upi_id: 'vikram.singh@sbi', account_created_at: new Date().toISOString(), previous_transactions: 0, average_received_amount: 0, dispute_count: 0, risk_signals: ['NEW_BENEFICIARY'], relationship: 'OTHER' }, account_age_minutes: 8 },
  { beneficiary: { beneficiary_id: 'BEN_UNKNOWN_RISKY', name: 'Rohit M. (Unverified)', upi_id: 'rohit.m99@ybl', account_created_at: new Date().toISOString(), previous_transactions: 0, average_received_amount: 0, dispute_count: 0, risk_signals: ['NEW_BENEFICIARY', 'HIGH_VELOCITY_RECEIVER'], relationship: 'OTHER' }, account_age_minutes: 5 },
  { beneficiary: { beneficiary_id: 'BEN_AMIT', name: 'Amit Patel', upi_id: 'amit.patel@axis', account_created_at: new Date().toISOString(), previous_transactions: 25, average_received_amount: 4800, dispute_count: 0, risk_signals: [], relationship: 'PERSONAL_CONTACT' }, account_age_minutes: 525600 }
];

export const MOCK_TRANSACTIONS: Transaction[] = [
  { transaction_id: 'TXN_NET_01', sender_id: 'USR_SELF', receiver_id: 'BEN_RAHUL', amount: 4500, currency: 'INR', timestamp: new Date(Date.now() - 10 * 60000).toISOString(), payment_status: 'FAILED', bank_status: 'NOT_DEBITED', upi_status: 'FAILED', receiver_status: 'NOT_RECEIVED', refund_status: 'NOT_INITIATED', device_id: 'DEV_ANANYA_PHONE', idempotency_key: 'IDEM_NET_01', created_at: new Date(Date.now() - 10 * 60000).toISOString(), updated_at: new Date(Date.now() - 10 * 60000).toISOString() },
  { transaction_id: 'TXN_DEBIT_02', sender_id: 'USR_SELF', receiver_id: 'BEN_SURESH', amount: 12500, currency: 'INR', timestamp: new Date(Date.now() - 25 * 60000).toISOString(), payment_status: 'DEBITED', bank_status: 'DEBITED', upi_status: 'SUCCESS', receiver_status: 'NOT_RECEIVED', refund_status: 'PROCESSING', device_id: 'DEV_ANANYA_PHONE', idempotency_key: 'IDEM_DEBIT_02', created_at: new Date(Date.now() - 25 * 60000).toISOString(), updated_at: new Date(Date.now() - 25 * 60000).toISOString() },
  { transaction_id: 'TXN_PEND_03', sender_id: 'USR_SELF', receiver_id: 'BEN_RAHUL', amount: 8200, currency: 'INR', timestamp: new Date(Date.now() - 5 * 60000).toISOString(), payment_status: 'PENDING', bank_status: 'DEBITED', upi_status: 'PENDING', receiver_status: 'UNKNOWN', refund_status: 'NOT_INITIATED', device_id: 'DEV_ANANYA_PHONE', idempotency_key: 'IDEM_PEND_03', created_at: new Date(Date.now() - 5 * 60000).toISOString(), updated_at: new Date(Date.now() - 5 * 60000).toISOString() },
  { transaction_id: 'TXN_DUP_04', sender_id: 'USR_SELF', receiver_id: 'BEN_AMIT', amount: 3500, currency: 'INR', timestamp: new Date(Date.now() - 60 * 60000).toISOString(), payment_status: 'SUCCESS', bank_status: 'DEBITED', upi_status: 'SUCCESS', receiver_status: 'CREDITED', refund_status: 'NOT_INITIATED', device_id: 'DEV_ANANYA_PHONE', idempotency_key: 'IDEM_DUP_04', created_at: new Date(Date.now() - 60 * 60000).toISOString(), updated_at: new Date(Date.now() - 60 * 60000).toISOString() },
  { transaction_id: 'TXN_CONF_05', sender_id: 'USR_SELF', receiver_id: 'BEN_SURESH', amount: 15000, currency: 'INR', timestamp: new Date(Date.now() - 120 * 60000).toISOString(), payment_status: 'SUCCESS', bank_status: 'DEBITED', upi_status: 'SUCCESS', receiver_status: 'CREDITED', refund_status: 'NOT_INITIATED', device_id: 'DEV_ANANYA_PHONE', idempotency_key: 'IDEM_CONF_05', created_at: new Date(Date.now() - 120 * 60000).toISOString(), updated_at: new Date(Date.now() - 120 * 60000).toISOString() },
  { transaction_id: 'TXN_RISK_06', sender_id: 'USR_SELF', receiver_id: 'BEN_VIKRAM_NEW', amount: 200000, currency: 'INR', timestamp: new Date(Date.now() - 15 * 60000).toISOString(), payment_status: 'FAILED', bank_status: 'NOT_DEBITED', upi_status: 'FAILED', receiver_status: 'NOT_RECEIVED', refund_status: 'NOT_INITIATED', device_id: 'DEV_ANANYA_PHONE', idempotency_key: 'IDEM_RISK_06', created_at: new Date(Date.now() - 15 * 60000).toISOString(), updated_at: new Date(Date.now() - 15 * 60000).toISOString() },
  { transaction_id: 'TXN_HIGHRISK_07', sender_id: 'USR_SELF', receiver_id: 'BEN_UNKNOWN_RISKY', amount: 480000, currency: 'INR', timestamp: new Date(Date.now() - 2 * 60000).toISOString(), payment_status: 'BLOCKED', bank_status: 'NOT_DEBITED', upi_status: 'FAILED', receiver_status: 'NOT_RECEIVED', refund_status: 'NOT_INITIATED', device_id: 'DEV_ANANYA_PHONE', idempotency_key: 'IDEM_HIGHRISK_07', created_at: new Date(Date.now() - 2 * 60000).toISOString(), updated_at: new Date(Date.now() - 2 * 60000).toISOString(), policy_block_reason: 'HARD_FRAUD_BLOCKED' },
  { transaction_id: 'TXN_HISTORY_08', sender_id: 'USR_SELF', receiver_id: 'BEN_RAHUL', amount: 1200, currency: 'INR', timestamp: new Date(Date.now() - 1440 * 60000).toISOString(), payment_status: 'SUCCESS', bank_status: 'DEBITED', upi_status: 'SUCCESS', receiver_status: 'CREDITED', refund_status: 'NOT_INITIATED', device_id: 'DEV_ANANYA_PHONE', idempotency_key: 'IDEM_HISTORY_08', created_at: new Date(Date.now() - 1440 * 60000).toISOString(), updated_at: new Date(Date.now() - 1440 * 60000).toISOString() }
];

export const MOCK_BANK_HEALTH: BankHealthState = {
  bank_name: 'HDFC Bank',
  status: 'DEGRADED',
  baseline_timeout_rate: 0.01,
  current_timeout_rate: 0.26,
  surge_percent: 2500,
  message: 'High timeout rate on CBS core banking switch',
  updated_at: new Date().toISOString()
};

export const MOCK_HUMAN_OPS_CASES: SupportCase[] = [
  { case_id: 'CASE_1001', transaction_id: 'TXN_DEBIT_02', customer_id: 'USR_SELF', reason: 'User debited ?12,500 but vendor receiver not credited.', priority: 'HIGH', status: 'OPEN', created_at: new Date(Date.now() - 25 * 60000).toISOString(), updated_at: new Date().toISOString(), investigation_timeline: [], evidence: {}, diagnosis: 'DEBIT_WITHOUT_CREDIT', actions_taken: [], recommended_action: 'INITIATE_REFUND', customer_instruction: 'Wait for refund' },
  { case_id: 'CASE_1002', transaction_id: 'TXN_PEND_03', customer_id: 'USR_SELF', reason: 'Transaction pending for >5 mins.', priority: 'MEDIUM', status: 'OPEN', created_at: new Date(Date.now() - 5 * 60000).toISOString(), updated_at: new Date().toISOString(), investigation_timeline: [], evidence: {}, diagnosis: 'SETTLEMENT_PENDING', actions_taken: [], recommended_action: 'MONITOR_TRANSACTION', customer_instruction: 'Monitor status' }
];

export const MOCK_HUMAN_OPS_METRICS: OperationsMetrics = {
  cases_handled: 150,
  auto_resolved: 148,
  escalated: 2,
  average_resolution_seconds: 42,
  duplicate_payments_prevented: 18,
  refund_workflows: 12,
  human_interventions: 2
};
