import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { AssetDisposalsComponent } from './asset-disposals.component';
import { AssetService } from '../../../core/services/asset.service';
import { FinanceService } from '../../../core/services/finance.service';

describe('AssetDisposalsComponent', () => {
  let component: AssetDisposalsComponent;
  let fixture: ComponentFixture<AssetDisposalsComponent>;
  let mockAssetService: any;
  let mockFinanceService: any;

  beforeEach(async () => {
    mockAssetService = {
      assetDisposals: signal([
        {
          id: 'disp-1',
          documentNumber: 'DA-260913-001',
          transactionDate: '2026-09-13',
          assetId: 'ast-1',
          assetCode: 'AST-260913-001-L1-1',
          assetName: 'Mesin Potong Kain',
          acquisitionCost: 10000000,
          accumulatedDepreciation: 6000000,
          bookValue: 4000000,
          proceeds: 4500000,
          gain: 500000,
          loss: 0,
          cashAccountId: 'cash-1',
          reason: 'Dijual karena upgrade mesin baru',
          status: 'posted',
          postedAt: '2026-09-13T14:00:00Z',
        },
      ]),
      assets: signal([
        {
          id: 'ast-2',
          companyId: 'comp-1',
          assetCode: 'AST-260913-001-L1-2',
          name: 'Mesin Jahit Singer',
          status: 'active',
          acquisitionCost: 6000000,
          accumulatedDepreciation: 2000000,
          bookValue: 4000000,
        },
      ]),
      loading: signal(false),
      loadAssetDisposals: vi.fn().mockResolvedValue([]),
      loadAssets: vi.fn().mockResolvedValue([]),
      postAssetDisposal: vi.fn().mockResolvedValue({
        id: 'disp-new',
        documentNumber: 'DA-260913-002',
        bookValue: 4000000,
        proceeds: 3000000,
        gain: 0,
        loss: 1000000,
      }),
    };

    mockFinanceService = {
      cashAccounts: signal([
        { id: 'cash-1', name: 'Kas Utama', code: '1-1.1.01', balance: 50000000 },
      ]),
      loadCashAccounts: vi.fn().mockResolvedValue([]),
    };

    await TestBed.configureTestingModule({
      imports: [AssetDisposalsComponent],
      providers: [
        { provide: AssetService, useValue: mockAssetService },
        { provide: FinanceService, useValue: mockFinanceService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AssetDisposalsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create component and compute KPIs correctly', () => {
    expect(component).toBeTruthy();
    expect(component.totalDisposalsCount()).toBe(1);
    expect(component.totalProceedsAmount()).toBe(4500000);
    expect(component.totalNetGain()).toBe(500000);
    expect(component.totalNetLoss()).toBe(0);
  });

  it('should calculate real-time gain or loss when asset and proceeds are set', () => {
    component.formAssetId.set('ast-2');
    expect(component.formSelectedAsset()).toBeTruthy();
    expect(component.calculatedBookValue()).toBe(4000000);

    // Gain scenario: proceeds = 5,000,000 > 4,000,000
    component.formProceeds.set(5000000);
    expect(component.calculatedDifference()).toBe(1000000);
    expect(component.isGain()).toBe(true);
    expect(component.isLoss()).toBe(false);

    // Loss scenario: proceeds = 3,000,000 < 4,000,000
    component.formProceeds.set(3000000);
    expect(component.calculatedDifference()).toBe(-1000000);
    expect(component.isGain()).toBe(false);
    expect(component.isLoss()).toBe(true);

    // Breakeven scenario: proceeds = 4,000,000 === 4,000,000
    component.formProceeds.set(4000000);
    expect(component.isBreakeven()).toBe(true);
  });

  it('should open confirm dialog and execute disposal', async () => {
    component.openCreateModal();
    expect(component.isCreateModalOpen()).toBe(true);

    component.formAssetId.set('ast-2');
    component.formProceeds.set(3000000);
    component.formCashAccountId.set('cash-1');
    component.formReason.set('Rusak parah');

    component.openConfirmDialog();
    expect(component.isConfirmDialogOpen()).toBe(true);

    await component.executeDisposal();

    expect(mockAssetService.postAssetDisposal).toHaveBeenCalledWith({
      assetId: 'ast-2',
      disposalDate: component.formDisposalDate(),
      proceeds: 3000000,
      cashAccountId: 'cash-1',
      reason: 'Rusak parah',
    });
    expect(component.isConfirmDialogOpen()).toBe(false);
    expect(component.isCreateModalOpen()).toBe(false);
  });
});
