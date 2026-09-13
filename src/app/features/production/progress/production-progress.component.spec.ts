import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EligibleBundleItem,
  ProductionProgressSummaryItem,
  ProductionService,
} from '../../../core/services/production.service';
import { ProductionProgressComponent } from './production-progress.component';

describe('ProductionProgressComponent', () => {
  let component: ProductionProgressComponent;
  let fixture: ComponentFixture<ProductionProgressComponent>;
  let mockProductionService: {
    progressSummary: ReturnType<typeof signal<ProductionProgressSummaryItem[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getProgressSummary: ReturnType<typeof vi.fn>;
    getAllBundles: ReturnType<typeof vi.fn>;
  };

  const mockSummary: ProductionProgressSummaryItem = {
    id: 'pp-1',
    documentNumber: 'PP-260913-001',
    targetDate: '2026-09-20',
    status: 'draft',
    codeLocked: true,
    notes: 'Order lebaran',
    targetPcs: 100,
    actualCuttingPcs: 100,
    actualPrintingPcs: 95,
    actualSewingPcs: 90,
    actualPackingPcs: 90,
    activeBundleCount: 2,
    activeRepairCount: 1,
    completionPercentage: 90,
  };

  const mockBundle: EligibleBundleItem = {
    id: 'b-1',
    bundle_code: 'IKT-01',
    product_id: 'prod-1',
    product_name: 'Kaos Polos',
    initial_quantity: 50,
    active_quantity: 50,
    stage: 'printing',
    work_condition: 'available',
    production_order_id: 'pp-1',
    production_order_number: 'PP-260913-001',
  };

  beforeEach(async () => {
    mockProductionService = {
      progressSummary: signal<ProductionProgressSummaryItem[]>([mockSummary]),
      isLoading: signal(false),
      getProgressSummary: vi.fn().mockResolvedValue([mockSummary]),
      getAllBundles: vi.fn().mockResolvedValue([mockBundle]),
    };

    await TestBed.configureTestingModule({
      imports: [ProductionProgressComponent],
      providers: [{ provide: ProductionService, useValue: mockProductionService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductionProgressComponent);
    component = fixture.componentInstance;
  });

  it('should initialize and calculate overall KPIs', async () => {
    expect(component).toBeTruthy();
    await component.loadData();
    expect(mockProductionService.getProgressSummary).toHaveBeenCalled();
    expect(mockProductionService.getAllBundles).toHaveBeenCalled();

    expect(component.totalTargetPcs()).toBe(100);
    expect(component.totalCuttingPcs()).toBe(100);
    expect(component.totalPrintingPcs()).toBe(95);
    expect(component.totalSewingPcs()).toBe(90);
    expect(component.totalPackingPcs()).toBe(90);
    expect(component.overallCompletion()).toBe(90);
    expect(component.bundles().length).toBe(1);
  });

  it('should filter bundles by search query', () => {
    component.bundles.set([mockBundle]);
    component.bundleSearch.set('IKT-01');
    expect(component.filteredBundles().length).toBe(1);

    component.bundleSearch.set('NONEXISTENT');
    expect(component.filteredBundles().length).toBe(0);
  });
});
