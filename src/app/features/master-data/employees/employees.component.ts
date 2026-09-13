import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCircleNotch,
  phosphorIdentificationCard,
  phosphorMagnifyingGlass,
  phosphorMapPin,
  phosphorPencilSimple,
  phosphorPhone,
  phosphorPlus,
  phosphorToggleLeft,
  phosphorToggleRight,
  phosphorUser,
  phosphorUsers,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { CompanyService } from '../../../core/services/company.service';
import {
  EmployeeData,
  MasterDataService,
  MasterRecord,
} from '../../../core/services/master-data.service';

export const ROLE_CATEGORIES = [
  'Operator Potong',
  'Operator Sablon',
  'Operator Jahit',
  'Operator Packing',
  'Supervisor Produksi',
  'Staf Umum',
] as const;

@Component({
  selector: 'app-employees',
  imports: [
    CommonModule,
    FormsModule,
    NgIcon,
    HlmButton,
    HlmCardImports,
  ],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorCircleNotch,
      phosphorIdentificationCard,
      phosphorMagnifyingGlass,
      phosphorMapPin,
      phosphorPencilSimple,
      phosphorPhone,
      phosphorPlus,
      phosphorToggleLeft,
      phosphorToggleRight,
      phosphorUser,
      phosphorUsers,
      phosphorX,
    }),
  ],
  templateUrl: './employees.component.html',
})
export class EmployeesComponent {
  private readonly masterDataService = inject(MasterDataService);
  private readonly companyService = inject(CompanyService);

  constructor() {
    effect(() => {
      const companyId = this.companyService.activeCompanyId();
      if (companyId) {
        this.loadEmployees();
      }
    });
  }

  readonly roleCategories = ROLE_CATEGORIES;
  readonly employees = signal<MasterRecord[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');
  readonly roleFilter = signal<string>('all');

  // Modal State
  readonly isModalOpen = signal<boolean>(false);
  readonly modalMode = signal<'create' | 'edit'>('create');
  readonly selectedEmployee = signal<MasterRecord | null>(null);

  // Form Signals
  readonly formName = signal<string>('');
  readonly formRoleCategory = signal<string>('Operator Jahit');
  readonly formPhone = signal<string>('');
  readonly formAddress = signal<string>('');
  readonly formIsActive = signal<boolean>(true);
  readonly formError = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  readonly filteredEmployees = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();
    const role = this.roleFilter();
    let list = this.employees();

    if (status === 'active') {
      list = list.filter((e) => e.is_active);
    } else if (status === 'inactive') {
      list = list.filter((e) => !e.is_active);
    }

    if (role !== 'all') {
      list = list.filter((e) => {
        const data = this.getEmployeeData(e);
        return data.roleCategory === role;
      });
    }

    if (q) {
      list = list.filter((e) => {
        const data = this.getEmployeeData(e);
        return (
          e.name.toLowerCase().includes(q) ||
          (data.phone && data.phone.toLowerCase().includes(q)) ||
          (data.address && data.address.toLowerCase().includes(q)) ||
          (data.roleCategory && data.roleCategory.toLowerCase().includes(q))
        );
      });
    }

    return list;
  });

  async loadEmployees(): Promise<void> {
    this.isLoading.set(true);
    try {
      const data = await this.masterDataService.getEmployees();
      this.employees.set(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data karyawan.';
      toast.error(msg);
    } finally {
      this.isLoading.set(false);
    }
  }

  setStatusFilter(status: 'all' | 'active' | 'inactive'): void {
    this.statusFilter.set(status);
  }

  setRoleFilter(role: string): void {
    this.roleFilter.set(role);
  }

  getEmployeeData(employee: MasterRecord): EmployeeData {
    return (employee.data || {
      phone: '',
      address: '',
      roleCategory: 'Operator Jahit',
    }) as EmployeeData;
  }

  openCreateModal(): void {
    this.modalMode.set('create');
    this.selectedEmployee.set(null);
    this.formName.set('');
    this.formRoleCategory.set('Operator Jahit');
    this.formPhone.set('');
    this.formAddress.set('');
    this.formIsActive.set(true);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  openEditModal(employee: MasterRecord): void {
    this.modalMode.set('edit');
    this.selectedEmployee.set(employee);
    this.formName.set(employee.name);

    const data = this.getEmployeeData(employee);
    this.formRoleCategory.set(data.roleCategory || 'Operator Jahit');
    this.formPhone.set(data.phone || '');
    this.formAddress.set(data.address || '');
    this.formIsActive.set(employee.is_active);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    if (this.isSubmitting()) return;
    this.isModalOpen.set(false);
  }

  async saveEmployee(): Promise<void> {
    this.formError.set(null);
    const name = this.formName().trim();
    if (!name) {
      this.formError.set('Nama tenaga kerja wajib diisi.');
      return;
    }

    this.isSubmitting.set(true);

    const payload = {
      name,
      roleCategory: this.formRoleCategory(),
      phone: this.formPhone().trim(),
      address: this.formAddress().trim(),
    };

    try {
      if (this.modalMode() === 'create') {
        const created = await this.masterDataService.createEmployee(payload);
        toast.success(`Tenaga kerja "${created.name}" berhasil ditambahkan.`);
      } else {
        const current = this.selectedEmployee();
        if (!current) return;
        const updated = await this.masterDataService.updateEmployee(current.id, {
          ...payload,
          isActive: this.formIsActive(),
        });
        toast.success(`Tenaga kerja "${updated.name}" berhasil diperbarui.`);
      }

      this.isModalOpen.set(false);
      await this.loadEmployees();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan data karyawan.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async toggleStatus(employee: MasterRecord): Promise<void> {
    const nextStatus = !employee.is_active;
    const data = this.getEmployeeData(employee);
    try {
      await this.masterDataService.updateEmployee(employee.id, {
        name: employee.name,
        roleCategory: data.roleCategory,
        phone: data.phone,
        address: data.address,
        isActive: nextStatus,
      });
      toast.success(`Status "${employee.name}" diubah menjadi ${nextStatus ? 'Aktif' : 'Nonaktif'}.`);
      await this.loadEmployees();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengubah status karyawan.';
      toast.error(msg);
    }
  }
}
