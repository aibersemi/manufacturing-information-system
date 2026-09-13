import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SalesOrdersComponent } from './sales-orders.component';
import { CustomerOrder, SalesService } from '../../../core/services/sales.service';

describe('SalesOrdersComponent', () => {
  let component: SalesOrdersComponent;
  let fixture: ComponentFixture<SalesOrdersComponent>;
  let mockSalesService: any;
  let mockRouter: any;

  const mockOrders: CustomerOrder[] = [
    {
      id: 'po-1',
      companyId: 'company-123',
      documentNumber: 'PO-260913-001',
      transactionDate: '2026-09-13',
      counterpartyId: 'cust-1',
      customerName: 'Toko Baju Jaya',
      totalAmount: 2000000,
      paidAmount: 0,
      status: 'posted',
      poStatus: 'open',
      deliveryStatus: 'unshipped',
      targetDeliveryDate: '2026-09-20',
      notes: 'Pesanan kaos',
      createdAt: '2026-09-13T00:00:00Z',
      lines: [
        {
          id: 'line-1',
          company_id: 'company-123',
          document_id: 'po-1',
          line_number: 1,
          item_id: 'prod-1',
          account_id: null,
          description: 'Kaos Cotton 30s',
          unit_code: 'pcs',
          conversion_factor: 1,
          quantity: 40,
          unit_price: 50000,
          subtotal: 2000000,
          total_amount: 2000000,
          data: {},
          revision: 1,
          is_current: true,
          version: 1,
          created_at: '2026-09-13T00:00:00Z',
          product: { id: 'prod-1', name: 'Kaos Cotton 30s', sku: 'TS-30S' },
        },
      ],
    },
  ];

  beforeEach(async () => {
    mockSalesService = {
      customerOrders: signal(mockOrders),
      loading: signal(false),
      getActiveCustomers: vi.fn().mockResolvedValue([
        { id: 'cust-1', name: 'Toko Baju Jaya' },
      ]),
      getActiveProducts: vi.fn().mockResolvedValue([
        { id: 'prod-1', name: 'Kaos Cotton 30s', sku: 'TS-30S' },
      ]),
      getCustomerOrders: vi.fn().mockResolvedValue(mockOrders),
      createCustomerOrder: vi.fn().mockResolvedValue({
        success: true,
        documentNumber: 'PO-260913-002',
      }),
    };

    mockRouter = {
      navigate: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SalesOrdersComponent],
      providers: [
        { provide: SalesService, useValue: mockSalesService },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SalesOrdersComponent);
    component = fixture.componentInstance;
  });

  it('should create and load initial data', async () => {
    expect(component).toBeTruthy();
    await component.loadInitialData();
    expect(mockSalesService.getActiveCustomers).toHaveBeenCalled();
    expect(mockSalesService.getActiveProducts).toHaveBeenCalled();
    expect(component.customers().length).toBe(1);
    expect(component.products().length).toBe(1);
    expect(component.orders().length).toBe(1);
  });

  it('should calculate KPI metrics accurately', () => {
    expect(component.totalOrderAmount()).toBe(2000000);
    expect(component.totalOrderedQty()).toBe(40);
    expect(component.openOrdersCount()).toBe(1);
  });

  it('should open create modal with default values', () => {
    component.products.set([{ id: 'prod-1', name: 'Kaos', sku: 'TS-1' } as any]);
    component.openCreateModal();

    expect(component.isModalOpen()).toBe(true);
    expect(component.formLines().length).toBe(1);
    expect(component.formLines()[0].itemId).toBe('prod-1');
  });

  it('should validate form customer before submitting order', async () => {
    component.formCustomerId.set('');
    await component.submitOrder();
    expect(component.formError()).toBe('Pelanggan wajib dipilih.');
  });

  it('should navigate to sales invoice when createInvoiceFromOrder is called', () => {
    component.createInvoiceFromOrder(mockOrders[0]);
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/workspace/sales'], {
      queryParams: { poId: 'po-1', customerId: 'cust-1' },
    });
  });
});
