import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { WagePaymentsComponent } from './wage-payments.component';
import { FinanceService } from '../../../core/services/finance.service';

describe('WagePaymentsComponent', () => {
  let component: WagePaymentsComponent;
  let fixture: ComponentFixture<WagePaymentsComponent>;
  let mockFinanceService: any;

  beforeEach(async () => {
    mockFinanceService = {
      wageLiabilities: signal([
        {
          id: 'wl-1',
          employeeId: 'emp-1',
          employeeName: 'Budi Santoso',
          serviceKind: 'cutting',
          quantity: 100,
          rate: 1500,
          grossAmount: 150000,
          paidAmount: 0,
          outstandingAmount: 150000,
          isPaid: false,
          postedAt: '2026-09-13T08:00:00Z',
          sourceDocumentNumber: 'SPK-202609-0001',
        },
        {
          id: 'wl-2',
          employeeId: 'emp-1',
          employeeName: 'Budi Santoso',
          serviceKind: 'cutting',
          quantity: 50,
          rate: 1500,
          grossAmount: 75000,
          paidAmount: 0,
          outstandingAmount: 75000,
          isPaid: false,
          postedAt: '2026-09-13T09:00:00Z',
          sourceDocumentNumber: 'SPK-202609-0002',
        },
        {
          id: 'wl-3',
          employeeId: 'emp-2',
          employeeName: 'Siti Aminah',
          serviceKind: 'sewing',
          quantity: 80,
          rate: 2500,
          grossAmount: 200000,
          paidAmount: 200000,
          outstandingAmount: 0,
          isPaid: true,
          postedAt: '2026-09-12T08:00:00Z',
          sourceDocumentNumber: 'SPK-202609-0003',
        },
      ]),
      cashAccounts: signal([
        { id: 'ca-1', name: 'Kas Utama', code: '1-1.1.01', balance: 1000000, isActive: true },
      ]),
      loading: signal(false),
      loadWageLiabilities: vi.fn().mockResolvedValue([]),
      loadCashAccounts: vi.fn().mockResolvedValue([]),
      postWagePayment: vi.fn().mockResolvedValue({ id: 'doc-payment' }),
    };

    await TestBed.configureTestingModule({
      imports: [WagePaymentsComponent],
      providers: [
        { provide: FinanceService, useValue: mockFinanceService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WagePaymentsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create WagePaymentsComponent and compute KPI metrics', () => {
    expect(component).toBeTruthy();
    expect(mockFinanceService.loadWageLiabilities).toHaveBeenCalled();
    expect(mockFinanceService.loadCashAccounts).toHaveBeenCalled();

    expect(component.totalUnpaidLiability()).toBe(225000); // 150000 + 75000
    expect(component.totalPaidAmount()).toBe(200000);
    expect(component.unpaidOperatorsCount()).toBe(1); // Only Budi has unpaid
    expect(component.totalLiabilitiesCount()).toBe(3);
  });

  it('should filter liabilities by status, service kind, and search query', () => {
    // Default status is 'unpaid'
    expect(component.filteredLiabilities().length).toBe(2);

    // Filter to 'paid'
    component.statusFilter.set('paid');
    expect(component.filteredLiabilities().length).toBe(1);
    expect(component.filteredLiabilities()[0].employeeName).toBe('Siti Aminah');

    // Filter to 'all'
    component.statusFilter.set('all');
    expect(component.filteredLiabilities().length).toBe(3);

    // Search query
    component.searchQuery.set('SPK-202609-0002');
    expect(component.filteredLiabilities().length).toBe(1);
    expect(component.filteredLiabilities()[0].id).toBe('wl-2');
  });

  it('should handle multi-selection and prevent mixing operators', () => {
    const item1 = mockFinanceService.wageLiabilities()[0]; // Budi
    const item2 = mockFinanceService.wageLiabilities()[1]; // Budi
    const item3 = mockFinanceService.wageLiabilities()[2]; // Siti (paid)

    // Select first item
    component.toggleSelectLiability(item1);
    expect(component.selectedLiabilityIds()).toEqual(['wl-1']);
    expect(component.selectedTotalAmount()).toBe(150000);
    expect(component.activeSelectedEmployee()?.id).toBe('emp-1');

    // Select second item from same operator
    component.toggleSelectLiability(item2);
    expect(component.selectedLiabilityIds()).toEqual(['wl-1', 'wl-2']);
    expect(component.selectedTotalAmount()).toBe(225000);

    // Paid item cannot be selected
    component.toggleSelectLiability(item3);
    expect(component.selectedLiabilityIds()).toEqual(['wl-1', 'wl-2']);

    // Unselect item1
    component.toggleSelectLiability(item1);
    expect(component.selectedLiabilityIds()).toEqual(['wl-2']);
  });

  it('should validate and post wage payment', async () => {
    const item1 = mockFinanceService.wageLiabilities()[0];
    component.toggleSelectLiability(item1);

    component.openPaymentModal();
    expect(component.isPaymentModalOpen()).toBe(true);

    // Validation: insufficient balance
    component.selectedCashAccountId.set('ca-1');
    mockFinanceService.cashAccounts.set([
      { id: 'ca-1', name: 'Kas Utama', code: '1-1.1.01', balance: 50000, isActive: true },
    ]);
    await component.submitPayment();
    expect(component.errorMessage()).toContain('Saldo rekening kas tidak mencukupi');

    // Valid balance
    mockFinanceService.cashAccounts.set([
      { id: 'ca-1', name: 'Kas Utama', code: '1-1.1.01', balance: 1000000, isActive: true },
    ]);
    await component.submitPayment();
    expect(mockFinanceService.postWagePayment).toHaveBeenCalledWith({
      employeeId: 'emp-1',
      cashAccountId: 'ca-1',
      paymentDate: expect.any(String),
      liabilityIds: ['wl-1'],
      notes: expect.any(String),
    });
    expect(component.isPaymentModalOpen()).toBe(false);
    expect(component.successMessage()).toContain('berhasil diposting');
    expect(component.selectedLiabilityIds().length).toBe(0);
  });
});
