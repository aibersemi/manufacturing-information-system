import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanyService } from './company.service';
import { ReportService } from './report.service';
import { SupabaseService } from './supabase.service';

describe('ReportService', () => {
  let service: ReportService;
  let mockSupabase: {
    client: {
      from: ReturnType<typeof vi.fn>;
      rpc: ReturnType<typeof vi.fn>;
    };
  };
  let mockCompanyService: {
    activeCompanyId: ReturnType<typeof signal<string | null>>;
  };

  beforeEach(() => {
    mockSupabase = {
      client: {
        from: vi.fn(),
        rpc: vi.fn(),
      },
    };

    mockCompanyService = {
      activeCompanyId: signal('company-123'),
    };

    TestBed.configureTestingModule({
      providers: [
        ReportService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    });

    service = TestBed.inject(ReportService);
  });

  it('should initialize with default states and signals', () => {
    expect(service.trialBalance()).toBeNull();
    expect(service.profitLoss()).toBeNull();
    expect(service.balanceSheet()).toBeNull();
    expect(service.cashFlow()).toBeNull();
    expect(service.generalLedger()).toBeNull();
    expect(service.hppSummary()).toBeNull();
    expect(service.reconciliation()).toBeNull();
    expect(service.availableAccounts()).toEqual([]);
    expect(service.loading()).toBe(false);
    expect(service.error()).toBeNull();
    expect(service.dateFrom()).toBeDefined();
    expect(service.dateTo()).toBeDefined();
    expect(service.selectedAccountId()).toBeNull();
  });

  it('should set date range and selected account id', () => {
    service.setDateRange('2026-08-01', '2026-08-31');
    expect(service.dateFrom()).toBe('2026-08-01');
    expect(service.dateTo()).toBe('2026-08-31');

    service.setSelectedAccountId('acc-1');
    expect(service.selectedAccountId()).toBe('acc-1');
  });

  it('should load trial balance successfully', async () => {
    const mockResult = {
      companyId: 'company-123',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      isBalanced: true,
      difference: 0,
      summary: {
        totalOpeningDebit: 1000,
        totalOpeningCredit: 1000,
        totalPeriodDebit: 500,
        totalPeriodCredit: 500,
        totalClosingDebit: 1500,
        totalClosingCredit: 1500,
        difference: 0,
        isBalanced: true,
      },
      accounts: [],
    };

    mockSupabase.client.rpc.mockResolvedValueOnce({ data: mockResult, error: null });

    const result = await service.loadTrialBalance('2026-09-01', '2026-09-30');
    expect(mockSupabase.client.rpc).toHaveBeenCalledWith('get_trial_balance', {
      p_company_id: 'company-123',
      p_date_from: '2026-09-01',
      p_date_to: '2026-09-30',
    });
    expect(result).toEqual(mockResult);
    expect(service.trialBalance()).toEqual(mockResult);
    expect(service.loading()).toBe(false);
  });

  it('should load profit & loss statement successfully', async () => {
    const mockResult = {
      companyId: 'company-123',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      netRevenue: 10000000,
      grossProfit: 4000000,
      totalCogs: 6000000,
      totalOperatingExpenses: 1500000,
      operatingProfit: 2500000,
      totalOtherIncome: 100000,
      totalOtherExpenses: 50000,
      netIncome: 2550000,
      grossProfitMargin: 40,
      netProfitMargin: 25.5,
      sections: {
        sales: [],
        salesDeductions: [],
        cogs: [],
        operatingExpenses: [],
        otherIncome: [],
        otherExpenses: [],
      },
    };

    mockSupabase.client.rpc.mockResolvedValueOnce({ data: mockResult, error: null });

    const result = await service.loadProfitLoss('2026-09-01', '2026-09-30');
    expect(mockSupabase.client.rpc).toHaveBeenCalledWith('get_profit_loss', {
      p_company_id: 'company-123',
      p_date_from: '2026-09-01',
      p_date_to: '2026-09-30',
    });
    expect(result).toEqual(mockResult);
    expect(service.profitLoss()).toEqual(mockResult);
  });

  it('should load balance sheet successfully', async () => {
    const mockResult = {
      companyId: 'company-123',
      asOfDate: '2026-09-30',
      totalCurrentAssets: 5000000,
      totalFixedAssets: 10000000,
      totalOtherAssets: 0,
      totalAssets: 15000000,
      totalCurrentLiabilities: 3000000,
      totalLongTermLiabilities: 2000000,
      totalLiabilities: 5000000,
      totalGlEquity: 8000000,
      priorYearUnclosedEarnings: 1000000,
      currentYearEarnings: 1000000,
      totalEquity: 10000000,
      totalLiabilitiesAndEquity: 15000000,
      difference: 0,
      isBalanced: true,
      sections: {
        currentAssets: [],
        fixedAssets: [],
        otherAssets: [],
        currentLiabilities: [],
        longTermLiabilities: [],
        equity: [],
      },
    };

    mockSupabase.client.rpc.mockResolvedValueOnce({ data: mockResult, error: null });

    const result = await service.loadBalanceSheet('2026-09-30');
    expect(mockSupabase.client.rpc).toHaveBeenCalledWith('get_balance_sheet', {
      p_company_id: 'company-123',
      p_date_to: '2026-09-30',
    });
    expect(result).toEqual(mockResult);
    expect(service.balanceSheet()).toEqual(mockResult);
  });

  it('should load cash flow statement successfully', async () => {
    const mockResult = {
      companyId: 'company-123',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      openingCashBalance: 2000000,
      closingCashBalance: 3500000,
      netCashChange: 1500000,
      operatingActivities: {
        customerReceipts: 5000000,
        supplierPayments: -2000000,
        payrollAndOperating: -1500000,
        otherOperating: 0,
        netOperatingCashFlow: 1500000,
      },
      investingActivities: {
        assetPurchases: 0,
        assetDisposals: 0,
        otherInvesting: 0,
        netInvestingCashFlow: 0,
      },
      financingActivities: {
        ownerContributions: 0,
        ownerDrawings: 0,
        debtFinancing: 0,
        otherFinancing: 0,
        netFinancingCashFlow: 0,
      },
      reconciliation: {
        cashMovementBalance: 3500000,
        glCashBalance: 3500000,
        difference: 0,
        isMatched: true,
      },
      items: [],
    };

    mockSupabase.client.rpc.mockResolvedValueOnce({ data: mockResult, error: null });

    const result = await service.loadCashFlow('2026-09-01', '2026-09-30');
    expect(mockSupabase.client.rpc).toHaveBeenCalledWith('get_cash_flow_statement', {
      p_company_id: 'company-123',
      p_date_from: '2026-09-01',
      p_date_to: '2026-09-30',
    });
    expect(result).toEqual(mockResult);
    expect(service.cashFlow()).toEqual(mockResult);
  });

  it('should load general ledger entries successfully', async () => {
    const mockResult = {
      account: {
        id: 'acc-1',
        code: '1-1.1.01',
        name: 'Kas Kecil',
        level1: 'AKTIVA',
        level2: 'AKTIVA LANCAR',
        level3: 'KAS DAN BANK',
        accountType: 'asset',
        normalBalance: 'debit',
        reportSign: 'positive',
      },
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      openingBalance: 1000000,
      totalDebit: 500000,
      totalCredit: 200000,
      endingBalance: 1300000,
      totalCount: 2,
      limit: 50,
      offset: 0,
      entries: [
        {
          id: 'line-1',
          journalEntryId: 'je-1',
          entryNumber: 'JRN-001',
          transactionDate: '2026-09-05',
          documentNumber: 'TRM-001',
          documentKind: 'sales_receipt',
          memo: 'Penerimaan Penjualan',
          description: 'Kas Kecil',
          debit: 500000,
          credit: 0,
          runningBalance: 1500000,
        },
      ],
    };

    mockSupabase.client.rpc.mockResolvedValueOnce({ data: mockResult, error: null });

    const result = await service.loadGeneralLedger('acc-1', '2026-09-01', '2026-09-30', 50, 0);
    expect(mockSupabase.client.rpc).toHaveBeenCalledWith('get_general_ledger_entries', {
      p_company_id: 'company-123',
      p_account_id: 'acc-1',
      p_date_from: '2026-09-01',
      p_date_to: '2026-09-30',
      p_limit: 50,
      p_offset: 0,
    });
    expect(result).toEqual(mockResult);
    expect(service.generalLedger()).toEqual(mockResult);
  });

  it('should return null when loading general ledger without account id', async () => {
    service.setSelectedAccountId(null);
    const result = await service.loadGeneralLedger(null);
    expect(result).toBeNull();
    expect(service.generalLedger()).toBeNull();
  });

  it('should load HPP manufacturing summary successfully', async () => {
    const mockResult = {
      companyId: 'company-123',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      directMaterialCost: 20000000,
      directLaborCost: 8000000,
      laborBreakdown: {
        cutting: 2000000,
        printing: 2000000,
        sewing: 3000000,
        packing: 1000000,
        headFee: 0,
      },
      factoryOverhead: 4000000,
      overheadBreakdown: {
        supplies: 1500000,
        depreciation: 2000000,
        other: 500000,
      },
      totalManufacturingCost: 32000000,
      cogsReconciliation: {
        actualCogs: 18000000,
        glCogs: 18000000,
        difference: 0,
        isMatched: true,
      },
      materialsBreakdown: [],
      productsBreakdown: [],
    };

    mockSupabase.client.rpc.mockResolvedValueOnce({ data: mockResult, error: null });

    const result = await service.loadHppSummary('2026-09-01', '2026-09-30');
    expect(mockSupabase.client.rpc).toHaveBeenCalledWith('get_hpp_manufacturing_summary', {
      p_company_id: 'company-123',
      p_date_from: '2026-09-01',
      p_date_to: '2026-09-30',
    });
    expect(result).toEqual(mockResult);
    expect(service.hppSummary()).toEqual(mockResult);
  });

  it('should load accounting reconciliation summary successfully', async () => {
    const mockResult = {
      companyId: 'company-123',
      asOfDate: '2026-09-30',
      allMatched: true,
      matchedCount: 6,
      totalCount: 6,
      items: [
        {
          key: 'cash_bank',
          title: 'Kas & Bank',
          category: 'Kas & Setara Kas',
          subledgerAmount: 1000000,
          glAmount: 1000000,
          variance: 0,
          isMatched: true,
          controlAccountCode: '1-1.1.xx',
        },
      ],
    };

    mockSupabase.client.rpc.mockResolvedValueOnce({ data: mockResult, error: null });

    const result = await service.loadReconciliation('2026-09-30');
    expect(mockSupabase.client.rpc).toHaveBeenCalledWith('get_accounting_reconciliation_summary', {
      p_company_id: 'company-123',
      p_as_of_date: '2026-09-30',
    });
    expect(result).toEqual(mockResult);
    expect(service.reconciliation()).toEqual(mockResult);
  });

  it('should load available COA accounts successfully', async () => {
    const mockAccounts = [
      {
        id: 'acc-1',
        code: '1-1.1.01',
        name: 'Kas Kecil',
        level1: 'AKTIVA',
        level2: 'AKTIVA LANCAR',
        level3: 'KAS DAN BANK',
        account_type: 'asset',
        normal_balance: 'debit',
      },
    ];

    const queryMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValueOnce({ data: mockAccounts, error: null }),
    };
    mockSupabase.client.from.mockReturnValueOnce(queryMock as any);

    const result = await service.loadAvailableAccounts();
    expect(mockSupabase.client.from).toHaveBeenCalledWith('ledger_account');
    expect(result.length).toBe(1);
    expect(result[0].code).toBe('1-1.1.01');
    expect(service.availableAccounts().length).toBe(1);
  });

  it('should handle RPC error gracefully in loadTrialBalance', async () => {
    mockSupabase.client.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database query failed' },
    });

    const result = await service.loadTrialBalance();
    expect(result).toBeNull();
    expect(service.error()).toBe('Database query failed');
    expect(service.loading()).toBe(false);
  });
});
