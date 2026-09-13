import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { User } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { AssetService } from './asset.service';
import { SupabaseService } from './supabase.service';

describe('AssetService', () => {
  let service: AssetService;
  let mockSupabase: any;
  let mockAuthService: any;
  let mockCompanyService: any;

  const mockUser: User = {
    id: 'user-asset-1',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    email: 'finance@mis.mrmads.net',
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
      activeCompanyId: signal('company-asset-123'),
      loadAvailableCompanies: vi.fn().mockResolvedValue([]),
      waitForActiveCompany: vi.fn().mockResolvedValue('company-asset-123'),
    };

    TestBed.configureTestingModule({
      providers: [
        AssetService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: AuthService, useValue: mockAuthService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    });

    service = TestBed.inject(AssetService);
  });

  it('should initialize with default empty signals', () => {
    expect(service.assetPurchases()).toEqual([]);
    expect(service.assets()).toEqual([]);
    expect(service.selectedAsset()).toBeNull();
    expect(service.depreciationPreview()).toBeNull();
    expect(service.depreciationHistory()).toEqual([]);
    expect(service.assetDisposals()).toEqual([]);
    expect(service.categories()).toEqual([]);
    expect(service.loading()).toBe(false);
  });

  it('should load asset purchases successfully', async () => {
    const mockData = [
      {
        id: 'doc-1',
        document_number: 'BA-260913-001',
        transaction_date: '2026-09-13',
        counterparty_id: 'supp-1',
        total_amount: 15000000,
        paid_amount: 0,
        status: 'draft',
        data: { notes: 'Pembelian mesin obras' },
        posted_at: null,
        created_at: '2026-09-13T10:00:00Z',
        counterparty: { id: 'supp-1', name: 'PT Mesin Jaya' },
        lines: [
          {
            id: 'line-1',
            line_number: 1,
            description: 'Mesin Obras Industri',
            quantity: 3,
            unit_price: 5000000,
            subtotal: 15000000,
            total_amount: 15000000,
            is_current: true,
          },
        ],
      },
    ];

    const queryMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve) => resolve({ data: mockData, error: null })),
    };

    mockSupabase.client.from.mockReturnValue(queryMock);

    const result = await service.loadAssetPurchases();

    expect(mockSupabase.client.from).toHaveBeenCalledWith('business_document');
    expect(result.length).toBe(1);
    expect(result[0].documentNumber).toBe('BA-260913-001');
    expect(result[0].totalUnits).toBe(3);
    expect(result[0].counterpartyName).toBe('PT Mesin Jaya');
    expect(service.assetPurchases()).toEqual(result);
  });

  it('should create asset purchase via rpc and reload purchases', async () => {
    mockSupabase.client.rpc.mockResolvedValue({
      data: { id: 'doc-new-1', documentNumber: 'BA-260913-002', totalAmount: 10000000 },
      error: null,
    });

    const queryMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve) => resolve({ data: [], error: null })),
    };
    mockSupabase.client.from.mockReturnValue(queryMock);

    const res = await service.createAssetPurchase({
      supplierId: 'supp-1',
      transactionDate: '2026-09-13',
      notes: 'Beli komputer',
      lines: [{ name: 'Komputer Desain', quantity: 2, unitPrice: 5000000 }],
    });

    expect(mockSupabase.client.rpc).toHaveBeenCalledWith('create_asset_purchase', {
      p_company_id: 'company-asset-123',
      p_supplier_id: 'supp-1',
      p_transaction_date: '2026-09-13',
      p_notes: 'Beli komputer',
      p_lines: [{ name: 'Komputer Desain', quantity: 2, unitPrice: 5000000 }],
      p_user_id: 'user-asset-1',
    });
    expect(res.documentNumber).toBe('BA-260913-002');
  });

  it('should post asset purchase and reload purchases and assets', async () => {
    mockSupabase.client.rpc.mockResolvedValue({
      data: { success: true },
      error: null,
    });

    const queryMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve) => resolve({ data: [], error: null })),
    };
    mockSupabase.client.from.mockReturnValue(queryMock);

    await service.postAssetPurchase('doc-1');

    expect(mockSupabase.client.rpc).toHaveBeenCalledWith('post_asset_purchase', {
      p_company_id: 'company-asset-123',
      p_document_id: 'doc-1',
      p_user_id: 'user-asset-1',
    });
  });

  it('should cancel asset purchase with reason', async () => {
    mockSupabase.client.rpc.mockResolvedValue({
      data: { success: true },
      error: null,
    });

    const queryMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve) => resolve({ data: [], error: null })),
    };
    mockSupabase.client.from.mockReturnValue(queryMock);

    await service.cancelAssetPurchase('doc-1', 'Salah input nomor barang');

    expect(mockSupabase.client.rpc).toHaveBeenCalledWith('cancel_asset_purchase', {
      p_company_id: 'company-asset-123',
      p_document_id: 'doc-1',
      p_reason: 'Salah input nomor barang',
      p_user_id: 'user-asset-1',
    });
  });

  it('should load assets with search and category filtering', async () => {
    const mockAssets = [
      {
        id: 'ast-1',
        company_id: 'company-asset-123',
        asset_code: 'AST-260913-001-L1-1',
        name: 'Mesin Jahit Jarum 1',
        status: 'active',
        category_id: 'cat-1',
        source_document_id: 'doc-1',
        acquisition_cost: 6000000,
        residual_value: 0,
        depreciation_method: 'straight_line',
        useful_life_months: 48,
        capitalization_date: '2026-09-13',
        depreciation_start_date: '2026-09-13',
        accumulated_depreciation: 250000,
        location: 'Lantai 1',
        custodian: 'Budi',
        serial_number: 'SN12345',
        data: {},
        created_at: '2026-09-13T10:00:00Z',
        updated_at: '2026-09-13T10:00:00Z',
        category: { id: 'cat-1', name: 'Mesin Produksi', code: 'MESIN' },
        source_document: { id: 'doc-1', document_number: 'BA-260913-001' },
      },
    ];

    const queryMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve) => resolve({ data: mockAssets, error: null })),
    };
    mockSupabase.client.from.mockReturnValue(queryMock);

    const items = await service.loadAssets({ search: 'Mesin Jahit' });

    expect(items.length).toBe(1);
    expect(items[0].assetCode).toBe('AST-260913-001-L1-1');
    expect(items[0].bookValue).toBe(5750000);
    expect(items[0].isLocked).toBe(true);
    expect(items[0].isSetupComplete).toBe(true);
  });

  it('should load depreciation preview for a period', async () => {
    const previewData = {
      periodMonth: '2026-09',
      totalEligibleAssets: 1,
      totalEligibleAmount: 125000,
      totalIneligibleAssets: 1,
      eligibleAssets: [
        {
          assetId: 'ast-1',
          assetCode: 'AST-260913-001-L1-1',
          name: 'Mesin Jahit Jarum 1',
          categoryName: 'Mesin Produksi',
          acquisitionCost: 6000000,
          residualValue: 0,
          depreciationMethod: 'straight_line',
          usefulLifeMonths: 48,
          periodNumber: 1,
          accumulatedDepreciation: 0,
          bookValueBefore: 6000000,
          depreciationAmount: 125000,
          bookValueAfter: 5875000,
        },
      ],
      ineligibleAssets: [
        {
          assetId: 'ast-2',
          assetCode: 'AST-260913-001-L1-2',
          name: 'Mesin Jahit Jarum 2',
          categoryName: 'Mesin Produksi',
          acquisitionCost: 6000000,
          accumulatedDepreciation: 0,
          reason: 'Perlu Pengaturan Penyusutan',
        },
      ],
    };

    mockSupabase.client.rpc.mockResolvedValue({
      data: previewData,
      error: null,
    });

    const summary = await service.loadDepreciationPreview('2026-09');

    expect(mockSupabase.client.rpc).toHaveBeenCalledWith('get_depreciation_preview', {
      p_company_id: 'company-asset-123',
      p_period_month: '2026-09',
    });
    expect(summary.totalEligibleAssets).toBe(1);
    expect(summary.totalEligibleAmount).toBe(125000);
    expect(summary.ineligibleAssets[0].reason).toBe('Perlu Pengaturan Penyusutan');
  });

  it('should post monthly depreciation via rpc', async () => {
    mockSupabase.client.rpc.mockResolvedValue({
      data: {
        id: 'dep-doc-1',
        documentNumber: 'DP-260930-001',
        totalAmount: 125000,
        assetCount: 1,
      },
      error: null,
    });

    const queryMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve) => resolve({ data: [], error: null })),
    };
    mockSupabase.client.from.mockReturnValue(queryMock);

    const res = await service.postMonthlyDepreciation('2026-09', ['ast-1'], 'Penyusutan September');

    expect(res.documentNumber).toBe('DP-260930-001');
    expect(res.totalAmount).toBe(125000);
    expect(res.assetCount).toBe(1);
  });

  it('should post asset disposal via rpc', async () => {
    mockSupabase.client.rpc.mockResolvedValue({
      data: {
        id: 'disp-doc-1',
        documentNumber: 'DA-260913-001',
        bookValue: 4000000,
        proceeds: 4500000,
        gain: 500000,
        loss: 0,
      },
      error: null,
    });

    const queryMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve) => resolve({ data: [], error: null })),
    };
    mockSupabase.client.from.mockReturnValue(queryMock);

    const res = await service.postAssetDisposal({
      assetId: 'ast-1',
      disposalDate: '2026-09-13',
      proceeds: 4500000,
      cashAccountId: 'cash-acc-1',
      reason: 'Dijual ke pihak ketiga',
    });

    expect(mockSupabase.client.rpc).toHaveBeenCalledWith('post_asset_disposal', {
      p_company_id: 'company-asset-123',
      p_asset_id: 'ast-1',
      p_disposal_date: '2026-09-13',
      p_proceeds: 4500000,
      p_cash_account_id: 'cash-acc-1',
      p_reason: 'Dijual ke pihak ketiga',
      p_user_id: 'user-asset-1',
    });
    expect(res.gain).toBe(500000);
    expect(res.loss).toBe(0);
  });
});
