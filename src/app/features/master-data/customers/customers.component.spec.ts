import { TestBed } from '@angular/core/testing';
import { CustomersComponent } from './customers.component';
import { MasterDataService } from '../../../core/services/master-data.service';

describe('CustomersComponent', () => {
  let component: CustomersComponent;
  let mockMasterDataService: any;

  const mockCustomers = [
    {
      id: 'cust-1',
      name: 'PT Garmen Jaya',
      data: { phone: '0812345678', address: 'Jakarta' },
      is_active: true,
      version: 1,
    },
    {
      id: 'cust-2',
      name: 'CV Sentosa',
      data: { phone: '087654321', address: 'Surabaya' },
      is_active: false,
      version: 1,
    },
  ];

  beforeEach(async () => {
    mockMasterDataService = {
      getCustomers: vi.fn().mockResolvedValue(mockCustomers),
      createCustomer: vi.fn().mockResolvedValue({
        id: 'cust-3',
        name: 'Toko Baru',
        is_active: true,
      }),
      updateCustomer: vi.fn().mockResolvedValue({
        id: 'cust-1',
        name: 'PT Garmen Jaya Updated',
        is_active: true,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [CustomersComponent],
      providers: [{ provide: MasterDataService, useValue: mockMasterDataService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(CustomersComponent);
    component = fixture.componentInstance;
  });

  it('should load customers on init', async () => {
    await component.loadCustomers();
    expect(mockMasterDataService.getCustomers).toHaveBeenCalled();
    expect(component.customers().length).toBe(2);
  });

  it('should filter customers by query and status', () => {
    component.customers.set(mockCustomers as any);

    component.searchQuery.set('sentosa');
    expect(component.filteredCustomers().length).toBe(1);
    expect(component.filteredCustomers()[0].name).toBe('CV Sentosa');

    component.searchQuery.set('');
    component.setStatusFilter('active');
    expect(component.filteredCustomers().length).toBe(1);
    expect(component.filteredCustomers()[0].name).toBe('PT Garmen Jaya');
  });

  it('should validate form and show error if name is empty', async () => {
    component.openCreateModal();
    component.formName.set('');

    await component.saveCustomer();

    expect(component.formError()).toBe('Nama pelanggan wajib diisi.');
    expect(mockMasterDataService.createCustomer).not.toHaveBeenCalled();
  });

  it('should call createCustomer on valid submission', async () => {
    component.openCreateModal();
    component.formName.set('Toko Baru');
    component.formPhone.set('081111');
    component.formAddress.set('Bandung');

    await component.saveCustomer();

    expect(mockMasterDataService.createCustomer).toHaveBeenCalledWith({
      name: 'Toko Baru',
      phone: '081111',
      address: 'Bandung',
    });
    expect(component.isModalOpen()).toBe(false);
  });
});
