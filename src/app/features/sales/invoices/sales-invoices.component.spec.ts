import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SalesInvoicesComponent } from './sales-invoices.component';
import { SalesInvoice, SalesService } from '../../../core/services/sales.service';

describe('SalesInvoicesComponent', () => {
  let component: SalesInvoicesComponent;
  let fixture: ComponentFixture<SalesInvoicesComponent>;
  let mockSalesService: any;

  const mockInvoices: SalesInvoice[] = [
    {
      id: 'inv-1',
      companyId: 'company-123',
      documentNumber: 'INV-202609-0001',
      transactionDate: '2026-09-13',
      counterpartyId: 'cust-1',
      customerName: 'Toko Baju Jaya',
      sourceDocumentId: 'po-1',
      sourceOrderNumber: 'PO-260913-001',
      totalAmount: 1500000,
      paidAmount: 500000,
      outstandingAmount: 1000000,
      status: 'posted',
      paymentStatus: 'Sebagian Dibayar',
      fundingMethod: 'receivable',
      notes: 'Faktur pengiriman 1',
      createdAt: '2026-09-13T00:00:00Z',
      lines: [],
    },
  ];

  beforeEach(async () => {
    mockSalesService = {
      salesInvoices: signal(mockInvoices),
      loading: signal(false),
      getActiveCustomers: vi.fn().mockResolvedValue([
        { id: 'cust-1', name: 'Toko Baju Jaya' },
      ]),
      getActiveProducts: vi.fn().mockResolvedValue([
        { id: 'prod-1', name: 'Kaos Cotton 30s', sku: 'TS-30S' },
      ]),
      getCashAccounts: vi.fn().mockResolvedValue([
        { id: 'cash-1', name: 'Kas Utama' },
      ]),
      getCustomerOrders: vi.fn().mockResolvedValue([]),
      getSalesInvoices: vi.fn().mockResolvedValue(mockInvoices),
      createSalesInvoiceDraft: vi.fn().mockResolvedValue({ id: 'inv-draft-1' }),
      postSalesInvoice: vi.fn().mockResolvedValue({ success: true, documentNumber: 'INV-202609-0002' }),
      voidSalesInvoice: vi.fn().mockResolvedValue({ success: true }),
    };

    await TestBed.configureTestingModule({
      imports: [SalesInvoicesComponent],
      providers: [
        { provide: SalesService, useValue: mockSalesService },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParams: signal({}),
            subscribe: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SalesInvoicesComponent);
    component = fixture.componentInstance;
  });

  it('should create and calculate KPI metrics accurately', () => {
    expect(component).toBeTruthy();
    expect(component.totalSalesAmount()).toBe(1500000);
    expect(component.totalOutstandingAR()).toBe(1000000);
    expect(component.postedInvoicesCount()).toBe(1);
  });

  it('should open modal with default direct sales form', () => {
    component.customers.set([{ id: 'cust-1', name: 'Toko Baju Jaya' } as any]);
    component.openCreateModal();

    expect(component.isModalOpen()).toBe(true);
    expect(component.formSourceType()).toBe('direct');
    expect(component.formCustomerId()).toBe('cust-1');
  });

  it('should validate customer when saving draft invoice', async () => {
    component.formCustomerId.set('');
    await component.submitInvoiceDraft();
    expect(component.formError()).toBe('Pelanggan wajib dipilih.');
  });

  it('should open void modal and handle invoice cancellation', async () => {
    component.openVoidModal(mockInvoices[0]);
    expect(component.isVoidModalOpen()).toBe(true);
    expect(component.voidInvoiceId()).toBe('inv-1');

    component.voidReason.set('Kelebihan kuantitas kirim');
    await component.confirmVoid();

    expect(mockSalesService.voidSalesInvoice).toHaveBeenCalledWith('inv-1', 'Kelebihan kuantitas kirim');
    expect(component.isVoidModalOpen()).toBe(false);
  });
});
