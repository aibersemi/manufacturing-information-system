import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { CompanyService } from '../../core/services/company.service';
import { ProductionService } from '../../core/services/production.service';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let mockAuthService: {
    currentUser: ReturnType<typeof signal>;
  };
  let mockCompanyService: {
    activeCompanyId: ReturnType<typeof signal<string | null>>;
    activeCompany: ReturnType<typeof computed>;
  };
  let mockProductionService: {
    productionOrders: ReturnType<typeof signal<any[]>>;
    progressSummary: ReturnType<typeof signal<any[]>>;
    spkList: ReturnType<typeof signal<any[]>>;
    repairCases: ReturnType<typeof signal<any[]>>;
    getProductionOrders: ReturnType<typeof vi.fn>;
    getProgressSummary: ReturnType<typeof vi.fn>;
    getSpkList: ReturnType<typeof vi.fn>;
    getRepairCases: ReturnType<typeof vi.fn>;
  };

  const initialOrders = [
    {
      id: 'po-1',
      document_number: 'PP-260920-001',
      status: 'in_progress',
      lines: [
        {
          quantity: 100,
          product: { name: 'Kemeja Formal Pria' },
        },
      ],
    },
    {
      id: 'po-2',
      document_number: 'PP-260920-002',
      status: 'completed',
      lines: [
        {
          quantity: 50,
          product: { name: 'Celana Chino Slim' },
        },
      ],
    },
  ];

  const initialSummaries = [
    {
      id: 'po-1',
      documentNumber: 'PP-260920-001',
      targetPcs: 100,
      actualCuttingPcs: 100,
      actualPrintingPcs: 50,
      actualSewingPcs: 0,
      actualPackingPcs: 0,
      activeBundleCount: 2,
      activeRepairCount: 0,
      completionPercentage: 50,
    },
    {
      id: 'po-2',
      documentNumber: 'PP-260920-002',
      targetPcs: 50,
      actualCuttingPcs: 50,
      actualPrintingPcs: 50,
      actualSewingPcs: 50,
      actualPackingPcs: 50,
      activeBundleCount: 0,
      activeRepairCount: 0,
      completionPercentage: 100,
    },
  ];

  beforeEach(async () => {
    mockAuthService = {
      currentUser: signal({
        id: 'u-1',
        email: 'e2e_browser@example.com',
        app_metadata: { role: 'head' },
        user_metadata: { role: 'head' },
      } as any),
    };

    const compIdSignal = signal<string | null>('company-dash-1');
    mockCompanyService = {
      activeCompanyId: compIdSignal,
      activeCompany: computed(() => {
        const id = compIdSignal();
        return id ? ({ id, name: 'Dummy Konveksi Test' } as any) : null;
      }),
    };

    mockProductionService = {
      productionOrders: signal<any[]>(initialOrders),
      progressSummary: signal<any[]>(initialSummaries),
      spkList: signal<any[]>([]),
      repairCases: signal<any[]>([]),
      getProductionOrders: vi.fn().mockResolvedValue(initialOrders),
      getProgressSummary: vi.fn().mockResolvedValue(initialSummaries),
      getSpkList: vi.fn().mockResolvedValue([]),
      getRepairCases: vi.fn().mockResolvedValue([]),
    };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuthService },
        { provide: CompanyService, useValue: mockCompanyService },
        { provide: ProductionService, useValue: mockProductionService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the dashboard component', () => {
    expect(component).toBeTruthy();
  });

  it('should display the current user email and role', () => {
    expect(component.userEmail()).toBe('e2e_browser@example.com');
    expect(component.userRole()).toBe('head');
  });

  it('should reflect active company name dynamically', () => {
    expect(component.companyName()).toBe('Dummy Konveksi Test');
  });

  it('should provide recent work orders list from production service', () => {
    const orders = component.recentWorkOrders();
    expect(orders.length).toBe(2);
    expect(orders[0]?.code).toBe('PP-260920-001');
    expect(orders[0]?.item).toBe('Kemeja Formal Pria');
    expect(orders[0]?.status).toBe('processing');
    expect(orders[1]?.code).toBe('PP-260920-002');
    expect(orders[1]?.status).toBe('completed');
  });

  it('should calculate KPI metrics accurately', () => {
    const output = component.productionOutputMetric();
    expect(output.targetUnits).toBe(150);
    expect(output.completedUnits).toBe(50);
    expect(output.percentage).toBe('33.3');

    const active = component.activeWorkOrdersMetric();
    expect(active.totalActive).toBe(1);
    expect(active.inProgressCount).toBe(1);

    const efficiency = component.productionEfficiencyMetric();
    expect(efficiency.rate).toBe('75.0');

    const qc = component.qualityYieldMetric();
    expect(qc.yieldRate).toBe('100.0');
    expect(qc.defectCount).toBe(0);
  });

  it('should fallback gracefully when data is empty', () => {
    mockProductionService.productionOrders.set([]);
    mockProductionService.progressSummary.set([]);
    mockProductionService.spkList.set([]);
    mockProductionService.repairCases.set([]);

    expect(component.recentWorkOrders()).toEqual([]);
    expect(component.activeWorkOrdersMetric().totalActive).toBe(0);
    expect(component.productionOutputMetric().completedUnits).toBe(0);
    expect(component.productionOutputMetric().targetUnits).toBe(0);
    expect(component.productionOutputMetric().percentage).toBe('0');
    expect(component.productionEfficiencyMetric().rate).toBe('0');
    expect(component.qualityYieldMetric().defectCount).toBe(0);
  });

  it('should return correct badge variants and labels for work order statuses', () => {
    expect(component.getStatusBadgeVariant('completed')).toBe('default');
    expect(component.getStatusLabel('completed')).toBe('Selesai');
    expect(component.getStatusBadgeVariant('processing')).toBe('secondary');
    expect(component.getStatusLabel('processing')).toBe('Sedang Berjalan');
    expect(component.getStatusBadgeVariant('quality_check')).toBe('outline');
    expect(component.getStatusLabel('quality_check')).toBe('Pemeriksaan QC');
    expect(component.getStatusBadgeVariant('queued')).toBe('outline');
    expect(component.getStatusLabel('queued')).toBe('Dalam Antrean');
  });

  it('should filter work orders by query and status', () => {
    component.searchQuery.set('Kemeja');
    expect(component.filteredWorkOrders().length).toBe(1);
    expect(component.filteredWorkOrders()[0]?.item).toBe('Kemeja Formal Pria');

    component.searchQuery.set('');
    component.setStatusFilter('completed');
    expect(component.filteredWorkOrders().length).toBe(1);
    expect(component.filteredWorkOrders()[0]?.code).toBe('PP-260920-002');

    component.setStatusFilter('active');
    expect(component.filteredWorkOrders().length).toBe(1);
    expect(component.filteredWorkOrders()[0]?.code).toBe('PP-260920-001');

    component.setStatusFilter('all');
    expect(component.filteredWorkOrders().length).toBe(2);
  });

  it('should invoke refreshData and reload data from production service', async () => {
    await component.refreshData();
    expect(mockProductionService.getProductionOrders).toHaveBeenCalled();
    expect(mockProductionService.getProgressSummary).toHaveBeenCalled();
    expect(mockProductionService.getSpkList).toHaveBeenCalled();
    expect(mockProductionService.getRepairCases).toHaveBeenCalled();
  });
});
