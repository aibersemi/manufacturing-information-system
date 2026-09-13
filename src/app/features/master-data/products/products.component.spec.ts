import { TestBed } from '@angular/core/testing';
import { ProductsComponent } from './products.component';
import { MasterDataService } from '../../../core/services/master-data.service';

describe('ProductsComponent', () => {
  let component: ProductsComponent;
  let mockMasterDataService: any;

  const mockUnits = [
    { code: 'PCS', name: 'Pieces', decimal_scale: 0, is_active: true },
    { code: 'LUSIN', name: 'Lusin', decimal_scale: 0, is_active: true },
  ];

  const mockProducts = [
    {
      id: 'prod-1',
      sku: 'TSHIRT-O-30S',
      name: 'Kaos Polos O-Neck Cotton Combed 30s',
      data: {
        salesUnit: 'PCS',
        referenceSalesPrice: 45000,
        description: 'Pola standar distro',
      },
      requiresPrinting: true,
      is_active: true,
      version: 1,
    },
    {
      id: 'prod-2',
      sku: 'POLO-PIQUE-24S',
      name: 'Polo Shirt Lacoste Pique',
      data: {
        salesUnit: 'PCS',
        referenceSalesPrice: 65000,
        description: 'Kerah rajut',
      },
      requiresPrinting: false,
      is_active: false,
      version: 1,
    },
  ];

  beforeEach(async () => {
    mockMasterDataService = {
      getProducts: vi.fn().mockResolvedValue(mockProducts),
      getUnits: vi.fn().mockResolvedValue(mockUnits),
      createProduct: vi.fn().mockResolvedValue({
        id: 'prod-3',
        sku: 'HOODIE-FLEECE',
        name: 'Hoodie Jumper Fleece',
        requiresPrinting: false,
        is_active: true,
      }),
      updateProduct: vi.fn().mockResolvedValue({
        id: 'prod-1',
        sku: 'TSHIRT-O-30S',
        name: 'Kaos Polos Updated',
        requiresPrinting: true,
        is_active: true,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ProductsComponent],
      providers: [{ provide: MasterDataService, useValue: mockMasterDataService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProductsComponent);
    component = fixture.componentInstance;
  });

  it('should load products and units on init', async () => {
    await component.loadData();
    expect(mockMasterDataService.getProducts).toHaveBeenCalled();
    expect(mockMasterDataService.getUnits).toHaveBeenCalled();
    expect(component.products().length).toBe(2);
    expect(component.units().length).toBe(2);
  });

  it('should filter products by search query, status, and routing', () => {
    component.products.set(mockProducts as any);

    component.searchQuery.set('Lacoste');
    expect(component.filteredProducts().length).toBe(1);
    expect(component.filteredProducts()[0].sku).toBe('POLO-PIQUE-24S');

    component.searchQuery.set('');
    component.setStatusFilter('active');
    expect(component.filteredProducts().length).toBe(1);
    expect(component.filteredProducts()[0].sku).toBe('TSHIRT-O-30S');

    component.setStatusFilter('all');
    component.setRoutingFilter('printing');
    expect(component.filteredProducts().length).toBe(1);
    expect(component.filteredProducts()[0].requiresPrinting).toBe(true);
  });

  it('should validate form and show error if SKU or Name is empty', async () => {
    component.openCreateModal();
    component.formSku.set('');
    component.formName.set('');

    await component.saveProduct();

    expect(component.formError()).toBe('Kode SKU wajib diisi.');
    expect(mockMasterDataService.createProduct).not.toHaveBeenCalled();

    component.formSku.set('VALID-SKU');
    component.formName.set('');
    await component.saveProduct();
    expect(component.formError()).toBe('Nama produk wajib diisi.');
  });

  it('should call createProduct with uppercase SKU on valid submission', async () => {
    component.openCreateModal();
    component.formSku.set('hoodie-fleece');
    component.formName.set('Hoodie Jumper Fleece');
    component.formSalesUnit.set('PCS');
    component.formReferenceSalesPrice.set(95000);
    component.formRequiresPrinting.set(false);

    await component.saveProduct();

    expect(mockMasterDataService.createProduct).toHaveBeenCalledWith({
      sku: 'HOODIE-FLEECE',
      name: 'Hoodie Jumper Fleece',
      salesUnit: 'PCS',
      referenceSalesPrice: 95000,
      description: '',
      requiresPrinting: false,
    });
    expect(component.isModalOpen()).toBe(false);
  });
});
