import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { OpeningBalanceComponent } from './opening-balance.component';
import { FinanceService } from '../../../core/services/finance.service';

describe('OpeningBalanceComponent', () => {
  let component: OpeningBalanceComponent;
  let fixture: ComponentFixture<OpeningBalanceComponent>;
  let mockFinanceService: any;

  beforeEach(async () => {
    mockFinanceService = {
      openingBalances: signal([
        {
          id: 'doc-sa-1',
          documentNumber: 'SA-202601-0001',
          transactionDate: '2026-01-01',
          totalAmount: 50000000,
          status: 'posted',
          notes: 'Saldo awal modal usaha',
          postedAt: '2026-01-01T00:00:00Z',
          lines: [
            { accountId: 'la-1', accountCode: '1-1.1.01', accountName: 'Kas', debit: 50000000, credit: 0, description: 'Saldo kas awal' },
            { accountId: 'la-3', accountCode: '3-1.1.01', accountName: 'Modal Disetor', debit: 0, credit: 50000000, description: 'Modal awal' },
          ],
        },
      ]),
      ledgerAccounts: signal([
        { id: 'la-1', code: '1-1.1.01', name: 'Kas Utama', account_type: 'asset', is_active: true },
        { id: 'la-2', code: '2-1.1.01', name: 'Hutang Usaha', account_type: 'liability', is_active: true },
        { id: 'la-3', code: '3-1.1.01', name: 'Modal Disetor', account_type: 'equity', is_active: true },
        { id: 'la-4', code: '3-3.0.00', name: 'Laba Tahun Berjalan', account_type: 'equity', is_active: true }, // Virtual presentation
        { id: 'la-5', code: '4-1.1.01', name: 'Pendapatan Penjualan', account_type: 'revenue', is_active: true }, // Nominal account
      ]),
      loading: signal(false),
      loadOpeningBalances: vi.fn().mockResolvedValue([]),
      loadLedgerAccounts: vi.fn().mockResolvedValue([]),
      postOpeningBalance: vi.fn().mockResolvedValue({ id: 'doc-new' }),
    };

    await TestBed.configureTestingModule({
      imports: [OpeningBalanceComponent],
      providers: [
        { provide: FinanceService, useValue: mockFinanceService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OpeningBalanceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create OpeningBalanceComponent and filter balance sheet accounts (excluding virtual 3-3.0.00 and nominal)', () => {
    expect(component).toBeTruthy();
    expect(mockFinanceService.loadLedgerAccounts).toHaveBeenCalled();
    expect(mockFinanceService.loadOpeningBalances).toHaveBeenCalled();

    // Accounts: la-1 (asset), la-2 (liability), la-3 (equity) -> 3 accounts (la-4 and la-5 excluded)
    expect(component.balanceSheetAccounts().length).toBe(3);
    expect(component.accountRows().length).toBe(3);
  });

  it('should track balancing real-time state', () => {
    expect(component.isBalanced()).toBe(false);
    expect(component.totalDebit()).toBe(0);
    expect(component.totalCredit()).toBe(0);

    // Set debit
    component.updateRow('la-1', { debit: 10000000 });
    expect(component.totalDebit()).toBe(10000000);
    expect(component.totalCredit()).toBe(0);
    expect(component.balanceDifference()).toBe(10000000);
    expect(component.isBalanced()).toBe(false);

    // Set credit to match
    component.updateRow('la-3', { credit: 10000000 });
    expect(component.totalDebit()).toBe(10000000);
    expect(component.totalCredit()).toBe(10000000);
    expect(component.balanceDifference()).toBe(0);
    expect(component.isBalanced()).toBe(true);
  });

  it('should validate and post opening balance when balanced', async () => {
    // Unbalanced should fail
    component.updateRow('la-1', { debit: 5000000 });
    await component.submitOpeningBalance();
    expect(component.errorMessage()).toContain('harus seimbang');

    // Make balanced
    component.updateRow('la-3', { credit: 5000000 });
    expect(component.isBalanced()).toBe(true);

    await component.submitOpeningBalance();
    expect(mockFinanceService.postOpeningBalance).toHaveBeenCalledWith({
      balanceDate: expect.any(String),
      notes: expect.any(String),
      lines: [
        { account_id: 'la-1', debit: 5000000, credit: 0, description: undefined },
        { account_id: 'la-3', debit: 0, credit: 5000000, description: undefined },
      ],
    });
    expect(component.activeView()).toBe('history');
    expect(component.successMessage()).toContain('berhasil diposting');
  });
});
