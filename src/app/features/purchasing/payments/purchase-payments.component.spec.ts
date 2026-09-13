import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanyService } from '../../../core/services/company.service';
import { PurchasingInventoryService } from '../../../core/services/purchasing-inventory.service';
import { PurchasePaymentsComponent } from './purchase-payments.component';

describe('PurchasePaymentsComponent', () => {
  let component: PurchasePaymentsComponent;
  let fixture: ComponentFixture<PurchasePaymentsComponent>;
  let mockPurchasingService: any;
  let mockCompanyService: any;

  beforeEach(async () => {
    mockPurchasingService = {
      getPayablePurchases: vi.fn().mockResolvedValue([
        {
          id: 'doc-1',
          document_number: 'BL-260913-001',
          total_amount: 3000000,
          paid_amount: 1000000,
          counterparty: { name: 'PT Kain Jaya' },
        },
      ]),
      getPaymentHistory: vi.fn().mockResolvedValue([
        {
          id: 'pay-1',
          document_number: 'KK-260913-001',
          total_amount: 1000000,
          transaction_date: '2026-09-13',
        },
      ]),
      getCashAccounts: vi.fn().mockResolvedValue([
        { id: 'cash-1', name: 'Bank BCA Operasional' },
      ]),
      payPurchase: vi.fn().mockResolvedValue({
        success: true,
        paymentNumber: 'KK-260913-002',
      }),
    };

    mockCompanyService = {
      activeCompanyId: signal('company-123'),
      waitForActiveCompany: vi.fn().mockResolvedValue('company-123'),
    };

    await TestBed.configureTestingModule({
      imports: [PurchasePaymentsComponent],
      providers: [
        { provide: PurchasingInventoryService, useValue: mockPurchasingService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PurchasePaymentsComponent);
    component = fixture.componentInstance;
  });

  it('should create and load payable purchases and history', async () => {
    expect(component).toBeTruthy();
    await component.loadData();
    expect(mockPurchasingService.getPayablePurchases).toHaveBeenCalled();
    expect(mockPurchasingService.getPaymentHistory).toHaveBeenCalled();
    expect(component.payablePurchases().length).toBe(1);
    expect(component.totalOutstanding()).toBe(2000000);
  });

  it('should open payment modal with pre-filled remaining balance', () => {
    const doc: any = {
      id: 'doc-1',
      document_number: 'BL-260913-001',
      total_amount: 3000000,
      paid_amount: 1000000,
    };
    component.cashAccounts.set([{ id: 'cash-1', name: 'Bank BCA' } as any]);
    component.openPaymentModal(doc);

    expect(component.isPayModalOpen()).toBe(true);
    expect(component.formAmount()).toBe(2000000);
    expect(component.formCashAccountId()).toBe('cash-1');
  });

  it('should reject payment amount exceeding remaining balance', async () => {
    const doc: any = {
      id: 'doc-1',
      total_amount: 3000000,
      paid_amount: 1000000,
    };
    component.selectedPurchase.set(doc);
    component.formCashAccountId.set('cash-1');
    component.formAmount.set(2500000);

    await component.submitPayment();
    expect(component.formError()).toContain('Jumlah pembayaran tidak boleh melebihi sisa hutang');
  });

  it('should process payment on valid submission', async () => {
    const doc: any = {
      id: 'doc-1',
      total_amount: 3000000,
      paid_amount: 1000000,
    };
    component.selectedPurchase.set(doc);
    component.formCashAccountId.set('cash-1');
    component.formAmount.set(1000000);

    await component.submitPayment();
    expect(mockPurchasingService.payPurchase).toHaveBeenCalledWith({
      purchaseId: 'doc-1',
      cashAccountId: 'cash-1',
      amount: 1000000,
      date: expect.any(String),
      notes: expect.any(String),
    });
    expect(component.isPayModalOpen()).toBe(false);
  });
});
