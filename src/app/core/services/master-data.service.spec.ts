import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { User } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { MasterDataService } from './master-data.service';
import { SupabaseService } from './supabase.service';

describe('MasterDataService', () => {
  let service: MasterDataService;
  let mockSupabase: any;
  let mockAuthService: any;
  let mockCompanyService: any;

  const mockUser: User = {
    id: 'user-op-1',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    email: 'admin@example.com',
  };

  beforeEach(() => {
    mockSupabase = {
      client: {
        from: vi.fn(),
      },
    };

    mockAuthService = {
      currentUser: vi.fn().mockReturnValue(mockUser),
    };

    mockCompanyService = {
      activeCompanyId: signal('company-123'),
    };

    TestBed.configureTestingModule({
      providers: [
        MasterDataService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: AuthService, useValue: mockAuthService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    });

    service = TestBed.inject(MasterDataService);
  });

  describe('UOM Management', () => {
    it('should reject invalid UOM code with spaces or lowercase', async () => {
      await expect(
        service.createUnit({ code: 'roll pack', name: 'Roll Pack', decimalScale: 0 }),
      ).rejects.toThrow('Kode UOM hanya boleh berupa huruf kapital, angka, dash, dan underscore tanpa spasi.');
    });

    it('should reject invalid decimal scale', async () => {
      await expect(
        service.createUnit({ code: 'ROLL', name: 'Roll', decimalScale: 7 }),
      ).rejects.toThrow('Skala desimal harus antara 0 sampai 6.');
    });

    it('should insert unit and log audit', async () => {
      const mockResult = {
        id: 'u-1',
        company_id: 'company-123',
        code: 'BOX',
        name: 'Kotak Box',
        decimal_scale: 0,
        is_active: true,
        version: 1,
      };

      mockSupabase.client.from.mockImplementation((table: string) => {
        if (table === 'unit_definition') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockResult, error: null }),
          };
        }
        if (table === 'audit_log') return { insert: vi.fn().mockResolvedValue({ error: null }) };
        return {};
      });

      const res = await service.createUnit({ code: 'box', name: 'Kotak Box', decimalScale: 0 });
      expect(res.code).toBe('BOX');
    });
  });

  describe('Customers & Suppliers', () => {
    it('should reject customer with empty name', async () => {
      await expect(
        service.createCustomer({ name: '', phone: '081234', address: 'Bandung' }),
      ).rejects.toThrow('Nama customer wajib diisi.');
    });

    it('should create customer record with metadata', async () => {
      const mockCust = {
        id: 'cust-1',
        company_id: 'company-123',
        record_kind: 'customer',
        name: 'CV Berkah Tekstil',
        data: { phone: '081234', address: 'Bandung' },
        is_active: true,
        version: 1,
      };

      mockSupabase.client.from.mockImplementation((table: string) => {
        if (table === 'master_record') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  ilike: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockCust, error: null }),
              }),
            }),
          };
        }
        if (table === 'audit_log') return { insert: vi.fn().mockResolvedValue({ error: null }) };
        return {};
      });

      const res = await service.createCustomer({
        name: 'CV Berkah Tekstil',
        phone: '081234',
        address: 'Bandung',
      });
      expect(res.name).toBe('CV Berkah Tekstil');
    });
  });

  describe('Materials Management', () => {
    it('should validate positive packagingQuantity and conversionFactor', async () => {
      await expect(
        service.createMaterial({
          name: 'Kain Katun Combed',
          packagingUnit: 'ROLL',
          packagingQuantity: 0,
          baseUnit: 'KG',
          conversionFactor: 25,
          referencePackagePrice: 1500000,
          notes: '',
        }),
      ).rejects.toThrow('Kuantitas kemasan harus lebih dari 0.');
    });
  });

  describe('Products & Routing', () => {
    it('should normalize SKU to uppercase and underscore', async () => {
      const mockProduct = {
        id: 'p-1',
        company_id: 'company-123',
        record_kind: 'product',
        sku: 'TSHIRT_POLOS_01',
        name: 'T-Shirt Polos Dewasa',
        data: { salesUnit: 'PCS', referenceSalesPrice: 75000, description: '' },
        is_active: true,
        version: 1,
      };

      mockSupabase.client.from.mockImplementation((table: string) => {
        if (table === 'master_record') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockProduct, error: null }),
              }),
            }),
          };
        }
        if (table === 'production_product_routing') {
          return { upsert: vi.fn().mockResolvedValue({ error: null }) };
        }
        if (table === 'audit_log') return { insert: vi.fn().mockResolvedValue({ error: null }) };
        return {};
      });

      const res = await service.createProduct({
        sku: 'tshirt polos 01',
        name: 'T-Shirt Polos Dewasa',
        salesUnit: 'pcs',
        referenceSalesPrice: 75000,
        description: 'Bahan combed 30s',
        requiresPrinting: true,
      });

      expect(res.sku).toBe('TSHIRT_POLOS_01');
      expect(res.requiresPrinting).toBe(true);
    });
  });

  describe('BOM Management', () => {
    it('should reject BOM with duplicate material components', async () => {
      await expect(
        service.saveBom('prod-1', 'Kaos Polos', [
          { materialId: 'mat-1', quantity: 1.5, unitCode: 'M' },
          { materialId: 'mat-1', quantity: 0.5, unitCode: 'M' },
        ]),
      ).rejects.toThrow('Komponen material tidak boleh duplikat dalam satu formula BOM.');
    });

    it('should reject BOM with empty material lines', async () => {
      await expect(service.saveBom('prod-1', 'Kaos Polos', [])).rejects.toThrow(
        'Formula BOM harus memiliki minimal satu komponen material.',
      );
    });
  });

  describe('Wage Rates', () => {
    it('should upsert wage rates for all 4 service kinds', async () => {
      const upsertMock = vi.fn().mockResolvedValue({ error: null });

      mockSupabase.client.from.mockImplementation((table: string) => {
        if (table === 'wage_rate') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
            upsert: upsertMock,
          };
        }
        if (table === 'audit_log') return { insert: vi.fn().mockResolvedValue({ error: null }) };
        return {};
      });

      await service.saveProductWageRates('prod-1', 'TSHIRT-01', {
        cutting: 1500,
        printing: 2000,
        sewing: 3500,
        packing: 800,
      });

      expect(upsertMock).toHaveBeenCalledTimes(4);
    });
  });
});
