import { TestBed } from '@angular/core/testing';
import { EmployeesComponent } from './employees.component';
import { MasterDataService } from '../../../core/services/master-data.service';

describe('EmployeesComponent', () => {
  let component: EmployeesComponent;
  let mockMasterDataService: any;

  const mockEmployees = [
    {
      id: 'emp-1',
      name: 'Ahmad Subagja',
      data: {
        roleCategory: 'Operator Potong',
        phone: '0812345678',
        address: 'Bandung',
      },
      is_active: true,
      version: 1,
    },
    {
      id: 'emp-2',
      name: 'Siti Rohmah',
      data: {
        roleCategory: 'Operator Jahit',
        phone: '0898765432',
        address: 'Cimahi',
      },
      is_active: false,
      version: 1,
    },
  ];

  beforeEach(async () => {
    mockMasterDataService = {
      getEmployees: vi.fn().mockResolvedValue(mockEmployees),
      createEmployee: vi.fn().mockResolvedValue({
        id: 'emp-3',
        name: 'Dedi Kurniawan',
        is_active: true,
      }),
      updateEmployee: vi.fn().mockResolvedValue({
        id: 'emp-1',
        name: 'Ahmad Subagja Updated',
        is_active: true,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [EmployeesComponent],
      providers: [{ provide: MasterDataService, useValue: mockMasterDataService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(EmployeesComponent);
    component = fixture.componentInstance;
    await component.loadEmployees();
  });

  it('should load employees on init', () => {
    expect(mockMasterDataService.getEmployees).toHaveBeenCalled();
    expect(component.employees().length).toBe(2);
  });

  it('should filter employees by query, role, and status', () => {
    component.searchQuery.set('Subagja');
    expect(component.filteredEmployees().length).toBe(1);
    expect(component.filteredEmployees()[0].name).toBe('Ahmad Subagja');

    component.searchQuery.set('');
    component.setStatusFilter('inactive');
    expect(component.filteredEmployees().length).toBe(1);
    expect(component.filteredEmployees()[0].name).toBe('Siti Rohmah');

    component.setStatusFilter('all');
    component.setRoleFilter('Operator Potong');
    expect(component.filteredEmployees().length).toBe(1);
    expect(component.filteredEmployees()[0].name).toBe('Ahmad Subagja');
  });

  it('should validate form and show error if name is empty', async () => {
    component.openCreateModal();
    component.formName.set('');

    await component.saveEmployee();

    expect(component.formError()).toBe('Nama tenaga kerja wajib diisi.');
    expect(mockMasterDataService.createEmployee).not.toHaveBeenCalled();
  });

  it('should call createEmployee with valid payload', async () => {
    component.openCreateModal();
    component.formName.set('Dedi Kurniawan');
    component.formRoleCategory.set('Operator Sablon');
    component.formPhone.set('0811223344');
    component.formAddress.set('Soreang');

    await component.saveEmployee();

    expect(mockMasterDataService.createEmployee).toHaveBeenCalledWith({
      name: 'Dedi Kurniawan',
      roleCategory: 'Operator Sablon',
      phone: '0811223344',
      address: 'Soreang',
    });
    expect(component.isModalOpen()).toBe(false);
  });
});
