import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EligibleBundleItem,
  OperatorProfileItem,
  ProductionOrderDetail,
  ProductionService,
  SpkWithDetails,
} from '../../../core/services/production.service';
import { SpkComponent } from './spk.component';

describe('SpkComponent', () => {
  let component: SpkComponent;
  let fixture: ComponentFixture<SpkComponent>;
  let mockProductionService: {
    spkList: ReturnType<typeof signal<SpkWithDetails[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getSpkList: ReturnType<typeof vi.fn>;
    getProductionOrders: ReturnType<typeof vi.fn>;
    getOperatorProfiles: ReturnType<typeof vi.fn>;
    getEligibleBundles: ReturnType<typeof vi.fn>;
    createSpk: ReturnType<typeof vi.fn>;
  };

  const mockSpkItem: SpkWithDetails = {
    id: 'spk-1',
    document_id: 'spk-1',
    document_number: 'SPK-POT-260913-001',
    production_order_id: 'pp-1',
    production_order_number: 'PP-260913-001',
    stage: 'cutting',
    operator_profile_id: 'op-1',
    operator_name: 'Budi Potong',
    business_status: 'assigned',
    target_pcs: 200,
    created_at: '2026-09-13T00:00:00Z',
  };

  const mockOp: OperatorProfileItem = {
    id: 'op-1',
    employee_id: 'emp-1',
    employee_name: 'Budi Potong',
    user_id: 'user-1',
    operator_role: 'operator_potong',
    is_active: true,
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
      spkList: signal<SpkWithDetails[]>([mockSpkItem]),
      isLoading: signal(false),
      getSpkList: vi.fn().mockResolvedValue([mockSpkItem]),
      getProductionOrders: vi.fn().mockResolvedValue([
        { id: 'pp-1', document_number: 'PP-260913-001' } as ProductionOrderDetail,
      ]),
      getOperatorProfiles: vi.fn().mockResolvedValue([mockOp]),
      getEligibleBundles: vi.fn().mockResolvedValue([mockBundle]),
      createSpk: vi.fn().mockResolvedValue({
        id: 'spk-2',
        documentNumber: 'SPK-POT-260913-002',
        stage: 'cutting',
      }),
    };

    await TestBed.configureTestingModule({
      imports: [SpkComponent],
      providers: [{ provide: ProductionService, useValue: mockProductionService }],
    }).compileComponents();

    fixture = TestBed.createComponent(SpkComponent);
    component = fixture.componentInstance;
  });

  it('should initialize and list SPK items', async () => {
    expect(component).toBeTruthy();
    await component.loadData();
    expect(mockProductionService.getSpkList).toHaveBeenCalledWith('cutting');
    expect(component.filteredSpk().length).toBe(1);
  });

  it('should switch stage tab', async () => {
    await component.setStage('printing');
    expect(component.activeStage()).toBe('printing');
    expect(mockProductionService.getSpkList).toHaveBeenCalledWith('printing');
  });

  it('should create SPK on valid form submit', async () => {
    await component.openCreateModal();
    component.selectedPpId.set('pp-1');
    component.selectedOperatorId.set('op-1');
    component.targetPcs.set(100);

    await component.submitCreateSpk();
    expect(mockProductionService.createSpk).toHaveBeenCalledWith({
      productionOrderId: 'pp-1',
      stage: 'cutting',
      operatorId: 'op-1',
      targetPcs: 100,
      notes: '',
      bundleIds: undefined,
    });
    expect(component.isCreateModalOpen()).toBe(false);
  });
});
