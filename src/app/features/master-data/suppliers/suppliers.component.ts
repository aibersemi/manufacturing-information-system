import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorBank,
  phosphorBuilding,
  phosphorMagnifyingGlass,
  phosphorPencilSimple,
  phosphorPlus,
  phosphorToggleLeft,
  phosphorToggleRight,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { CompanyService } from '../../../core/services/company.service';
import { MasterDataService, MasterRecord, SupplierData } from '../../../core/services/master-data.service';

@Component({
  selector: 'app-suppliers',
  imports: [
    FormsModule,
    NgIcon,
    HlmButton,
    HlmCardImports,
  ],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorBank,
      phosphorBuilding,
      phosphorMagnifyingGlass,
      phosphorPencilSimple,
      phosphorPlus,
      phosphorToggleLeft,
      phosphorToggleRight,
      phosphorX,
    }),
  ],
  templateUrl: './suppliers.component.html',
})
export class SuppliersComponent {
  private readonly masterDataService = inject(MasterDataService);
  private readonly companyService = inject(CompanyService);

  constructor() {
    effect(() => {
      const companyId = this.companyService.activeCompanyId();
      if (companyId) {
        this.loadSuppliers();
      }
    });
  }

  readonly suppliers = signal<MasterRecord[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');

  // Modal State
  readonly isModalOpen = signal<boolean>(false);
  readonly modalMode = signal<'create' | 'edit'>('create');
  readonly selectedSupplier = signal<MasterRecord | null>(null);
  readonly formName = signal<string>('');
  readonly formPhone = signal<string>('');
  readonly formEmail = signal<string>('');
  readonly formBank = signal<string>('');
  readonly formAccountNumber = signal<string>('');
  readonly formAccountHolder = signal<string>('');
  readonly formAddress = signal<string>('');
  readonly formIsActive = signal<boolean>(true);
  readonly formError = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  readonly filteredSuppliers = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();
    let list = this.suppliers();

    if (status === 'active') {
      list = list.filter((s) => s.is_active);
    } else if (status === 'inactive') {
      list = list.filter((s) => !s.is_active);
    }

    if (q) {
      list = list.filter((s) => {
        const data = (s.data || {}) as SupplierData;
        return (
          s.name.toLowerCase().includes(q) ||
          (data.phone && data.phone.toLowerCase().includes(q)) ||
          (data.email && data.email.toLowerCase().includes(q)) ||
          (data.bank && data.bank.toLowerCase().includes(q)) ||
          (data.accountNumber && data.accountNumber.toLowerCase().includes(q)) ||
          (data.accountHolder && data.accountHolder.toLowerCase().includes(q))
        );
      });
    }

    return list;
  });

  async loadSuppliers(): Promise<void> {
    this.isLoading.set(true);
    try {
      const data = await this.masterDataService.getSuppliers();
      this.suppliers.set(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data pemasok.';
      toast.error(msg);
    } finally {
      this.isLoading.set(false);
    }
  }

  setStatusFilter(status: 'all' | 'active' | 'inactive'): void {
    this.statusFilter.set(status);
  }

  getSupplierData(supplier: MasterRecord): SupplierData {
    return (supplier.data || {}) as SupplierData;
  }

  openCreateModal(): void {
    this.modalMode.set('create');
    this.selectedSupplier.set(null);
    this.formName.set('');
    this.formPhone.set('');
    this.formEmail.set('');
    this.formBank.set('');
    this.formAccountNumber.set('');
    this.formAccountHolder.set('');
    this.formAddress.set('');
    this.formIsActive.set(true);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  openEditModal(supplier: MasterRecord): void {
    this.modalMode.set('edit');
    this.selectedSupplier.set(supplier);
    this.formName.set(supplier.name);
    const data = this.getSupplierData(supplier);
    this.formPhone.set(data.phone || '');
    this.formEmail.set(data.email || '');
    this.formBank.set(data.bank || '');
    this.formAccountNumber.set(data.accountNumber || '');
    this.formAccountHolder.set(data.accountHolder || '');
    this.formAddress.set(data.address || '');
    this.formIsActive.set(supplier.is_active);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    if (this.isSubmitting()) return;
    this.isModalOpen.set(false);
  }

  async saveSupplier(): Promise<void> {
    this.formError.set(null);
    const name = this.formName().trim();
    if (!name) {
      this.formError.set('Nama pemasok wajib diisi.');
      return;
    }

    this.isSubmitting.set(true);

    const payload = {
      name,
      phone: this.formPhone().trim(),
      email: this.formEmail().trim(),
      bank: this.formBank().trim(),
      accountNumber: this.formAccountNumber().trim(),
      accountHolder: this.formAccountHolder().trim(),
      address: this.formAddress().trim(),
    };

    try {
      if (this.modalMode() === 'create') {
        const created = await this.masterDataService.createSupplier(payload);
        toast.success(`Pemasok "${created.name}" berhasil ditambahkan.`);
      } else {
        const current = this.selectedSupplier();
        if (!current) return;
        const updated = await this.masterDataService.updateSupplier(current.id, {
          ...payload,
          isActive: this.formIsActive(),
        });
        toast.success(`Pemasok "${updated.name}" berhasil diperbarui.`);
      }

      this.isModalOpen.set(false);
      await this.loadSuppliers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan pemasok.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async toggleStatus(supplier: MasterRecord): Promise<void> {
    const nextStatus = !supplier.is_active;
    const data = this.getSupplierData(supplier);
    try {
      await this.masterDataService.updateSupplier(supplier.id, {
        name: supplier.name,
        phone: data.phone || '',
        email: data.email || '',
        bank: data.bank || '',
        accountNumber: data.accountNumber || '',
        accountHolder: data.accountHolder || '',
        address: data.address || '',
        isActive: nextStatus,
      });
      toast.success(`Status "${supplier.name}" diubah menjadi ${nextStatus ? 'Aktif' : 'Nonaktif'}.`);
      await this.loadSuppliers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengubah status pemasok.';
      toast.error(msg);
    }
  }
}
