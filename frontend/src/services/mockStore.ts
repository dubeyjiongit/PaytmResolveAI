import type { Customer, Transaction, BeneficiaryDirectoryEntry, BankHealthState, SupportCase, OperationsMetrics, MonitoringState } from '../types';

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
  { beneficiary_id: 'BEN_RAHUL', name: 'Rahul Sharma', vpa: 'rahul@paytm', bank_name: 'HDFC Bank', account_number_masked: '•••• 4821', relationship_type: 'KNOWN_CONTACT', added_days_ago: 180, transaction_count_with_user: 14, total_amount_transferred: 45000 },
  { beneficiary_id: 'BEN_SURESH', name: 'Suresh Kumar (Vendor)', vpa: 'suresh.vendor@icici', bank_name: 'ICICI Bank', account_number_masked: '•••• 9102', relationship_type: 'KNOWN_CONTACT', added_days_ago: 90, transaction_count_with_user: 6, total_amount_transferred: 18500 },
  { beneficiary_id: 'BEN_VIKRAM_NEW', name: 'Vikram Singh', vpa: 'vikram.singh@sbi', bank_name: 'State Bank of India', account_number_masked: '•••• 3341', relationship_type: 'NEW_BENEFICIARY', added_days_ago: 0, transaction_count_with_user: 0, total_amount_transferred: 0 },
  { beneficiary_id: 'BEN_UNKNOWN_RISKY', name: 'Rohit M. (Unverified)', vpa: 'rohit.m99@ybl', bank_name: 'Yes Bank', account_number_masked: '•••• 7781', relationship_type: 'UNKNOWN', added_days_ago: 0, transaction_count_with_user: 0, total_amount_transferred: 0 },
  { beneficiary_id: 'BEN_AMIT', name: 'Amit Patel', vpa: 'amit.patel@axis', bank_name: 'Axis Bank', account_number_masked: '•••• 1234', relationship_type: 'KNOWN_CONTACT', added_days_ago: 365, transaction_count_with_user: 25, total_amount_transferred: 120000 }
];

export const MOCK_TRANSACTIONS: Transaction[] = [
  { transaction_id: 'TXN_NET_01', user_id: 'USR_SELF', amount: 4500, currency: 'INR', beneficiary_vpa: 'rahul@paytm', beneficiary_name: 'Rahul Sharma', beneficiary_bank: 'HDFC Bank', created_at: new Date(Date.now() - 10 * 60000).toISOString(), status_decoupled: { bank: 'FAILED', upi_switch: 'FAILED', receiver_credited: 'NOT_CREDITED', refund_status: 'NOT_APPLICABLE' }, failure_reason: 'BANK_TIMEOUT', failure_code: 'ERR_HDFC_503' },
  { transaction_id: 'TXN_DEBIT_02', user_id: 'USR_SELF', amount: 12500, currency: 'INR', beneficiary_vpa: 'suresh.vendor@icici', beneficiary_name: 'Suresh Kumar (Vendor)', beneficiary_bank: 'ICICI Bank', created_at: new Date(Date.now() - 25 * 60000).toISOString(), status_decoupled: { bank: 'DEBITED', upi_switch: 'SUCCESS', receiver_credited: 'FAILED', refund_status: 'AUTO_REFUND_IN_PROGRESS' }, failure_reason: 'RECEIVER_BANK_TIMEOUT', failure_code: 'ERR_ICICI_DES_TIMEOUT' },
  { transaction_id: 'TXN_PEND_03', user_id: 'USR_SELF', amount: 8200, currency: 'INR', beneficiary_vpa: 'rahul@paytm', beneficiary_name: 'Rahul Sharma', beneficiary_bank: 'HDFC Bank', created_at: new Date(Date.now() - 5 * 60000).toISOString(), status_decoupled: { bank: 'DEBITED', upi_switch: 'PENDING', receiver_credited: 'PENDING', refund_status: 'NONE' } },
  { transaction_id: 'TXN_DUP_04', user_id: 'USR_SELF', amount: 3500, currency: 'INR', beneficiary_vpa: 'amit.patel@axis', beneficiary_name: 'Amit Patel', beneficiary_bank: 'Axis Bank', created_at: new Date(Date.now() - 60 * 60000).toISOString(), status_decoupled: { bank: 'SUCCESS', upi_switch: 'SUCCESS', receiver_credited: 'CREDITED', refund_status: 'NONE' } },
  { transaction_id: 'TXN_CONF_05', user_id: 'USR_SELF', amount: 15000, currency: 'INR', beneficiary_vpa: 'suresh.vendor@icici', beneficiary_name: 'Suresh Kumar (Vendor)', beneficiary_bank: 'ICICI Bank', created_at: new Date(Date.now() - 120 * 60000).toISOString(), status_decoupled: { bank: 'DEBITED', upi_switch: 'SUCCESS', receiver_credited: 'CREDITED', refund_status: 'NONE' } },
  { transaction_id: 'TXN_RISK_06', user_id: 'USR_SELF', amount: 200000, currency: 'INR', beneficiary_vpa: 'vikram.singh@sbi', beneficiary_name: 'Vikram Singh', beneficiary_bank: 'State Bank of India', created_at: new Date(Date.now() - 15 * 60000).toISOString(), status_decoupled: { bank: 'FAILED', upi_switch: 'FAILED', receiver_credited: 'NOT_CREDITED', refund_status: 'NOT_APPLICABLE' }, failure_reason: 'STEP_UP_REQUIRED' },
  { transaction_id: 'TXN_HIGHRISK_07', user_id: 'USR_SELF', amount: 480000, currency: 'INR', beneficiary_vpa: 'rohit.m99@ybl', beneficiary_name: 'Rohit M. (Unverified)', beneficiary_bank: 'Yes Bank', created_at: new Date(Date.now() - 2 * 60000).toISOString(), status_decoupled: { bank: 'FAILED', upi_switch: 'FAILED', receiver_credited: 'NOT_CREDITED', refund_status: 'NOT_APPLICABLE' }, failure_reason: 'HARD_FRAUD_BLOCKED' },
  { transaction_id: 'TXN_HISTORY_08', user_id: 'USR_SELF', amount: 1200, currency: 'INR', beneficiary_vpa: 'rahul@paytm', beneficiary_name: 'Rahul Sharma', beneficiary_bank: 'HDFC Bank', created_at: new Date(Date.now() - 1440 * 60000).toISOString(), status_decoupled: { bank: 'SUCCESS', upi_switch: 'SUCCESS', receiver_credited: 'CREDITED', refund_status: 'NONE' } }
];

