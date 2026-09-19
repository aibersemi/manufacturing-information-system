import { inject, Injectable, signal } from '@angular/core';
import { Tables } from '../../../types/database.types';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { SupabaseService } from './supabase.service';

export type LedgerAccount = Tables<'ledger_account'>;
export type AccountingMappingRow = Tables<'accounting_mapping'>;
export type ReportAccountMappingRow = Tables<'report_account_mapping'>;
export type AccountingPeriod = Tables<'accounting_period'>;

export interface AccountingMappingItem {
  mappingKey: string;
  label: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  isControl: boolean;
  defaultCode: string;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  isCompatible: boolean;
}

export interface ReportAccountMappingItem {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  managementPost: 'revenue' | 'cogs' | 'operating_expense' | 'marketing_ads' | 'payroll' | 'other' | null;
  cashFlowActivity: 'operating' | 'investing' | 'financing' | null;
  cashFlowGroup: string | null;
}

export interface CashAccountItem {
  id: string;
  name: string;
  code: string | null;
  ledgerAccountId: string | null;
  ledgerAccountCode: string | null;
  ledgerAccountName: string | null;
  balance: number;
  isActive: boolean;
}

export interface CashMovementItem {
  id: string;
  companyId: string;
  cashAccountId: string;
  cashAccountName: string;
  movementType: string;
  transactionDate: string;
  amount: number;
  notes: string | null;
  sourceDocumentId: string | null;
  pairedMovementId: string | null;
  reversalOfId: string | null;
  postedAt: string;
}

export interface CashTransferDocument {
  id: string;
  documentNumber: string;
  transactionDate: string;
  sourceCashAccountId: string;
  sourceCashAccountName: string;
  destinationCashAccountId: string;
  destinationCashAccountName: string;
  amount: number;
  notes: string;
  status: string;
  postedAt: string;
}

export interface OperatingExpenseLine {
  id?: string;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  description: string;
  amount: number;
}

export interface OperatingExpenseDocument {
  id: string;
  documentNumber: string;
  transactionDate: string;
  totalAmount: number;
  fundingMethod: 'cash' | 'payable';
  cashAccountId?: string | null;
  cashAccountName?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  notes?: string;
  status: 'posted' | 'void' | string;
  voidReason?: string | null;
  lines: OperatingExpenseLine[];
  postedAt: string;
}

export interface WageLiabilityItem {
  id: string;
  employeeId: string;
  employeeName: string;
  serviceKind: string;
  quantity: number;
  rate: number;
  grossAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  isPaid: boolean;
  postedAt: string;
  sourceDocumentNumber?: string | null;
}

export interface PrepaidExpenseItem {
  id: string;
  description: string;
  prepaidAccountId: string;
  prepaidAccountCode: string;
  prepaidAccountName: string;
  expenseAccountId: string;
  expenseAccountCode: string;
  expenseAccountName: string;
  startDate: string;
  endDate: string;
  numberOfMonths: number;
  originalAmount: number;
  amortizedAmount: number;
  remainingAmount: number;
  progressPercentage: number;
  status: 'active' | 'completed' | 'cancelled' | string;
  entries?: {
    periodMonth: string;
    amount: number;
    postedAt: string;
  }[];
}

export interface OpeningBalanceDocument {
  id: string;
  documentNumber: string;
  transactionDate: string;
  totalAmount: number;
  status: string;
  notes?: string;
  postedAt: string;
  lines: {
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    description: string;
  }[];
}

export interface ManualJournalItem {
  id: string;
  entryNumber: string;
  transactionDate: string;
  entryType: string;
  memo: string;
  description: string;
  status: string;
  reversalOfId: string | null;
  postedAt: string;
  lines: {
    id: string;
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    description: string | null;
  }[];
}

export interface AccountingPeriodItem {
  id: string;
  periodMonth: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'closing' | 'closed';
  state: 'open' | 'closing' | 'closed';
  openingState: 'pending' | 'posted' | 'zero_declared';
  closeSummary?: Record<string, unknown> | null;
  closedAt?: string | null;
  closedByUserId?: string | null;
  reopenedAt?: string | null;
  reopenReason?: string | null;
}

export interface PeriodIntegrityCheckResult {
  periodMonth: string;
  balancedJournals: boolean;
  totalDebit: number;
  totalCredit: number;
  pendingDrafts: number;
  cashReconciled: boolean;
  canClose: boolean;
  errors: string[];
}

