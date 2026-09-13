import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { MonthlyDepreciationComponent } from './monthly-depreciation.component';
import { AssetService } from '../../../core/services/asset.service';

describe('MonthlyDepreciationComponent', () => {
  let component: MonthlyDepreciationComponent;
  let fixture: ComponentFixture<MonthlyDepreciationComponent>;
  let mockAssetService: any;

  const mockPreview = {
    periodMonth: '2026-09',
    totalEligibleAssets: 2,
    totalEligibleAmount: 250000,
    totalIneligibleAssets: 1,
    eligibleAssets: [
      {
        assetId: 'ast-1',
        assetCode: 'AST-260913-001-L1-1',
        name: 'Mesin Jahit Singer',
        categoryName: 'Mesin Produksi',
        acquisitionCost: 6000000,
        residualValue: 0,
        depreciationMethod: 'straight_line',
        usefulLifeMonths: 48,
        periodNumber: 1,
        accumulatedDepreciation: 0,
        bookValueBefore: 6000000,
        depreciationAmount: 125000,
        bookValueAfter: 5875000,
      },
      {
        assetId: 'ast-2',
        assetCode: 'AST-260913-001-L1-2',
        name: 'Mesin Obras Juki',
        categoryName: 'Mesin Produksi',
        acquisitionCost: 6000000,
        residualValue: 0,
        depreciationMethod: 'straight_line',
        usefulLifeMonths: 48,
        periodNumber: 1,
        accumulatedDepreciation: 0,
        bookValueBefore: 6000000,
        depreciationAmount: 125000,
        bookValueAfter: 5875000,
      },
    ],
    ineligibleAssets: [
      {
        assetId: 'ast-3',
        assetCode: 'AST-260913-001-L1-3',
        name: 'Komputer Desain',
        categoryName: 'Komputer & Elektronik',
        acquisitionCost: 8000000,
        accumulatedDepreciation: 0,
        reason: 'Perlu Pengaturan Penyusutan',
      },
    ],
  };

  beforeEach(async () => {
    mockAssetService = {
      depreciationPreview: signal(mockPreview),
      depreciationHistory: signal([
        {
          id: 'dep-doc-1',
          documentNumber: 'DP-260831-001',
          periodMonth: '2026-08',
          transactionDate: '2026-08-31',
          totalAmount: 250000,
          assetCount: 2,
          status: 'posted',
          notes: 'Penyusutan Agustus',
          postedAt: '2026-08-31T17:00:00Z',
        },
      ]),
      loading: signal(false),
      loadDepreciationPreview: vi.fn().mockResolvedValue(mockPreview),
      loadDepreciationHistory: vi.fn().mockResolvedValue([]),
      postMonthlyDepreciation: vi.fn().mockResolvedValue({
        id: 'dep-doc-2',
        documentNumber: 'DP-260930-001',
        totalAmount: 250000,
        assetCount: 2,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [MonthlyDepreciationComponent],
      providers: [{ provide: AssetService, useValue: mockAssetService }],
    }).compileComponents();

    fixture = TestBed.createComponent(MonthlyDepreciationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create component and compute KPIs correctly', () => {
    expect(component).toBeTruthy();
    expect(component.totalEligibleCount()).toBe(2);
    expect(component.totalEligibleAmount()).toBe(250000);
    expect(component.totalIneligibleCount()).toBe(1);
  });

  it('should select and deselect assets for posting', () => {
    // Select all is active by default
    expect(component.isAllSelected()).toBe(true);

    component.toggleSelectAll();
    expect(component.selectedAssetIds().size).toBe(0);

    component.toggleAssetSelection('ast-1');
    expect(component.selectedAssetIds().size).toBe(1);
    expect(component.selectedTotalAmount()).toBe(125000);
  });

  it('should handle period change and reload preview', async () => {
    component.onPeriodChange('2026-10');
    expect(component.selectedPeriod()).toBe('2026-10');
    expect(mockAssetService.loadDepreciationPreview).toHaveBeenCalledWith('2026-10');
  });

  it('should open dialog and confirm monthly depreciation posting', async () => {
    component.selectedAssetIds.set(new Set(['ast-1', 'ast-2']));
    component.openPostDialog();
    expect(component.isPostDialogOpen()).toBe(true);

    component.postNotes.set('Penyusutan September 2026');
    await component.confirmPostDepreciation();

    expect(mockAssetService.postMonthlyDepreciation).toHaveBeenCalledWith(
      component.selectedPeriod(),
      ['ast-1', 'ast-2'],
      'Penyusutan September 2026'
    );
    expect(component.isPostDialogOpen()).toBe(false);
  });
});
