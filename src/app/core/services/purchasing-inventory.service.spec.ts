import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { User } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { PurchasingInventoryService, PurchaseDraftPayload } from './purchasing-inventory.service';
import { SupabaseService } from './supabase.service';

describe('PurchasingInventoryService', () => {
  let service: PurchasingInventoryService;
  let mockSupabase: any;
  let mockAuthService: any;
  let mockCompanyService: any;

  const mockUser: User = {
    id: 'user-purchasing-1',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    email: 'purchasing@example.com',
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
        PurchasingInventoryService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: AuthService, useValue: mockAuthService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    });

    service = TestBed.inject(PurchasingInventoryService);
  });

  describe('Purchase Documents', () => {
    it('should validate empty lines when saving draft', async () => {
      const payload: PurchaseDraftPayload = {
        documentKind: 'purchase_material',
        counterpartyId: 'sup-1',
        transactionDate: '2026-09-13',
        fundingMethod: 'payable',
        lines: [],
      };

      await expect(service.savePurchaseDraft(payload)).rejects.toThrow(
        'Dokumen pembelian wajib memiliki minimal satu baris item.'
      );
    });

    it('should validate line quantity and price when saving draft', async () => {
      const payload: PurchaseDraftPayload = {
        documentKind: 'purchase_material',
        counterpartyId: 'sup-1',
        transactionDate: '2026-09-13',
        fundingMethod: 'payable',
        lines: [
          {
            description: 'Kain Katun Combed',
            unitCode: 'roll',
            conversionFactor: 25,
            quantity: 0,
            unitPrice: 1500000,
          },
        ],
      };

      await expect(service.savePurchaseDraft(payload)).rejects.toThrow(
        'Kuantitas baris 1 harus lebih dari 0.'
      );
    });

    it('should save purchase draft with calculated total amount and lines', async () => {
      const createdDoc = {
        id: 'doc-new-1',
        company_id: 'company-123',
        document_kind: 'purchase_material',
        status: 'draft',
        total_amount: 3000000,
      };

      const docInsertBuilder: any = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: createdDoc, error: null }),
      };

      const lineInsertBuilder: any = {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };

      mockSupabase.client.from.mockImplementation((table: string) => {
        if (table === 'business_document') return docInsertBuilder;
        if (table === 'business_document_line') return lineInsertBuilder;
        return {};
      });

      const payload: PurchaseDraftPayload = {
        documentKind: 'purchase_material',
        counterpartyId: 'sup-1',
        transactionDate: '2026-09-13',
        fundingMethod: 'payable',
        lines: [
          {
            description: 'Kain Katun Combed 30s',
            unitCode: 'roll',
            conversionFactor: 25,
            quantity: 2,
            unitPrice: 1500000,
          },
        ],
      };

      const res = await service.savePurchaseDraft(payload);
      expect(res.id).toBe('doc-new-1');
      expect(res.total_amount).toBe(3000000);
      expect(docInsertBuilder.insert).toHaveBeenCalled();
      expect(lineInsertBuilder.insert).toHaveBeenCalled();
    });

    it('should call RPC post_purchase_document on postPurchase', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: { success: true, documentNumber: 'BL-260913-001' },
        error: null,
      });

      const res = await service.postPurchase('doc-1');
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('post_purchase_document', {
        p_document_id: 'doc-1',
        p_user_id: 'user-purchasing-1',
      });
      expect(res.documentNumber).toBe('BL-260913-001');
    });

    it('should require reason on voidPurchase and call RPC', async () => {
      await expect(service.voidPurchase('doc-1', '  ')).rejects.toThrow(
        'Alasan pembatalan (void) wajib dicantumkan.'
      );

      mockSupabase.client.rpc.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const res = await service.voidPurchase('doc-1', 'Salah input harga supplier');
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('void_purchase_document', {
        p_document_id: 'doc-1',
        p_user_id: 'user-purchasing-1',
        p_reason: 'Salah input harga supplier',
      });
      expect(res.success).toBe(true);
    });
  });

  describe('Purchase Payments', () => {
    it('should validate payment payload and call post_purchase_payment RPC', async () => {
      await expect(
        service.payPurchase({
          purchaseId: 'doc-1',
          cashAccountId: 'cash-1',
          amount: 0,
          date: '2026-09-13',
        })
      ).rejects.toThrow('Jumlah pembayaran harus lebih dari 0.');

      mockSupabase.client.rpc.mockResolvedValue({
        data: { success: true, paymentNumber: 'KK-260913-001' },
        error: null,
      });

      const res = await service.payPurchase({
        purchaseId: 'doc-1',
        cashAccountId: 'cash-1',
        amount: 1500000,
        date: '2026-09-13',
        notes: 'Pelunasan termin 1',
      });

      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('post_purchase_payment', {
        p_purchase_id: 'doc-1',
        p_cash_account_id: 'cash-1',
        p_amount: 1500000,
        p_date: '2026-09-13',
        p_notes: 'Pelunasan termin 1',
        p_user_id: 'user-purchasing-1',
      });
      expect(res.paymentNumber).toBe('KK-260913-001');
    });
  });

  describe('Inventory & Ledger', () => {
    it('should fetch inventory summary via RPC', async () => {
      const mockSummary = [
        {
          item_id: 'item-1',
          item_name: 'Cotton Combed 30s',
          item_kind: 'material',
          unit_code: 'm',
          inventory_state: 'material',
          total_in: 100,
          total_out: 20,
          current_stock: 80,
          moving_avg_cost: 60000,
          total_valuation: 4800000,
        },
      ];

      mockSupabase.client.rpc.mockResolvedValue({
        data: mockSummary,
        error: null,
      });

      const res = await service.getInventorySummary();
      expect(res.length).toBe(1);
      expect(res[0].item_name).toBe('Cotton Combed 30s');
      expect(res[0].current_stock).toBe(80);
      expect(res[0].total_valuation).toBe(4800000);
    });

    it('should fetch inventory movements', async () => {
      const mockMovements = [
        {
          id: 'mov-1',
          quantity: 50,
          movement_type: 'purchase_receipt',
          transaction_date: '2026-09-13',
        },
      ];

      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
      };
      builder.order.mockReturnValueOnce(builder).mockResolvedValueOnce({ data: mockMovements, error: null });

      mockSupabase.client.from.mockReturnValue(builder);

      const res = await service.getInventoryMovements();
      expect(res.length).toBe(1);
      expect(res[0].quantity).toBe(50);
    });
  });
});
