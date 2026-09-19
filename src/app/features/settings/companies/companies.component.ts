import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorArrowsLeftRight,
  phosphorBuilding,
  phosphorBuildings,
  phosphorCheck,
  phosphorCheckCircle,
  phosphorEnvelopeSimple,
  phosphorFactory,
  phosphorInfo,
  phosphorLock,
  phosphorLockOpen,
  phosphorMagnifyingGlass,
  phosphorMapPin,
  phosphorPencilSimple,
  phosphorPhone,
  phosphorPlus,
  phosphorProhibit,
  phosphorToggleLeft,
  phosphorToggleRight,
  phosphorUsers,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { CompanyService } from '../../../core/services/company.service';
import {
  CompanyWithStats,
  CreateCompanyPayload,
  SettingsService,
  UpdateCompanyPayload,
} from '../../../core/services/settings.service';

@Component({
  selector: 'app-companies',
  imports: [
    FormsModule,
    DatePipe,
    NgIcon,
    HlmButton,
    HlmCardImports,
    HlmBadgeImports,
  ],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorArrowsLeftRight,
      phosphorBuilding,
      phosphorBuildings,
      phosphorCheck,
      phosphorCheckCircle,
      phosphorEnvelopeSimple,
      phosphorFactory,
      phosphorInfo,
      phosphorLock,
      phosphorLockOpen,
      phosphorMagnifyingGlass,
      phosphorMapPin,
      phosphorPencilSimple,
      phosphorPhone,
      phosphorPlus,
      phosphorProhibit,
      phosphorToggleLeft,
      phosphorToggleRight,
      phosphorUsers,
      phosphorX,
    }),
  ],
  templateUrl: './companies.component.html',
})
export class CompaniesComponent implements OnInit {
  private readonly settingsService = inject(SettingsService);
  private readonly companyService = inject(CompanyService);

  readonly companies = signal<CompanyWithStats[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');

  // KPI Signals
  readonly totalCompanies = computed(() => this.companies().length);
  readonly activeCompaniesCount = computed(
    () => this.companies().filter((c) => c.is_active).length,
  );
  readonly inactiveCompaniesCount = computed(
    () => this.companies().filter((c) => !c.is_active).length,
  );
  readonly activeCompanyId = computed(() => this.companyService.activeCompanyId());
  readonly currentActiveCompany = computed(() => this.companyService.activeCompany());

  // Modal Form State
  readonly isModalOpen = signal<boolean>(false);
  readonly modalMode = signal<'create' | 'edit'>('create');
  readonly selectedCompany = signal<CompanyWithStats | null>(null);
  readonly formCode = signal<string>('');
  readonly formName = signal<string>('');
  readonly formAddress = signal<string>('');
  readonly formPhone = signal<string>('');
  readonly formEmail = signal<string>('');
  readonly formIsActive = signal<boolean>(true);
  readonly formError = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  // Detail Drawer / Modal State
  readonly isDetailModalOpen = signal<boolean>(false);
  readonly detailCompany = signal<CompanyWithStats | null>(null);

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
          c.name.toLowerCase().includes(q) ||
          (c.address && c.address.toLowerCase().includes(q)) ||
          (c.phone && c.phone.toLowerCase().includes(q)) ||
          (c.email && c.email.toLowerCase().includes(q)),
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
    this.formAddress.set('');
    this.formPhone.set('');
    this.formEmail.set('');
    this.formIsActive.set(true);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  openEditModal(company: CompanyWithStats): void {
    this.modalMode.set('edit');
    this.selectedCompany.set(company);
    this.formCode.set(company.code);
    this.formName.set(company.name);
    this.formAddress.set(company.address || '');
    this.formPhone.set(company.phone || '');
    this.formEmail.set(company.email || '');
    this.formIsActive.set(company.is_active);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    if (this.isSubmitting()) return;
    this.isModalOpen.set(false);
  }

  openDetailModal(company: CompanyWithStats): void {
    this.detailCompany.set(company);
    this.isDetailModalOpen.set(true);
  }

  closeDetailModal(): void {
    this.isDetailModalOpen.set(false);
    this.detailCompany.set(null);
  }

  async saveCompany(): Promise<void> {
    this.formError.set(null);
    const code = this.formCode().trim().toUpperCase();
    const name = this.formName().trim();
    const address = this.formAddress().trim();
    const phone = this.formPhone().trim();
    const email = this.formEmail().trim();

    if (!code) {
      this.formError.set('Kode perusahaan wajib diisi.');
      return;
    }

    if (!/^[A-Z0-9_-]+$/.test(code)) {
      this.formError.set('Kode perusahaan hanya boleh berupa huruf kapital, angka, garis bawah, atau tanda hubung tanpa spasi.');
      return;
    }

    if (code.length < 2 || code.length > 20) {
      this.formError.set('Kode perusahaan harus terdiri dari 2 hingga 20 karakter.');
      return;
    }

    if (!name) {
      this.formError.set('Nama perusahaan wajib diisi.');
      return;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.formError.set('Format alamat email perusahaan tidak valid.');
      return;
    }

    this.isSubmitting.set(true);

    try {
      if (this.modalMode() === 'create') {
        const payload: CreateCompanyPayload = {
          code,
          name,
          address: address || undefined,
          phone: phone || undefined,
          email: email || undefined,
        };

        const created = await this.settingsService.createCompany(payload);
        toast.success(`Perusahaan "${created.name}" (${created.code}) berhasil dibuat dan diinisialisasi.`);
      } else {
        const current = this.selectedCompany();
        if (!current) return;

        const payload: UpdateCompanyPayload = {
          name,
          code: current.code_locked ? undefined : code,
          address: address || undefined,
          phone: phone || undefined,
          email: email || undefined,
          isActive: this.formIsActive(),
          version: current.version,
        };

        const updated = await this.settingsService.updateCompany(current.id, payload);
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

  async toggleStatus(company: CompanyWithStats): Promise<void> {
    const nextStatus = !company.is_active;

    if (this.activeCompanyId() === company.id && !nextStatus) {
      toast.error('Tidak dapat menonaktifkan perusahaan yang sedang aktif digunakan.');
      return;
    }

    try {
      const updated = await this.settingsService.updateCompany(company.id, {
        name: company.name,
        isActive: nextStatus,
        version: company.version,
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

  quickSwitchCompany(company: CompanyWithStats): void {
    if (!company.is_active) {
      toast.error('Perusahaan nonaktif tidak dapat dipilih sebagai entitas kerja aktif.');
      return;
    }

    if (this.activeCompanyId() === company.id) {
      toast.info(`Perusahaan "${company.name}" sudah merupakan entitas aktif saat ini.`);
      return;
    }

    const switched = this.companyService.switchActiveCompany(company.id);
    if (switched) {
      toast.success(`Berhasil beralih ke entitas "${company.name}".`);
    } else {
      toast.error('Gagal beralih ke perusahaan yang dipilih.');
    }
  }
}
