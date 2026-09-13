import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheck,
  phosphorMagnifyingGlass,
  phosphorPencilSimple,
  phosphorPlus,
  phosphorRuler,
  phosphorToggleLeft,
  phosphorToggleRight,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { CompanyService } from '../../../core/services/company.service';
import { MasterDataService, UnitDefinition } from '../../../core/services/master-data.service';

@Component({
  selector: 'app-uom',
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
      phosphorMagnifyingGlass,
      phosphorPencilSimple,
      phosphorPlus,
      phosphorRuler,
      phosphorToggleLeft,
      phosphorToggleRight,
      phosphorX,
    }),
  ],
  templateUrl: './uom.component.html',
})
export class UomComponent {
  private readonly masterDataService = inject(MasterDataService);
  private readonly companyService = inject(CompanyService);

  constructor() {
    effect(() => {
      const companyId = this.companyService.activeCompanyId();
      if (companyId) {
        this.loadUnits();
      }
    });
  }

  readonly units = signal<UnitDefinition[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');

  // Modal State
  readonly isModalOpen = signal<boolean>(false);
  readonly modalMode = signal<'create' | 'edit'>('create');
  readonly selectedUnit = signal<UnitDefinition | null>(null);
  readonly formCode = signal<string>('');
  readonly formName = signal<string>('');
  readonly formDecimalScale = signal<number>(0);
  readonly formIsActive = signal<boolean>(true);
  readonly formError = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  readonly filteredUnits = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();
    let list = this.units();

    if (status === 'active') {
      list = list.filter((u) => u.is_active);
    } else if (status === 'inactive') {
      list = list.filter((u) => !u.is_active);
    }

    if (q) {
      list = list.filter(
        (u) =>
          u.code.toLowerCase().includes(q) ||
          u.name.toLowerCase().includes(q),
      );
    }

    return list;
  });

  async loadUnits(): Promise<void> {
    this.isLoading.set(true);
    try {
      const data = await this.masterDataService.getUnits();
      this.units.set(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat satuan UOM.';
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
    this.selectedUnit.set(null);
    this.formCode.set('');
    this.formName.set('');
    this.formDecimalScale.set(0);
    this.formIsActive.set(true);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  openEditModal(unit: UnitDefinition): void {
    this.modalMode.set('edit');
    this.selectedUnit.set(unit);
    this.formCode.set(unit.code);
    this.formName.set(unit.name);
    this.formDecimalScale.set(unit.decimal_scale);
    this.formIsActive.set(unit.is_active);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    if (this.isSubmitting()) return;
    this.isModalOpen.set(false);
  }

  async saveUnit(): Promise<void> {
    this.formError.set(null);
    const code = this.formCode().trim().toUpperCase();
    const name = this.formName().trim();
    const decimalScale = Number(this.formDecimalScale());

    if (!code) {
      this.formError.set('Kode UOM wajib diisi.');
      return;
    }
    if (!name) {
      this.formError.set('Nama satuan UOM wajib diisi.');
      return;
    }

    this.isSubmitting.set(true);

    try {
      if (this.modalMode() === 'create') {
        const created = await this.masterDataService.createUnit({
          code,
          name,
          decimalScale,
        });
        toast.success(`Satuan "${created.code}" berhasil ditambahkan.`);
      } else {
        const updated = await this.masterDataService.updateUnit(code, {
          name,
          decimalScale,
          isActive: this.formIsActive(),
        });
        toast.success(`Satuan "${updated.code}" berhasil diperbarui.`);
      }

      this.isModalOpen.set(false);
      await this.loadUnits();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan satuan UOM.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async toggleStatus(unit: UnitDefinition): Promise<void> {
    const nextStatus = !unit.is_active;
    try {
      await this.masterDataService.updateUnit(unit.code, {
        name: unit.name,
        isActive: nextStatus,
      });
      toast.success(`Status satuan "${unit.code}" diubah menjadi ${nextStatus ? 'Aktif' : 'Nonaktif'}.`);
      await this.loadUnits();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengubah status satuan.';
      toast.error(msg);
    }
  }
}
