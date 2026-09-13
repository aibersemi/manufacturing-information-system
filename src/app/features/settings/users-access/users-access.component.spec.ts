import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { UsersAccessComponent } from './users-access.component';
import { SettingsService } from '../../../core/services/settings.service';
import { CompanyService } from '../../../core/services/company.service';
import { AuthService } from '../../../core/services/auth.service';

describe('UsersAccessComponent', () => {
  let component: UsersAccessComponent;
  let mockSettingsService: any;
  let mockCompanyService: any;
  let mockAuthService: any;

  const mockUsers = [
    {
      company_id: 'c1',
      user_id: 'u-owner-1',
      email: 'owner@example.com',
      full_name: 'Budi Owner',
      username: 'budi_owner',
      roles: ['owner'],
      is_active: true,
      version: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      company_id: 'c1',
      user_id: 'u-op-2',
      email: 'operator@example.com',
      full_name: 'Siti Jahit',
      username: 'siti_jahit',
      roles: ['operator_jahit'],
      is_active: true,
      version: 1,
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    },
  ];

  const mockPermissions = [
    {
      company_id: 'c1',
      role: 'owner',
      menu_key: 'dashboard',
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: true,
      can_post: true,
      can_void: true,
      allowed: true,
      version: 1,
      updated_by_user_id: null,
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      company_id: 'c1',
      role: 'operator_jahit',
      menu_key: 'production',
      can_view: true,
      can_create: false,
      can_edit: false,
      can_delete: false,
      can_post: false,
      can_void: false,
      allowed: true,
      version: 1,
      updated_by_user_id: null,
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  beforeEach(async () => {
    mockSettingsService = {
      getCompanyUsers: vi.fn().mockResolvedValue(mockUsers),
      listAvailableSystemUsers: vi.fn().mockResolvedValue([
        { user_id: 'u-new', email: 'baru@example.com', full_name: 'Staf Baru', username: 'staf_baru' },
      ]),
      getUserPermissions: vi.fn().mockResolvedValue(mockPermissions),
      assignUserRole: vi.fn().mockResolvedValue({
        company_id: 'c1',
        user_id: 'u-new',
        roles: ['operator_jahit'],
        is_active: true,
      }),
      updatePermission: vi.fn().mockResolvedValue({
        ...mockPermissions[1],
        can_create: true,
      }),
    };

    mockCompanyService = {
      activeCompanyId: signal('c1'),
      activeCompany: signal({ id: 'c1', code: 'AIBER001', name: 'PT Aiber Semikonduktor Indonesia' }),
    };

    mockAuthService = {
      currentUser: signal({ id: 'u-owner-1', email: 'owner@example.com' }),
    };

    await TestBed.configureTestingModule({
      imports: [UsersAccessComponent],
      providers: [
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: CompanyService, useValue: mockCompanyService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UsersAccessComponent);
    component = fixture.componentInstance;
  });

  it('should load users and permissions on init', async () => {
    await component.loadAllData();

    expect(mockSettingsService.getCompanyUsers).toHaveBeenCalledWith('c1');
    expect(mockSettingsService.getUserPermissions).toHaveBeenCalledWith('c1');
    expect(component.companyUsers().length).toBe(2);
  });

  it('should switch tabs between assignments and matrix', () => {
    expect(component.activeTab()).toBe('assignments');
    component.setTab('matrix');
    expect(component.activeTab()).toBe('matrix');
  });

  it('should filter staff list by search query', () => {
    component.companyUsers.set(mockUsers as any);
    component.searchQuery.set('siti');

    expect(component.filteredUsers().length).toBe(1);
    expect(component.filteredUsers()[0].full_name).toBe('Siti Jahit');
  });

  it('should handle exclusive role selection (owner/finance clears other roles)', () => {
    component.formSelectedRoles.set(['operator_potong', 'operator_jahit']);

    // Pilih role owner (eksklusif)
    component.toggleRoleSelection('owner');
    expect(component.formSelectedRoles()).toEqual(['owner']);

    // Pilih role operasional (harus menghapus role owner)
    component.toggleRoleSelection('operator_sablon');
    expect(component.formSelectedRoles()).toEqual(['operator_sablon']);
  });

  it('should validate form and require user and roles', async () => {
    component.openAddAssignmentModal();
    component.formUserId.set('');

    await component.saveAssignment();

    expect(component.formError()).toBe('Pengguna wajib dipilih.');
    expect(mockSettingsService.assignUserRole).not.toHaveBeenCalled();
  });

  it('should call assignUserRole when valid assignment is saved', async () => {
    component.openAddAssignmentModal();
    component.formUserId.set('u-new');
    component.formSelectedRoles.set(['operator_potong']);

    await component.saveAssignment();

    expect(mockSettingsService.assignUserRole).toHaveBeenCalledWith(
      'c1',
      'u-new',
      ['operator_potong'],
      true,
    );
    expect(component.isAssignmentModalOpen()).toBe(false);
  });

  it('should prevent modifying owner permission', async () => {
    component.permissions.set(mockPermissions as any);
    const ownerPerm = mockPermissions[0];

    await component.updateSinglePermission(ownerPerm as any, 'can_create', false);

    expect(mockSettingsService.updatePermission).not.toHaveBeenCalled();
  });
});
