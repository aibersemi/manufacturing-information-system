import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheck,
  phosphorFloppyDisk,
  phosphorMagnifyingGlass,
  phosphorPencilSimple,
  phosphorPlus,
  phosphorShieldCheck,
  phosphorUser,
  phosphorUserPlus,
  phosphorUsers,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import {
  AccessPermission,
  CompanyUserWithProfile,
  SettingsService,
  SystemUserOption,
  VALID_ROLES,
} from '../../../core/services/settings.service';
import { AuthService } from '../../../core/services/auth.service';
import { CompanyService } from '../../../core/services/company.service';

@Component({
  selector: 'app-users-access',
  imports: [
    FormsModule,
    NgIcon,
    HlmButton,
    HlmCardImports,
  ],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorCheck,
      phosphorFloppyDisk,
      phosphorMagnifyingGlass,
      phosphorPencilSimple,
      phosphorPlus,
      phosphorShieldCheck,
      phosphorUser,
      phosphorUserPlus,
      phosphorUsers,
      phosphorX,
    }),
  ],
  templateUrl: './users-access.component.html',
})
export class UsersAccessComponent implements OnInit {
  private readonly settingsService = inject(SettingsService);
  private readonly companyService = inject(CompanyService);
  private readonly authService = inject(AuthService);

  readonly activeTab = signal<'assignments' | 'matrix'>('assignments');
  readonly isLoading = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');

  // Data lists
  readonly companyUsers = signal<CompanyUserWithProfile[]>([]);
  readonly systemUsers = signal<SystemUserOption[]>([]);
  readonly permissions = signal<AccessPermission[]>([]);
  readonly selectedMatrixRole = signal<string>('owner');

  readonly availableRoles = VALID_ROLES;

  // Modal Assignment State
  readonly isAssignmentModalOpen = signal<boolean>(false);
  readonly modalMode = signal<'create' | 'edit'>('create');
  readonly selectedAssignment = signal<CompanyUserWithProfile | null>(null);
  readonly formUserId = signal<string>('');
  readonly formSelectedRoles = signal<string[]>([]);
  readonly formIsActive = signal<boolean>(true);
  readonly formError = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  // Active Context
  readonly currentUserId = computed(() => this.authService.currentUser()?.id ?? '');
  readonly activeCompany = computed(() => this.companyService.activeCompany());
  readonly activeCompanyId = computed(() => this.companyService.activeCompanyId() ?? '');

  // Filtered Company Users
  readonly filteredUsers = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();
    let list = this.companyUsers();

    if (status === 'active') {
      list = list.filter((u) => u.is_active);
    } else if (status === 'inactive') {
      list = list.filter((u) => !u.is_active);
    }

