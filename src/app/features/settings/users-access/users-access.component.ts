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

export type ModuleCategory =
  | 'Dashboard'
  | 'Operator'
  | 'Produksi'
  | 'Stok'
  | 'Master Data'
  | 'Pembelian'
  | 'Penjualan'
  | 'Keuangan'
  | 'Pengaturan';

export interface MenuMetadata {
  readonly label: string;
  readonly module: ModuleCategory;
}

export const MODULE_CATEGORIES: ModuleCategory[] = [
  'Dashboard',
  'Operator',
  'Produksi',
  'Stok',
  'Master Data',
  'Pembelian',
  'Penjualan',
  'Keuangan',
  'Pengaturan',
];

export const MENU_METADATA: Record<string, MenuMetadata> = {
  // Dashboard
  'dashboard': { label: 'Dashboard Utama', module: 'Dashboard' },

  // Master Data
  'master.customers': { label: 'Data Pelanggan', module: 'Master Data' },
  'master.suppliers': { label: 'Data Pemasok', module: 'Master Data' },
  'master.materials': { label: 'Bahan Baku & Material', module: 'Master Data' },
  'master.bom': { label: 'BOM (Formula Bahan)', module: 'Master Data' },
  'master.products': { label: 'SKU & Katalog Produk', module: 'Master Data' },
  'master.employees': { label: 'Karyawan & Tenaga Kerja', module: 'Master Data' },

  // Pembelian
  'purchases.materials': { label: 'Pembelian Bahan Produksi', module: 'Pembelian' },
  'purchases.supplies': { label: 'Pembelian Perlengkapan', module: 'Pembelian' },
  'purchases.non-production': { label: 'Pengadaan Non-Produksi', module: 'Pembelian' },
  'purchases.assets': { label: 'Belanja Aset Pabrik', module: 'Pembelian' },

  // Penjualan
  'sales.orders': { label: 'Pesanan Penjualan (PO Masuk)', module: 'Penjualan' },
  'sales.invoices': { label: 'Faktur & Tagihan Penjualan', module: 'Penjualan' },

  // Produksi
  'production.orders': { label: 'Perintah Produksi (Work Order)', module: 'Produksi' },
  'production.cutting-orders': { label: 'SPK Potong', module: 'Produksi' },
  'production.printing-orders': { label: 'SPK Sablon', module: 'Produksi' },
  'production.sewing-orders': { label: 'SPK Jahit', module: 'Produksi' },
  'production.packing-orders': { label: 'SPK Packing', module: 'Produksi' },
  'production.repairs': { label: 'Kasus Perbaikan (Rework)', module: 'Produksi' },
  'production.progress': { label: 'Progress SPK & Produksi', module: 'Produksi' },

  // Operator
  'operators.cutting': { label: 'Catat Potongan', module: 'Operator' },
  'operators.printing': { label: 'Catat Sablon', module: 'Operator' },
  'operators.sewing': { label: 'Catat Jahit', module: 'Operator' },
  'operators.packing': { label: 'Catat Packing', module: 'Operator' },

  // Stok
  'inventory.materials': { label: 'Stok Bahan Baku', module: 'Stok' },
  'inventory.incoming': { label: 'Penerimaan Stok (Masuk)', module: 'Stok' },
  'inventory.outgoing': { label: 'Pengeluaran Stok (Keluar)', module: 'Stok' },
  'inventory.wip': { label: 'Stok WIP (Produksi)', module: 'Stok' },
  'inventory.finished-goods': { label: 'Stok Produk Jadi', module: 'Stok' },

  // Keuangan
  'finance.purchase-payments': { label: 'Pembayaran Pembelian', module: 'Keuangan' },
  'finance.wage-payments': { label: 'Upah & Payroll Borongan', module: 'Keuangan' },
  'finance.expenses': { label: 'Biaya Operasional', module: 'Keuangan' },
  'finance.sales-receipts': { label: 'Penerimaan Pembayaran Piutang', module: 'Keuangan' },
  'finance.cash': { label: 'Kas & Rekening Bank', module: 'Keuangan' },
  'finance.assets': { label: 'Register & Penyusutan Aset', module: 'Keuangan' },
  'finance.coa': { label: 'Bagan Akun (Chart of Accounts)', module: 'Keuangan' },
  'finance.reports': { label: 'Laporan Keuangan & Akuntansi', module: 'Keuangan' },

  // Pengaturan
  'settings.companies': { label: 'Perusahaan & Multi-Tenant', module: 'Pengaturan' },
  'settings.users-access': { label: 'Pengguna & Hak Akses', module: 'Pengaturan' },
};

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

  // Matrix Filter & Search State
  readonly matrixSearchQuery = signal<string>('');
  readonly selectedCategoryFilter = signal<string>('all');
  readonly moduleCategories = MODULE_CATEGORIES;

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

  // Filtered Permissions based on Role, Module Category, and Search Query
  readonly filteredMatrixPermissions = computed(() => {
    const list = this.matrixPermissions();
    const q = this.matrixSearchQuery().trim().toLowerCase();
    const cat = this.selectedCategoryFilter();

    return list.filter((p) => {
      const meta = this.getMenuMetadata(p.menu_key);

      // Filter by category
      if (cat !== 'all' && meta.module !== cat) {
        return false;
      }

      // Filter by search query (menu_key, label, or module)
      if (q) {
        const matchKey = p.menu_key.toLowerCase().includes(q);
        const matchLabel = meta.label.toLowerCase().includes(q);
        const matchModule = meta.module.toLowerCase().includes(q);
        if (!matchKey && !matchLabel && !matchModule) {
          return false;
        }
      }

      return true;
    });
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

  setCategoryFilter(category: string): void {
    this.selectedCategoryFilter.set(category);
  }

  setMatrixSearchQuery(query: string): void {
    this.matrixSearchQuery.set(query);
  }

  getMenuMetadata(menuKey: string): MenuMetadata {
    if (MENU_METADATA[menuKey]) {
      return MENU_METADATA[menuKey];
    }

    // Fallback for custom or legacy keys
    const prefix = menuKey.split('.')[0]?.toLowerCase() ?? '';
    let fallbackModule: ModuleCategory = 'Pengaturan';
    if (prefix === 'dashboard') fallbackModule = 'Dashboard';
    else if (prefix === 'operators' || prefix === 'operator') fallbackModule = 'Operator';
    else if (prefix === 'production') fallbackModule = 'Produksi';
    else if (prefix === 'inventory') fallbackModule = 'Stok';
    else if (prefix === 'master') fallbackModule = 'Master Data';
    else if (prefix === 'purchases' || prefix === 'purchasing') fallbackModule = 'Pembelian';
    else if (prefix === 'sales') fallbackModule = 'Penjualan';
    else if (prefix === 'finance') fallbackModule = 'Keuangan';
    else if (prefix === 'settings') fallbackModule = 'Pengaturan';

    return {
      label: menuKey,
      module: fallbackModule,
    };
  }

  getMenuLabel(menuKey: string): string {
    return this.getMenuMetadata(menuKey).label;
  }

  getMenuModule(menuKey: string): ModuleCategory {
    return this.getMenuMetadata(menuKey).module;
  }

  getModuleBadgeClass(module: string): string {
    switch (module) {
      case 'Operator':
        return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
      case 'Produksi':
        return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20';
      case 'Stok':
        return 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20';
      case 'Master Data':
        return 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20';
      case 'Pembelian':
        return 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20';
      case 'Penjualan':
        return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20';
      case 'Keuangan':
        return 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20';
      case 'Pengaturan':
        return 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20';
      case 'Dashboard':
      default:
        return 'bg-muted text-muted-foreground border-border/80';
    }
  }
}
