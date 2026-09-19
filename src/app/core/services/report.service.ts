import { inject, Injectable, signal } from '@angular/core';
import { CompanyService } from './company.service';
import { SupabaseService } from './supabase.service';

export interface TrialBalanceAccountItem {
  id: string;
  code: string;
  name: string;
  level1: string;
  level2: string;
  level3: string;
  accountType: string;
  normalBalance: 'debit' | 'credit';
  reportSign: 'positive' | 'negative';
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
  openingBalance: number;
  periodMovement: number;
  closingBalance: number;
}

export interface TrialBalanceSummary {
  companyId: string;
  dateFrom: string;
  dateTo: string;
  isBalanced: boolean;
  difference: number;
  summary: {
    totalOpeningDebit: number;
    totalOpeningCredit: number;
    totalPeriodDebit: number;
    totalPeriodCredit: number;
    totalClosingDebit: number;
    totalClosingCredit: number;
    difference: number;
    isBalanced: boolean;
  };
  accounts: TrialBalanceAccountItem[];
}

export interface ProfitLossItem {
  id: string;
  code: string;
  name: string;
  level2: string;
  level3: string;
  amount: number;
}

export interface ProfitLossSummary {
  companyId: string;
  dateFrom: string;
  dateTo: string;
  grossSales: number;
  salesDeductions: number;
  netRevenue: number;
  totalCogs: number;
  grossProfit: number;
  totalOperatingExpenses: number;
  operatingProfit: number;
  totalOtherIncome: number;
  totalOtherExpenses: number;
  netIncome: number;
  grossProfitMargin: number;
  netProfitMargin: number;
  sections: {
    sales: ProfitLossItem[];
    salesDeductions: ProfitLossItem[];
    cogs: ProfitLossItem[];
    operatingExpenses: ProfitLossItem[];
    otherIncome: ProfitLossItem[];
    otherExpenses: ProfitLossItem[];
  };
}

export interface BalanceSheetItem {
  id: string;
  code: string;
  name: string;
  level2: string;
  level3: string;
  amount: number;
  isContra?: boolean;
}

export interface BalanceSheetSummary {
  companyId: string;
  asOfDate: string;
  totalCurrentAssets: number;
  totalFixedAssets: number;
  totalOtherAssets: number;
  totalAssets: number;
  totalCurrentLiabilities: number;
  totalLongTermLiabilities: number;
  totalLiabilities: number;
  totalGlEquity: number;
  priorYearUnclosedEarnings: number;
  currentYearEarnings: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  difference: number;
  isBalanced: boolean;
  sections: {
    currentAssets: BalanceSheetItem[];
    fixedAssets: BalanceSheetItem[];
    otherAssets: BalanceSheetItem[];
    currentLiabilities: BalanceSheetItem[];
    longTermLiabilities: BalanceSheetItem[];
    equity: BalanceSheetItem[];
  };
}

export interface CashFlowMovementItem {
  id: string;
  date: string;
  amount: number;
  activity: 'operating' | 'investing' | 'financing';
  group: string;
  documentKind?: string;
  documentNumber?: string;
  notes?: string;
}

export interface CashFlowSummary {
  companyId: string;
  dateFrom: string;
  dateTo: string;
  openingCashBalance: number;
  closingCashBalance: number;
  netCashChange: number;
  operatingActivities: {
    customerReceipts: number;
    supplierPayments: number;
    payrollAndOperating: number;
    otherOperating: number;
    netOperatingCashFlow: number;
  };
  investingActivities: {
    assetPurchases: number;
    assetDisposals: number;
    otherInvesting: number;
    netInvestingCashFlow: number;
  };
  financingActivities: {
    ownerContributions: number;
    ownerDrawings: number;
    debtFinancing: number;
    otherFinancing: number;
    netFinancingCashFlow: number;
  };
  reconciliation: {
    cashMovementBalance: number;
    glCashBalance: number;
    difference: number;
    isMatched: boolean;
  };
  items: CashFlowMovementItem[];
}

