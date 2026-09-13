import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ProductionMaterialUnit,
  ProductionOrderDetail,
  ProductionService,
  SpkWithDetails,
} from '../../../core/services/production.service';
import { OperatorCuttingComponent } from './operator-cutting.component';

describe('OperatorCuttingComponent', () => {
  let component: OperatorCuttingComponent;
  let fixture: ComponentFixture<OperatorCuttingComponent>;
  let mockProductionService: {
    spkList: ReturnType<typeof signal<SpkWithDetails[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getSpkList: ReturnType<typeof vi.fn>;
    getAvailableRollsForSpk: ReturnType<typeof vi.fn>;
    getProductionOrderById: ReturnType<typeof vi.fn>;
    confirmCutting: ReturnType<typeof vi.fn>;
  };

  const mockSpk: SpkWithDetails = {
    id: 'spk-1',
    document_id: 'spk-1',
    document_number: 'SPK-POT-260913-001',
    production_order_id: 'pp-1',
    stage: 'cutting',
    operator_profile_id: 'op-1',
    business_status: 'assigned',
    target_pcs: 100,
    created_at: '2026-09-13T00:00:00Z',
  };

  const mockRoll: ProductionMaterialUnit = {
    id: 'roll-1',
    company_id: 'company-123',
    material_id: 'mat-1',
    physical_code: 'ROLL-COTTON-001',
    initial_base_quantity: 25,
    stock_unit_code: 'm',
    packaging_unit_code: 'roll',
    status: 'available',
    receipt_cycle: 1,
    source_document_id: 'doc-rec-1',
    source_line_id: 'line-rec-1',
    consumed_at: null,
    consumed_by_document_id: null,
    created_at: '2026-09-13T00:00:00Z',
  };

  beforeEach(async () => {
    mockProductionService = {
      spkList: signal<SpkWithDetails[]>([mockSpk]),
      isLoading: signal(false),
      getSpkList: vi.fn().mockResolvedValue([mockSpk]),
      getAvailableRollsForSpk: vi.fn().mockResolvedValue([mockRoll]),
      getProductionOrderById: vi.fn().mockResolvedValue({
        id: 'pp-1',
        document_number: 'PP-260913-001',
        lines: [
          {
            id: 'l-1',
            item_id: 'prod-1',
            quantity: 100,
            product: { id: 'prod-1', name: 'Kaos Hitam', sku: 'KH-01' },
          },
        ],
      } as unknown as ProductionOrderDetail),
      confirmCutting: vi.fn().mockResolvedValue({
        actualId: 'act-1',
        actualNumber: 'ACT-POT-260913-001',
        lotCode: 'LOT-260913-001',
        totalActualPcs: 100,
        bundleCount: 2,
        wageAmount: 150000,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [OperatorCuttingComponent],
      providers: [{ provide: ProductionService, useValue: mockProductionService }],
    }).compileComponents();

    fixture = TestBed.createComponent(OperatorCuttingComponent);
    component = fixture.componentInstance;
  });

  it('should initialize and load assigned SPKs and rolls', async () => {
    expect(component).toBeTruthy();
    await component.loadAssignedSpks();
    expect(mockProductionService.getSpkList).toHaveBeenCalledWith('cutting');
    expect(component.assignedSpks().length).toBe(1);
    expect(component.selectedSpkId()).toBe('spk-1');
    expect(component.availableRolls().length).toBe(1);
  });

  it('should auto generate bundles based on actual quantity', async () => {
    await component.loadAssignedSpks();
    expect(component.totalActualPcs()).toBe(100);
    expect(component.bundles().length).toBe(2); // 100 pcs dibagi 50 = 2 bundle
    expect(component.isBundleCountMatching()).toBe(true);
  });

  it('should submit confirmation successfully', async () => {
    await component.loadAssignedSpks();
    await component.submitConfirmation();

    expect(mockProductionService.confirmCutting).toHaveBeenCalledWith({
      spkId: 'spk-1',
      rollId: 'roll-1',
      actualDate: expect.any(String),
      actualLines: [{ productId: 'prod-1', quantity: 100 }],
      bundles: expect.any(Array),
    });
    expect(component.lastConfirmation()).toBeTruthy();
    expect(component.lastConfirmation()?.lotCode).toBe('LOT-260913-001');
  });
});
