import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanyService } from '../../../core/services/company.service';
import { PurchasingInventoryService } from '../../../core/services/purchasing-inventory.service';
import { PurchaseNonProductionComponent } from './purchase-non-production.component';

describe('PurchaseNonProductionComponent', () => {
  let component: PurchaseNonProductionComponent;
  let fixture: ComponentFixture<PurchaseNonProductionComponent>;
  let mockPurchasingService: any;
  let mockCompanyService: any;

  beforeEach(async () => {
    mockPurchasingService = {
      getPurchaseDocuments: vi.fn().mockResolvedValue([]),
      getSuppliers: vi.fn().mockResolvedValue([
        { id: 'sup-1', name: 'Toko ATK Makmur' },
      ]),
      getCashAccounts: vi.fn().mockResolvedValue([
        { id: 'cash-1', name: 'Kas Kecil' },
      ]),
      savePurchaseDraft: vi.fn().mockResolvedValue({ id: 'doc-np-1' }),
      postPurchase: vi.fn().mockResolvedValue({ success: true, documentNumber: 'BN-260913-001' }),
      voidPurchase: vi.fn().mockResolvedValue({ success: true }),
    };

    mockCompanyService = {
      activeCompanyId: signal('company-123'),
      waitForActiveCompany: vi.fn().mockResolvedValue('company-123'),
    };

    await TestBed.configureTestingModule({
      imports: [PurchaseNonProductionComponent],
      providers: [
        { provide: PurchasingInventoryService, useValue: mockPurchasingService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PurchaseNonProductionComponent);
    component = fixture.componentInstance;
  });

  it('should create and load non-production data', async () => {
    expect(component).toBeTruthy();
    await component.loadData();
    expect(mockPurchasingService.getPurchaseDocuments).toHaveBeenCalledWith('purchase_non_production');
  });

  it('should open modal and validate description', async () => {
    component.openCreateModal();
    expect(component.isModalOpen()).toBe(true);

    component.formSupplierId.set('sup-1');
    component.formLines.set([
      { description: '   ', unitCode: 'unit', quantity: 1, unitPrice: 50000 },
    ]);

    await component.saveDraft();
    expect(component.formError()).toBe('Seluruh baris wajib memiliki deskripsi barang atau jasa.');
  });

  it('should save non-production draft on valid submission', async () => {
    component.formSupplierId.set('sup-1');
    component.formLines.set([
      { description: 'Kertas HVS A4 80gr', unitCode: 'rim', quantity: 5, unitPrice: 45000 },
    ]);

    await component.saveDraft();
    expect(mockPurchasingService.savePurchaseDraft).toHaveBeenCalled();
    expect(component.isModalOpen()).toBe(false);
  });
});
