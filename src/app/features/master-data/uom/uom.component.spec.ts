import { TestBed } from '@angular/core/testing';
import { UomComponent } from './uom.component';
import { MasterDataService } from '../../../core/services/master-data.service';

describe('UomComponent', () => {
  let component: UomComponent;
  let mockMasterDataService: any;

  const mockUnits = [
    { company_id: 'c1', code: 'PCS', name: 'Pieces', decimal_scale: 0, is_active: true, version: 1 },
    { company_id: 'c1', code: 'ROLL', name: 'Roll', decimal_scale: 2, is_active: true, version: 1 },
    { company_id: 'c1', code: 'YARD', name: 'Yard', decimal_scale: 3, is_active: false, version: 1 },
  ];

  beforeEach(async () => {
    mockMasterDataService = {
      getUnits: vi.fn().mockResolvedValue(mockUnits),
      createUnit: vi.fn().mockResolvedValue({
        company_id: 'c1',
        code: 'BOX',
        name: 'Box',
        decimal_scale: 0,
        is_active: true,
      }),
      updateUnit: vi.fn().mockResolvedValue({
        company_id: 'c1',
        code: 'PCS',
        name: 'Pieces Updated',
        decimal_scale: 0,
        is_active: true,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [UomComponent],
      providers: [{ provide: MasterDataService, useValue: mockMasterDataService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(UomComponent);
    component = fixture.componentInstance;
  });

  it('should load units on init', async () => {
    await component.loadUnits();
    expect(mockMasterDataService.getUnits).toHaveBeenCalled();
    expect(component.units().length).toBe(3);
  });

  it('should filter units by query and status', () => {
    component.units.set(mockUnits as any);

    component.searchQuery.set('roll');
    expect(component.filteredUnits().length).toBe(1);
    expect(component.filteredUnits()[0].code).toBe('ROLL');

    component.searchQuery.set('');
    component.setStatusFilter('inactive');
    expect(component.filteredUnits().length).toBe(1);
    expect(component.filteredUnits()[0].code).toBe('YARD');
  });

  it('should validate form and show error if code is empty', async () => {
    component.openCreateModal();
    component.formCode.set('');
    component.formName.set('Satuan Baru');

    await component.saveUnit();

    expect(component.formError()).toBe('Kode UOM wajib diisi.');
    expect(mockMasterDataService.createUnit).not.toHaveBeenCalled();
  });

  it('should call createUnit when saveUnit is invoked in create mode', async () => {
    component.openCreateModal();
    component.formCode.set('BOX');
    component.formName.set('Box');

    await component.saveUnit();

    expect(mockMasterDataService.createUnit).toHaveBeenCalledWith({
      code: 'BOX',
      name: 'Box',
      decimalScale: 0,
    });
    expect(component.isModalOpen()).toBe(false);
  });
});