export const SYSTEM_MAPPING_DEFINITIONS: readonly {
  key: string;
  label: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  defaultCode: string;
  isControl: boolean;
}[] = [
  { key: 'cash', label: 'Kas/Bank', accountType: 'asset', defaultCode: '1-1.1.01', isControl: true },
  { key: 'receivable', label: 'Piutang Usaha', accountType: 'asset', defaultCode: '1-1.2.01', isControl: true },
  { key: 'material_inventory', label: 'Persediaan Material', accountType: 'asset', defaultCode: '1-1.4.02', isControl: true },
  { key: 'production_supplies_inventory', label: 'Persediaan Perlengkapan Produksi', accountType: 'asset', defaultCode: '1-1.4.02', isControl: true },
  { key: 'wip_cut', label: 'WIP Potong', accountType: 'asset', defaultCode: '1-1.4.03', isControl: true },
  { key: 'wip_printed', label: 'WIP Sablon', accountType: 'asset', defaultCode: '1-1.4.03', isControl: true },
  { key: 'wip_sewn', label: 'WIP Jahit', accountType: 'asset', defaultCode: '1-1.4.03', isControl: true },
  { key: 'finished_goods', label: 'Persediaan Produk Jadi', accountType: 'asset', defaultCode: '1-1.4.01', isControl: true },
  { key: 'asset_candidate', label: 'Calon Aset Tetap', accountType: 'asset', defaultCode: '1-1.5.01', isControl: true },
  { key: 'fixed_asset', label: 'Aset Tetap', accountType: 'asset', defaultCode: '1-2.0.04', isControl: true },
  { key: 'accumulated_depreciation', label: 'Akumulasi Penyusutan', accountType: 'asset', defaultCode: '1-2.1.03', isControl: true },
  { key: 'supplier_payable', label: 'Hutang Pemasok', accountType: 'liability', defaultCode: '2-1.1.01', isControl: true },
  { key: 'wage_payable', label: 'Hutang Upah', accountType: 'liability', defaultCode: '2-1.2.01', isControl: true },
  { key: 'opening_equity', label: 'Ekuitas Saldo Awal', accountType: 'equity', defaultCode: '3-9.0.00', isControl: true },
  { key: 'sales_revenue', label: 'Pendapatan Penjualan', accountType: 'revenue', defaultCode: '4-1.0.01', isControl: false },
  { key: 'asset_disposal_gain', label: 'Laba Pelepasan Aset', accountType: 'revenue', defaultCode: '4-2.0.03', isControl: false },
  { key: 'cogs', label: 'Harga Pokok Penjualan', accountType: 'expense', defaultCode: '5-1.1.00', isControl: false },
  { key: 'operating_expense', label: 'Biaya Operasional', accountType: 'expense', defaultCode: '8-2.0.00', isControl: false },
  { key: 'production_overhead', label: 'Biaya Overhead Produksi', accountType: 'expense', defaultCode: '6-2.1.03', isControl: false },
  { key: 'depreciation_expense', label: 'Biaya Penyusutan', accountType: 'expense', defaultCode: '6-3.0.03', isControl: false },
  { key: 'asset_disposal_loss', label: 'Rugi Pelepasan Aset', accountType: 'expense', defaultCode: '8-2.0.00', isControl: false },
];

@Injectable({
  providedIn: 'root',
})
export class FinanceService {
  private readonly supabase = inject(SupabaseService);
  private readonly companyService = inject(CompanyService);
  private readonly authService = inject(AuthService);

  // State Reaktif
  readonly ledgerAccounts = signal<LedgerAccount[]>([]);
  readonly systemMappings = signal<AccountingMappingItem[]>([]);
  readonly reportMappings = signal<ReportAccountMappingItem[]>([]);
  readonly cashAccounts = signal<CashAccountItem[]>([]);
  readonly cashMovements = signal<CashMovementItem[]>([]);
  readonly cashTransfers = signal<CashTransferDocument[]>([]);
  readonly operatingExpenses = signal<OperatingExpenseDocument[]>([]);
  readonly wageLiabilities = signal<WageLiabilityItem[]>([]);
  readonly prepaidExpenses = signal<PrepaidExpenseItem[]>([]);
  readonly openingBalances = signal<OpeningBalanceDocument[]>([]);
  readonly manualJournals = signal<ManualJournalItem[]>([]);
  readonly accountingPeriods = signal<AccountingPeriodItem[]>([]);
  readonly activePeriod = signal<AccountingPeriodItem | null>(null);
  readonly loading = signal<boolean>(false);

  private async requireActiveCompanyId(): Promise<string> {
    let companyId = this.companyService.activeCompanyId();
    if (!companyId) {
      companyId = await this.companyService.waitForActiveCompany();
    }
    if (!companyId) {
      throw new Error('Tidak ada perusahaan aktif yang dipilih.');
    }
    return companyId;
  }

  private requireCurrentUserId(): string {
    const user = this.authService.currentUser();
    if (!user?.id) {
      throw new Error('Pengguna belum terautentikasi.');
    }
    return user.id;
  }

  // ============================================================================
  // 1. BAGAN AKUN (CHART OF ACCOUNTS)
  // ============================================================================

