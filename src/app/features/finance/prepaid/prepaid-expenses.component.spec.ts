import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { PrepaidExpensesComponent } from './prepaid-expenses.component';
import { FinanceService } from '../../../core/services/finance.service';

describe('PrepaidExpensesComponent', () => {
  let component: PrepaidExpensesComponent;
  let fixture: ComponentFixture<PrepaidExpensesComponent>;
  let mockFinanceService: any;

  beforeEach(async () => {
    mockFinanceService = {
      prepaidExpenses: signal([
        {
          id: 'pe-1',
          description: 'Sewa Gedung 2026',
          prepaidAccountId: 'la-prep-1',
          prepaidAccountCode: '1-1.4.01',
          prepaidAccountName: 'Sewa Dibayar Dimuka',
          expenseAccountId: 'la-exp-1',
          expenseAccountCode: '5-1.2.01',
          expenseAccountName: 'Beban Sewa Gedung',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          numberOfMonths: 12,
          originalAmount: 12000000,
          amortizedAmount: 2000000,
          remainingAmount: 10000000,
          progressPercentage: 17,
          status: 'active',
          entries: [
            { periodMonth: '2026-01', amount: 1000000, postedAt: '2026-01-31' },
            { periodMonth: '2026-02', amount: 1000000, postedAt: '2026-02-28' },
          ],
        },
        {
          id: 'pe-2',
          description: 'Asuransi Mesin 2025',
          prepaidAccountId: 'la-prep-2',
          prepaidAccountCode: '1-1.4.02',
          prepaidAccountName: 'Asuransi Dibayar Dimuka',
          expenseAccountId: 'la-exp-2',
          expenseAccountCode: '5-1.2.02',
          expenseAccountName: 'Beban Asuransi',
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          numberOfMonths: 12,
          originalAmount: 6000000,
          amortizedAmount: 6000000,
          remainingAmount: 0,
          progressPercentage: 100,
          status: 'completed',
          entries: [],
        },
      ]),
      ledgerAccounts: signal([
        { id: 'la-prep-1', code: '1-1.4.01', name: 'Sewa Dibayar Dimuka', account_type: 'asset', is_active: true },
        { id: 'la-prep-2', code: '1-1.4.02', name: 'Asuransi Dibayar Dimuka', account_type: 'asset', is_active: true },
        { id: 'la-exp-1', code: '5-1.2.01', name: 'Beban Sewa Gedung', account_type: 'expense', is_active: true },
        { id: 'la-exp-2', code: '5-1.2.02', name: 'Beban Asuransi', account_type: 'expense', is_active: true },
      ]),
      loading: signal(false),
      loadPrepaidExpenses: vi.fn().mockResolvedValue([]),
      loadLedgerAccounts: vi.fn().mockResolvedValue([]),
      createPrepaidExpense: vi.fn().mockResolvedValue({ id: 'pe-new' }),
      postPrepaidAmortization: vi.fn().mockResolvedValue({}),
    };

    await TestBed.configureTestingModule({
      imports: [PrepaidExpensesComponent],
      providers: [
        { provide: FinanceService, useValue: mockFinanceService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PrepaidExpensesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create PrepaidExpensesComponent and compute KPI metrics', () => {
    expect(component).toBeTruthy();
    expect(mockFinanceService.loadPrepaidExpenses).toHaveBeenCalled();
    expect(mockFinanceService.loadLedgerAccounts).toHaveBeenCalled();

    expect(component.activeContractsCount()).toBe(1);
    expect(component.totalOriginalAmount()).toBe(12000000);
    expect(component.totalAmortizedAmount()).toBe(2000000);
    expect(component.totalRemainingAmount()).toBe(10000000);
  });

  it('should filter contracts by status and query', () => {
    // Default filter is 'active'
    expect(component.filteredExpenses().length).toBe(1);
    expect(component.filteredExpenses()[0].id).toBe('pe-1');

    // Filter 'completed'
    component.statusFilter.set('completed');
    expect(component.filteredExpenses().length).toBe(1);
    expect(component.filteredExpenses()[0].id).toBe('pe-2');

    // Filter 'all'
    component.statusFilter.set('all');
    expect(component.filteredExpenses().length).toBe(2);

    // Search query
    component.searchQuery.set('Asuransi');
    expect(component.filteredExpenses().length).toBe(1);
    expect(component.filteredExpenses()[0].id).toBe('pe-2');
  });

  it('should validate and create new prepaid contract', async () => {
    component.openCreateModal();
    expect(component.isCreateModalOpen()).toBe(true);

    component.description.set('Sewa Kantor 2026-2027');
    component.prepaidAccountId.set('la-prep-1');
    component.expenseAccountId.set('la-exp-1');
    component.startDate.set('2026-09-01');
    component.numberOfMonths.set(12);
    component.originalAmount.set(24000000);

    expect(component.calculateMonthlyEstimate()).toBe(2000000);

    await component.submitCreate();
    expect(mockFinanceService.createPrepaidExpense).toHaveBeenCalledWith({
      description: 'Sewa Kantor 2026-2027',
      prepaidAccountId: 'la-prep-1',
      expenseAccountId: 'la-exp-1',
      startDate: '2026-09-01',
      numberOfMonths: 12,
      originalAmount: 24000000,
    });
    expect(component.isCreateModalOpen()).toBe(false);
    expect(component.successMessage()).toContain('berhasil didaftarkan');
  });

  it('should validate and post amortization for an active contract', async () => {
    const item = mockFinanceService.prepaidExpenses()[0];
    component.openAmortizeModal(item);
    expect(component.selectedPrepaidForAmortize()).toBe(item);
    expect(component.getAmortizeMonthlyAmount()).toBe(1000000);

    // Duplicate month should fail validation
    component.amortizePeriodMonth.set('2026-01');
    await component.submitAmortize();
    expect(component.errorMessage()).toContain('sudah diamortisasi sebelumnya');

    // New month should succeed
    component.amortizePeriodMonth.set('2026-03');
    await component.submitAmortize();
    expect(mockFinanceService.postPrepaidAmortization).toHaveBeenCalledWith('pe-1', '2026-03');
    expect(component.isAmortizeModalOpen()).toBe(false);
    expect(component.successMessage()).toContain('berhasil diposting');
  });
});
