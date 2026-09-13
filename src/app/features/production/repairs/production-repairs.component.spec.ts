import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OperatorProfileItem,
  ProductionService,
  RepairCaseWithDetails,
} from '../../../core/services/production.service';
import { ProductionRepairsComponent } from './production-repairs.component';

describe('ProductionRepairsComponent', () => {
  let component: ProductionRepairsComponent;
  let fixture: ComponentFixture<ProductionRepairsComponent>;
  let mockProductionService: {
    repairCases: ReturnType<typeof signal<RepairCaseWithDetails[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getRepairCases: ReturnType<typeof vi.fn>;
    getOperatorProfiles: ReturnType<typeof vi.fn>;
    assignRepair: ReturnType<typeof vi.fn>;
  };

  const mockCase: RepairCaseWithDetails = {
    id: 'rep-1',
    company_id: 'company-123',
    production_order_id: 'pp-1',
    source_work_order_id: 'spk-1',
    bundle_id: 'bundle-1',
    found_at_stage: 'printing',
    repair_work_kind: 'printing',
    quantity: 5,
    issue_reason: 'Cacat sablon luntur',
    business_status: 'pending_assignment',
    created_at: '2026-09-13T00:00:00Z',
    updated_at: '2026-09-13T00:00:00Z',
    compensation_mode: null,
    rate_snapshot: null,
    repair_work_order_id: null,
    bundle_code: 'IKT-01',
    product_name: 'Kaos Polo',
  };

  const mockOp: OperatorProfileItem = {
    id: 'op-1',
    employee_id: 'emp-1',
    employee_name: 'Joko Sablon',
    user_id: 'u-1',
    operator_role: 'operator_sablon',
    is_active: true,
  };

  beforeEach(async () => {
    mockProductionService = {
      repairCases: signal<RepairCaseWithDetails[]>([mockCase]),
      isLoading: signal(false),
      getRepairCases: vi.fn().mockResolvedValue([mockCase]),
      getOperatorProfiles: vi.fn().mockResolvedValue([mockOp]),
      assignRepair: vi.fn().mockResolvedValue({
        repairCaseId: 'rep-1',
        spkId: 'spk-rep-1',
        spkNumber: 'SPK-REP-260913-001',
        compensationMode: 'reference_rate',
        rateSnapshot: 2000,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ProductionRepairsComponent],
      providers: [{ provide: ProductionService, useValue: mockProductionService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductionRepairsComponent);
    component = fixture.componentInstance;
  });

  it('should initialize and display repair cases', async () => {
    expect(component).toBeTruthy();
    await component.loadData();
    expect(mockProductionService.getRepairCases).toHaveBeenCalled();
    expect(component.filteredCases().length).toBe(1);
    expect(component.pendingCases()).toBe(1);
    expect(component.totalDefectivePcs()).toBe(5);
  });

  it('should open assign modal and submit repair assignment', async () => {
    await component.loadData();
    await component.openAssignModal(mockCase);

    expect(component.isAssignModalOpen()).toBe(true);
    expect(component.selectedCase()).toBe(mockCase);
    expect(component.operators().length).toBe(1);

    component.wageMode.set('reference');
    await component.submitAssign();

    expect(mockProductionService.assignRepair).toHaveBeenCalledWith({
      repairCaseId: 'rep-1',
      operatorId: 'op-1',
      wageMode: 'reference',
      customRate: undefined,
      notes: '',
    });
    expect(component.isAssignModalOpen()).toBe(false);
  });
});
