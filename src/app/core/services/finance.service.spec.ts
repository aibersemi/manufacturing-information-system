import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { User } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { FinanceService } from './finance.service';
import { SupabaseService } from './supabase.service';

describe('FinanceService', () => {
  let service: FinanceService;
  let mockSupabase: any;
  let mockAuthService: any;
  let mockCompanyService: any;

  const mockUser: User = {
    id: 'user-finance-1',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    email: 'finance@mis.mrmads.net',
  };

  beforeEach(() => {
    mockSupabase = {
      client: {
        from: vi.fn(),
        rpc: vi.fn(),
      },
    };

    mockAuthService = {
      currentUser: vi.fn().mockReturnValue(mockUser),
    };

    mockCompanyService = {
      activeCompanyId: signal('company-finance-123'),
      waitForActiveCompany: vi.fn().mockResolvedValue('company-finance-123'),
    };

    TestBed.configureTestingModule({
      providers: [
        FinanceService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: AuthService, useValue: mockAuthService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    });

    service = TestBed.inject(FinanceService);
  });

  it('should initialize with default empty signals', () => {
    expect(service.ledgerAccounts()).toEqual([]);
    expect(service.systemMappings()).toEqual([]);
    expect(service.reportMappings()).toEqual([]);
    expect(service.cashAccounts()).toEqual([]);
    expect(service.cashMovements()).toEqual([]);
    expect(service.cashTransfers()).toEqual([]);
    expect(service.operatingExpenses()).toEqual([]);
    expect(service.wageLiabilities()).toEqual([]);
    expect(service.prepaidExpenses()).toEqual([]);
    expect(service.openingBalances()).toEqual([]);
    expect(service.manualJournals()).toEqual([]);
    expect(service.accountingPeriods()).toEqual([]);
    expect(service.activePeriod()).toBeNull();
    expect(service.loading()).toBe(false);
  });

  describe('Ledger Accounts & Status', () => {
    it('should load ledger accounts into signal', async () => {
      const mockAccounts = [
        { id: 'acc-1', code: '1-1.1.01', name: 'Kas Kecil', is_active: true, version: 1 },
        { id: 'acc-2', code: '2-1.1.01', name: 'Hutang Usaha', is_active: true, version: 1 },
      ];

      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockAccounts, error: null }),
      };
      mockSupabase.client.from.mockReturnValue(chain);

      const res = await service.loadLedgerAccounts();
      expect(res).toEqual(mockAccounts);
      expect(service.ledgerAccounts()).toEqual(mockAccounts);
    });

    it('should update account status via RPC', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: { id: 'acc-1', is_active: false, version: 2 },
        error: null,
      });

      service.ledgerAccounts.set([
        { id: 'acc-1', code: '1-1.1.01', name: 'Kas Kecil', is_active: true, version: 1 } as any,
      ]);

      await service.updateAccountStatus('acc-1', false);
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('update_ledger_account_status', {
        p_company_id: 'company-finance-123',
        p_account_id: 'acc-1',
        p_is_active: false,
        p_user_id: 'user-finance-1',
      });
      expect(service.ledgerAccounts()[0].is_active).toBe(false);
    });
  });

  describe('Cash Transfer', () => {
    it('should post cash transfer via RPC', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: { documentId: 'doc-tr-1', status: 'posted' },
        error: null,
      });

      // Mock chain for subsequent load calls
      const emptyChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      mockSupabase.client.from.mockReturnValue(emptyChain);

      await service.postCashTransfer({
        sourceCashId: 'cash-src',
        destinationCashId: 'cash-dst',
        amount: 500000,
        transferDate: '2026-09-13',
        notes: 'Transfer operasional',
      });

      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('post_cash_transfer', {
        p_company_id: 'company-finance-123',
        p_source_cash_id: 'cash-src',
        p_destination_cash_id: 'cash-dst',
        p_amount: 500000,
        p_transfer_date: '2026-09-13',
        p_notes: 'Transfer operasional',
        p_user_id: 'user-finance-1',
      });
    });
  });

  describe('Operating Expenses', () => {
    it('should post operating expense via RPC', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: { documentId: 'doc-bo-1', status: 'posted' },
        error: null,
      });

      const emptyChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      mockSupabase.client.from.mockReturnValue(emptyChain);

      await service.postOperatingExpense({
        fundingMethod: 'cash',
        cashAccountId: 'cash-1',
        expenseDate: '2026-09-13',
        notes: 'Biaya listrik',
        lines: [{ account_id: 'acc-exp', description: 'Listrik kantor', amount: 350000 }],
      });

      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('post_operating_expense', {
        p_company_id: 'company-finance-123',
        p_funding_method: 'cash',
        p_cash_account_id: 'cash-1',
        p_supplier_id: undefined,
        p_expense_date: '2026-09-13',
        p_notes: 'Biaya listrik',
        p_lines: [{ account_id: 'acc-exp', description: 'Listrik kantor', amount: 350000 }],
        p_user_id: 'user-finance-1',
      });
    });

    it('should void operating expense via RPC', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: { documentId: 'doc-bo-1', status: 'void' },
        error: null,
      });

      const emptyChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      mockSupabase.client.from.mockReturnValue(emptyChain);

      await service.voidOperatingExpense('doc-bo-1', 'Salah input nominal');

      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('void_operating_expense', {
        p_company_id: 'company-finance-123',
        p_document_id: 'doc-bo-1',
        p_reason: 'Salah input nominal',
        p_user_id: 'user-finance-1',
      });
    });
  });

  describe('Prepaid Expenses', () => {
    it('should create prepaid expense and post amortization', async () => {
      mockSupabase.client.rpc.mockResolvedValue({ data: { id: 'prep-1' }, error: null });

      const emptyChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      mockSupabase.client.from.mockReturnValue(emptyChain);

      await service.createPrepaidExpense({
        description: 'Sewa Gedung 1 Tahun',
        prepaidAccountId: 'acc-prepaid',
        expenseAccountId: 'acc-expense',
        startDate: '2026-09-01',
        numberOfMonths: 12,
        originalAmount: 12000000,
      });

      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('create_prepaid_expense', {
        p_company_id: 'company-finance-123',
        p_description: 'Sewa Gedung 1 Tahun',
        p_prepaid_account_id: 'acc-prepaid',
        p_expense_account_id: 'acc-expense',
        p_start_date: '2026-09-01',
        p_number_of_months: 12,
        p_original_amount: 12000000,
        p_user_id: 'user-finance-1',
      });

      await service.postPrepaidAmortization('prep-1', '2026-09');
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('post_prepaid_amortization', {
        p_company_id: 'company-finance-123',
        p_prepaid_id: 'prep-1',
        p_period_month: '2026-09',
        p_user_id: 'user-finance-1',
      });
    });
  });

  describe('Accounting Period Close and Reopen', () => {
    it('should close and reopen period via RPC', async () => {
      mockSupabase.client.rpc.mockResolvedValue({ data: { status: 'closed' }, error: null });

      const emptyChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      mockSupabase.client.from.mockReturnValue(emptyChain);

      await service.closePeriod('2026-09');
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('close_accounting_period', {
        p_company_id: 'company-finance-123',
        p_period_month: '2026-09',
        p_user_id: 'user-finance-1',
      });

      await service.reopenPeriod('2026-09', 'Perlu penyesuaian memorial');
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('reopen_accounting_period', {
        p_company_id: 'company-finance-123',
        p_period_month: '2026-09',
        p_reason: 'Perlu penyesuaian memorial',
        p_user_id: 'user-finance-1',
      });
    });
  });
});
