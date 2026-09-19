import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EligibleBundleItem,
  ProductionService,
  SpkWithDetails,
} from '../../../core/services/production.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { OperatorPackingComponent } from './operator-packing.component';

describe('OperatorPackingComponent', () => {
  let component: OperatorPackingComponent;
  let fixture: ComponentFixture<OperatorPackingComponent>;
  let mockProductionService: {
    spkList: ReturnType<typeof signal<SpkWithDetails[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getSpkList: ReturnType<typeof vi.fn>;
    getAllBundles: ReturnType<typeof vi.fn>;
    confirmPacking: ReturnType<typeof vi.fn>;
    supabase: {
      client: {
        from: ReturnType<typeof vi.fn>;
      };
    };
  };
  let mockSupabaseService: {
    client: {
      from: ReturnType<typeof vi.fn>;
    };
  };

  const mockSpk: SpkWithDetails = {
    id: 'spk-pck-1',
    document_id: 'spk-pck-1',
    document_number: 'SPK-PCK-260920-001',
    production_order_id: 'pp-1',
    production_order_number: 'PP-260920-001',
    stage: 'packing',
    operator_profile_id: 'op-pck-1',
    operator_name: 'Dewi Lestari',
    business_status: 'assigned',
    target_pcs: 50,
    created_at: '2026-09-20T00:00:00Z',
  };

  const mockBundle: EligibleBundleItem = {
    id: 'b-pck-1',
    bundle_code: 'IKT-PCK-01',
    product_id: 'prod-1',
    product_name: 'Jaket Casual',
    product_sku: 'JKT-001',
    initial_quantity: 50,
    active_quantity: 50,
    stage: 'sewing',
    work_condition: 'completed',
    production_order_id: 'pp-1',
  };

  beforeEach(async () => {
    const supabaseFromMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{ bundle_id: 'b-pck-1' }] }),
      }),
    });

    mockSupabaseService = {
      client: {
        from: supabaseFromMock,
      },
    };

    mockProductionService = {
      spkList: signal<SpkWithDetails[]>([mockSpk]),
      isLoading: signal(false),
      getSpkList: vi.fn().mockResolvedValue([mockSpk]),
      getAllBundles: vi.fn().mockResolvedValue([mockBundle]),
      confirmPacking: vi.fn().mockResolvedValue({
        actualId: 'act-pck-1',
        actualNumber: 'ACT-PCK-260920-001',
        bundleCode: 'IKT-PCK-01',
        successQuantity: 50,
        wageAmount: 50000,
        spkCompleted: true,
      }),
      supabase: {
        client: {
          from: supabaseFromMock,
        },
      },
    };

    await TestBed.configureTestingModule({
      imports: [OperatorPackingComponent],
      providers: [
        { provide: ProductionService, useValue: mockProductionService },
        { provide: SupabaseService, useValue: mockSupabaseService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OperatorPackingComponent);
    component = fixture.componentInstance;
  });

  it('should initialize and load packing SPKs and bundles', async () => {
    expect(component).toBeTruthy();
    await component.loadPackingSpks();
    expect(mockProductionService.getSpkList).toHaveBeenCalledWith('packing');
    expect(component.packingSpks().length).toBe(1);
    expect(component.selectedSpkId()).toBe('spk-pck-1');
    expect(component.bundleEntries().length).toBe(1);
    expect(component.bundleEntries()[0].bundle.bundle_code).toBe('IKT-PCK-01');
    expect(component.confirmedCount()).toBe(0);
    expect(component.totalBundles()).toBe(1);
  });

  it('should update bundle entry quantities and validate exact match invariant correctly', async () => {
    await component.loadPackingSpks();

    // Default entry matches initial active quantity (50)
    const entry = component.bundleEntries()[0];
    expect(component.isEntryValid(entry)).toBe(true);
    expect(component.isEntryBalanced(entry)).toBe(true);

    // Mismatched quantity
    component.updateEntry(0, 'successQty', 45);
    expect(component.isEntryValid(component.bundleEntries()[0])).toBe(false);

    // Zero quantity
    component.updateEntry(0, 'successQty', 0);
    expect(component.isEntryValid(component.bundleEntries()[0])).toBe(false);

    // Re-match quantity: 50
    component.updateEntry(0, 'successQty', 50);
    component.updateEntry(0, 'notes', 'Packing rapi 50 pcs OPP');
    expect(component.isEntryValid(component.bundleEntries()[0])).toBe(true);
    expect(component.bundleEntries()[0].notes).toBe('Packing rapi 50 pcs OPP');
  });

  it('should prevent confirmation when quantity is mismatched or zero', async () => {
    await component.loadPackingSpks();
    component.updateEntry(0, 'successQty', 30); // 30 != 50

    await component.confirmBundleResult(0);
    expect(mockProductionService.confirmPacking).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('wajib tepat sama dengan kuantitas aktif ikatan');

    // Test zero quantity
    component.updateEntry(0, 'successQty', 0);
    await component.confirmBundleResult(0);
    expect(mockProductionService.confirmPacking).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('harus lebih besar dari 0');
  });

  it('should confirm packing result for a bundle and reflect success state', async () => {
    await component.loadPackingSpks();
    component.updateEntry(0, 'successQty', 50);
    component.updateEntry(0, 'notes', 'Packing selesai rapi');

    await component.confirmBundleResult(0);

    expect(mockProductionService.confirmPacking).toHaveBeenCalledWith({
      spkId: 'spk-pck-1',
      bundleId: 'b-pck-1',
      successQty: 50,
      notes: 'Packing selesai rapi',
    });

    expect(component.lastResult()).toBeTruthy();
    expect(component.lastResult()?.actualNumber).toBe('ACT-PCK-260920-001');
    expect(component.lastResult()?.wageAmount).toBe(50000);
    expect(component.bundleEntries()[0].isConfirmed).toBe(true);
    expect(component.confirmedCount()).toBe(1);
    expect(component.successMessage()).toContain('ACT-PCK-260920-001');
    expect(component.successMessage()).toContain('50.000');
  });

  it('should handle error when confirmPacking fails', async () => {
    mockProductionService.confirmPacking.mockRejectedValueOnce(
      new Error('Koneksi database terputus.')
    );

    await component.loadPackingSpks();
    component.updateEntry(0, 'successQty', 50);

    await component.confirmBundleResult(0);
    expect(component.errorMessage()).toBe('Koneksi database terputus.');
    expect(component.isSubmitting()).toBe(false);
  });

  it('should handle switching selected SPK', async () => {
    await component.loadPackingSpks();
    expect(component.selectedSpkId()).toBe('spk-pck-1');

    await component.onSelectSpk('non-existent-spk');
    expect(component.selectedSpk()).toBeNull();
    expect(component.bundleEntries().length).toBe(0);
  });
});
