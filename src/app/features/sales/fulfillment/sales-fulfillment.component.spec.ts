import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SalesFulfillmentComponent } from './sales-fulfillment.component';
import { SalesFulfillmentSummary, SalesService } from '../../../core/services/sales.service';

describe('SalesFulfillmentComponent', () => {
  let component: SalesFulfillmentComponent;
  let fixture: ComponentFixture<SalesFulfillmentComponent>;
  let mockSalesService: any;

  const mockSummary: SalesFulfillmentSummary = {
    totalOrders: 2,
    totalOrderedQty: 100,
    totalDeliveredQty: 60,
    totalRemainingQty: 40,
    totalOrderAmount: 5000000,
    items: [
      {
        id: 'po-1',
        poNumber: 'PO-260913-001',
        orderDate: '2026-09-13',
        customerId: 'cust-1',
        customerName: 'Toko Baju Jaya',
        targetDeliveryDate: '2026-09-20',
        poStatus: 'open',
        deliveryStatus: 'partial_delivery',
        totalOrderedQty: 100,
        totalDeliveredQty: 60,
        remainingQty: 40,
        totalAmount: 5000000,
        fulfillmentRate: 60,
        lines: [
          {
            lineId: 'line-1',
            itemId: 'prod-1',
            productName: 'Kaos Cotton 30s',
            sku: 'TS-30S',
            orderedQty: 100,
            deliveredQty: 60,
            remainingQty: 40,
            unitPrice: 50000,
            unitCode: 'pcs',
          },
        ],
        invoiceHistory: [
          {
            invoiceId: 'inv-1',
            invoiceNumber: 'INV-202609-0001',
            invoiceDate: '2026-09-13',
            totalAmount: 3000000,
            paidAmount: 3000000,
            status: 'posted',
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    mockSalesService = {
      fulfillmentSummary: signal(mockSummary),
      loading: signal(false),
      getFulfillmentSummary: vi.fn().mockResolvedValue(mockSummary),
    };

    await TestBed.configureTestingModule({
      imports: [SalesFulfillmentComponent],
      providers: [
        { provide: SalesService, useValue: mockSalesService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SalesFulfillmentComponent);
    component = fixture.componentInstance;
  });

  it('should create and compute overall fulfillment rate', () => {
    expect(component).toBeTruthy();
    expect(component.summary()).toEqual(mockSummary);
    expect(component.overallFulfillmentRate()).toBe(60);
    expect(component.items().length).toBe(1);
  });

  it('should filter items by delivery status', () => {
    component.statusFilter.set('partial_delivery');
    expect(component.filteredItems().length).toBe(1);

    component.statusFilter.set('full_delivery');
    expect(component.filteredItems().length).toBe(0);
  });

  it('should open and close SKU detail modal', () => {
    component.openDetailModal(mockSummary.items[0]);
    expect(component.isDetailModalOpen()).toBe(true);
    expect(component.selectedItem()?.poNumber).toBe('PO-260913-001');

    component.closeDetailModal();
    expect(component.isDetailModalOpen()).toBe(false);
    expect(component.selectedItem()).toBeNull();
  });
});
