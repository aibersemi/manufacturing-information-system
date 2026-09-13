import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CompaniesComponent } from './companies.component';
import { SettingsService } from '../../../core/services/settings.service';
import { CompanyService } from '../../../core/services/company.service';

describe('CompaniesComponent', () => {
  let component: CompaniesComponent;
  let mockSettingsService: any;
  let mockCompanyService: any;

  const mockCompanies = [
    {
      id: 'c1',
      code: 'AIBER001',
      name: 'PT Aiber Semikonduktor Indonesia',
      is_active: true,
      code_locked: true,
      version: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'c2',
      code: 'BDG002',
      name: 'PT Bandung Silikon',
      is_active: false,
      code_locked: false,
      version: 1,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
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
      loadUserCompanies: vi.fn().mockResolvedValue(undefined),
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

  it('should load companies on init', async () => {
    component.ngOnInit();
    await Promise.resolve();

    expect(mockSettingsService.getCompanies).toHaveBeenCalled();
    expect(component.companies().length).toBe(2);
  });

  it('should filter companies by search query and status', () => {
    component.companies.set(mockCompanies as any);

    // Search code
    component.searchQuery.set('aiber');
    expect(component.filteredCompanies().length).toBe(1);
    expect(component.filteredCompanies()[0].code).toBe('AIBER001');

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

  it('should call createCompany when saving in create mode', async () => {
    component.openCreateModal();
    component.formCode.set('SBY003');
    component.formName.set('PT Surabaya Chip');

    await component.saveCompany();

    expect(mockSettingsService.createCompany).toHaveBeenCalledWith({
      code: 'SBY003',
      name: 'PT Surabaya Chip',
    });
    expect(component.isModalOpen()).toBe(false);
  });

  it('should prevent toggling active company to inactive', async () => {
    component.companies.set(mockCompanies as any);
    const activeComp = mockCompanies[0];

    await component.toggleStatus(activeComp as any);

    expect(mockSettingsService.updateCompany).not.toHaveBeenCalled();
  });
});
