import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EligibleBundleItem,
  ProductionService,
  SpkWithDetails,
} from '../../../core/services/production.service';
import { OperatorPrintingComponent } from './operator-printing.component';

describe('OperatorPrintingComponent', () => {
  let component: OperatorPrintingComponent;
  let fixture: ComponentFixture<OperatorPrintingComponent>;
  let mockProductionService: {
    spkList: ReturnType<typeof signal<SpkWithDetails[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getSpkList: ReturnType<typeof vi.fn>;
    getAllBundles: ReturnType<typeof vi.fn>;
    confirmPrinting: ReturnType<typeof vi.fn>;
    supabase: {
      client: {
        from: ReturnType<typeof vi.fn>;
      };
    };
  };

  const mockSpk: SpkWithDetails = {
    id: 'spk-sab-1',
    document_id: 'spk-sab-1',
    document_number: 'SPK-SAB-260913-001',
    production_order_id: 'pp-1',
    stage: 'printing',
    operator_profile_id: 'op-sab-1',
    business_status: 'assigned',
    created_at: '2026-09-13T00:00:00Z',
  };

  const mockBundle: EligibleBundleItem = {
    id: 'b-1',
    bundle_code: 'IKT-01',
    product_id: 'prod-1',
    initial_quantity: 50,
    active_quantity: 50,
    stage: 'cutting',
    work_condition: 'available',
    production_order_id: 'pp-1',
  };

  beforeEach(async () => {
    mockProductionService = {
      spkList: signal<SpkWithDetails[]>([mockSpk]),
      isLoading: signal(false),
      getSpkList: vi.fn().mockResolvedValue([mockSpk]),
      getAllBundles: vi.fn().mockResolvedValue([mockBundle]),
      confirmPrinting: vi.fn().mockResolvedValue({
        actualId: 'act-sab-1',
        actualNumber: 'ACT-SAB-260913-001',
        bundleCode: 'IKT-01',
        successQuantity: 48,
        repairQuantity: 2,
        rejectQuantity: 0,
        wageAmount: 75000,
        repairCaseId: 'rep-1',
        spkCompleted: true,
      }),
      supabase: {
        client: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [{ bundle_id: 'b-1' }] }),
            }),
          }),
        },
      },
    };

    await TestBed.configureTestingModule({
      imports: [OperatorPrintingComponent],
      providers: [{ provide: ProductionService, useValue: mockProductionService }],
    }).compileComponents();

    fixture = TestBed.createComponent(OperatorPrintingComponent);
    component = fixture.componentInstance;
  });

  it('should initialize and load printing SPK and bundles', async () => {
    expect(component).toBeTruthy();
    await component.loadPrintingSpks();
    expect(mockProductionService.getSpkList).toHaveBeenCalledWith('printing');
    expect(component.printingSpks().length).toBe(1);
    expect(component.bundleEntries().length).toBe(1);
  });

  it('should confirm printing for a bundle', async () => {
    await component.loadPrintingSpks();
    component.updateEntry(0, 'successQty', 48);
    component.updateEntry(0, 'repairQty', 2);
    component.updateEntry(0, 'rejectQty', 0);

    expect(component.isEntryBalanced(component.bundleEntries()[0])).toBe(true);

    await component.confirmBundleResult(0);
    expect(mockProductionService.confirmPrinting).toHaveBeenCalledWith({
      spkId: 'spk-sab-1',
      bundleId: 'b-1',
      successQty: 48,
      repairQty: 2,
      rejectQty: 0,
      notes: '',
    });
    expect(component.lastResult()).toBeTruthy();
    expect(component.lastResult()?.repairQuantity).toBe(2);
  });
});
