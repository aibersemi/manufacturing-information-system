import { TestBed } from '@angular/core/testing';
import { BomComponent } from './bom.component';
import { MasterDataService } from '../../../core/services/master-data.service';

describe('BomComponent', () => {
  let component: BomComponent;
  let mockMasterDataService: any;

  const mockMaterials = [
    {
      id: 'mat-1',
      name: 'Cotton Combed 30s Reaktif',
      data: {
        packagingUnit: 'ROLL',
        packagingQuantity: 1,
        baseUnit: 'KG',
        conversionFactor: 25,
        referencePackagePrice: 3000000, // Rp 120.000 / KG
      },
      is_active: true,
    },
    {
      id: 'mat-2',
      name: 'Rib Cotton 30s',
      data: {
        packagingUnit: 'KG',
        packagingQuantity: 1,
        baseUnit: 'KG',
        conversionFactor: 1,
        referencePackagePrice: 125000, // Rp 125.000 / KG
      },
      is_active: true,
    },
  ];

  const mockProducts = [
    {
      id: 'prod-1',
      sku: 'TSHIRT-O-30S',
      name: 'Kaos Polos O-Neck',
      data: { salesUnit: 'PCS' },
      requiresPrinting: true,
      is_active: true,
    },
    {
      id: 'prod-2',
      sku: 'POLO-24S',
      name: 'Polo Shirt',
      data: { salesUnit: 'PCS' },
      requiresPrinting: false,
      is_active: true,
    },
  ];

  const mockBoms = [
    {
      id: 'bom-1',
      name: 'BOM - Kaos Polos O-Neck',
      data: {
        productId: 'prod-1',
        materialLines: [
          { materialId: 'mat-1', quantity: 0.25, unitCode: 'KG' },
          { materialId: 'mat-2', quantity: 0.05, unitCode: 'KG' },
        ],
      },
      is_active: true,
    },
  ];

  beforeEach(async () => {
    mockMasterDataService = {
      getProducts: vi.fn().mockResolvedValue(mockProducts),
      getMaterials: vi.fn().mockResolvedValue(mockMaterials),
      getBoms: vi.fn().mockResolvedValue(mockBoms),
      saveBom: vi.fn().mockResolvedValue({
        id: 'bom-new',
        name: 'BOM - Saved',
        is_active: true,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [BomComponent],
      providers: [{ provide: MasterDataService, useValue: mockMasterDataService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(BomComponent);
    component = fixture.componentInstance;
    await component.loadData();
  });

  it('should load data and associate BOMs with products correctly', async () => {
    await component.loadData();
    expect(mockMasterDataService.getProducts).toHaveBeenCalled();
    expect(mockMasterDataService.getMaterials).toHaveBeenCalled();
    expect(mockMasterDataService.getBoms).toHaveBeenCalled();

    const list = component.productBomList();
    expect(list.length).toBe(2);

    const tshirt = list.find((item) => item.product.id === 'prod-1');
    expect(tshirt?.linesCount).toBe(2);
    // 0.25 * 120000 + 0.05 * 125000 = 30000 + 6250 = 36250
    expect(tshirt?.estimatedMaterialCost).toBe(36250);

    const polo = list.find((item) => item.product.id === 'prod-2');
    expect(polo?.linesCount).toBe(0);
    expect(polo?.estimatedMaterialCost).toBe(0);
  });

  it('should filter product BOMs by configuration status', () => {
    component.products.set(mockProducts as any);
    component.materials.set(mockMaterials as any);
    component.boms.set(mockBoms as any);

    component.setFilter('configured');
    expect(component.filteredProductBoms().length).toBe(1);
    expect(component.filteredProductBoms()[0].product.sku).toBe('TSHIRT-O-30S');

    component.setFilter('unconfigured');
    expect(component.filteredProductBoms().length).toBe(1);
    expect(component.filteredProductBoms()[0].product.sku).toBe('POLO-24S');
  });

  it('should validate duplicate materials and empty lines in editor', async () => {
    const item = component.productBomList().find((i) => i.product.id === 'prod-1')!;
    component.openBomEditor(item);

    component.editableLines.set([
      { materialId: 'mat-1', quantity: 0.2, unitCode: 'KG' },
      { materialId: 'mat-1', quantity: 0.1, unitCode: 'KG' },
    ]);

    await component.saveBom();
    expect(component.formError()).toBe('Terdapat komponen bahan baku yang dipilih lebih dari satu kali.');
    expect(mockMasterDataService.saveBom).not.toHaveBeenCalled();
  });

  it('should call saveBom with valid payload', async () => {
    const item = component.productBomList().find((i) => i.product.id === 'prod-2')!;
    component.openBomEditor(item);

    component.editableLines.set([
      { materialId: 'mat-1', quantity: 0.3, unitCode: 'KG' },
    ]);

    await component.saveBom();
    expect(mockMasterDataService.saveBom).toHaveBeenCalledWith('prod-2', 'Polo Shirt', [
      { materialId: 'mat-1', quantity: 0.3, unitCode: 'KG' },
    ]);
    expect(component.isModalOpen()).toBe(false);
  });
});
