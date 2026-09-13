import { TestBed } from '@angular/core/testing';
import { WageRatesComponent } from './wage-rates.component';
import { MasterDataService } from '../../../core/services/master-data.service';

describe('WageRatesComponent', () => {
  let component: WageRatesComponent;
  let mockMasterDataService: any;

  const mockProductRates = [
    {
      productId: 'prod-1',
      sku: 'TSHIRT-O-30S',
      productName: 'Kaos Polos O-Neck',
      cutting: 1500,
      printing: 2500,
      sewing: 4000,
      packing: 1000,
    },
    {
      productId: 'prod-2',
      sku: 'POLO-24S',
      productName: 'Polo Shirt Lacoste',
      cutting: 2000,
      printing: 0,
      sewing: 6000,
      packing: 1200,
    },
  ];

  beforeEach(async () => {
    mockMasterDataService = {
      getWageRatesGroupedByProduct: vi.fn().mockResolvedValue(mockProductRates),
      saveProductWageRates: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [WageRatesComponent],
      providers: [{ provide: MasterDataService, useValue: mockMasterDataService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(WageRatesComponent);
    component = fixture.componentInstance;
    await component.loadRates();
  });

  it('should load product wage rates on init', () => {
    expect(mockMasterDataService.getWageRatesGroupedByProduct).toHaveBeenCalled();
    expect(component.productRates().length).toBe(2);
  });

  it('should compute total rate correctly', () => {
    const tshirt = component.productRates()[0];
    // 1500 + 2500 + 4000 + 1000 = 9000
    expect(component.getTotalRate(tshirt)).toBe(9000);
  });

  it('should filter product rates by search query', () => {
    component.searchQuery.set('lacoste');
    expect(component.filteredProductRates().length).toBe(1);
    expect(component.filteredProductRates()[0].sku).toBe('POLO-24S');
  });

  it('should open modal and populate form values', () => {
    const item = component.productRates()[0];
    component.openEditModal(item);

    expect(component.isModalOpen()).toBe(true);
    expect(component.selectedItem()?.productId).toBe('prod-1');
    expect(component.formCutting()).toBe(1500);
    expect(component.formPrinting()).toBe(2500);
    expect(component.formSewing()).toBe(4000);
    expect(component.formPacking()).toBe(1000);
    expect(component.totalFormRate()).toBe(9000);
  });

  it('should save updated wage rates via MasterDataService', async () => {
    const item = component.productRates()[0];
    component.openEditModal(item);

    component.formCutting.set(1800);
    component.formSewing.set(4500);

    await component.saveRates();

    expect(mockMasterDataService.saveProductWageRates).toHaveBeenCalledWith(
      'prod-1',
      'TSHIRT-O-30S',
      {
        cutting: 1800,
        printing: 2500,
        sewing: 4500,
        packing: 1000,
      },
    );
    expect(component.isModalOpen()).toBe(false);
  });
});