export interface GeneralLedgerEntry {
  id: string;
  journalEntryId: string;
  entryNumber: string;
  transactionDate: string;
  documentNumber?: string;
  documentKind?: string;
  memo?: string;
  description?: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface GeneralLedgerReport {
  account: {
    id: string;
    code: string;
    name: string;
    level1: string;
    level2: string;
    level3: string;
    accountType: string;
    normalBalance: 'debit' | 'credit';
    reportSign: 'positive' | 'negative';
  };
  dateFrom: string;
  dateTo: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  endingBalance: number;
  totalCount: number;
  limit: number;
  offset: number;
  entries: GeneralLedgerEntry[];
}

export interface HppMaterialItem {
  itemId: string;
  itemName: string;
  quantityUsed: number;
  totalCost: number;
}

export interface HppProductItem {
  productId: string;
  sku: string;
  name: string;
  quantityProduced: number;
  quantitySold: number;
  totalProductionCost: number;
  totalSoldCogs: number;
  actualHppPerUnit: number;
  bomStandardHpp: number;
  variance: number;
  variancePercent: number;
}

export interface HppManufacturingSummary {
  companyId: string;
  dateFrom: string;
  dateTo: string;
  directMaterialCost: number;
  directLaborCost: number;
  laborBreakdown: {
    cutting: number;
    printing: number;
    sewing: number;
    packing: number;
    headFee: number;
  };
  factoryOverhead: number;
  overheadBreakdown: {
    supplies: number;
    depreciation: number;
    other: number;
  };
  totalManufacturingCost: number;
  cogsReconciliation: {
    actualCogs: number;
    glCogs: number;
    difference: number;
    isMatched: boolean;
  };
  materialsBreakdown: HppMaterialItem[];
  productsBreakdown: HppProductItem[];
}

export interface ReconciliationItem {
  key: string;
  title: string;
  category: string;
  subledgerAmount: number;
  glAmount: number;
  variance: number;
  isMatched: boolean;
  controlAccountCode: string;
}

export interface AccountingReconciliationSummary {
  companyId: string;
  asOfDate: string;
  allMatched: boolean;
  matchedCount: number;
  totalCount: number;
  items: ReconciliationItem[];
}

export interface CoaAccountOption {
  id: string;
  code: string;
  name: string;
  level1: string;
  level2: string;
  level3: string;
  accountType: string;
  normalBalance: 'debit' | 'credit';
}

function extractErrorMessage(err: unknown, defaultMessage: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return defaultMessage;
}

function getDefaultDates(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return {
    dateFrom: `${year}-${month}-01`,
    dateTo: `${year}-${month}-${day}`,
  };
}

@Injectable({
  providedIn: 'root',
})
export class ReportService {
  private readonly supabase = inject(SupabaseService);
  private readonly companyService = inject(CompanyService);

  private readonly defaultDates = getDefaultDates();

  // Signals Filter Reaktif
  readonly dateFrom = signal<string>(this.defaultDates.dateFrom);
  readonly dateTo = signal<string>(this.defaultDates.dateTo);
  readonly selectedAccountId = signal<string | null>(null);

  // Signals State Reaktif
  readonly trialBalance = signal<TrialBalanceSummary | null>(null);
  readonly profitLoss = signal<ProfitLossSummary | null>(null);
  readonly balanceSheet = signal<BalanceSheetSummary | null>(null);
  readonly cashFlow = signal<CashFlowSummary | null>(null);
  readonly generalLedger = signal<GeneralLedgerReport | null>(null);
  readonly hppSummary = signal<HppManufacturingSummary | null>(null);
  readonly reconciliation = signal<AccountingReconciliationSummary | null>(null);
  readonly availableAccounts = signal<CoaAccountOption[]>([]);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  private async getActiveCompanyId(): Promise<string> {
    let companyId = this.companyService.activeCompanyId();
    if (!companyId) {
      companyId = await this.companyService.waitForActiveCompany();
    }
    if (!companyId) {
      throw new Error('Tidak ada perusahaan aktif terpilih.');
    }
    return companyId;
  }

  setDateRange(from: string, to: string): void {
    this.dateFrom.set(from);
    this.dateTo.set(to);
  }

  setSelectedAccountId(accountId: string | null): void {
    this.selectedAccountId.set(accountId);
  }

