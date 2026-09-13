import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { AssetPurchasesComponent } from './asset-purchases.component';
import { AssetService } from '../../../core/services/asset.service';
import { MasterDataService } from '../../../core/services/master-data.service';

describe('AssetPurchasesComponent', () => {
  let component: AssetPurchasesComponent;
  let fixture: ComponentFixture<AssetPurchasesComponent>;
  let mockAssetService: any;
  let mockMasterDataService: any;

  beforeEach(async () => {
    mockAssetService = {
      assetPurchases: signal([
        {
          id: 'doc-1',
          documentNumber: 'BA-260913-001',
          transactionDate: '2026-09-13',
          counterpartyId: 'sup-1',
          counterpartyName: 'PT Mesin Jaya',
          totalAmount: 15000000,
          paidAmount: 0,
          status: 'draft',
          notes: 'Pembelian mesin jahit',
          totalUnits: 3,
          lines: [
            {
              id: 'line-1',
              lineNumber: 1,
              description: 'Mesin Jahit',
              quantity: 3,
              unitPrice: 5000000,
              subtotal: 15000000,
              totalAmount: 15000000,
            },
          ],
          postedAt: null,
          createdAt: '2026-09-13T10:00:00Z',
        },
        {
          id: 'doc-2',
          documentNumber: 'BA-260913-002',
          transactionDate: '2026-09-13',
          counterpartyId: 'sup-2',
          counterpartyName: 'PT Hardware Tech',
          totalAmount: 8000000,
          paidAmount: 0,
          status: 'posted',
          notes: 'Komputer server',
          totalUnits: 1,
          lines: [
            {
              id: 'line-2',
              lineNumber: 1,
              description: 'Komputer Server',
              quantity: 1,
              unitPrice: 8000000,
              subtotal: 8000000,
              totalAmount: 8000000,
            },
          ],
          postedAt: '2026-09-13T11:00:00Z',
          createdAt: '2026-09-13T10:30:00Z',
        },
      ]),
      loading: signal(false),
      loadAssetPurchases: vi.fn().mockResolvedValue([]),
      createAssetPurchase: vi.fn().mockResolvedValue({ id: 'new-id', documentNumber: 'BA-260913-003' }),
      postAssetPurchase: vi.fn().mockResolvedValue(undefined),
      cancelAssetPurchase: vi.fn().mockResolvedValue(undefined),
    };

    mockMasterDataService = {
      getSuppliers: vi.fn().mockResolvedValue([
        { id: 'sup-1', name: 'PT Mesin Jaya', is_active: true },
        { id: 'sup-2', name: 'PT Hardware Tech', is_active: true },
      ]),
    };

    await TestBed.configureTestingModule({
      imports: [AssetPurchasesComponent],
      providers: [
        { provide: AssetService, useValue: mockAssetService },
        { provide: MasterDataService, useValue: mockMasterDataService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AssetPurchasesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create component and compute KPIs correctly', () => {
    expect(component).toBeTruthy();
    expect(component.totalPurchasesCount()).toBe(2);
    expect(component.totalPurchaseValue()).toBe(23000000);
    expect(component.pendingDraftsCount()).toBe(1);
  });

  it('should filter purchases by search query and status', () => {
    component.searchQuery.set('Server');
    expect(component.filteredPurchases().length).toBe(1);
    expect(component.filteredPurchases()[0].documentNumber).toBe('BA-260913-002');

    component.searchQuery.set('');
    component.statusFilter.set('draft');
    expect(component.filteredPurchases().length).toBe(1);
    expect(component.filteredPurchases()[0].status).toBe('draft');
  });

  it('should open and close create modal', () => {
    component.openCreateModal();
    expect(component.isCreateModalOpen()).toBe(true);

    component.addLine();
    expect(component.formLines().length).toBe(2);

    component.removeLine(1);
    expect(component.formLines().length).toBe(1);

    component.closeCreateModal();
    expect(component.isCreateModalOpen()).toBe(false);
  });

  it('should handle posting confirmation', async () => {
    const doc = component.purchases()[0];
    component.openPostDialog(doc);
    expect(component.isPostDialogOpen()).toBe(true);
    expect(component.selectedDoc()).toBe(doc);

    await component.confirmPost();
    expect(mockAssetService.postAssetPurchase).toHaveBeenCalledWith(doc.id);
    expect(component.isPostDialogOpen()).toBe(false);
  });

  it('should handle cancellation confirmation', async () => {
    const doc = component.purchases()[1];
    component.openCancelDialog(doc);
    expect(component.isCancelDialogOpen()).toBe(true);

    component.cancelReason.set('Barang cacat pabrik');
    await component.confirmCancel();
    expect(mockAssetService.cancelAssetPurchase).toHaveBeenCalledWith(doc.id, 'Barang cacat pabrik');
    expect(component.isCancelDialogOpen()).toBe(false);
  });
});
