import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportService } from '../../../core/services/report.service';
import { TrialBalanceComponent } from './trial-balance.component';

describe('TrialBalanceComponent', () => {
  let component: TrialBalanceComponent;
  let fixture: ComponentFixture<TrialBalanceComponent>;
  let mockReportService: any;

  const mockTrialBalance = {
    companyId: 'company-123',
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    isBalanced: true,
    difference: 0,
    summary: {
      totalOpeningDebit: 1000000,
      totalOpeningCredit: 1000000,
      totalPeriodDebit: 500000,
      totalPeriodCredit: 500000,
      totalClosingDebit: 1500000,
      totalClosingCredit: 1500000,
      difference: 0,
      isBalanced: true,
    },
    accounts: [
      {
        id: 'acc-1',
        code: '1-1.1.01',
        name: 'Kas Kecil',
        level1: 'AKTIVA',
        level2: 'AKTIVA LANCAR',
        level3: 'KAS DAN BANK',
        accountType: 'asset',
        normalBalance: 'debit',
        reportSign: 'positive',
        openingDebit: 1000000,
        openingCredit: 0,
        periodDebit: 500000,
        periodCredit: 200000,
        closingDebit: 1300000,
        closingCredit: 0,
        openingBalance: 1000000,
        periodMovement: 300000,
        closingBalance: 1300000,
      },
      {
        id: 'acc-2',
        code: '2-1.1.01',
        name: 'Hutang Dagang',
        level1: 'KEWAJIBAN',
        level2: 'HUTANG JANGKA PENDEK',
        level3: 'HUTANG DAGANG',
        accountType: 'liability',
        normalBalance: 'credit',
        reportSign: 'positive',
        openingDebit: 0,
        openingCredit: 1000000,
        periodDebit: 200000,
        periodCredit: 500000,
        closingDebit: 0,
        closingCredit: 1300000,
        openingBalance: -1000000,
        periodMovement: -300000,
        closingBalance: -1300000,
      },
    ],
  };

  beforeEach(async () => {
    mockReportService = {
      dateFrom: signal('2026-09-01'),
      dateTo: signal('2026-09-30'),
      trialBalance: signal(mockTrialBalance),
      loading: signal(false),
      setDateRange: vi.fn(),
      loadTrialBalance: vi.fn().mockResolvedValue(mockTrialBalance),
    };

    await TestBed.configureTestingModule({
      imports: [TrialBalanceComponent],
      providers: [{ provide: ReportService, useValue: mockReportService }],
    }).compileComponents();

    fixture = TestBed.createComponent(TrialBalanceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and display trial balance accounts', () => {
    expect(component).toBeTruthy();
    expect(component.filteredAccounts().length).toBe(2);
    expect(component.availableLevels()).toContain('AKTIVA');
    expect(component.availableLevels()).toContain('KEWAJIBAN');
  });

  it('should filter accounts by search query', () => {
    component.searchQuery.set('Kas');
    expect(component.filteredAccounts().length).toBe(1);
    expect(component.filteredAccounts()[0].code).toBe('1-1.1.01');
  });

  it('should filter accounts by Level 1 category', () => {
    component.setLevelFilter('KEWAJIBAN');
    expect(component.filteredAccounts().length).toBe(1);
    expect(component.filteredAccounts()[0].code).toBe('2-1.1.01');

    component.setLevelFilter('ALL');
    expect(component.filteredAccounts().length).toBe(2);
  });

  it('should refresh data through report service', async () => {
    component.dateFrom.set('2026-08-01');
    component.dateTo.set('2026-08-31');
    await component.refreshData();

    expect(mockReportService.setDateRange).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
    expect(mockReportService.loadTrialBalance).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
  });

  it('should format currency correctly', () => {
    expect(component.formatRupiah(1500000)).toContain('1.500.000');
  });
});
