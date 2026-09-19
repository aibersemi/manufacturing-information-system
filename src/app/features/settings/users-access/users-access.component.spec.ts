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
      role: 'owner',
      menu_key: 'operators.cutting',
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
      role: 'owner',
      menu_key: 'production.orders',
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
      menu_key: 'dashboard',
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
    {
      company_id: 'c1',
      role: 'operator_jahit',
      menu_key: 'operators.sewing',
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: false,
      can_post: false,
      can_void: false,
      allowed: true,
      version: 1,
      updated_by_user_id: null,
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      company_id: 'c1',
      role: 'operator_jahit',
      menu_key: 'production.sewing-orders',
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
    {
      company_id: 'c1',
      role: 'operator_packing',
      menu_key: 'dashboard',
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
    {
      company_id: 'c1',
      role: 'operator_packing',
      menu_key: 'operators.packing',
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: false,
      can_post: false,
      can_void: false,
      allowed: true,
      version: 1,
      updated_by_user_id: null,
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      company_id: 'c1',
      role: 'operator_packing',
      menu_key: 'production.packing-orders',
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
        ...mockPermissions[0],
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

  it('should filter matrix permissions by search query matching menu_key, label, or module', () => {
    component.permissions.set(mockPermissions as any);
    component.setMatrixRole('operator_jahit');

    expect(component.filteredMatrixPermissions().length).toBe(3);

    // Search by technical menu_key
    component.setMatrixSearchQuery('operators.sewing');
    expect(component.filteredMatrixPermissions().length).toBe(1);
    expect(component.filteredMatrixPermissions()[0].menu_key).toBe('operators.sewing');

    // Search by Indonesian label
    component.setMatrixSearchQuery('Catat Jahit');
    expect(component.filteredMatrixPermissions().length).toBe(1);
    expect(component.filteredMatrixPermissions()[0].menu_key).toBe('operators.sewing');

    // Search by module name
    component.setMatrixSearchQuery('Produksi');
    expect(component.filteredMatrixPermissions().length).toBe(1);
    expect(component.filteredMatrixPermissions()[0].menu_key).toBe('production.sewing-orders');

    // Clear search
    component.setMatrixSearchQuery('');
    expect(component.filteredMatrixPermissions().length).toBe(3);
  });

  it('should filter matrix permissions by module category', () => {
    component.permissions.set(mockPermissions as any);
    component.setMatrixRole('operator_jahit');

    // Filter by 'Operator' category
    component.setCategoryFilter('Operator');
    expect(component.filteredMatrixPermissions().length).toBe(1);
    expect(component.filteredMatrixPermissions()[0].menu_key).toBe('operators.sewing');

    // Filter by 'Produksi' category
    component.setCategoryFilter('Produksi');
    expect(component.filteredMatrixPermissions().length).toBe(1);
    expect(component.filteredMatrixPermissions()[0].menu_key).toBe('production.sewing-orders');

    // Filter by 'Dashboard' category
    component.setCategoryFilter('Dashboard');
    expect(component.filteredMatrixPermissions().length).toBe(1);
    expect(component.filteredMatrixPermissions()[0].menu_key).toBe('dashboard');

    // Reset filter to 'all'
    component.setCategoryFilter('all');
    expect(component.filteredMatrixPermissions().length).toBe(3);
  });

  it('should support operator_jahit and operator_packing roles with their specific menu permissions', () => {
    component.permissions.set(mockPermissions as any);

    // Test operator_jahit
    component.setMatrixRole('operator_jahit');
    expect(component.matrixPermissions().length).toBe(3);

    component.setCategoryFilter('Operator');
    const jahitPerms = component.filteredMatrixPermissions();
    expect(jahitPerms.length).toBe(1);
    expect(jahitPerms[0].menu_key).toBe('operators.sewing');
    expect(component.getMenuLabel('operators.sewing')).toBe('Catat Jahit');
    expect(component.getMenuModule('operators.sewing')).toBe('Operator');

    // Test operator_packing
    component.setMatrixRole('operator_packing');
    expect(component.matrixPermissions().length).toBe(3);

    const packingPerms = component.filteredMatrixPermissions();
    expect(packingPerms.length).toBe(1);
    expect(packingPerms[0].menu_key).toBe('operators.packing');
    expect(component.getMenuLabel('operators.packing')).toBe('Catat Packing');
    expect(component.getMenuModule('operators.packing')).toBe('Operator');

    // Search query for packing
    component.setCategoryFilter('all');
    component.setMatrixSearchQuery('packing');
    const filteredKeys = component.filteredMatrixPermissions().map((p) => p.menu_key);
    expect(filteredKeys).toContain('operators.packing');
    expect(filteredKeys).toContain('production.packing-orders');
  });

  it('should provide accurate Indonesian labels and categories across all key modules', () => {
    // Operator
    expect(component.getMenuLabel('operators.cutting')).toBe('Catat Potongan');
    expect(component.getMenuModule('operators.cutting')).toBe('Operator');
    expect(component.getMenuLabel('operators.printing')).toBe('Catat Sablon');
    expect(component.getMenuModule('operators.printing')).toBe('Operator');

    // Produksi
    expect(component.getMenuLabel('production.sewing-orders')).toBe('SPK Jahit');
    expect(component.getMenuModule('production.sewing-orders')).toBe('Produksi');
    expect(component.getMenuLabel('production.packing-orders')).toBe('SPK Packing');
    expect(component.getMenuModule('production.packing-orders')).toBe('Produksi');

    // Stok
    expect(component.getMenuLabel('inventory.finished-goods')).toBe('Stok Produk Jadi');
    expect(component.getMenuModule('inventory.finished-goods')).toBe('Stok');
    expect(component.getMenuLabel('inventory.wip')).toBe('Stok WIP (Produksi)');
    expect(component.getMenuModule('inventory.wip')).toBe('Stok');

    // Keuangan
    expect(component.getMenuLabel('finance.wage-payments')).toBe('Upah & Payroll Borongan');
    expect(component.getMenuModule('finance.wage-payments')).toBe('Keuangan');

    // Fallback for custom or unrecognized keys
    expect(component.getMenuLabel('custom.menu')).toBe('custom.menu');
    expect(component.getMenuModule('custom.menu')).toBe('Pengaturan');
    expect(component.getMenuModule('production.unknown')).toBe('Produksi');

    // Badge styling
    expect(component.getModuleBadgeClass('Operator')).toContain('amber');
    expect(component.getModuleBadgeClass('Produksi')).toContain('blue');
    expect(component.getModuleBadgeClass('Dashboard')).toContain('muted');
  });
});
