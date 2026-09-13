import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { ReconciliationComponent } from './reconciliation.component';
import { ReportService, AccountingReconciliationSummary } from '../../../core/services/report.service';

describe('ReconciliationComponent', () => {
  let component: ReconciliationComponent;
  let fixture: ComponentFixture<ReconciliationComponent>;

  const mockReconciliation: AccountingReconciliationSummary = {
    companyId: 'c-1',
    asOfDate: '2026-09-13',
    allMatched: true,
    matchedCount: 6,
    totalCount: 6,
    items: [
      {
        key: 'cash_bank',
        title: 'Kas & Bank',
        category: 'Kas & Setara Kas',
        subledgerAmount: 50000000,
        glAmount: 50000000,
        variance: 0,
        isMatched: true,
        controlAccountCode: '1-1.1.xx',
      },
      {
        key: 'receivable',
        title: 'Piutang Usaha',
        category: 'Piutang Pelanggan',
        subledgerAmount: 20000000,
        glAmount: 20000000,
        variance: 0,
        isMatched: true,
        controlAccountCode: '1-1.2.01',
      },
      {
        key: 'supplier_payable',
        title: 'Hutang Usaha',
        category: 'Hutang Pemasok',
        subledgerAmount: 15000000,
        glAmount: 15000000,
        variance: 0,
        isMatched: true,
        controlAccountCode: '2-1.1.01',
      },
      {
        key: 'inventory',
        title: 'Persediaan',
        category: 'Inventaris Fisik & WIP',
        subledgerAmount: 30000000,
        glAmount: 30000000,
        variance: 0,
        isMatched: true,
        controlAccountCode: '1-1.4.xx',
      },
      {
        key: 'fixed_assets',
        title: 'Aset Tetap',
        category: 'Biaya Perolehan Register Aset',
        subledgerAmount: 100000000,
        glAmount: 100000000,
        variance: 0,
        isMatched: true,
        controlAccountCode: '1-2.0.xx',
      },
      {
        key: 'accumulated_depreciation',
        title: 'Akumulasi Penyusutan',
        category: 'Akumulasi Beban Depresiasi',
        subledgerAmount: 10000000,
        glAmount: 10000000,
        variance: 0,
        isMatched: true,
        controlAccountCode: '1-2.1.xx',
      },
    ],
  };

  const reportServiceMock = {
    dateTo: signal<string>('2026-09-13'),
    loading: signal<boolean>(false),
    error: signal<string | null>(null),
    reconciliation: signal<AccountingReconciliationSummary | null>(mockReconciliation),
    loadReconciliation: vi.fn().mockResolvedValue(mockReconciliation),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReconciliationComponent],
      providers: [
        provideRouter([]),
        { provide: ReportService, useValue: reportServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReconciliationComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should run reconciliation on init and compute metrics', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(reportServiceMock.loadReconciliation).toHaveBeenCalled();
    expect(component.reconciliationData()).toEqual(mockReconciliation);
    expect(component.allMatched()).toBe(true);
    expect(component.matchedCount()).toBe(6);
    expect(component.totalCount()).toBe(6);
    expect(component.reconciliationRatePct()).toBe(100);
    expect(component.totalVariance()).toBe(0);
  });

  it('should resolve correct module routes for keys', () => {
    expect(component.getModuleRoute('cash_bank')).toBe('/workspace/finance/cash-bank');
    expect(component.getModuleRoute('receivable')).toBe('/workspace/sales/orders');
    expect(component.getModuleRoute('supplier_payable')).toBe('/workspace/purchasing/materials');
    expect(component.getModuleRoute('inventory')).toBe('/workspace/inventory');
    expect(component.getModuleRoute('fixed_assets')).toBe('/workspace/assets');
    expect(component.getModuleRoute('accumulated_depreciation')).toBe('/workspace/assets');
    expect(component.getModuleRoute('unknown')).toBe('/workspace/finance/journals');
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
