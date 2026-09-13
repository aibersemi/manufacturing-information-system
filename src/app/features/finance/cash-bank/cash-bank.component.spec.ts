import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { CashBankComponent } from './cash-bank.component';
import { FinanceService } from '../../../core/services/finance.service';

describe('CashBankComponent', () => {
  let component: CashBankComponent;
  let fixture: ComponentFixture<CashBankComponent>;
  let mockFinanceService: any;

  beforeEach(async () => {
    mockFinanceService = {
      cashAccounts: signal([
        { id: 'ca-1', name: 'Kas Utama', code: '1-1.1.01', balance: 5000000, isActive: true, ledgerAccountId: 'la-1', ledgerAccountCode: '1-1.1.01', ledgerAccountName: 'Kas' },
        { id: 'ca-2', name: 'Bank BCA', code: '1-1.2.01', balance: 25000000, isActive: true, ledgerAccountId: 'la-2', ledgerAccountCode: '1-1.2.01', ledgerAccountName: 'Bank BCA' },
      ]),
      cashMovements: signal([
        {
          id: 'cm-1',
          companyId: 'comp-1',
          cashAccountId: 'ca-1',
          cashAccountName: 'Kas Utama',
          movementType: 'revenue',
          amount: 1500000,
          transactionDate: '2026-09-13',
          notes: 'Penerimaan Penjualan',
          sourceDocumentId: null,
          pairedMovementId: null,
          reversalOfId: null,
          postedAt: new Date().toISOString(),
        },
        {
          id: 'cm-2',
          companyId: 'comp-1',
          cashAccountId: 'ca-2',
          cashAccountName: 'Bank BCA',
          movementType: 'expense',
          amount: 500000,
          transactionDate: '2026-09-13',
          notes: 'Biaya Listrik',
          sourceDocumentId: null,
          pairedMovementId: null,
          reversalOfId: null,
          postedAt: new Date().toISOString(),
        },
      ]),
      cashTransfers: signal([
        {
          id: 'ct-1',
          documentNumber: 'TRF-202609-0001',
          sourceCashAccountId: 'ca-2',
          sourceCashAccountName: 'Bank BCA',
          destinationCashAccountId: 'ca-1',
          destinationCashAccountName: 'Kas Utama',
          amount: 2000000,
          transactionDate: '2026-09-13',
          notes: 'Tarik tunai kas kecil',
          status: 'posted',
          postedAt: new Date().toISOString(),
        },
      ]),
      loading: signal(false),
      loadCashAccounts: vi.fn().mockResolvedValue([]),
      loadCashMovements: vi.fn().mockResolvedValue([]),
      loadCashTransfers: vi.fn().mockResolvedValue([]),
      postCashTransfer: vi.fn().mockResolvedValue({ id: 'doc-1', documentNumber: 'TRF-202609-0002' }),
    };

    await TestBed.configureTestingModule({
      imports: [CashBankComponent],
      providers: [
        { provide: FinanceService, useValue: mockFinanceService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CashBankComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create CashBankComponent and calculate total cash balance', () => {
    expect(component).toBeTruthy();
    expect(mockFinanceService.loadCashAccounts).toHaveBeenCalled();
    expect(mockFinanceService.loadCashMovements).toHaveBeenCalled();
    expect(mockFinanceService.loadCashTransfers).toHaveBeenCalled();
    expect(component.totalCashBalance()).toBe(30000000);
    expect(component.activeAccountsCount()).toBe(2);
    expect(component.totalTransfersCount()).toBe(1);
  });

  it('should filter cash movements by query and type', () => {
    expect(component.filteredMovements().length).toBe(2);

    component.searchQuery.set('Listrik');
    expect(component.filteredMovements().length).toBe(1);
    expect(component.filteredMovements()[0].id).toBe('cm-2');

    component.searchQuery.set('');
    component.movementTypeFilter.set('in');
    expect(component.filteredMovements().length).toBe(1);
    expect(component.filteredMovements()[0].movementType).toBe('revenue');

    component.movementTypeFilter.set('out');
    expect(component.filteredMovements().length).toBe(1);
    expect(component.filteredMovements()[0].movementType).toBe('expense');
  });

  it('should validate and post cash transfer', async () => {
    component.openTransferModal();
    expect(component.isTransferModalOpen()).toBe(true);

    // Invalid: same source and destination
    component.transferSourceId.set('ca-1');
    component.transferDestinationId.set('ca-1');
    component.transferAmount.set(100000);
    await component.submitTransfer();
    expect(component.errorMessage()).toContain('tidak boleh sama');

    // Invalid: amount exceeds balance
    component.transferDestinationId.set('ca-2');
    component.transferAmount.set(10000000); // balance is 5000000
    await component.submitTransfer();
    expect(component.errorMessage()).toContain('tidak mencukupi');

    // Valid transfer
    component.transferAmount.set(1000000);
    await component.submitTransfer();
    expect(mockFinanceService.postCashTransfer).toHaveBeenCalledWith({
      sourceCashId: 'ca-1',
      destinationCashId: 'ca-2',
      amount: 1000000,
      transferDate: expect.any(String),
      notes: undefined,
    });
    expect(component.isTransferModalOpen()).toBe(false);
    expect(component.successMessage()).toContain('berhasil diposting');
  });
});
