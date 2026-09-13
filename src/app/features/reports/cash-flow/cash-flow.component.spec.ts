import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CashFlowSummary, ReportService } from '../../../core/services/report.service';
import { CashFlowComponent } from './cash-flow.component';

describe('CashFlowComponent', () => {
  let component: CashFlowComponent;
  let fixture: ComponentFixture<CashFlowComponent>;
  let mockReportService: any;

  const mockCashFlow: CashFlowSummary = {
    companyId: 'company-123',
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    openingCashBalance: 2000000,
    closingCashBalance: 3500000,
    netCashChange: 1500000,
    operatingActivities: {
      customerReceipts: 5000000,
      supplierPayments: -2000000,
      payrollAndOperating: -1500000,
      otherOperating: 0,
      netOperatingCashFlow: 1500000,
    },
    investingActivities: {
      assetPurchases: 0,
      assetDisposals: 0,
      otherInvesting: 0,
      netInvestingCashFlow: 0,
    },
    financingActivities: {
      ownerContributions: 0,
      ownerDrawings: 0,
      debtFinancing: 0,
      otherFinancing: 0,
      netFinancingCashFlow: 0,
    },
    reconciliation: {
      cashMovementBalance: 3500000,
      glCashBalance: 3500000,
      difference: 0,
      isMatched: true,
    },
    items: [],
  };

  beforeEach(async () => {
    mockReportService = {
      dateFrom: signal('2026-09-01'),
      dateTo: signal('2026-09-30'),
      cashFlow: signal(mockCashFlow),
      loading: signal(false),
      setDateRange: vi.fn(),
      loadCashFlow: vi.fn().mockResolvedValue(mockCashFlow),
    };

    await TestBed.configureTestingModule({
      imports: [CashFlowComponent],
      providers: [{ provide: ReportService, useValue: mockReportService }],
    }).compileComponents();

    fixture = TestBed.createComponent(CashFlowComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and display cash flow summary', () => {
    expect(component).toBeTruthy();
    expect(component.cashFlow()?.openingCashBalance).toBe(2000000);
    expect(component.cashFlow()?.closingCashBalance).toBe(3500000);
    expect(component.cashFlow()?.netCashChange).toBe(1500000);
  });

  it('should refresh data when dates change', async () => {
    component.dateFrom.set('2026-08-01');
    component.dateTo.set('2026-08-31');
    await component.refreshData();

    expect(mockReportService.setDateRange).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
    expect(mockReportService.loadCashFlow).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
  });

  it('should format rupiah correctly', () => {
    expect(component.formatRupiah(3500000)).toContain('3.500.000');
  });
});
