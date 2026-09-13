import { TestBed } from '@angular/core/testing';
import { SuppliersComponent } from './suppliers.component';
import { MasterDataService } from '../../../core/services/master-data.service';

describe('SuppliersComponent', () => {
  let component: SuppliersComponent;
  let mockMasterDataService: any;

  const mockSuppliers = [
    {
      id: 'supp-1',
      name: 'PT Tekstil Jaya Mandiri',
      data: {
        phone: '0812345678',
        email: 'info@tekstiljaya.com',
        bank: 'BCA',
        accountNumber: '1234567890',
        accountHolder: 'PT Tekstil Jaya',
        address: 'Bandung',
      },
      is_active: true,
      version: 1,
    },
    {
      id: 'supp-2',
      name: 'Toko Benang Berkah',
      data: {
        phone: '087654321',
        email: 'berkah@gmail.com',
        bank: 'Mandiri',
        accountNumber: '9876543210',
        accountHolder: 'H. Slamet',
        address: 'Solo',
      },
      is_active: false,
      version: 1,
    },
  ];

  beforeEach(async () => {
    mockMasterDataService = {
      getSuppliers: vi.fn().mockResolvedValue(mockSuppliers),
      createSupplier: vi.fn().mockResolvedValue({
        id: 'supp-3',
        name: 'CV Kancing Indah',
        is_active: true,
      }),
      updateSupplier: vi.fn().mockResolvedValue({
        id: 'supp-1',
        name: 'PT Tekstil Jaya Mandiri Updated',
        is_active: true,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [SuppliersComponent],
      providers: [{ provide: MasterDataService, useValue: mockMasterDataService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(SuppliersComponent);
    component = fixture.componentInstance;
  });

  it('should load suppliers on init', async () => {
    await component.loadSuppliers();
    expect(mockMasterDataService.getSuppliers).toHaveBeenCalled();
    expect(component.suppliers().length).toBe(2);
  });

  it('should filter suppliers by query and status', () => {
    component.suppliers.set(mockSuppliers as any);

    component.searchQuery.set('berkah');
    expect(component.filteredSuppliers().length).toBe(1);
    expect(component.filteredSuppliers()[0].name).toBe('Toko Benang Berkah');

    component.searchQuery.set('');
    component.setStatusFilter('active');
    expect(component.filteredSuppliers().length).toBe(1);
    expect(component.filteredSuppliers()[0].name).toBe('PT Tekstil Jaya Mandiri');
  });

  it('should validate form and show error if name is empty', async () => {
    component.openCreateModal();
    component.formName.set('');

    await component.saveSupplier();

    expect(component.formError()).toBe('Nama pemasok wajib diisi.');
    expect(mockMasterDataService.createSupplier).not.toHaveBeenCalled();
  });

  it('should call createSupplier on valid submission', async () => {
    component.openCreateModal();
    component.formName.set('CV Kancing Indah');
    component.formPhone.set('082222');
    component.formBank.set('BCA');
    component.formAccountNumber.set('11223344');
    component.formAccountHolder.set('CV Kancing');
    component.formAddress.set('Pekalongan');

    await component.saveSupplier();

    expect(mockMasterDataService.createSupplier).toHaveBeenCalledWith({
      name: 'CV Kancing Indah',
      phone: '082222',
      email: '',
      bank: 'BCA',
      accountNumber: '11223344',
      accountHolder: 'CV Kancing',
      address: 'Pekalongan',
    });
    expect(component.isModalOpen()).toBe(false);
  });
});
