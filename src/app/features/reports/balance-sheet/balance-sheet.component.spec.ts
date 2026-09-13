import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BalanceSheetSummary, ReportService } from '../../../core/services/report.service';
import { BalanceSheetComponent } from './balance-sheet.component';

describe('BalanceSheetComponent', () => {
  let component: BalanceSheetComponent;
  let fixture: ComponentFixture<BalanceSheetComponent>;
  let mockReportService: any;

  const mockBalanceSheet: BalanceSheetSummary = {
    companyId: 'company-123',
    asOfDate: '2026-09-30',
    totalCurrentAssets: 5000000,
    totalFixedAssets: 10000000,
    totalOtherAssets: 0,
    totalAssets: 15000000,
    totalCurrentLiabilities: 3000000,
    totalLongTermLiabilities: 2000000,
    totalLiabilities: 5000000,
    totalGlEquity: 8000000,
    priorYearUnclosedEarnings: 1000000,
    currentYearEarnings: 1000000,
    totalEquity: 10000000,
    totalLiabilitiesAndEquity: 15000000,
    difference: 0,
    isBalanced: true,
    sections: {
      currentAssets: [
        { id: 'acc-1', code: '1-1.1.01', name: 'Kas Kecil', level2: 'AKTIVA LANCAR', level3: 'KAS DAN BANK', amount: 5000000 },
      ],
      fixedAssets: [
        { id: 'acc-2', code: '1-2.0.04', name: 'Peralatan Kantor', level2: 'AKTIVA TETAP', level3: 'AKTIVA TETAP', amount: 12000000 },
        { id: 'acc-3', code: '1-2.1.03', name: 'Ak. Peny. Peralatan Kantor', level2: 'AKTIVA TETAP', level3: 'PENYUSUTAN AKTIVA TETAP', amount: 2000000, isContra: true },
      ],
      otherAssets: [],
      currentLiabilities: [
        { id: 'acc-4', code: '2-1.1.01', name: 'Hutang Dagang', level2: 'HUTANG JANGKA PENDEK', level3: 'HUTANG DAGANG', amount: 3000000 },
      ],
      longTermLiabilities: [
        { id: 'acc-5', code: '2-2.0.01', name: 'Hutang Bank', level2: 'HUTANG JANGKA PANJANG', level3: 'HUTANG JANGKA PANJANG', amount: 2000000 },
      ],
      equity: [
        { id: 'acc-6', code: '3-1.0.00', name: 'Modal Saham', level2: 'MODAL', level3: 'MODAL', amount: 8000000 },
      ],
    },
  };

  beforeEach(async () => {
    mockReportService = {
      dateTo: signal('2026-09-30'),
      balanceSheet: signal(mockBalanceSheet),
      loading: signal(false),
      loadBalanceSheet: vi.fn().mockResolvedValue(mockBalanceSheet),
    };

    await TestBed.configureTestingModule({
      imports: [BalanceSheetComponent],
      providers: [{ provide: ReportService, useValue: mockReportService }],
    }).compileComponents();

    fixture = TestBed.createComponent(BalanceSheetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and display balance sheet values', () => {
    expect(component).toBeTruthy();
    expect(component.balanceSheet()?.totalAssets).toBe(15000000);
    expect(component.balanceSheet()?.totalLiabilitiesAndEquity).toBe(15000000);
    expect(component.balanceSheet()?.isBalanced).toBe(true);
  });

  it('should refresh data when asOfDate changes', async () => {
    component.asOfDate.set('2026-12-31');
    await component.refreshData();
    expect(mockReportService.loadBalanceSheet).toHaveBeenCalledWith('2026-12-31');
  });

  it('should format rupiah correctly', () => {
    expect(component.formatRupiah(15000000)).toContain('15.000.000');
  });
});
