import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HppReportComponent } from './hpp-report.component';
import { ReportService, HppManufacturingSummary } from '../../../core/services/report.service';

describe('HppReportComponent', () => {
  let component: HppReportComponent;
  let fixture: ComponentFixture<HppReportComponent>;

  const mockSummary: HppManufacturingSummary = {
    companyId: 'c-1',
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    directMaterialCost: 5000000,
    directLaborCost: 2000000,
    laborBreakdown: {
      cutting: 500000,
      printing: 200000,
      sewing: 1000000,
      packing: 200000,
      headFee: 100000,
    },
    factoryOverhead: 1500000,
    overheadBreakdown: {
      supplies: 500000,
      depreciation: 700000,
      other: 300000,
    },
    totalManufacturingCost: 8500000,
    cogsReconciliation: {
      actualCogs: 8500000,
      glCogs: 8500000,
      difference: 0,
      isMatched: true,
    },
    materialsBreakdown: [
      {
        itemId: 'i-1',
        itemName: 'Kain Katun',
        quantityUsed: 100,
        totalCost: 5000000,
      },
    ],
    productsBreakdown: [
      {
        productId: 'p-1',
        sku: 'TSHIRT-01',
        name: 'Kaos Polos',
        quantityProduced: 100,
        quantitySold: 80,
        totalProductionCost: 8500000,
        totalSoldCogs: 6800000,
        actualHppPerUnit: 85000,
        bomStandardHpp: 80000,
        variance: 5000,
        variancePercent: 6.25,
      },
    ],
  };

  const reportServiceMock = {
    dateFrom: signal<string>('2026-01-01'),
    dateTo: signal<string>('2026-01-31'),
    loading: signal<boolean>(false),
    error: signal<string | null>(null),
    hppSummary: signal<HppManufacturingSummary | null>(mockSummary),
    loadHppSummary: vi.fn().mockResolvedValue(mockSummary),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HppReportComponent],
      providers: [{ provide: ReportService, useValue: reportServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(HppReportComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should load HPP summary on init and compute totals', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(reportServiceMock.loadHppSummary).toHaveBeenCalled();
    expect(component.summaryData()).toEqual(mockSummary);
    expect(component.directMaterialCost()).toBe(5000000);
    expect(component.directLaborCost()).toBe(2000000);
    expect(component.factoryOverhead()).toBe(1500000);
    expect(component.totalManufacturingCost()).toBe(8500000);
    expect(component.isMatched()).toBe(true);
  });

  it('should handle CSV export trigger', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const removeChildSpy = vi.spyOn(document.body, 'removeChild');

    component.exportCsv();

    expect(appendChildSpy).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();
  });
});
