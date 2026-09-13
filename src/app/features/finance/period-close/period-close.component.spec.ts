import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { PeriodCloseComponent } from './period-close.component';
import { FinanceService } from '../../../core/services/finance.service';
import { CompanyService } from '../../../core/services/company.service';

describe('PeriodCloseComponent', () => {
  let component: PeriodCloseComponent;
  let fixture: ComponentFixture<PeriodCloseComponent>;
  let mockFinanceService: any;
  let mockCompanyService: any;

  beforeEach(async () => {
    mockFinanceService = {
      accountingPeriods: signal([
        {
          id: 'p-1',
          periodMonth: '2026-08',
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          status: 'closed',
          state: 'closed',
          openingState: 'none',
          closeSummary: {},
          closedAt: '2026-09-01T00:00:00Z',
          closedByUserId: 'user-1',
          reopenedAt: null,
          reopenReason: null,
        },
        {
          id: 'p-2',
          periodMonth: '2026-09',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
          status: 'open',
          state: 'open',
          openingState: 'none',
          closeSummary: null,
          closedAt: null,
          closedByUserId: null,
          reopenedAt: null,
          reopenReason: null,
        },
      ]),
      activePeriod: signal({
        id: 'p-2',
        periodMonth: '2026-09',
        status: 'open',
      }),
      loading: signal(false),
      loadAccountingPeriods: vi.fn().mockResolvedValue([]),
      checkPeriodIntegrity: vi.fn().mockResolvedValue({
        periodMonth: '2026-09',
        balancedJournals: true,
        totalDebit: 10000000,
        totalCredit: 10000000,
        pendingDrafts: 0,
        cashReconciled: true,
        canClose: true,
        errors: [],
      }),
      closePeriod: vi.fn().mockResolvedValue({}),
      reopenPeriod: vi.fn().mockResolvedValue({}),
    };

    mockCompanyService = {
      isOwner: signal(true),
    };

    await TestBed.configureTestingModule({
      imports: [PeriodCloseComponent],
      providers: [
        { provide: FinanceService, useValue: mockFinanceService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PeriodCloseComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create PeriodCloseComponent and run integrity check', () => {
    expect(component).toBeTruthy();
    expect(mockFinanceService.loadAccountingPeriods).toHaveBeenCalled();
    expect(mockFinanceService.checkPeriodIntegrity).toHaveBeenCalled();

    expect(component.openPeriodsCount()).toBe(1);
    expect(component.closedPeriodsCount()).toBe(1);
    expect(component.integrityCheckResult()?.canClose).toBe(true);
  });

  it('should open close modal when checks pass and submit closePeriod', async () => {
    component.openCloseModal();
    expect(component.isCloseModalOpen()).toBe(true);

    await component.submitClose();
    expect(mockFinanceService.closePeriod).toHaveBeenCalledWith(component.selectedPeriodMonth());
    expect(component.isCloseModalOpen()).toBe(false);
    expect(component.successMessage()).toContain('berhasil ditutup');
  });

  it('should require owner authorization and reason to reopen period', async () => {
    const closedPeriod = mockFinanceService.accountingPeriods()[0];

    // Case 1: not owner
    mockCompanyService.isOwner.set(false);
    component.openReopenModal(closedPeriod);
    expect(component.errorMessage()).toContain('Hanya Owner');
    expect(component.isReopenModalOpen()).toBe(false);

    // Case 2: owner, but empty reason
    mockCompanyService.isOwner.set(true);
    component.openReopenModal(closedPeriod);
    expect(component.isReopenModalOpen()).toBe(true);
    component.reopenReason.set('');
    await component.submitReopen();
    expect(component.errorMessage()).toContain('Alasan pembukaan kembali');

    // Case 3: valid reason
    component.reopenReason.set('Audit penyesuaian');
    await component.submitReopen();
    expect(mockFinanceService.reopenPeriod).toHaveBeenCalledWith('2026-08', 'Audit penyesuaian');
    expect(component.isReopenModalOpen()).toBe(false);
    expect(component.successMessage()).toContain('berhasil dibuka kembali');
  });
});
