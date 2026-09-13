import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanyService } from '../../../core/services/company.service';
import { PurchasingInventoryService } from '../../../core/services/purchasing-inventory.service';
import { PurchaseMaterialsComponent } from './purchase-materials.component';

describe('PurchaseMaterialsComponent', () => {
  let component: PurchaseMaterialsComponent;
  let fixture: ComponentFixture<PurchaseMaterialsComponent>;
  let mockPurchasingService: any;
  let mockCompanyService: any;

  beforeEach(async () => {
    mockPurchasingService = {
      getPurchaseDocuments: vi.fn().mockResolvedValue([]),
      getSuppliers: vi.fn().mockResolvedValue([
        { id: 'sup-1', name: 'PT Mitra Tekstil' },
      ]),
      getMaterials: vi.fn().mockResolvedValue([
        { id: 'mat-1', name: 'Cotton Combed 30s', data: { conversionFactor: 25, packagingUnit: 'roll', baseUnit: 'm' } },
      ]),
      getCashAccounts: vi.fn().mockResolvedValue([
        { id: 'cash-1', name: 'Kas Kecil' },
      ]),
      savePurchaseDraft: vi.fn().mockResolvedValue({ id: 'doc-1' }),
      postPurchase: vi.fn().mockResolvedValue({ success: true, documentNumber: 'BL-260913-001' }),
      voidPurchase: vi.fn().mockResolvedValue({ success: true }),
    };

    mockCompanyService = {
      activeCompanyId: signal('company-123'),
      waitForActiveCompany: vi.fn().mockResolvedValue('company-123'),
    };

    await TestBed.configureTestingModule({
      imports: [PurchaseMaterialsComponent],
      providers: [
        { provide: PurchasingInventoryService, useValue: mockPurchasingService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PurchaseMaterialsComponent);
    component = fixture.componentInstance;
  });

  it('should create and initialize data', async () => {
    expect(component).toBeTruthy();
    await component.loadData();
    expect(mockPurchasingService.getPurchaseDocuments).toHaveBeenCalledWith('purchase_material');
    expect(mockPurchasingService.getSuppliers).toHaveBeenCalled();
    expect(mockPurchasingService.getMaterials).toHaveBeenCalled();
  });

  it('should open create modal with default values', () => {
    component.suppliers.set([{ id: 'sup-1', name: 'PT Vendor' } as any]);
    component.materials.set([{ id: 'mat-1', name: 'Kain TC', data: { conversionFactor: 30 } } as any]);
    component.openCreateModal();

    expect(component.isModalOpen()).toBe(true);
    expect(component.formSupplierId()).toBe('sup-1');
    expect(component.formLines().length).toBe(1);
  });

  it('should validate supplier before saving draft', async () => {
    component.formSupplierId.set('');
    await component.saveDraft();
    expect(component.formError()).toBe('Pemasok wajib dipilih.');
  });

  it('should save draft and reload data on valid submission', async () => {
    component.formSupplierId.set('sup-1');
    component.formLines.set([
      {
        itemId: 'mat-1',
        description: 'Cotton Combed',
        unitCode: 'roll',
        stockUnitCode: 'm',
        conversionFactor: 25,
        quantity: 2,
        unitPrice: 1500000,
      },
    ]);

    await component.saveDraft();
    expect(mockPurchasingService.savePurchaseDraft).toHaveBeenCalled();
    expect(component.isModalOpen()).toBe(false);
  });
});