export const MOCK_BANK_HEALTH: BankHealthState = {
  banks: [
    { bank_name: 'HDFC Bank', status: 'DEGRADED', success_rate_percent: 74, avg_latency_ms: 3800, active_incidents: ['High timeout rate on CBS core banking switch'] },
    { bank_name: 'ICICI Bank', status: 'DEGRADED', success_rate_percent: 81, avg_latency_ms: 2900, active_incidents: ['Intermittent destination credit delay'] },
    { bank_name: 'State Bank of India', status: 'HEALTHY', success_rate_percent: 98, avg_latency_ms: 450, active_incidents: [] },
    { bank_name: 'Axis Bank', status: 'HEALTHY', success_rate_percent: 99, avg_latency_ms: 320, active_incidents: [] },
    { bank_name: 'Yes Bank', status: 'HEALTHY', success_rate_percent: 97, avg_latency_ms: 510, active_incidents: [] }
  ],
  overall_system_status: 'DEGRADED_PERFORMANCE',
  recommended_routing: { 'HDFC Bank': 'REROUTE_VIA_IMPS', 'ICICI Bank': 'DELAYED_SETTLEMENT_WARNING' },
  updated_at: new Date().toISOString()
};

export const MOCK_HUMAN_OPS_CASES: SupportCase[] = [
  { case_id: 'CASE_1001', transaction_id: 'TXN_DEBIT_02', user_id: 'USR_SELF', customer_name: 'Ananya Verma', category: 'DEBIT_NO_CREDIT', priority: 'HIGH', status: 'OPEN', created_at: new Date(Date.now() - 25 * 60000).toISOString(), summary: 'User debited ?12,500 but vendor receiver not credited.', suggested_resolution: 'AUTO_REFUND' },
  { case_id: 'CASE_1002', transaction_id: 'TXN_PEND_03', user_id: 'USR_SELF', customer_name: 'Ananya Verma', category: 'PENDING_TIMEOUT', priority: 'MEDIUM', status: 'OPEN', created_at: new Date(Date.now() - 5 * 60000).toISOString(), summary: 'Transaction pending for >5 mins.', suggested_resolution: 'POLL_NPCI_STATUS' }
];

export const MOCK_HUMAN_OPS_METRICS: OperationsMetrics = {
  open_cases_count: 2,
  avg_resolution_time_seconds: 42,
  auto_resolved_today_count: 148,
  escalation_rate_percent: 1.8,
  refunded_today_inr: 425000
};
