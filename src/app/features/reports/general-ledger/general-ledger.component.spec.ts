import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeneralLedgerReport, ReportService } from '../../../core/services/report.service';
import { GeneralLedgerComponent } from './general-ledger.component';

describe('GeneralLedgerComponent', () => {
  let component: GeneralLedgerComponent;
  let fixture: ComponentFixture<GeneralLedgerComponent>;
  let mockReportService: any;

  const mockAccounts = [
    {
      id: 'acc-1',
      code: '1-1.1.01',
      name: 'Kas Kecil',
      level1: 'AKTIVA',
      level2: 'AKTIVA LANCAR',
      level3: 'KAS DAN BANK',
      accountType: 'asset',
      normalBalance: 'debit' as const,
    },
  ];

  const mockLedger: GeneralLedgerReport = {
    account: {
      id: 'acc-1',
      code: '1-1.1.01',
      name: 'Kas Kecil',
      level1: 'AKTIVA',
      level2: 'AKTIVA LANCAR',
      level3: 'KAS DAN BANK',
      accountType: 'asset',
      normalBalance: 'debit',
      reportSign: 'positive',
    },
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    openingBalance: 1000000,
    totalDebit: 500000,
    totalCredit: 200000,
    endingBalance: 1300000,
    totalCount: 1,
    limit: 100,
    offset: 0,
    entries: [
      {
        id: 'line-1',
        journalEntryId: 'je-1',
        entryNumber: 'JRN-001',
        transactionDate: '2026-09-05',
        documentNumber: 'TRM-001',
        documentKind: 'sales_receipt',
        memo: 'Penerimaan Penjualan',
        description: 'Kas Kecil',
        debit: 500000,
        credit: 0,
        runningBalance: 1500000,
      },
    ],
  };

  beforeEach(async () => {
    mockReportService = {
      dateFrom: signal('2026-09-01'),
      dateTo: signal('2026-09-30'),
      availableAccounts: signal(mockAccounts),
      generalLedger: signal(mockLedger),
      loading: signal(false),
      loadAvailableAccounts: vi.fn().mockResolvedValue(mockAccounts),
      loadGeneralLedger: vi.fn().mockResolvedValue(mockLedger),
      setDateRange: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [GeneralLedgerComponent],
      providers: [{ provide: ReportService, useValue: mockReportService }],
    }).compileComponents();

    fixture = TestBed.createComponent(GeneralLedgerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and display general ledger entries', () => {
    expect(component).toBeTruthy();
    expect(component.generalLedger()?.account.code).toBe('1-1.1.01');
    expect(component.generalLedger()?.openingBalance).toBe(1000000);
    expect(component.generalLedger()?.endingBalance).toBe(1300000);
  });

  it('should switch account when selected', async () => {
    component.onAccountSelected('acc-1');
    expect(component.selectedAccountId()).toBe('acc-1');
    expect(mockReportService.loadGeneralLedger).toHaveBeenCalled();
  });

  it('should format rupiah correctly', () => {
    expect(component.formatRupiah(1300000)).toContain('1.300.000');
  });
});
