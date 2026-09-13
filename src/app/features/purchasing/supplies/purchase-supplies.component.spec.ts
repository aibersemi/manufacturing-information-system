import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanyService } from '../../../core/services/company.service';
import { PurchasingInventoryService } from '../../../core/services/purchasing-inventory.service';
import { PurchaseSuppliesComponent } from './purchase-supplies.component';

describe('PurchaseSuppliesComponent', () => {
  let component: PurchaseSuppliesComponent;
  let fixture: ComponentFixture<PurchaseSuppliesComponent>;
  let mockPurchasingService: any;
  let mockCompanyService: any;

  beforeEach(async () => {
    mockPurchasingService = {
      getPurchaseDocuments: vi.fn().mockResolvedValue([]),
      getSuppliers: vi.fn().mockResolvedValue([
        { id: 'sup-1', name: 'PT Aksesoris Garment' },
      ]),
      getSupplies: vi.fn().mockResolvedValue([
        { id: 'sup-item-1', name: 'Benang Jahit Putih', data: { stockUnitCode: 'cones' } },
      ]),
      getCashAccounts: vi.fn().mockResolvedValue([
        { id: 'cash-1', name: 'Kas Kecil' },
      ]),
      savePurchaseDraft: vi.fn().mockResolvedValue({ id: 'doc-sup-1' }),
      postPurchase: vi.fn().mockResolvedValue({ success: true, documentNumber: 'BP-260913-001' }),
      voidPurchase: vi.fn().mockResolvedValue({ success: true }),
    };

    mockCompanyService = {
      activeCompanyId: signal('company-123'),
      waitForActiveCompany: vi.fn().mockResolvedValue('company-123'),
    };

    await TestBed.configureTestingModule({
      imports: [PurchaseSuppliesComponent],
      providers: [
        { provide: PurchasingInventoryService, useValue: mockPurchasingService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PurchaseSuppliesComponent);
    component = fixture.componentInstance;
  });

  it('should create and initialize supplies data', async () => {
    expect(component).toBeTruthy();
    await component.loadData();
    expect(mockPurchasingService.getPurchaseDocuments).toHaveBeenCalledWith('purchase_supplies');
    expect(mockPurchasingService.getSupplies).toHaveBeenCalled();
  });

  it('should open create modal with default values', () => {
    component.suppliers.set([{ id: 'sup-1', name: 'PT Vendor' } as any]);
    component.supplies.set([{ id: 'sup-item-1', name: 'Kancing Kemeja', data: { stockUnitCode: 'gross' } } as any]);
    component.openCreateModal();

    expect(component.isModalOpen()).toBe(true);
    expect(component.formSupplierId()).toBe('sup-1');
    expect(component.formLines().length).toBe(1);
  });

  it('should save supplies draft on valid submission', async () => {
    component.formSupplierId.set('sup-1');
    component.formLines.set([
      {
        itemId: 'sup-item-1',
        description: 'Benang Jahit Putih',
        unitCode: 'cones',
        conversionFactor: 1,
        quantity: 10,
        unitPrice: 25000,
      },
    ]);

    await component.saveDraft();
    expect(mockPurchasingService.savePurchaseDraft).toHaveBeenCalled();
    expect(component.isModalOpen()).toBe(false);
  });
});