  async loadLedgerAccounts(): Promise<LedgerAccount[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const { data, error } = await this.supabase.client
        .from('ledger_account')
        .select('*')
        .eq('company_id', companyId)
        .order('code', { ascending: true });

      if (error) throw error;
      const accounts = data || [];
      this.ledgerAccounts.set(accounts);
      return accounts;
    } finally {
      this.loading.set(false);
    }
  }

  async updateAccountStatus(id: string, isActive: boolean): Promise<LedgerAccount> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { data, error } = await this.supabase.client.rpc('update_ledger_account_status', {
        p_company_id: companyId,
        p_account_id: id,
        p_is_active: isActive,
        p_user_id: userId,
      });

      if (error) throw error;
      const updated = (data as unknown) as LedgerAccount;
      this.ledgerAccounts.update((prev) =>
        prev.map((acc) => (acc.id === id ? { ...acc, is_active: isActive, version: acc.version + 1 } : acc))
      );
      return updated;
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 2. PEMETAAN SISTEM (SYSTEM MAPPINGS)
  // ============================================================================

  async loadAccountingMappings(): Promise<AccountingMappingItem[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const [accountsRes, mappingsRes] = await Promise.all([
        this.supabase.client.from('ledger_account').select('*').eq('company_id', companyId),
        this.supabase.client.from('accounting_mapping').select('*').eq('company_id', companyId),
      ]);

      if (accountsRes.error) throw accountsRes.error;
      if (mappingsRes.error) throw mappingsRes.error;

      const accounts = accountsRes.data || [];
      const mappings = mappingsRes.data || [];

      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      const items: AccountingMappingItem[] = SYSTEM_MAPPING_DEFINITIONS.map((def) => {
        const found = mappings.find((m) => m.mapping_key === def.key);
        const acc = found ? accountMap.get(found.account_id) : undefined;
        const isCompatible = acc ? acc.account_type === def.accountType && acc.is_active : false;

        return {
          mappingKey: def.key,
          label: def.label,
          accountType: def.accountType,
          isControl: def.isControl,
          defaultCode: def.defaultCode,
          accountId: acc ? acc.id : null,
          accountCode: acc ? acc.code : null,
          accountName: acc ? acc.name : null,
          isCompatible,
        };
      });

      this.systemMappings.set(items);
      return items;
    } finally {
      this.loading.set(false);
    }
  }

  async saveAccountingMappings(mappings: { mapping_key: string; account_id: string }[]): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('save_accounting_mappings', {
        p_company_id: companyId,
        p_mappings: mappings,
        p_user_id: userId,
      });

      if (error) throw error;
      await this.loadAccountingMappings();
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 3. PEMETAAN LAPORAN (REPORT ACCOUNT MAPPINGS)
  // ============================================================================

  async loadReportAccountMappings(): Promise<ReportAccountMappingItem[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const [accountsRes, mappingsRes] = await Promise.all([
        this.supabase.client.from('ledger_account').select('*').eq('company_id', companyId).order('code', { ascending: true }),
        this.supabase.client.from('report_account_mapping').select('*').eq('company_id', companyId),
      ]);

      if (accountsRes.error) throw accountsRes.error;
      if (mappingsRes.error) throw mappingsRes.error;

      const accounts = accountsRes.data || [];
      const mappings = mappingsRes.data || [];
      const mappingMap = new Map(mappings.map((m) => [m.account_id, m]));

      const items: ReportAccountMappingItem[] = accounts.map((acc) => {
        const m = mappingMap.get(acc.id);
        return {
          accountId: acc.id,
          accountCode: acc.code,
          accountName: acc.name,
          accountType: acc.account_type,
          managementPost: (m?.management_post as ReportAccountMappingItem['managementPost']) || null,
          cashFlowActivity: (m?.cash_flow_activity as ReportAccountMappingItem['cashFlowActivity']) || null,
          cashFlowGroup: m?.cash_flow_group || null,
        };
      });

      this.reportMappings.set(items);
      return items;
    } finally {
      this.loading.set(false);
    }
  }

  async saveReportAccountMappings(
    mappings: {
      account_id: string;
      management_post?: string | null;
      cash_flow_activity?: string | null;
      cash_flow_group?: string | null;
    }[]
  ): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('save_report_account_mappings', {
        p_company_id: companyId,
        p_mappings: mappings,
        p_user_id: userId,
      });

      if (error) throw error;
      await this.loadReportAccountMappings();
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 4. REKENING KAS & TRANSFER ANTAR REKENING
  // ============================================================================

  async loadCashAccounts(): Promise<CashAccountItem[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const [mastersRes, movementsRes, accountsRes] = await Promise.all([
        this.supabase.client
          .from('master_record')
          .select('id, name, code, ledger_account_id, is_active')
          .eq('company_id', companyId)
          .eq('record_kind', 'cash_account')
          .order('name', { ascending: true }),
        this.supabase.client
          .from('cash_movement')
          .select('cash_account_id, amount, movement_type')
          .eq('company_id', companyId),
        this.supabase.client
          .from('ledger_account')
          .select('id, code, name')
          .eq('company_id', companyId),
      ]);

      if (mastersRes.error) throw mastersRes.error;
      if (movementsRes.error) throw movementsRes.error;
      if (accountsRes.error) throw accountsRes.error;

      const masters = mastersRes.data || [];
      const movements = movementsRes.data || [];
      const accounts = accountsRes.data || [];
      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      // Hitung saldo per cash account
      const balanceMap = new Map<string, number>();
      for (const mv of movements) {
        const current = balanceMap.get(mv.cash_account_id) || 0;
        let delta = Number(mv.amount);
        const mt = mv.movement_type;
        if (['expense', 'disbursement', 'transfer_out'].includes(mt)) {
          delta = -Math.abs(delta);
        } else if (['receipt', 'revenue', 'income', 'opening_balance', 'transfer_in'].includes(mt)) {
          delta = Math.abs(delta);
        }
        balanceMap.set(mv.cash_account_id, current + delta);
      }

      const items: CashAccountItem[] = masters.map((m) => {
        const acc = m.ledger_account_id ? accountMap.get(m.ledger_account_id) : undefined;
        return {
          id: m.id,
          name: m.name,
          code: m.code,
          ledgerAccountId: m.ledger_account_id,
          ledgerAccountCode: acc ? acc.code : null,
          ledgerAccountName: acc ? acc.name : null,
          balance: balanceMap.get(m.id) || 0,
          isActive: m.is_active,
        };
      });

      this.cashAccounts.set(items);
      return items;
    } finally {
      this.loading.set(false);
    }
  }

  async loadCashMovements(cashAccountId?: string): Promise<CashMovementItem[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      let query = this.supabase.client
        .from('cash_movement')
        .select(
          `
          id, company_id, cash_account_id, movement_type, transaction_date,
          amount, notes, source_document_id, paired_movement_id, reversal_of_id, posted_at,
          cash_account:master_record!cash_account_id(name)
        `
        )
        .eq('company_id', companyId)
        .order('posted_at', { ascending: false })
        .limit(100);

      if (cashAccountId) {
        query = query.eq('cash_account_id', cashAccountId);
      }

      const { data, error } = await query;
      if (error) throw error;

      interface CashMovementRow {
        id: string;
        company_id: string;
        cash_account_id: string;
        movement_type: string;
        transaction_date: string;
        amount: number;
        notes: string | null;
        source_document_id: string | null;
        paired_movement_id: string | null;
        reversal_of_id: string | null;
        posted_at: string;
        cash_account?: { name: string } | null;
      }

      const rows = (data || []) as unknown as CashMovementRow[];
      const items: CashMovementItem[] = rows.map((r) => ({
        id: r.id,
        companyId: r.company_id,
        cashAccountId: r.cash_account_id,
        cashAccountName: r.cash_account?.name || 'Kas/Bank',
        movementType: r.movement_type,
        transactionDate: r.transaction_date,
        amount: Number(r.amount),
        notes: r.notes,
        sourceDocumentId: r.source_document_id,
        pairedMovementId: r.paired_movement_id,
        reversalOfId: r.reversal_of_id,
        postedAt: r.posted_at,
      }));

      this.cashMovements.set(items);
      return items;
    } finally {
      this.loading.set(false);
    }
  }

  async loadCashTransfers(): Promise<CashTransferDocument[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const { data, error } = await this.supabase.client
        .from('business_document')
        .select('*')
        .eq('company_id', companyId)
        .eq('document_kind', 'cash_transfer')
        .order('transaction_date', { ascending: false })
        .limit(100);

      if (error) throw error;

      const items: CashTransferDocument[] = (data || []).map((doc) => {
        const d = (doc.data as Record<string, unknown>) || {};
        return {
          id: doc.id,
          documentNumber: doc.document_number || '-',
          transactionDate: doc.transaction_date,
          sourceCashAccountId: (d['sourceCashAccountId'] as string) || '',
          sourceCashAccountName: (d['sourceCashAccountName'] as string) || 'Kas Sumber',
          destinationCashAccountId: (d['destinationCashAccountId'] as string) || '',
          destinationCashAccountName: (d['destinationCashAccountName'] as string) || 'Kas Tujuan',
          amount: Number(doc.total_amount),
          notes: (d['notes'] as string) || '',
          status: doc.status,
          postedAt: doc.posted_at || doc.created_at,
        };
      });

      this.cashTransfers.set(items);
      return items;
    } finally {
      this.loading.set(false);
    }
  }

  async postCashTransfer(payload: {
    sourceCashId: string;
    destinationCashId: string;
    amount: number;
    transferDate: string;
    notes?: string;
  }): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('post_cash_transfer', {
        p_company_id: companyId,
        p_source_cash_id: payload.sourceCashId,
        p_destination_cash_id: payload.destinationCashId,
        p_amount: payload.amount,
        p_transfer_date: payload.transferDate,
        p_notes: payload.notes || undefined,
        p_user_id: userId,
      });

      if (error) throw error;
      await Promise.all([this.loadCashAccounts(), this.loadCashTransfers(), this.loadCashMovements()]);
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 5. BIAYA OPERASIONAL (OPERATING EXPENSES)
  // ============================================================================

  async loadOperatingExpenses(): Promise<OperatingExpenseDocument[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const { data, error } = await this.supabase.client
        .from('business_document')
        .select(
          `
          id, document_number, transaction_date, total_amount, status,
          data, void_reason, posted_at, created_at,
          supplier:master_record!counterparty_id(id, name),
          lines:business_document_line(id, account_id, description, total_amount, account:ledger_account!account_id(code, name))
        `
        )
        .eq('company_id', companyId)
        .eq('document_kind', 'operating_expense')
        .order('transaction_date', { ascending: false })
        .limit(100);

      if (error) throw error;

      interface OperatingExpenseRawRow {
        id: string;
        document_number: string | null;
        transaction_date: string;
        total_amount: number;
        status: string;
        data: Record<string, unknown> | null;
        void_reason: string | null;
        posted_at: string | null;
        created_at: string;
        supplier?: { id: string; name: string } | null;
        lines?: {
          id: string;
          account_id: string | null;
          description: string;
          total_amount: number;
          account?: { code: string; name: string } | null;
        }[];
      }

      const rows = (data || []) as unknown as OperatingExpenseRawRow[];
      const items: OperatingExpenseDocument[] = rows.map((r) => {
        const d = r.data || {};
        return {
          id: r.id,
          documentNumber: r.document_number || '-',
          transactionDate: r.transaction_date,
          totalAmount: Number(r.total_amount),
          fundingMethod: (d['fundingMethod'] as 'cash' | 'payable') || 'cash',
          cashAccountId: (d['cashAccountId'] as string) || null,
          cashAccountName: (d['cashAccountName'] as string) || null,
          supplierId: r.supplier?.id || null,
          supplierName: r.supplier?.name || null,
          notes: (d['notes'] as string) || '',
          status: r.status,
          voidReason: r.void_reason,
          lines: (r.lines || []).map((l) => ({
            id: l.id,
            accountId: l.account_id || '',
            accountCode: l.account?.code,
            accountName: l.account?.name,
            description: l.description,
            amount: Number(l.total_amount),
          })),
          postedAt: r.posted_at || r.created_at,
        };
      });

      this.operatingExpenses.set(items);
      return items;
    } finally {
      this.loading.set(false);
    }
  }

  async postOperatingExpense(payload: {
    fundingMethod: 'cash' | 'payable';
    cashAccountId?: string | null;
    supplierId?: string | null;
    expenseDate: string;
    notes?: string;
    lines: { account_id: string; description: string; amount: number }[];
  }): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('post_operating_expense', {
        p_company_id: companyId,
        p_funding_method: payload.fundingMethod,
        p_cash_account_id: payload.cashAccountId || undefined,
        p_supplier_id: payload.supplierId || undefined,
        p_expense_date: payload.expenseDate,
        p_notes: payload.notes || undefined,
        p_lines: payload.lines,
        p_user_id: userId,
      });

      if (error) throw error;
      await Promise.all([this.loadOperatingExpenses(), this.loadCashAccounts()]);
    } finally {
      this.loading.set(false);
    }
  }

  async voidOperatingExpense(documentId: string, reason: string): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('void_operating_expense', {
        p_company_id: companyId,
        p_document_id: documentId,
        p_reason: reason,
        p_user_id: userId,
      });

      if (error) throw error;
      await Promise.all([this.loadOperatingExpenses(), this.loadCashAccounts()]);
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 6. PEMBAYARAN UPAH & GAJI BORONGAN (WAGES)
  // ============================================================================

  async loadWageLiabilities(employeeId?: string): Promise<WageLiabilityItem[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      let query = this.supabase.client
        .from('wage_liability')
        .select(
          `
          id, employee_id, service_kind, quantity, rate, gross_amount, paid_amount, is_paid, posted_at,
          employee:master_record!employee_id(name),
          source_document:business_document!source_document_id(document_number)
        `
        )
        .eq('company_id', companyId)
        .order('posted_at', { ascending: false })
        .limit(150);

      if (employeeId) {
        query = query.eq('employee_id', employeeId);
      }

      const { data, error } = await query;
      if (error) throw error;

      interface WageLiabilityRawRow {
        id: string;
        employee_id: string;
        service_kind: string;
        quantity: number;
        rate: number;
        gross_amount: number;
        paid_amount: number;
        is_paid: boolean;
        posted_at: string;
        employee?: { name: string } | null;
        source_document?: { document_number: string | null } | null;
      }

      const rows = (data || []) as unknown as WageLiabilityRawRow[];
      const items: WageLiabilityItem[] = rows.map((r) => {
        const gross = Number(r.gross_amount);
        const paid = Number(r.paid_amount);
        return {
          id: r.id,
          employeeId: r.employee_id,
          employeeName: r.employee?.name || 'Operator',
          serviceKind: r.service_kind,
          quantity: Number(r.quantity),
          rate: Number(r.rate),
          grossAmount: gross,
          paidAmount: paid,
          outstandingAmount: Math.max(0, gross - paid),
          isPaid: r.is_paid || paid >= gross,
          postedAt: r.posted_at,
          sourceDocumentNumber: r.source_document?.document_number,
        };
      });

      this.wageLiabilities.set(items);
      return items;
    } finally {
      this.loading.set(false);
    }
  }

  async postWagePayment(payload: {
    employeeId: string;
    cashAccountId: string;
    paymentDate: string;
    liabilityIds: string[];
    notes?: string;
  }): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('post_wage_payment', {
        p_company_id: companyId,
        p_employee_id: payload.employeeId,
        p_cash_account_id: payload.cashAccountId,
        p_payment_date: payload.paymentDate,
        p_liability_ids: payload.liabilityIds,
        p_notes: payload.notes || undefined,
        p_user_id: userId,
      });

      if (error) throw error;
      await Promise.all([this.loadWageLiabilities(), this.loadCashAccounts()]);
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 7. BIAYA DIBAYAR DIMUKA & AMORTISASI (PREPAID EXPENSES)
  // ============================================================================

  async loadPrepaidExpenses(): Promise<PrepaidExpenseItem[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const [prepaidRes, entriesRes] = await Promise.all([
        this.supabase.client
          .from('prepaid_expense')
          .select(
            `
            id, description, prepaid_account_id, expense_account_id,
            start_date, end_date, number_of_months, original_amount, amortized_amount, status,
            prepaid_acc:ledger_account!prepaid_account_id(code, name),
            expense_acc:ledger_account!expense_account_id(code, name)
          `
          )
          .eq('company_id', companyId)
          .order('created_at', { ascending: false }),
        this.supabase.client
          .from('prepaid_amortization_entry')
          .select('prepaid_expense_id, period_month, amount, posted_at')
          .eq('company_id', companyId)
          .order('period_month', { ascending: true }),
      ]);

      if (prepaidRes.error) throw prepaidRes.error;
      if (entriesRes.error) throw entriesRes.error;

      interface PrepaidExpenseRawRow {
        id: string;
        description: string;
        prepaid_account_id: string;
        expense_account_id: string;
        start_date: string;
        end_date: string;
        number_of_months: number;
        original_amount: number;
        amortized_amount: number;
        status: string;
        prepaid_acc?: { code: string; name: string } | null;
        expense_acc?: { code: string; name: string } | null;
      }

      const rows = (prepaidRes.data || []) as unknown as PrepaidExpenseRawRow[];
      const entries = entriesRes.data || [];

      const entriesMap = new Map<string, { periodMonth: string; amount: number; postedAt: string }[]>();
      for (const e of entries) {
        const list = entriesMap.get(e.prepaid_expense_id) || [];
        list.push({
          periodMonth: e.period_month,
          amount: Number(e.amount),
          postedAt: e.posted_at,
        });
        entriesMap.set(e.prepaid_expense_id, list);
      }

      const items: PrepaidExpenseItem[] = rows.map((r) => {
        const orig = Number(r.original_amount);
        const amortized = Number(r.amortized_amount);
        const remaining = Math.max(0, orig - amortized);
        const progress = orig > 0 ? Math.min(100, Math.round((amortized / orig) * 100)) : 0;

        return {
          id: r.id,
          description: r.description,
          prepaidAccountId: r.prepaid_account_id,
          prepaidAccountCode: r.prepaid_acc?.code || '-',
          prepaidAccountName: r.prepaid_acc?.name || 'Akun Prepaid',
          expenseAccountId: r.expense_account_id,
          expenseAccountCode: r.expense_acc?.code || '-',
          expenseAccountName: r.expense_acc?.name || 'Akun Beban',
          startDate: r.start_date,
          endDate: r.end_date,
          numberOfMonths: r.number_of_months,
          originalAmount: orig,
          amortizedAmount: amortized,
          remainingAmount: remaining,
          progressPercentage: progress,
          status: r.status,
          entries: entriesMap.get(r.id) || [],
        };
      });

      this.prepaidExpenses.set(items);
      return items;
    } finally {
      this.loading.set(false);
    }
  }

  async createPrepaidExpense(payload: {
    description: string;
    prepaidAccountId: string;
    expenseAccountId: string;
    startDate: string;
    numberOfMonths: number;
    originalAmount: number;
  }): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('create_prepaid_expense', {
        p_company_id: companyId,
        p_description: payload.description,
        p_prepaid_account_id: payload.prepaidAccountId,
        p_expense_account_id: payload.expenseAccountId,
        p_start_date: payload.startDate,
        p_number_of_months: payload.numberOfMonths,
        p_original_amount: payload.originalAmount,
        p_user_id: userId,
      });

      if (error) throw error;
      await this.loadPrepaidExpenses();
    } finally {
      this.loading.set(false);
    }
  }

  async postPrepaidAmortization(prepaidId: string, periodMonth: string): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('post_prepaid_amortization', {
        p_company_id: companyId,
        p_prepaid_id: prepaidId,
        p_period_month: periodMonth,
        p_user_id: userId,
      });

      if (error) throw error;
      await this.loadPrepaidExpenses();
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 8. SALDO AWAL (OPENING BALANCE)
  // ============================================================================

  async loadOpeningBalances(): Promise<OpeningBalanceDocument[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const { data, error } = await this.supabase.client
        .from('business_document')
        .select(
          `
          id, document_number, transaction_date, total_amount, status,
          data, posted_at, created_at,
          lines:business_document_line(id, account_id, description, total_amount, subtotal, account:ledger_account!account_id(code, name))
        `
        )
        .eq('company_id', companyId)
        .eq('document_kind', 'opening_balance')
        .order('transaction_date', { ascending: false });

      if (error) throw error;

      interface OpeningBalanceRawRow {
        id: string;
        document_number: string | null;
        transaction_date: string;
        total_amount: number;
        status: string;
        data: Record<string, unknown> | null;
        posted_at: string | null;
        created_at: string;
        lines?: {
          id: string;
          account_id: string | null;
          description: string;
          total_amount: number;
          subtotal: number;
          account?: { code: string; name: string } | null;
        }[];
      }

      const rows = (data || []) as unknown as OpeningBalanceRawRow[];
      const items: OpeningBalanceDocument[] = rows.map((r) => {
        const d = r.data || {};
        return {
          id: r.id,
          documentNumber: r.document_number || '-',
          transactionDate: r.transaction_date,
          totalAmount: Number(r.total_amount),
          status: r.status,
          notes: (d['notes'] as string) || '',
          postedAt: r.posted_at || r.created_at,
          lines: (r.lines || []).map((l) => ({
            accountId: l.account_id || '',
            accountCode: l.account?.code || '-',
            accountName: l.account?.name || 'Akun',
            debit: Number(l.total_amount),
            credit: 0,
            description: l.description,
          })),
        };
      });

      this.openingBalances.set(items);
      return items;
    } finally {
      this.loading.set(false);
    }
  }

  async postOpeningBalance(payload: {
    balanceDate: string;
    notes?: string;
    lines: { account_id: string; debit: number; credit: number; description?: string }[];
  }): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('post_opening_balance', {
        p_company_id: companyId,
        p_balance_date: payload.balanceDate,
        p_notes: payload.notes || undefined,
        p_lines: payload.lines,
        p_user_id: userId,
      });

      if (error) throw error;
      await Promise.all([this.loadOpeningBalances(), this.loadAccountingPeriods(), this.loadCashAccounts()]);
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 9. JURNAL MEMORIAL / MANUAL (MANUAL JOURNALS)
  // ============================================================================

  async loadManualJournals(): Promise<ManualJournalItem[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const { data, error } = await this.supabase.client
        .from('journal_entry')
        .select(
          `
          id, entry_number, transaction_date, entry_type, memo, description,
          status, reversal_of_id, posted_at,
          lines:journal_line(id, account_id, debit, credit, description, account:ledger_account!account_id(code, name))
        `
        )
        .eq('company_id', companyId)
        .order('transaction_date', { ascending: false })
        .limit(100);

      if (error) throw error;

      interface ManualJournalRawRow {
        id: string;
        entry_number: string;
        transaction_date: string;
        entry_type: string;
        memo: string;
        description: string;
        status: string;
        reversal_of_id: string | null;
        posted_at: string;
        lines?: {
          id: string;
          account_id: string;
          debit: number;
          credit: number;
          description: string | null;
          account?: { code: string; name: string } | null;
        }[];
      }

      const rows = (data || []) as unknown as ManualJournalRawRow[];
      const items: ManualJournalItem[] = rows.map((r) => ({
        id: r.id,
        entryNumber: r.entry_number,
        transactionDate: r.transaction_date,
        entryType: r.entry_type,
        memo: r.memo,
        description: r.description,
        status: r.status,
        reversalOfId: r.reversal_of_id,
        postedAt: r.posted_at,
        lines: (r.lines || []).map((l) => ({
          id: l.id,
          accountId: l.account_id,
          accountCode: l.account?.code || '-',
          accountName: l.account?.name || 'Akun',
          debit: Number(l.debit),
          credit: Number(l.credit),
          description: l.description,
        })),
      }));

      this.manualJournals.set(items);
      return items;
    } finally {
      this.loading.set(false);
    }
  }

  async postManualJournal(payload: {
    transactionDate: string;
    description: string;
    lines: { account_id: string; debit: number; credit: number; description?: string }[];
  }): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('post_manual_journal', {
        p_company_id: companyId,
        p_transaction_date: payload.transactionDate,
        p_description: payload.description,
        p_lines: payload.lines,
        p_user_id: userId,
      });

      if (error) throw error;
      await this.loadManualJournals();
    } finally {
      this.loading.set(false);
    }
  }

  async reverseManualJournal(journalId: string, reason: string): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('reverse_manual_journal', {
        p_company_id: companyId,
        p_journal_id: journalId,
        p_reason: reason,
        p_user_id: userId,
      });

      if (error) throw error;
      await this.loadManualJournals();
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 10. PENUTUPAN PERIODE AKUNTANSI (ACCOUNTING PERIODS)
  // ============================================================================

  async loadAccountingPeriods(): Promise<AccountingPeriodItem[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const { data, error } = await this.supabase.client
        .from('accounting_period')
        .select('*')
        .eq('company_id', companyId)
        .order('period_month', { ascending: false });

      if (error) throw error;

      const items: AccountingPeriodItem[] = (data || []).map((p) => ({
        id: p.id,
        periodMonth: p.period_month,
        startDate: p.start_date,
        endDate: p.end_date,
        status: p.status as AccountingPeriodItem['status'],
        state: p.state as AccountingPeriodItem['state'],
        openingState: p.opening_state as AccountingPeriodItem['openingState'],
        closeSummary: (p.close_summary as Record<string, unknown>) || null,
        closedAt: p.closed_at,
        closedByUserId: p.closed_by_user_id,
        reopenedAt: p.reopened_at,
        reopenReason: p.reopen_reason,
      }));

      this.accountingPeriods.set(items);
      const currentMonth = new Date().toISOString().slice(0, 7);
      const active = items.find((p) => p.periodMonth === currentMonth) || items[0] || null;
      this.activePeriod.set(active);

      return items;
    } finally {
      this.loading.set(false);
    }
  }

  async checkPeriodIntegrity(periodMonth: string): Promise<PeriodIntegrityCheckResult> {
    const companyId = await this.requireActiveCompanyId();
    const errors: string[] = [];

    const [year, month] = periodMonth.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const startDate = `${periodMonth}-01`;
    const endDate = `${periodMonth}-${String(lastDay).padStart(2, '0')}`;

    // 1. Cek Jurnal
    const { data: journalData } = await this.supabase.client
      .from('journal_entry')
      .select('id, journal_line(debit, credit)')
      .eq('company_id', companyId)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .eq('status', 'posted');

    let totalDebit = 0;
    let totalCredit = 0;
    interface JournalRowCheck {
      id: string;
      journal_line: { debit: number; credit: number }[];
    }
    const journals = (journalData || []) as unknown as JournalRowCheck[];
    for (const j of journals) {
      for (const line of j.journal_line || []) {
        totalDebit += Number(line.debit);
        totalCredit += Number(line.credit);
      }
    }
    const balancedJournals = totalDebit === totalCredit;
    if (!balancedJournals) {
      errors.push(`Jurnal umum tidak seimbang: Total Debit (Rp ${totalDebit.toLocaleString()}) != Total Kredit (Rp ${totalCredit.toLocaleString()}).`);
    }

    // 2. Cek Dokumen Draf Gantung
    const { count: draftCount } = await this.supabase.client
      .from('business_document')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('status', 'draft')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate);

    const pendingDrafts = draftCount || 0;
    if (pendingDrafts > 0) {
      errors.push(`Terdapat ${pendingDrafts} transaksi berstatus draf yang belum diselesaikan.`);
    }

    return {
      periodMonth,
      balancedJournals,
      totalDebit,
      totalCredit,
      pendingDrafts,
      cashReconciled: true,
      canClose: errors.length === 0,
      errors,
    };
  }

  async closePeriod(periodMonth: string): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('close_accounting_period', {
        p_company_id: companyId,
        p_period_month: periodMonth,
        p_user_id: userId,
      });

      if (error) throw error;
      await this.loadAccountingPeriods();
    } finally {
      this.loading.set(false);
    }
  }

  async reopenPeriod(periodMonth: string, reason: string): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('reopen_accounting_period', {
        p_company_id: companyId,
        p_period_month: periodMonth,
        p_reason: reason,
        p_user_id: userId,
      });

      if (error) throw error;
      await this.loadAccountingPeriods();
    } finally {
      this.loading.set(false);
    }
  }
}
