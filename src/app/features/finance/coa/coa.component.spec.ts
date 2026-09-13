import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { CoaComponent } from './coa.component';
import { FinanceService } from '../../../core/services/finance.service';
import { CompanyService } from '../../../core/services/company.service';

describe('CoaComponent', () => {
  let component: CoaComponent;
  let fixture: ComponentFixture<CoaComponent>;
  let mockFinanceService: any;
  let mockCompanyService: any;

  beforeEach(async () => {
    mockFinanceService = {
      ledgerAccounts: signal([
        { id: '1', code: '1-1.1.01', name: 'Kas Kecil', account_type: 'asset', is_active: true, level1: 'AKTIVA', level2: 'AKTIVA LANCAR' },
        { id: '2', code: '2-1.1.01', name: 'Hutang Pemasok', account_type: 'liability', is_active: true, level1: 'KEWAJIBAN', level2: 'KEWAJIBAN LANCAR' },
      ]),
      systemMappings: signal([
        { mappingKey: 'cash', label: 'Kas/Bank', accountType: 'asset', accountId: '1', isCompatible: true },
      ]),
      reportMappings: signal([
        { accountId: '1', accountCode: '1-1.1.01', accountName: 'Kas Kecil', accountType: 'asset', managementPost: null, cashFlowActivity: 'operating', cashFlowGroup: 'other' },
      ]),
      loading: signal(false),
      loadLedgerAccounts: vi.fn().mockResolvedValue([]),
      loadAccountingMappings: vi.fn().mockResolvedValue([]),
      loadReportAccountMappings: vi.fn().mockResolvedValue([]),
      updateAccountStatus: vi.fn().mockResolvedValue({}),
      saveAccountingMappings: vi.fn().mockResolvedValue({}),
      saveReportAccountMappings: vi.fn().mockResolvedValue({}),
    };

    mockCompanyService = {
      activeCompanyId: signal('comp-1'),
    };

    await TestBed.configureTestingModule({
      imports: [CoaComponent],
      providers: [
        { provide: FinanceService, useValue: mockFinanceService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CoaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create CoaComponent and load data', () => {
    expect(component).toBeTruthy();
    expect(mockFinanceService.loadLedgerAccounts).toHaveBeenCalled();
    expect(component.totalAccounts()).toBe(2);
    expect(component.activeAccountsCount()).toBe(2);
  });

  it('should switch tabs', () => {
    expect(component.activeTab()).toBe('accounts');
    component.activeTab.set('system');
    expect(component.activeTab()).toBe('system');
    component.activeTab.set('report');
    expect(component.activeTab()).toBe('report');
  });

  it('should filter accounts by search query', () => {
    component.searchQuery.set('Kas');
    expect(component.filteredAccounts().length).toBe(1);
    expect(component.filteredAccounts()[0].code).toBe('1-1.1.01');
  });
});