  async loadAvailableAccounts(): Promise<CoaAccountOption[]> {
    try {
      const companyId = await this.getActiveCompanyId();
      const { data, error } = await this.supabase.client
        .from('ledger_account')
        .select('id, code, name, level1, level2, level3, account_type, normal_balance')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('code', { ascending: true });

      if (error) throw error;
      const accounts: CoaAccountOption[] = (data || []).map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        level1: row.level1,
        level2: row.level2,
        level3: row.level3,
        accountType: row.account_type,
        normalBalance: row.normal_balance as 'debit' | 'credit',
      }));
      this.availableAccounts.set(accounts);
      return accounts;
    } catch (err: unknown) {
      console.error('Gagal memuat daftar akun COA:', err);
      return [];
    }
  }

  async loadTrialBalance(dateFrom?: string, dateTo?: string): Promise<TrialBalanceSummary | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const companyId = await this.getActiveCompanyId();
      const from = dateFrom ?? this.dateFrom();
      const to = dateTo ?? this.dateTo();

      const { data, error } = await this.supabase.client.rpc('get_trial_balance', {
        p_company_id: companyId,
        p_date_from: from,
        p_date_to: to,
      });

      if (error) throw error;
      const result = data as unknown as TrialBalanceSummary;
      this.trialBalance.set(result);
      return result;
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Gagal memuat Neraca Saldo');
      this.error.set(msg);
      console.error(msg, err);
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  async loadProfitLoss(dateFrom?: string, dateTo?: string): Promise<ProfitLossSummary | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const companyId = await this.getActiveCompanyId();
      const from = dateFrom ?? this.dateFrom();
      const to = dateTo ?? this.dateTo();

      const { data, error } = await this.supabase.client.rpc('get_profit_loss', {
        p_company_id: companyId,
        p_date_from: from,
        p_date_to: to,
      });

      if (error) throw error;
      const result = data as unknown as ProfitLossSummary;
      this.profitLoss.set(result);
      return result;
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Gagal memuat Laporan Laba Rugi');
      this.error.set(msg);
      console.error(msg, err);
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  async loadBalanceSheet(asOfDate?: string): Promise<BalanceSheetSummary | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const companyId = await this.getActiveCompanyId();
      const to = asOfDate ?? this.dateTo();

      const { data, error } = await this.supabase.client.rpc('get_balance_sheet', {
        p_company_id: companyId,
        p_date_to: to,
      });

      if (error) throw error;
      const result = data as unknown as BalanceSheetSummary;
      this.balanceSheet.set(result);
      return result;
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Gagal memuat Laporan Neraca');
      this.error.set(msg);
      console.error(msg, err);
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  async loadCashFlow(dateFrom?: string, dateTo?: string): Promise<CashFlowSummary | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const companyId = await this.getActiveCompanyId();
      const from = dateFrom ?? this.dateFrom();
      const to = dateTo ?? this.dateTo();

      const { data, error } = await this.supabase.client.rpc('get_cash_flow_statement', {
        p_company_id: companyId,
        p_date_from: from,
        p_date_to: to,
      });

      if (error) throw error;
      const result = data as unknown as CashFlowSummary;
      this.cashFlow.set(result);
      return result;
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Gagal memuat Laporan Arus Kas');
      this.error.set(msg);
      console.error(msg, err);
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  async loadGeneralLedger(
    accountId?: string | null,
    dateFrom?: string,
    dateTo?: string,
    limit = 50,
    offset = 0
  ): Promise<GeneralLedgerReport | null> {
    const accId = accountId ?? this.selectedAccountId();
    if (!accId) {
      this.generalLedger.set(null);
      return null;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const companyId = await this.getActiveCompanyId();
      const from = dateFrom ?? this.dateFrom();
      const to = dateTo ?? this.dateTo();

      const { data, error } = await this.supabase.client.rpc('get_general_ledger_entries', {
        p_company_id: companyId,
        p_account_id: accId,
        p_date_from: from,
        p_date_to: to,
        p_limit: limit,
        p_offset: offset,
      });

      if (error) throw error;
      const result = data as unknown as GeneralLedgerReport;
      this.generalLedger.set(result);
      return result;
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Gagal memuat Buku Besar');
      this.error.set(msg);
      console.error(msg, err);
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  async loadHppSummary(dateFrom?: string, dateTo?: string): Promise<HppManufacturingSummary | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const companyId = await this.getActiveCompanyId();
      const from = dateFrom ?? this.dateFrom();
      const to = dateTo ?? this.dateTo();

      const { data, error } = await this.supabase.client.rpc('get_hpp_manufacturing_summary', {
        p_company_id: companyId,
        p_date_from: from,
        p_date_to: to,
      });

      if (error) throw error;
      const result = data as unknown as HppManufacturingSummary;
      this.hppSummary.set(result);
      return result;
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Gagal memuat Laporan HPP Manufaktur');
      this.error.set(msg);
      console.error(msg, err);
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  async loadReconciliation(asOfDate?: string): Promise<AccountingReconciliationSummary | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const companyId = await this.getActiveCompanyId();
      const to = asOfDate ?? this.dateTo();

      const { data, error } = await this.supabase.client.rpc('get_accounting_reconciliation_summary', {
        p_company_id: companyId,
        p_as_of_date: to,
      });

      if (error) throw error;
      const result = data as unknown as AccountingReconciliationSummary;
      this.reconciliation.set(result);
      return result;
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Gagal memuat Rekonsiliasi Akuntansi');
      this.error.set(msg);
      console.error(msg, err);
      return null;
    } finally {
      this.loading.set(false);
    }
  }
}
