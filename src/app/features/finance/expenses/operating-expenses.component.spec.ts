import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { OperatingExpensesComponent } from './operating-expenses.component';
import { FinanceService } from '../../../core/services/finance.service';
import { MasterDataService } from '../../../core/services/master-data.service';
import { CompanyService } from '../../../core/services/company.service';

describe('OperatingExpensesComponent', () => {
  let component: OperatingExpensesComponent;
  let fixture: ComponentFixture<OperatingExpensesComponent>;
  let mockFinanceService: any;
  let mockMasterDataService: any;
  let mockCompanyService: any;

  beforeEach(async () => {
    mockFinanceService = {
      operatingExpenses: signal([
        {
          id: 'exp-1',
          documentNumber: 'BO-202609-0001',
          transactionDate: '2026-09-13',
          totalAmount: 750000,
          fundingMethod: 'cash',
          cashAccountId: 'ca-1',
          cashAccountName: 'Kas Kecil',
          supplierId: null,
          supplierName: null,
          notes: 'Biaya operasional kantor',
          status: 'posted',
          voidReason: null,
          lines: [
            {
              id: 'line-1',
              accountId: 'la-exp-1',
              accountCode: '5-1.1.01',
              accountName: 'Beban ATK',
              description: 'Kertas & Tinta Printer',
              amount: 750000,
            },
          ],
          postedAt: '2026-09-13T10:00:00Z',
        },
        {
          id: 'exp-2',
          documentNumber: 'BO-202609-0002',
          transactionDate: '2026-09-12',
          totalAmount: 1200000,
          fundingMethod: 'payable',
          cashAccountId: null,
          cashAccountName: null,
          supplierId: 'sup-1',
          supplierName: 'PT Vendor Servis',
          notes: 'Servis AC berkala',
          status: 'void',
          voidReason: 'Salah jumlah tagihan',
          lines: [
            {
              id: 'line-2',
              accountId: 'la-exp-2',
              accountCode: '5-1.1.02',
              accountName: 'Beban Pemeliharaan',
              description: 'Servis AC Ruang Jahit',
              amount: 1200000,
            },
          ],
          postedAt: '2026-09-12T10:00:00Z',
        },
      ]),
      cashAccounts: signal([
        { id: 'ca-1', name: 'Kas Kecil', code: '1-1.1.01', balance: 3000000, isActive: true },
      ]),
      ledgerAccounts: signal([
        { id: 'la-exp-1', code: '5-1.1.01', name: 'Beban ATK', account_type: 'expense', is_active: true },
        { id: 'la-exp-2', code: '5-1.1.02', name: 'Beban Pemeliharaan', account_type: 'expense', is_active: true },
        { id: 'la-asset-1', code: '1-1.1.01', name: 'Kas Kecil', account_type: 'asset', is_active: true },
      ]),
      loading: signal(false),
      loadOperatingExpenses: vi.fn().mockResolvedValue([]),
      loadCashAccounts: vi.fn().mockResolvedValue([]),
      loadLedgerAccounts: vi.fn().mockResolvedValue([]),
      postOperatingExpense: vi.fn().mockResolvedValue({ id: 'doc-new' }),
      voidOperatingExpense: vi.fn().mockResolvedValue({}),
    };

    mockMasterDataService = {
      getSuppliers: vi.fn().mockResolvedValue([
        { id: 'sup-1', name: 'PT Vendor Servis', code: 'SUP-001', is_active: true },
      ]),
    };

    mockCompanyService = {
      activeCompanyId: signal('comp-1'),
    };

    await TestBed.configureTestingModule({
      imports: [OperatingExpensesComponent],
      providers: [
        { provide: FinanceService, useValue: mockFinanceService },
        { provide: MasterDataService, useValue: mockMasterDataService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OperatingExpensesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create OperatingExpensesComponent and compute metrics', () => {
    expect(component).toBeTruthy();
    expect(mockFinanceService.loadOperatingExpenses).toHaveBeenCalled();
    expect(mockFinanceService.loadCashAccounts).toHaveBeenCalled();
    expect(mockFinanceService.loadLedgerAccounts).toHaveBeenCalled();

    expect(component.expenseAccounts().length).toBe(2);
    expect(component.totalCashExpenses()).toBe(750000);
    expect(component.totalPayableExpenses()).toBe(0); // exp-2 is void
    expect(component.totalVoidExpensesCount()).toBe(1);
  });

  it('should filter operating expenses by query, status, and method', () => {
    expect(component.filteredExpenses().length).toBe(2);

    component.searchQuery.set('ATK');
    expect(component.filteredExpenses().length).toBe(1);
    expect(component.filteredExpenses()[0].id).toBe('exp-1');

    component.searchQuery.set('');
    component.statusFilter.set('void');
    expect(component.filteredExpenses().length).toBe(1);
    expect(component.filteredExpenses()[0].id).toBe('exp-2');

    component.statusFilter.set('all');
    component.fundingMethodFilter.set('cash');
    expect(component.filteredExpenses().length).toBe(1);
    expect(component.filteredExpenses()[0].fundingMethod).toBe('cash');
  });

  it('should manage multi-line expense creation', () => {
    component.openCreateModal();
    expect(component.isCreateModalOpen()).toBe(true);
    expect(component.expenseLines().length).toBe(1);

    component.addLine();
    expect(component.expenseLines().length).toBe(2);

    component.updateLine(0, { accountId: 'la-exp-1', description: 'ATK Toko', amount: 50000 });
    component.updateLine(1, { accountId: 'la-exp-2', description: 'Ganti Lampu', amount: 100000 });
    expect(component.totalFormAmount()).toBe(150000);

    component.removeLine(1);
    expect(component.expenseLines().length).toBe(1);
    expect(component.totalFormAmount()).toBe(50000);
  });

  it('should validate and post new operating expense', async () => {
    component.openCreateModal();
    component.fundingMethod.set('cash');
    component.selectedCashAccountId.set('ca-1');
    component.expenseDate.set('2026-09-13');
    component.updateLine(0, { accountId: 'la-exp-1', description: 'Beli Lakban', amount: 50000 });

    await component.submitExpense();
    expect(mockFinanceService.postOperatingExpense).toHaveBeenCalledWith({
      fundingMethod: 'cash',
      cashAccountId: 'ca-1',
      supplierId: undefined,
      expenseDate: '2026-09-13',
      notes: undefined,
      lines: [
        {
          account_id: 'la-exp-1',
          description: 'Beli Lakban',
          amount: 50000,
        },
      ],
    });
    expect(component.isCreateModalOpen()).toBe(false);
    expect(component.successMessage()).toContain('berhasil dicatat');
  });

  it('should void an existing operating expense', async () => {
    const expense = mockFinanceService.operatingExpenses()[0];
    component.openVoidModal(expense);
    expect(component.selectedExpenseForVoid()).toBe(expense);

    // Empty reason should fail
    component.voidReason.set('');
    await component.submitVoid();
    expect(component.errorMessage()).toContain('Alasan pembatalan');

    // Valid reason
    component.voidReason.set('Salah posting');
    await component.submitVoid();
    expect(mockFinanceService.voidOperatingExpense).toHaveBeenCalledWith(
      'exp-1',
      'Salah posting'
    );
    expect(component.selectedExpenseForVoid()).toBeNull();
    expect(component.successMessage()).toContain('berhasil dibatalkan');
  });
});
