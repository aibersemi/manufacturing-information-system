import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SalesReceiptsComponent } from './sales-receipts.component';
import { SalesInvoice, SalesReceipt, SalesService } from '../../../core/services/sales.service';

describe('SalesReceiptsComponent', () => {
  let component: SalesReceiptsComponent;
  let fixture: ComponentFixture<SalesReceiptsComponent>;
  let mockSalesService: any;

  const mockReceivableInvoices: SalesInvoice[] = [
    {
      id: 'inv-1',
      companyId: 'company-123',
      documentNumber: 'INV-202609-0001',
      transactionDate: '2026-09-13',
      counterpartyId: 'cust-1',
      customerName: 'Toko Baju Jaya',
      totalAmount: 1500000,
      paidAmount: 500000,
      outstandingAmount: 1000000,
      status: 'posted',
      paymentStatus: 'Sebagian Dibayar',
      fundingMethod: 'receivable',
      notes: '',
      createdAt: '2026-09-13T00:00:00Z',
    },
  ];

  const mockReceipts: SalesReceipt[] = [
    {
      id: 'rc-1',
      companyId: 'company-123',
      receiptNumber: 'KM-260913-001',
      transactionDate: '2026-09-13',
      customerId: 'cust-1',
      customerName: 'Toko Baju Jaya',
      sourceInvoiceId: 'inv-1',
      invoiceNumber: 'INV-202609-0001',
      amount: 500000,
      cashAccountId: 'cash-1',
      cashAccountName: 'Kas Utama',
      notes: 'DP Pesanan',
      createdAt: '2026-09-13T00:00:00Z',
    },
  ];

  beforeEach(async () => {
    mockSalesService = {
      receivableInvoices: signal(mockReceivableInvoices),
      salesReceipts: signal(mockReceipts),
      loading: signal(false),
      getCashAccounts: vi.fn().mockResolvedValue([
        { id: 'cash-1', name: 'Kas Utama' },
      ]),
      getReceivableInvoices: vi.fn().mockResolvedValue(mockReceivableInvoices),
      getReceiptHistory: vi.fn().mockResolvedValue(mockReceipts),
      payInvoice: vi.fn().mockResolvedValue({
        success: true,
        receiptNumber: 'KM-260913-002',
      }),
    };

    await TestBed.configureTestingModule({
      imports: [SalesReceiptsComponent],
      providers: [
        { provide: SalesService, useValue: mockSalesService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SalesReceiptsComponent);
    component = fixture.componentInstance;
  });

  it('should create and calculate KPI metrics correctly', () => {
    expect(component).toBeTruthy();
    expect(component.totalOutstandingAR()).toBe(1000000);
    expect(component.totalReceiptsAmount()).toBe(500000);
    expect(component.outstandingInvoicesCount()).toBe(1);
  });

  it('should open pay modal and populate default full payment amount', () => {
    component.cashAccounts.set([{ id: 'cash-1', name: 'Kas Utama' } as any]);
    component.openPayModal(mockReceivableInvoices[0]);

    expect(component.isPayModalOpen()).toBe(true);
    expect(component.selectedInvoice()?.id).toBe('inv-1');
    expect(component.formAmount()).toBe(1000000);
    expect(component.formCashAccountId()).toBe('cash-1');
  });

  it('should validate payment amount when submitting', async () => {
    component.selectedInvoice.set(mockReceivableInvoices[0]);
    component.formAmount.set(0);
    await component.submitPayment();
    expect(component.formError()).toBe('Jumlah pembayaran harus lebih besar dari Rp 0.');

    component.formAmount.set(2000000);
    await component.submitPayment();
    expect(component.formError()).toContain('tidak boleh melebihi sisa piutang');
  });

  it('should submit valid payment successfully', async () => {
    component.selectedInvoice.set(mockReceivableInvoices[0]);
    component.formAmount.set(500000);
    component.formCashAccountId.set('cash-1');
    component.formReceiptDate.set('2026-09-13');

    await component.submitPayment();
    expect(mockSalesService.payInvoice).toHaveBeenCalledWith(expect.objectContaining({
      invoiceId: 'inv-1',
      cashAccountId: 'cash-1',
      amount: 500000,
    }));
    expect(component.isPayModalOpen()).toBe(false);
  });
});