    if (q) {
      list = list.filter(
        (u) =>
          u.full_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q),
      );
    }

    return list;
  });

  // Filtered Permissions for Active Matrix Role
  readonly matrixPermissions = computed(() => {
    const role = this.selectedMatrixRole();
    return this.permissions().filter((p) => p.role === role);
  });

  ngOnInit(): void {
    this.loadAllData();
  }

  async loadAllData(): Promise<void> {
    const compId = this.activeCompanyId();
    if (!compId) return;

    this.isLoading.set(true);
    try {
      const [users, availableUsers, perms] = await Promise.all([
        this.settingsService.getCompanyUsers(compId),
        this.settingsService.listAvailableSystemUsers(),
        this.settingsService.getUserPermissions(compId),
      ]);
      this.companyUsers.set(users);
      this.systemUsers.set(availableUsers);
      this.permissions.set(perms);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data pengguna dan akses.';
      toast.error(msg);
    } finally {
      this.isLoading.set(false);
    }
  }

  setTab(tab: 'assignments' | 'matrix'): void {
    this.activeTab.set(tab);
  }

  setMatrixRole(role: string): void {
    this.selectedMatrixRole.set(role);
  }

  setStatusFilter(status: 'all' | 'active' | 'inactive'): void {
    this.statusFilter.set(status);
  }

  // --- MODAL ASSIGNMENT METHODS ---

  openAddAssignmentModal(): void {
    this.modalMode.set('create');
    this.selectedAssignment.set(null);
    this.formUserId.set('');
    this.formSelectedRoles.set(['operator_jahit']);
    this.formIsActive.set(true);
    this.formError.set(null);
    this.isAssignmentModalOpen.set(true);
  }

  openEditAssignmentModal(item: CompanyUserWithProfile): void {
    this.modalMode.set('edit');
    this.selectedAssignment.set(item);
    this.formUserId.set(item.user_id);
    this.formSelectedRoles.set([...item.roles]);
    this.formIsActive.set(item.is_active);
    this.formError.set(null);
    this.isAssignmentModalOpen.set(true);
  }

  closeAssignmentModal(): void {
    if (this.isSubmitting()) return;
    this.isAssignmentModalOpen.set(false);
  }

  toggleRoleSelection(roleId: string): void {
    const current = this.formSelectedRoles();
    const roleDef = this.availableRoles.find((r) => r.id === roleId);

    if (roleDef?.isExclusive) {
      // Role eksklusif (owner atau finance) hanya boleh berdiri sendiri
      if (current.includes(roleId)) {
        this.formSelectedRoles.set([]);
      } else {
        this.formSelectedRoles.set([roleId]);
      }
    } else {
      // Role operasional tidak boleh digabung dengan role eksklusif
      const filtered = current.filter((r) => r !== 'owner' && r !== 'finance');
      if (filtered.includes(roleId)) {
        this.formSelectedRoles.set(filtered.filter((r) => r !== roleId));
      } else {
        this.formSelectedRoles.set([...filtered, roleId]);
      }
    }
  }

  isRoleSelected(roleId: string): boolean {
    return this.formSelectedRoles().includes(roleId);
  }

  async saveAssignment(): Promise<void> {
    this.formError.set(null);
    const compId = this.activeCompanyId();
    const userId = this.formUserId();
    const roles = this.formSelectedRoles();
    const isActive = this.formIsActive();

    if (!userId) {
      this.formError.set('Pengguna wajib dipilih.');
      return;
    }

    if (roles.length === 0) {
      this.formError.set('Pilih minimal satu peran untuk penugasan.');
      return;
    }

    this.isSubmitting.set(true);

    try {
      await this.settingsService.assignUserRole(compId, userId, roles, isActive);
      toast.success('Penugasan peran pengguna berhasil disimpan.');
      this.isAssignmentModalOpen.set(false);
      await this.loadAllData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan penugasan.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // --- PERMISSION MATRIX METHODS ---

  async updateSinglePermission(
    perm: AccessPermission,
    key: 'can_view' | 'can_create' | 'can_edit' | 'can_delete' | 'can_post' | 'can_void',
    value: boolean,
  ): Promise<void> {
    const compId = this.activeCompanyId();
    if (!compId) return;

    // Invariant: Owner selalu memiliki full access, beri konfirmasi atau peringatan
    if (perm.role === 'owner' && !value) {
      toast.error('Peran Owner memiliki hak akses penuh secara permanen.');
      return;
    }

    try {
      const updated = await this.settingsService.updatePermission(
        compId,
        perm.role,
        perm.menu_key,
        {
          canView: key === 'can_view' ? value : perm.can_view,
          canCreate: key === 'can_create' ? value : perm.can_create,
          canEdit: key === 'can_edit' ? value : perm.can_edit,
          canDelete: key === 'can_delete' ? value : perm.can_delete,
          canPost: key === 'can_post' ? value : perm.can_post,
          canVoid: key === 'can_void' ? value : perm.can_void,
        },
      );

      // Update state lokal
      this.permissions.update((list) =>
        list.map((p) =>
          p.company_id === updated.company_id &&
          p.role === updated.role &&
          p.menu_key === updated.menu_key
            ? updated
            : p,
        ),
      );

      toast.success(`Izin "${perm.menu_key}" untuk peran "${perm.role}" diperbarui.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memperbarui izin akses.';
      toast.error(msg);
    }
  }

  formatRoleLabel(roleId: string): string {
    const match = this.availableRoles.find((r) => r.id === roleId);
    return match ? match.label : roleId;
  }
}
