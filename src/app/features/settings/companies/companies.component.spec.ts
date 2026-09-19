import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CompaniesComponent } from './companies.component';
import { SettingsService, CompanyWithStats } from '../../../core/services/settings.service';
import { CompanyService } from '../../../core/services/company.service';

describe('CompaniesComponent', () => {
  let component: CompaniesComponent;
  let mockSettingsService: any;
  let mockCompanyService: any;

  const mockCompanies: CompanyWithStats[] = [
    {
      id: 'c1',
      code: 'AIBER001',
      name: 'PT Aiber Semikonduktor Indonesia',
      address: 'Kawasan Industri Cikarang',
      phone: '021-123456',
      email: 'contact@aiber.co.id',
      logo_storage_key: null,
      is_active: true,
      code_locked: true,
      version: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      assigned_users_count: 5,
    },
    {
      id: 'c2',
      code: 'BDG002',
      name: 'PT Bandung Silikon',
      address: 'Jl. Dago No. 10',
      phone: '022-654321',
      email: 'admin@bdgsilikon.id',
      logo_storage_key: null,
      is_active: false,
      code_locked: false,
      version: 1,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
      assigned_users_count: 2,
    },
  ];

  beforeEach(async () => {
    mockSettingsService = {
      getCompanies: vi.fn().mockResolvedValue(mockCompanies),
      createCompany: vi.fn().mockResolvedValue({
        id: 'c3',
        code: 'SBY003',
        name: 'PT Surabaya Chip',
        is_active: true,
      }),
      updateCompany: vi.fn().mockResolvedValue({
        id: 'c1',
        name: 'PT Aiber Semikonduktor Indonesia Updated',
        is_active: true,
      }),
    };

    mockCompanyService = {
      activeCompanyId: signal('c1'),
      activeCompany: signal(mockCompanies[0]),
      loadUserCompanies: vi.fn().mockResolvedValue(undefined),
      switchActiveCompany: vi.fn().mockReturnValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [CompaniesComponent],
      providers: [
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CompaniesComponent);
    component = fixture.componentInstance;
  });

  it('should load companies on init and calculate KPI metrics correctly', async () => {
    component.ngOnInit();
    await Promise.resolve();

    expect(mockSettingsService.getCompanies).toHaveBeenCalled();
    expect(component.companies().length).toBe(2);
    expect(component.totalCompanies()).toBe(2);
    expect(component.activeCompaniesCount()).toBe(1);
    expect(component.inactiveCompaniesCount()).toBe(1);
  });

  it('should filter companies by search query across multiple fields (code, name, address, email)', () => {
    component.companies.set(mockCompanies);

    // Search code
    component.searchQuery.set('aiber');
    expect(component.filteredCompanies().length).toBe(1);
    expect(component.filteredCompanies()[0].code).toBe('AIBER001');

    // Search address
    component.searchQuery.set('cikarang');
    expect(component.filteredCompanies().length).toBe(1);

    // Search email
    component.searchQuery.set('bdgsilikon');
    expect(component.filteredCompanies().length).toBe(1);
    expect(component.filteredCompanies()[0].code).toBe('BDG002');

    // Filter status inactive
    component.searchQuery.set('');
    component.setStatusFilter('inactive');
    expect(component.filteredCompanies().length).toBe(1);
    expect(component.filteredCompanies()[0].code).toBe('BDG002');
  });

  it('should validate form and show error if code is empty', async () => {
    component.openCreateModal();
    component.formCode.set('');
    component.formName.set('PT Baru');

    await component.saveCompany();

    expect(component.formError()).toBe('Kode perusahaan wajib diisi.');
    expect(mockSettingsService.createCompany).not.toHaveBeenCalled();
  });

  it('should validate invalid email format on company creation', async () => {
    component.openCreateModal();
    component.formCode.set('SBY003');
    component.formName.set('PT Surabaya Chip');
    component.formEmail.set('invalid-email-format');

    await component.saveCompany();

    expect(component.formError()).toBe('Format alamat email perusahaan tidak valid.');
    expect(mockSettingsService.createCompany).not.toHaveBeenCalled();
  });

  it('should call createCompany with full payload when saving in create mode', async () => {
    component.openCreateModal();
    component.formCode.set('SBY003');
    component.formName.set('PT Surabaya Chip');
    component.formAddress.set('Kawasan Rungkut Industri');
    component.formPhone.set('031-123456');
    component.formEmail.set('info@surabayachip.id');

    await component.saveCompany();

    expect(mockSettingsService.createCompany).toHaveBeenCalledWith({
      code: 'SBY003',
      name: 'PT Surabaya Chip',
      address: 'Kawasan Rungkut Industri',
      phone: '031-123456',
      email: 'info@surabayachip.id',
    });
    expect(component.isModalOpen()).toBe(false);
  });

  it('should open and populate edit modal correctly', () => {
    component.openEditModal(mockCompanies[0]);

    expect(component.modalMode()).toBe('edit');
    expect(component.selectedCompany()).toEqual(mockCompanies[0]);
    expect(component.formCode()).toBe('AIBER001');
    expect(component.formName()).toBe('PT Aiber Semikonduktor Indonesia');
    expect(component.formAddress()).toBe('Kawasan Industri Cikarang');
    expect(component.formPhone()).toBe('021-123456');
    expect(component.formEmail()).toBe('contact@aiber.co.id');
    expect(component.isModalOpen()).toBe(true);
  });

  it('should prevent toggling active company to inactive', async () => {
    component.companies.set(mockCompanies);
    const activeComp = mockCompanies[0];

    await component.toggleStatus(activeComp);

    expect(mockSettingsService.updateCompany).not.toHaveBeenCalled();
  });

  it('should handle quick switch company successfully for active non-current company', () => {
    const activeNonCurrent: CompanyWithStats = {
      ...mockCompanies[1],
      is_active: true,
    };

    component.quickSwitchCompany(activeNonCurrent);

    expect(mockCompanyService.switchActiveCompany).toHaveBeenCalledWith(activeNonCurrent.id);
  });

  it('should open and close detail modal', () => {
    component.openDetailModal(mockCompanies[0]);
    expect(component.isDetailModalOpen()).toBe(true);
    expect(component.detailCompany()).toEqual(mockCompanies[0]);

    component.closeDetailModal();
    expect(component.isDetailModalOpen()).toBe(false);
    expect(component.detailCompany()).toBeNull();
  });
});
