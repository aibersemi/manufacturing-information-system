import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { AssetRegisterComponent } from './asset-register.component';
import { AssetService } from '../../../core/services/asset.service';

describe('AssetRegisterComponent', () => {
  let component: AssetRegisterComponent;
  let fixture: ComponentFixture<AssetRegisterComponent>;
  let mockAssetService: any;

  beforeEach(async () => {
    mockAssetService = {
      assets: signal([
        {
          id: 'ast-1',
          companyId: 'comp-1',
          assetCode: 'AST-260913-001-L1-1',
          name: 'Mesin Jahit Singer',
          status: 'active',
          categoryId: 'cat-1',
          categoryName: 'Mesin Produksi',
          sourceDocumentId: 'doc-1',
          sourceDocumentNumber: 'BA-260913-001',
          sourcePurchaseLineId: 'line-1',
          acquisitionCost: 6000000,
          residualValue: 0,
          depreciationMethod: 'straight_line',
          usefulLifeMonths: 48,
          capitalizationDate: '2026-09-13',
          depreciationStartDate: '2026-09-13',
          accumulatedDepreciation: 125000,
          bookValue: 5875000,
          location: 'Lantai 1',
          custodian: 'Budi',
          serialNumber: 'SN-001',
          data: {},
          isLocked: true,
          isSetupComplete: true,
          createdAt: '2026-09-13T10:00:00Z',
          updatedAt: '2026-09-13T10:00:00Z',
        },
        {
          id: 'ast-2',
          companyId: 'comp-1',
          assetCode: 'AST-260913-001-L1-2',
          name: 'Mesin Jahit Juki',
          status: 'active',
          categoryId: null,
          categoryName: null,
          sourceDocumentId: 'doc-1',
          sourceDocumentNumber: 'BA-260913-001',
          sourcePurchaseLineId: 'line-1',
          acquisitionCost: 7000000,
          residualValue: 0,
          depreciationMethod: null,
          usefulLifeMonths: null,
          capitalizationDate: '2026-09-13',
          depreciationStartDate: '2026-09-13',
          accumulatedDepreciation: 0,
          bookValue: 7000000,
          location: null,
          custodian: null,
          serialNumber: null,
          data: {},
          isLocked: false,
          isSetupComplete: false,
          createdAt: '2026-09-13T10:00:00Z',
          updatedAt: '2026-09-13T10:00:00Z',
        },
      ]),
      categories: signal([
        { id: 'cat-1', code: 'MESIN', name: 'Mesin Produksi' },
      ]),
      loading: signal(false),
      loadAssets: vi.fn().mockResolvedValue([]),
      loadCategories: vi.fn().mockResolvedValue([]),
      updateAssetParameters: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [AssetRegisterComponent],
      providers: [{ provide: AssetService, useValue: mockAssetService }],
    }).compileComponents();

    fixture = TestBed.createComponent(AssetRegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create component and compute KPIs', () => {
    expect(component).toBeTruthy();
    expect(component.totalActiveUnits()).toBe(2);
    expect(component.totalAcquisitionCost()).toBe(13000000);
    expect(component.totalAccumulatedDepreciation()).toBe(125000);
    expect(component.totalNetBookValue()).toBe(12875000);
  });

  it('should filter assets by setup status and query', () => {
    component.setupFilter.set('ready');
    expect(component.filteredAssets().length).toBe(1);
    expect(component.filteredAssets()[0].assetCode).toBe('AST-260913-001-L1-1');

    component.setupFilter.set('needs_setup');
    expect(component.filteredAssets().length).toBe(1);
    expect(component.filteredAssets()[0].assetCode).toBe('AST-260913-001-L1-2');

    component.setupFilter.set('all');
    component.searchQuery.set('Juki');
    expect(component.filteredAssets().length).toBe(1);
  });

  it('should open settings modal and detect accounting lock', () => {
    const lockedAsset = component.assets()[0];
    component.openSettingsModal(lockedAsset);
    expect(component.isSettingsModalOpen()).toBe(true);
    expect(component.selectedAsset()?.isLocked).toBe(true);
    expect(component.formDepreciationMethod()).toBe('straight_line');
    expect(component.formUsefulLifeMonths()).toBe(48);

    component.closeSettingsModal();
    expect(component.isSettingsModalOpen()).toBe(false);
  });

  it('should save updated asset parameters', async () => {
    const unlockedAsset = component.assets()[1];
    component.openSettingsModal(unlockedAsset);

    component.formCategoryId.set('cat-1');
    component.formUsefulLifeMonths.set(60);
    component.formLocation.set('Gudang 2');

    await component.saveSettings();

    expect(mockAssetService.updateAssetParameters).toHaveBeenCalledWith('ast-2', {
      categoryId: 'cat-1',
      depreciationMethod: 'straight_line',
      usefulLifeMonths: 60,
      residualValue: 0,
      depreciationStartDate: '2026-09-13',
      location: 'Gudang 2',
      custodian: null,
      serialNumber: null,
    });
    expect(component.isSettingsModalOpen()).toBe(false);
  });
});
