import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfitLossSummary, ReportService } from '../../../core/services/report.service';
import { ProfitLossComponent } from './profit-loss.component';

describe('ProfitLossComponent', () => {
  let component: ProfitLossComponent;
  let fixture: ComponentFixture<ProfitLossComponent>;
  let mockReportService: any;

  const mockProfitLoss: ProfitLossSummary = {
    companyId: 'company-123',
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    grossSales: 12000000,
    salesDeductions: -500000,
    netRevenue: 11500000,
    totalCogs: 6000000,
    grossProfit: 5500000,
    totalOperatingExpenses: 2000000,
    operatingProfit: 3500000,
    totalOtherIncome: 100000,
    totalOtherExpenses: 50000,
    netIncome: 3550000,
    grossProfitMargin: 47.83,
    netProfitMargin: 30.87,
    sections: {
      sales: [
        { id: 'acc-1', code: '4-1.0.01', name: 'Penjualan', level2: 'PENDAPATAN USAHA', level3: 'PENJUALAN', amount: 12000000 },
      ],
      salesDeductions: [
        { id: 'acc-2', code: '4-1.1.01', name: 'Diskon Penjualan', level2: 'PENDAPATAN USAHA', level3: 'POTONGAN PENJUALAN', amount: -500000 },
      ],
      cogs: [
        { id: 'acc-3', code: '5-1.1.00', name: 'HPP Produk', level2: 'HPP', level3: 'HPP', amount: 6000000 },
      ],
      operatingExpenses: [
        { id: 'acc-4', code: '6-1.1.01', name: 'Biaya Gaji', level2: 'BIAYA UMUM', level3: 'BIAYA GAJI DAN UPAH', amount: 2000000 },
      ],
      otherIncome: [],
      otherExpenses: [],
    },
  };

  beforeEach(async () => {
    mockReportService = {
      dateFrom: signal('2026-09-01'),
      dateTo: signal('2026-09-30'),
      profitLoss: signal(mockProfitLoss),
      loading: signal(false),
      setDateRange: vi.fn(),
      loadProfitLoss: vi.fn().mockResolvedValue(mockProfitLoss),
    };

    await TestBed.configureTestingModule({
      imports: [ProfitLossComponent],
      providers: [{ provide: ReportService, useValue: mockReportService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfitLossComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and display profit loss metrics', () => {
    expect(component).toBeTruthy();
    expect(component.profitLoss()?.netRevenue).toBe(11500000);
    expect(component.profitLoss()?.grossProfit).toBe(5500000);
    expect(component.profitLoss()?.netIncome).toBe(3550000);
  });

  it('should handle quick period filters', () => {
    component.setQuickPeriod('this_quarter');
    expect(component.activePeriod()).toBe('this_quarter');
    expect(mockReportService.setDateRange).toHaveBeenCalled();

    component.setQuickPeriod('this_year');
    expect(component.activePeriod()).toBe('this_year');
    expect(component.dateFrom()).toContain('-01-01');
  });

  it('should format rupiah correctly', () => {
    expect(component.formatRupiah(11500000)).toContain('11.500.000');
  });
});
