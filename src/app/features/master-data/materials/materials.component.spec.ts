import { TestBed } from '@angular/core/testing';
import { MaterialsComponent } from './materials.component';
import { MasterDataService } from '../../../core/services/master-data.service';

describe('MaterialsComponent', () => {
  let component: MaterialsComponent;
  let mockMasterDataService: any;

  const mockUnits = [
    { code: 'ROLL', name: 'Roll', decimal_scale: 2, is_active: true },
    { code: 'KG', name: 'Kilogram', decimal_scale: 3, is_active: true },
    { code: 'YARD', name: 'Yard', decimal_scale: 2, is_active: true },
  ];

  const mockMaterials = [
    {
      id: 'mat-1',
      name: 'Cotton Combed 30s Reaktif',
      data: {
        packagingUnit: 'ROLL',
        packagingQuantity: 1,
        baseUnit: 'KG',
        conversionFactor: 25,
        referencePackagePrice: 3000000,
        notes: 'Jet black',
      },
      is_active: true,
      version: 1,
    },
    {
      id: 'mat-2',
      name: 'Benang Jahit Poliester',
      data: {
        packagingUnit: 'CONES',
        packagingQuantity: 1,
        baseUnit: 'CONES',
        conversionFactor: 1,
        referencePackagePrice: 15000,
        notes: 'Warna putih',
      },
      is_active: false,
      version: 1,
    },
  ];

  beforeEach(async () => {
    mockMasterDataService = {
      getMaterials: vi.fn().mockResolvedValue(mockMaterials),
      getUnits: vi.fn().mockResolvedValue(mockUnits),
      createMaterial: vi.fn().mockResolvedValue({
        id: 'mat-3',
        name: 'Rib Cotton 30s',
        is_active: true,
      }),
      updateMaterial: vi.fn().mockResolvedValue({
        id: 'mat-1',
        name: 'Cotton Combed 30s Updated',
        is_active: true,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [MaterialsComponent],
      providers: [{ provide: MasterDataService, useValue: mockMasterDataService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MaterialsComponent);
    component = fixture.componentInstance;
  });

  it('should load materials and units on init', async () => {
    await component.loadData();
    expect(mockMasterDataService.getMaterials).toHaveBeenCalled();
    expect(mockMasterDataService.getUnits).toHaveBeenCalled();
    expect(component.materials().length).toBe(2);
    expect(component.units().length).toBe(3);
  });

  it('should compute unit price accurately', () => {
    component.formPackagingQuantity.set(1);
    component.formConversionFactor.set(25);
    component.formReferencePackagePrice.set(3000000);

    // 3000000 / (1 * 25) = 120000
    expect(component.calculatedUnitPrice()).toBe(120000);
  });

  it('should filter materials by search query and status', () => {
    component.materials.set(mockMaterials as any);

    component.searchQuery.set('Benang');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].name).toBe('Benang Jahit Poliester');

    component.searchQuery.set('');
    component.setStatusFilter('active');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].name).toBe('Cotton Combed 30s Reaktif');
  });

  it('should validate form and reject empty name', async () => {
    component.openCreateModal();
    component.formName.set('');

    await component.saveMaterial();

    expect(component.formError()).toBe('Nama bahan baku wajib diisi.');
    expect(mockMasterDataService.createMaterial).not.toHaveBeenCalled();
  });

  it('should call createMaterial on valid form submission', async () => {
    component.openCreateModal();
    component.formName.set('Rib Cotton 30s');
    component.formPackagingUnit.set('KG');
    component.formPackagingQuantity.set(1);
    component.formBaseUnit.set('KG');
    component.formConversionFactor.set(1);
    component.formReferencePackagePrice.set(125000);

    await component.saveMaterial();

    expect(mockMasterDataService.createMaterial).toHaveBeenCalledWith({
      name: 'Rib Cotton 30s',
      packagingUnit: 'KG',
      packagingQuantity: 1,
      baseUnit: 'KG',
      conversionFactor: 1,
      referencePackagePrice: 125000,
      notes: '',
    });
    expect(component.isModalOpen()).toBe(false);
  });
});
