import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorBuilding,
  phosphorCheckCircle,
  phosphorLock,
  phosphorLockOpen,
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
import { Company, SettingsService } from '../../../core/services/settings.service';
import { CompanyService } from '../../../core/services/company.service';

@Component({
  selector: 'app-companies',
  imports: [
    FormsModule,
    DatePipe,
    NgIcon,
    HlmButton,
    HlmCardImports,
  ],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorBuilding,
      phosphorCheckCircle,
      phosphorLock,
      phosphorLockOpen,
      phosphorMagnifyingGlass,
      phosphorPencilSimple,
      phosphorPlus,
      phosphorToggleLeft,
      phosphorToggleRight,
      phosphorX,
    }),
  ],
  templateUrl: './companies.component.html',
})
export class CompaniesComponent implements OnInit {
  private readonly settingsService = inject(SettingsService);
  private readonly companyService = inject(CompanyService);

  readonly companies = signal<Company[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');

  // Modal Form State
  readonly isModalOpen = signal<boolean>(false);
  readonly modalMode = signal<'create' | 'edit'>('create');
  readonly selectedCompany = signal<Company | null>(null);
  readonly formCode = signal<string>('');
  readonly formName = signal<string>('');
  readonly formIsActive = signal<boolean>(true);
  readonly formError = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  readonly activeCompanyId = computed(() => this.companyService.activeCompanyId());

  readonly filteredCompanies = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();
    let list = this.companies();

    if (status === 'active') {
      list = list.filter((c) => c.is_active);
    } else if (status === 'inactive') {
      list = list.filter((c) => !c.is_active);
    }

    if (q) {
      list = list.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q),
      );
    }

    return list;
  });

  ngOnInit(): void {
    this.loadCompanies();
  }

  async loadCompanies(): Promise<void> {
    this.isLoading.set(true);
    try {
      const data = await this.settingsService.getCompanies();
      this.companies.set(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data perusahaan.';
      toast.error(msg);
    } finally {
      this.isLoading.set(false);
    }
  }

  setStatusFilter(status: 'all' | 'active' | 'inactive'): void {
    this.statusFilter.set(status);
  }

  openCreateModal(): void {
    this.modalMode.set('create');
    this.selectedCompany.set(null);
    this.formCode.set('');
    this.formName.set('');
    this.formIsActive.set(true);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  openEditModal(company: Company): void {
    this.modalMode.set('edit');
    this.selectedCompany.set(company);
    this.formCode.set(company.code);
    this.formName.set(company.name);
    this.formIsActive.set(company.is_active);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    if (this.isSubmitting()) return;
    this.isModalOpen.set(false);
  }

  async saveCompany(): Promise<void> {
    this.formError.set(null);
    const code = this.formCode().trim().toUpperCase();
    const name = this.formName().trim();

    if (!code) {
      this.formError.set('Kode perusahaan wajib diisi.');
      return;
    }

    if (!name) {
      this.formError.set('Nama perusahaan wajib diisi.');
      return;
    }

    this.isSubmitting.set(true);

    try {
      if (this.modalMode() === 'create') {
        const created = await this.settingsService.createCompany({ code, name });
        toast.success(`Perusahaan "${created.name}" berhasil dibuat dan diinisialisasi.`);
      } else {
        const current = this.selectedCompany();
        if (!current) return;
        const updated = await this.settingsService.updateCompany(current.id, {
          name,
          isActive: this.formIsActive(),
        });
        toast.success(`Perusahaan "${updated.name}" berhasil diperbarui.`);
      }

      this.isModalOpen.set(false);
      await this.loadCompanies();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan perusahaan.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async toggleStatus(company: Company): Promise<void> {
    const nextStatus = !company.is_active;

    if (this.activeCompanyId() === company.id && !nextStatus) {
      toast.error('Tidak dapat menonaktifkan perusahaan yang sedang aktif digunakan.');
      return;
    }

    try {
      const updated = await this.settingsService.updateCompany(company.id, {
        name: company.name,
        isActive: nextStatus,
      });
      toast.success(
        `Status perusahaan "${updated.name}" diubah menjadi ${nextStatus ? 'Aktif' : 'Nonaktif'}.`,
      );
      await this.loadCompanies();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengubah status perusahaan.';
      toast.error(msg);
    }
  }
}
