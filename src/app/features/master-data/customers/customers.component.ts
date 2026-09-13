import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorMagnifyingGlass,
  phosphorPencilSimple,
  phosphorPlus,
  phosphorToggleLeft,
  phosphorToggleRight,
  phosphorUser,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { CompanyService } from '../../../core/services/company.service';
import { CustomerData, MasterDataService, MasterRecord } from '../../../core/services/master-data.service';

@Component({
  selector: 'app-customers',
  imports: [
    FormsModule,
    NgIcon,
    HlmButton,
    HlmCardImports,
  ],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorPencilSimple,
      phosphorPlus,
      phosphorToggleLeft,
      phosphorToggleRight,
      phosphorUser,
      phosphorX,
    }),
  ],
  templateUrl: './customers.component.html',
})
export class CustomersComponent {
  private readonly masterDataService = inject(MasterDataService);
  private readonly companyService = inject(CompanyService);

  constructor() {
    effect(() => {
      const companyId = this.companyService.activeCompanyId();
      if (companyId) {
        this.loadCustomers();
      }
    });
  }

  readonly customers = signal<MasterRecord[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');

  // Modal State
  readonly isModalOpen = signal<boolean>(false);
  readonly modalMode = signal<'create' | 'edit'>('create');
  readonly selectedCustomer = signal<MasterRecord | null>(null);
  readonly formName = signal<string>('');
  readonly formPhone = signal<string>('');
  readonly formAddress = signal<string>('');
  readonly formIsActive = signal<boolean>(true);
  readonly formError = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  readonly filteredCustomers = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();
    let list = this.customers();

    if (status === 'active') {
      list = list.filter((c) => c.is_active);
    } else if (status === 'inactive') {
      list = list.filter((c) => !c.is_active);
    }

    if (q) {
      list = list.filter((c) => {
        const data = (c.data || {}) as CustomerData;
        return (
          c.name.toLowerCase().includes(q) ||
          (data.phone && data.phone.toLowerCase().includes(q)) ||
          (data.address && data.address.toLowerCase().includes(q))
        );
      });
    }

    return list;
  });

  async loadCustomers(): Promise<void> {
    this.isLoading.set(true);
    try {
      const data = await this.masterDataService.getCustomers();
      this.customers.set(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data pelanggan.';
      toast.error(msg);
    } finally {
      this.isLoading.set(false);
    }
  }

  setStatusFilter(status: 'all' | 'active' | 'inactive'): void {
    this.statusFilter.set(status);
  }

  getCustomerPhone(customer: MasterRecord): string {
    const data = (customer.data || {}) as CustomerData;
    return data.phone || '-';
  }

  getCustomerAddress(customer: MasterRecord): string {
    const data = (customer.data || {}) as CustomerData;
    return data.address || '-';
  }

  openCreateModal(): void {
    this.modalMode.set('create');
    this.selectedCustomer.set(null);
    this.formName.set('');
    this.formPhone.set('');
    this.formAddress.set('');
    this.formIsActive.set(true);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  openEditModal(customer: MasterRecord): void {
    this.modalMode.set('edit');
    this.selectedCustomer.set(customer);
    this.formName.set(customer.name);
    const data = (customer.data || {}) as CustomerData;
    this.formPhone.set(data.phone || '');
    this.formAddress.set(data.address || '');
    this.formIsActive.set(customer.is_active);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    if (this.isSubmitting()) return;
    this.isModalOpen.set(false);
  }

  async saveCustomer(): Promise<void> {
    this.formError.set(null);
    const name = this.formName().trim();
    const phone = this.formPhone().trim();
    const address = this.formAddress().trim();

    if (!name) {
      this.formError.set('Nama pelanggan wajib diisi.');
      return;
    }

    this.isSubmitting.set(true);

    try {
      if (this.modalMode() === 'create') {
        const created = await this.masterDataService.createCustomer({ name, phone, address });
        toast.success(`Pelanggan "${created.name}" berhasil ditambahkan.`);
      } else {
        const current = this.selectedCustomer();
        if (!current) return;
        const updated = await this.masterDataService.updateCustomer(current.id, {
          name,
          phone,
          address,
          isActive: this.formIsActive(),
        });
        toast.success(`Pelanggan "${updated.name}" berhasil diperbarui.`);
      }

      this.isModalOpen.set(false);
      await this.loadCustomers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan pelanggan.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async toggleStatus(customer: MasterRecord): Promise<void> {
    const nextStatus = !customer.is_active;
    const data = (customer.data || {}) as CustomerData;
    try {
      await this.masterDataService.updateCustomer(customer.id, {
        name: customer.name,
        phone: data.phone || '',
        address: data.address || '',
        isActive: nextStatus,
      });
      toast.success(`Status "${customer.name}" diubah menjadi ${nextStatus ? 'Aktif' : 'Nonaktif'}.`);
      await this.loadCustomers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengubah status pelanggan.';
      toast.error(msg);
    }
  }
}
