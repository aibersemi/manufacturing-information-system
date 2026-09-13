import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { User } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import {
  CreateCustomerOrderPayload,
  CreateSalesInvoicePayload,
  PostSalesReceiptPayload,
  SalesService,
} from './sales.service';
import { SupabaseService } from './supabase.service';

describe('SalesService', () => {
  let service: SalesService;
  let mockSupabase: any;
  let mockAuthService: any;
  let mockCompanyService: any;

  const mockUser: User = {
    id: 'user-sales-1',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    email: 'sales@example.com',
  };

  beforeEach(() => {
    mockSupabase = {
      client: {
        from: vi.fn(),
        rpc: vi.fn(),
      },
    };

    mockAuthService = {
      currentUser: vi.fn().mockReturnValue(mockUser),
    };

    mockCompanyService = {
      activeCompanyId: signal('company-123'),
      waitForActiveCompany: vi.fn().mockResolvedValue('company-123'),
    };

    TestBed.configureTestingModule({
      providers: [
        SalesService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: AuthService, useValue: mockAuthService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    });

    service = TestBed.inject(SalesService);
  });

  describe('Customer Orders (Customer PO)', () => {
    it('should fetch customer orders and update signal', async () => {
      const mockOrders = [
        {
          id: 'po-1',
          company_id: 'company-123',
          document_number: 'PO-260913-001',
          transaction_date: '2026-09-13',
          counterparty_id: 'cust-1',
          total_amount: 1000000,
          paid_amount: 0,
          status: 'posted',
          data: { poStatus: 'open', deliveryStatus: 'unshipped', targetDeliveryDate: '2026-09-20' },
          created_at: '2026-09-13T00:00:00Z',
          customer: { id: 'cust-1', name: 'Distro Bandung' },
          lines: [
            {
              id: 'line-1',
              line_number: 1,
              item_id: 'prod-1',
              quantity: 20,
              unit_price: 50000,
              total_amount: 1000000,
              product: { id: 'prod-1', name: 'Kaos Polos', sku: 'TS-001' },
            },
          ],
        },
      ];

      const queryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: any) => resolve({ data: mockOrders, error: null }),
      };

      mockSupabase.client.from.mockReturnValue(queryBuilder);

      const result = await service.getCustomerOrders();
      expect(result.length).toBe(1);
      expect(result[0].documentNumber).toBe('PO-260913-001');
      expect(result[0].customerName).toBe('Distro Bandung');
      expect(service.customerOrders().length).toBe(1);
    });

    it('should call create_customer_po rpc when creating order', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: { success: true, id: 'po-1', documentNumber: 'PO-260913-001', totalAmount: 1000000 },
        error: null,
      });

      // Mock getCustomerOrders internal query
      const queryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      mockSupabase.client.from.mockReturnValue(queryBuilder);

      const payload: CreateCustomerOrderPayload = {
        customerId: 'cust-1',
        orderDate: '2026-09-13',
        targetDeliveryDate: '2026-09-25',
        notes: 'Order kaos seragam',
        lines: [
          { itemId: 'prod-1', quantity: 20, unitPrice: 50000 },
        ],
      };

      const res = await service.createCustomerOrder(payload);
      expect(res.success).toBe(true);
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('create_customer_po', expect.objectContaining({
        p_company_id: 'company-123',
        p_customer_id: 'cust-1',
      }));
    });
  });

  describe('Sales Invoices', () => {
    it('should call create_sales_invoice rpc when creating draft invoice', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: { success: true, id: 'inv-1', totalAmount: 1000000 },
        error: null,
      });

      const queryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      mockSupabase.client.from.mockReturnValue(queryBuilder);

      const payload: CreateSalesInvoicePayload = {
        customerId: 'cust-1',
        poId: 'po-1',
        invoiceDate: '2026-09-13',
        fundingMethod: 'receivable',
        lines: [
          { itemId: 'prod-1', quantity: 20, unitPrice: 50000 },
        ],
      };

      const res = await service.createSalesInvoiceDraft(payload);
      expect(res.success).toBe(true);
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('create_sales_invoice', expect.objectContaining({
        p_company_id: 'company-123',
        p_customer_id: 'cust-1',
        p_po_id: 'po-1',
      }));
    });

    it('should call post_sales_invoice rpc when posting invoice', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: { success: true, id: 'inv-1', documentNumber: 'INV-202609-0001', totalAmount: 1000000, cogsTotal: 600000 },
        error: null,
      });

      const queryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      mockSupabase.client.from.mockReturnValue(queryBuilder);

      const res = await service.postSalesInvoice('inv-1');
      expect(res.success).toBe(true);
      expect(res.documentNumber).toBe('INV-202609-0001');
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('post_sales_invoice', {
        p_document_id: 'inv-1',
        p_user_id: 'user-sales-1',
      });
    });

    it('should call void_sales_invoice rpc when voiding invoice', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: { success: true, id: 'inv-1', status: 'void' },
        error: null,
      });

      const queryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      mockSupabase.client.from.mockReturnValue(queryBuilder);

      const res = await service.voidSalesInvoice('inv-1', 'Salah input barang');
      expect(res.success).toBe(true);
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('void_sales_invoice', {
        p_document_id: 'inv-1',
        p_user_id: 'user-sales-1',
        p_reason: 'Salah input barang',
      });
    });
  });

  describe('Sales Receipts', () => {
    it('should call post_sales_receipt rpc when paying invoice', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: { success: true, receiptId: 'km-1', receiptNumber: 'KM-260913-001', paidAmount: 500000, remainingBalance: 500000 },
        error: null,
      });

      const queryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        filter: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      mockSupabase.client.from.mockReturnValue(queryBuilder);

      const payload: PostSalesReceiptPayload = {
        invoiceId: 'inv-1',
        cashAccountId: 'cash-1',
        amount: 500000,
        date: '2026-09-13',
        notes: 'Cicilan 1',
      };

      const res = await service.payInvoice(payload);
      expect(res.success).toBe(true);
      expect(res.receiptNumber).toBe('KM-260913-001');
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('post_sales_receipt', {
        p_invoice_id: 'inv-1',
        p_cash_account_id: 'cash-1',
        p_amount: 500000,
        p_receipt_date: '2026-09-13',
        p_notes: 'Cicilan 1',
        p_user_id: 'user-sales-1',
      });
    });
  });

  describe('Fulfillment Summary', () => {
    it('should call get_sales_fulfillment_summary rpc and set summary signal', async () => {
      const mockSummary = {
        totalOrders: 5,
        totalOrderedQty: 500,
        totalDeliveredQty: 300,
        totalRemainingQty: 200,
        totalOrderAmount: 25000000,
        items: [],
      };

      mockSupabase.client.rpc.mockResolvedValue({
        data: mockSummary,
        error: null,
      });

      const res = await service.getFulfillmentSummary();
      expect(res.totalOrders).toBe(5);
      expect(res.totalOrderedQty).toBe(500);
      expect(service.fulfillmentSummary()).toEqual(mockSummary);
    });
  });
});
