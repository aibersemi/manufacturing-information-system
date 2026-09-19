import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EligibleBundleItem,
  ProductionService,
  SpkWithDetails,
} from '../../../core/services/production.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { OperatorSewingComponent } from './operator-sewing.component';

describe('OperatorSewingComponent', () => {
  let component: OperatorSewingComponent;
  let fixture: ComponentFixture<OperatorSewingComponent>;
  let mockProductionService: {
    spkList: ReturnType<typeof signal<SpkWithDetails[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getSpkList: ReturnType<typeof vi.fn>;
    getAllBundles: ReturnType<typeof vi.fn>;
    confirmSewing: ReturnType<typeof vi.fn>;
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
    id: 'spk-jah-1',
    document_id: 'spk-jah-1',
    document_number: 'SPK-JAH-260920-001',
    production_order_id: 'pp-1',
    production_order_number: 'PP-260920-001',
    stage: 'sewing',
    operator_profile_id: 'op-jah-1',
    operator_name: 'Budi Santoso',
    business_status: 'assigned',
    target_pcs: 50,
    created_at: '2026-09-20T00:00:00Z',
  };

  const mockBundle: EligibleBundleItem = {
    id: 'b-jah-1',
    bundle_code: 'IKT-JAH-01',
    product_id: 'prod-1',
    product_name: 'Jaket Casual',
    product_sku: 'JKT-001',
    initial_quantity: 50,
    active_quantity: 50,
    stage: 'printing',
    work_condition: 'available',
    production_order_id: 'pp-1',
  };

  beforeEach(async () => {
    const supabaseFromMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{ bundle_id: 'b-jah-1' }] }),
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
      confirmSewing: vi.fn().mockResolvedValue({
        actualId: 'act-jah-1',
        actualNumber: 'ACT-JAH-260920-001',
        bundleCode: 'IKT-JAH-01',
        successQuantity: 45,
        repairQuantity: 3,
        rejectQuantity: 2,
        wageAmount: 750000,
        repairCaseId: 'rep-case-1',
        spkCompleted: true,
      }),
      supabase: {
        client: {
          from: supabaseFromMock,
        },
      },
    };

    await TestBed.configureTestingModule({
      imports: [OperatorSewingComponent],
      providers: [
        { provide: ProductionService, useValue: mockProductionService },
        { provide: SupabaseService, useValue: mockSupabaseService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OperatorSewingComponent);
    component = fixture.componentInstance;
  });

  it('should initialize and load sewing SPKs and bundles', async () => {
    expect(component).toBeTruthy();
    await component.loadSewingSpks();
    expect(mockProductionService.getSpkList).toHaveBeenCalledWith('sewing');
    expect(component.sewingSpks().length).toBe(1);
    expect(component.selectedSpkId()).toBe('spk-jah-1');
    expect(component.bundleEntries().length).toBe(1);
    expect(component.bundleEntries()[0].bundle.bundle_code).toBe('IKT-JAH-01');
    expect(component.confirmedCount()).toBe(0);
    expect(component.totalBundles()).toBe(1);
  });

  it('should update bundle entry quantities and validate balance invariant correctly', async () => {
    await component.loadSewingSpks();

    // Default entry is initial active quantity (50)
    const entry = component.bundleEntries()[0];
    expect(component.isEntryBalanced(entry)).toBe(true);

    // Make unbalanced
    component.updateEntry(0, 'successQty', 40);
    component.updateEntry(0, 'repairQty', 2);
    component.updateEntry(0, 'rejectQty', 1);
    expect(component.isEntryBalanced(component.bundleEntries()[0])).toBe(false);

    // Balance again: 45 + 3 + 2 = 50
    component.updateEntry(0, 'successQty', 45);
    component.updateEntry(0, 'repairQty', 3);
    component.updateEntry(0, 'rejectQty', 2);
    component.updateEntry(0, 'notes', '3 pcs jahitan meleset perlu repair');
    expect(component.isEntryBalanced(component.bundleEntries()[0])).toBe(true);
    expect(component.bundleEntries()[0].notes).toBe('3 pcs jahitan meleset perlu repair');
  });

  it('should prevent confirmation when quantities are unbalanced', async () => {
    await component.loadSewingSpks();
    component.updateEntry(0, 'successQty', 30);
    component.updateEntry(0, 'repairQty', 0);
    component.updateEntry(0, 'rejectQty', 0); // 30 != 50

    await component.confirmBundleResult(0);
    expect(mockProductionService.confirmSewing).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('wajib tepat sama dengan kuantitas aktif ikatan');
  });

  it('should confirm sewing result for a bundle and reflect success state', async () => {
    await component.loadSewingSpks();
    component.updateEntry(0, 'successQty', 45);
    component.updateEntry(0, 'repairQty', 3);
    component.updateEntry(0, 'rejectQty', 2);
    component.updateEntry(0, 'notes', 'Jahitan selesai');

    await component.confirmBundleResult(0);

    expect(mockProductionService.confirmSewing).toHaveBeenCalledWith({
      spkId: 'spk-jah-1',
      bundleId: 'b-jah-1',
      successQty: 45,
      repairQty: 3,
      rejectQty: 2,
      notes: 'Jahitan selesai',
    });

    expect(component.lastResult()).toBeTruthy();
    expect(component.lastResult()?.actualNumber).toBe('ACT-JAH-260920-001');
    expect(component.lastResult()?.wageAmount).toBe(750000);
    expect(component.bundleEntries()[0].isConfirmed).toBe(true);
    expect(component.confirmedCount()).toBe(1);
    expect(component.successMessage()).toContain('ACT-JAH-260920-001');
    expect(component.successMessage()).toContain('750.000');
  });

  it('should handle error when confirmSewing fails', async () => {
    mockProductionService.confirmSewing.mockRejectedValueOnce(
      new Error('Koneksi database terputus.')
    );

    await component.loadSewingSpks();
    component.updateEntry(0, 'successQty', 50);
    component.updateEntry(0, 'repairQty', 0);
    component.updateEntry(0, 'rejectQty', 0);

    await component.confirmBundleResult(0);
    expect(component.errorMessage()).toBe('Koneksi database terputus.');
    expect(component.isSubmitting()).toBe(false);
  });
});
