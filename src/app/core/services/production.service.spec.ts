import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { User } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { ProductionService } from './production.service';
import { SupabaseService } from './supabase.service';

describe('ProductionService', () => {
  let service: ProductionService;
  let mockSupabase: {
    client: {
      from: ReturnType<typeof vi.fn>;
      rpc: ReturnType<typeof vi.fn>;
    };
  };
  let mockAuthService: {
    currentUser: ReturnType<typeof vi.fn>;
  };
  let mockCompanyService: {
    activeCompanyId: ReturnType<typeof signal<string | null>>;
    waitForActiveCompany: ReturnType<typeof vi.fn>;
  };

  const mockUser: User = {
    id: 'user-head-1',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    email: 'head@example.com',
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
        ProductionService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: AuthService, useValue: mockAuthService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    });

    service = TestBed.inject(ProductionService);
  });

  describe('createProductionOrder', () => {
    it('should call create_production_order RPC with formatted payload', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: { id: 'pp-1', documentNumber: 'PP-260913-001', status: 'draft' },
        error: null,
      });

      // Mock getProductionOrders call inside createProductionOrder
      const mockQueryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve: (val: unknown) => void) => resolve({ data: [], error: null })),
      };
      mockSupabase.client.from.mockReturnValue(mockQueryBuilder);

      const res = await service.createProductionOrder({
        targetDate: '2026-09-20',
        notes: 'Target lebaran',
        lines: [{ productId: 'prod-1', quantity: 150 }],
      });

      expect(res.documentNumber).toBe('PP-260913-001');
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('create_production_order', {
        p_company_id: 'company-123',
        p_target_date: '2026-09-20',
        p_notes: 'Target lebaran',
        p_lines: [{ productId: 'prod-1', quantity: 150 }],
        p_user_id: 'user-head-1',
      });
    });

    it('should throw error when rpc fails', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: null,
        error: { message: 'SKU belum memiliki konfigurasi routing' },
      });

      await expect(
        service.createProductionOrder({
          targetDate: '2026-09-20',
          lines: [{ productId: 'prod-1', quantity: 100 }],
        })
      ).rejects.toThrow('SKU belum memiliki konfigurasi routing');
    });
  });

  describe('createSpk', () => {
    it('should call create_spk RPC for cutting stage', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: { id: 'spk-1', documentNumber: 'SPK-POT-260913-001', stage: 'cutting' },
        error: null,
      });

      const mockQueryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve: (val: unknown) => void) => resolve({ data: [], error: null })),
      };
      mockSupabase.client.from.mockReturnValue(mockQueryBuilder);

      const res = await service.createSpk({
        productionOrderId: 'pp-1',
        stage: 'cutting',
        operatorId: 'op-1',
        targetPcs: 150,
        notes: 'Potong presisi',
      });

      expect(res.documentNumber).toBe('SPK-POT-260913-001');
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('create_spk', {
        p_pp_id: 'pp-1',
        p_stage: 'cutting',
        p_operator_id: 'op-1',
        p_target_pcs: 150,
        p_notes: 'Potong presisi',
        p_bundle_ids: [],
        p_user_id: 'user-head-1',
      });
    });
  });

  describe('confirmCutting', () => {
    it('should call confirm_operator_cutting RPC', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: {
          actualId: 'act-1',
          actualNumber: 'ACT-POT-260913-001',
          lotCode: 'LOT-260913-001',
          totalActualPcs: 100,
          bundleCount: 2,
          wageAmount: 100000,
        },
        error: null,
      });

      const res = await service.confirmCutting({
        spkId: 'spk-1',
        rollId: 'roll-1',
        actualDate: '2026-09-13',
        actualLines: [{ productId: 'prod-1', quantity: 100 }],
        bundles: [{ productId: 'prod-1', quantity: 50 }, { productId: 'prod-1', quantity: 50 }],
      });

      expect(res.lotCode).toBe('LOT-260913-001');
      expect(res.bundleCount).toBe(2);
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('confirm_operator_cutting', expect.any(Object));
    });
  });

  describe('confirmPrinting', () => {
    it('should call confirm_operator_printing RPC', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: {
          actualId: 'act-sab-1',
          actualNumber: 'ACT-SAB-260913-001',
          bundleCode: 'IKT-01',
          successQuantity: 48,
          repairQuantity: 2,
          rejectQuantity: 0,
          wageAmount: 50000,
          repairCaseId: 'rep-1',
          spkCompleted: false,
        },
        error: null,
      });

      const res = await service.confirmPrinting({
        spkId: 'spk-sab-1',
        bundleId: 'bundle-1',
        successQty: 48,
        repairQty: 2,
        rejectQty: 0,
        notes: 'Cacat sablon luntur',
      });

      expect(res.repairQuantity).toBe(2);
      expect(res.repairCaseId).toBe('rep-1');
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('confirm_operator_printing', expect.any(Object));
    });
  });

  describe('confirmSewing', () => {
    it('should call confirm_operator_sewing RPC with correct parameters', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: {
          actualId: 'act-jah-1',
          actualNumber: 'ACT-JAH-260920-001',
          bundleCode: 'IKT-02',
          successQuantity: 45,
          repairQuantity: 3,
          rejectQuantity: 2,
          wageAmount: 750000,
          repairCaseId: 'rep-jah-1',
          spkCompleted: false,
        },
        error: null,
      });

      const res = await service.confirmSewing({
        spkId: 'spk-jah-1',
        bundleId: 'bundle-2',
        successQty: 45,
        repairQty: 3,
        rejectQty: 2,
        notes: 'Jahitan samping melenceng',
      });

      expect(res.actualNumber).toBe('ACT-JAH-260920-001');
      expect(res.successQuantity).toBe(45);
      expect(res.repairQuantity).toBe(3);
      expect(res.rejectQuantity).toBe(2);
      expect(res.wageAmount).toBe(750000);
      expect(res.repairCaseId).toBe('rep-jah-1');
      expect(res.spkCompleted).toBe(false);
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('confirm_operator_sewing', {
        p_spk_id: 'spk-jah-1',
        p_bundle_id: 'bundle-2',
        p_success_qty: 45,
        p_repair_qty: 3,
        p_reject_qty: 2,
        p_notes: 'Jahitan samping melenceng',
        p_user_id: 'user-head-1',
      });
    });

    it('should throw error when confirm_operator_sewing RPC fails', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: null,
        error: { message: 'Total kuantitas hasil jahit wajib tepat sama dengan kuantitas aktif ikatan' },
      });

      await expect(
        service.confirmSewing({
          spkId: 'spk-jah-1',
          bundleId: 'bundle-2',
          successQty: 40,
          repairQty: 0,
          rejectQty: 0,
        })
      ).rejects.toThrow('Total kuantitas hasil jahit wajib tepat sama dengan kuantitas aktif ikatan');
    });
  });

  describe('confirmPacking', () => {
    it('should call confirm_operator_packing RPC with correct parameters', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: {
          actualId: 'act-pck-1',
          actualNumber: 'ACT-PCK-260920-001',
          bundleCode: 'IKT-03',
          successQuantity: 50,
          wageAmount: 50000,
          spkCompleted: true,
        },
        error: null,
      });

      const res = await service.confirmPacking({
        spkId: 'spk-pck-1',
        bundleId: 'bundle-3',
        successQty: 50,
        notes: 'Packing selesai rapi',
      });

      expect(res.actualNumber).toBe('ACT-PCK-260920-001');
      expect(res.successQuantity).toBe(50);
      expect(res.wageAmount).toBe(50000);
      expect(res.spkCompleted).toBe(true);
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('confirm_operator_packing', {
        p_spk_id: 'spk-pck-1',
        p_bundle_id: 'bundle-3',
        p_success_qty: 50,
        p_notes: 'Packing selesai rapi',
        p_user_id: 'user-head-1',
      });
    });

    it('should throw error when confirm_operator_packing RPC fails', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: null,
        error: { message: 'Kuantitas hasil packing wajib tepat sama dengan kuantitas aktif ikatan' },
      });

      await expect(
        service.confirmPacking({
          spkId: 'spk-pck-1',
          bundleId: 'bundle-3',
          successQty: 40,
        })
      ).rejects.toThrow('Kuantitas hasil packing wajib tepat sama dengan kuantitas aktif ikatan');
    });
  });

  describe('assignRepair', () => {
    it('should call assign_repair_spk RPC', async () => {
      mockSupabase.client.rpc.mockResolvedValue({
        data: {
          repairCaseId: 'rep-1',
          spkId: 'spk-rep-1',
          spkNumber: 'SPK-REP-260913-001',
          compensationMode: 'reference_rate',
          rateSnapshot: 1500,
        },
        error: null,
      });

      const mockQueryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve: (val: unknown) => void) => resolve({ data: [], error: null })),
      };
      mockSupabase.client.from.mockReturnValue(mockQueryBuilder);

      const res = await service.assignRepair({
        repairCaseId: 'rep-1',
        operatorId: 'op-1',
        wageMode: 'reference',
      });

      expect(res.spkNumber).toBe('SPK-REP-260913-001');
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('assign_repair_spk', expect.any(Object));
    });
  });

  describe('getProgressSummary', () => {
    it('should call get_production_progress_summary RPC', async () => {
      const mockSummary = [
        {
          id: 'pp-1',
          documentNumber: 'PP-260913-001',
          targetDate: '2026-09-20',
          status: 'draft',
          codeLocked: true,
          notes: '',
          targetPcs: 100,
          actualCuttingPcs: 100,
          actualPrintingPcs: 95,
          actualSewingPcs: 90,
          actualPackingPcs: 90,
          activeBundleCount: 2,
          activeRepairCount: 1,
          completionPercentage: 90,
        },
      ];

      mockSupabase.client.rpc.mockResolvedValue({
        data: mockSummary,
        error: null,
      });

      const res = await service.getProgressSummary();
      expect(res.length).toBe(1);
      expect(res[0].actualCuttingPcs).toBe(100);
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('get_production_progress_summary', {
        p_company_id: 'company-123',
      });
    });
  });
});
