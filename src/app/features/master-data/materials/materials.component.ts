import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorCircleNotch,
  phosphorCube,
  phosphorMagnifyingGlass,
  phosphorPencilSimple,
  phosphorPlus,
  phosphorToggleLeft,
  phosphorToggleRight,
  phosphorX,
  phosphorXCircle,
} from '@ng-icons/phosphor-icons/regular';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { CompanyService } from '../../../core/services/company.service';
import {
  MasterDataService,
  MasterRecord,
  MaterialData,
  UnitDefinition,
} from '../../../core/services/master-data.service';

@Component({
  selector: 'app-materials',
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    NgIcon,
    HlmButton,
    HlmCardImports,
  ],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorCheckCircle,
      phosphorCircleNotch,
      phosphorCube,
      phosphorMagnifyingGlass,
      phosphorPencilSimple,
      phosphorPlus,
      phosphorToggleLeft,
      phosphorToggleRight,
      phosphorX,
      phosphorXCircle,
    }),
  ],
  templateUrl: './materials.component.html',
})
export class MaterialsComponent {
  private readonly masterDataService = inject(MasterDataService);
  private readonly companyService = inject(CompanyService);

  constructor() {
    effect(() => {
      const companyId = this.companyService.activeCompanyId();
      if (companyId) {
        this.loadData();
      }
    });
  }

  readonly materials = signal<MasterRecord[]>([]);
  readonly units = signal<UnitDefinition[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');

  // Modal State
  readonly isModalOpen = signal<boolean>(false);
  readonly modalMode = signal<'create' | 'edit'>('create');
  readonly selectedMaterial = signal<MasterRecord | null>(null);

  // Form Signals
  readonly formName = signal<string>('');
  readonly formPackagingUnit = signal<string>('ROLL');
  readonly formPackagingQuantity = signal<number>(1);
  readonly formBaseUnit = signal<string>('KG');
  readonly formConversionFactor = signal<number>(1);
  readonly formReferencePackagePrice = signal<number>(0);
  readonly formNotes = signal<string>('');
  readonly formIsActive = signal<boolean>(true);
  readonly formError = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  // Computed unit price helper
  readonly calculatedUnitPrice = computed(() => {
    const pkgQty = this.formPackagingQuantity();
    const conv = this.formConversionFactor();
    const pkgPrice = this.formReferencePackagePrice();
    const totalBaseUnits = pkgQty * conv;
    if (totalBaseUnits <= 0) return 0;
    return Math.round(pkgPrice / totalBaseUnits);
  });

  readonly filteredMaterials = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();
    let list = this.materials();

    if (status === 'active') {
      list = list.filter((m) => m.is_active);
    } else if (status === 'inactive') {
      list = list.filter((m) => !m.is_active);
    }

    if (q) {
      list = list.filter((m) => {
        const data = this.getMaterialData(m);
        return (
          m.name.toLowerCase().includes(q) ||
          data.packagingUnit.toLowerCase().includes(q) ||
          data.baseUnit.toLowerCase().includes(q) ||
          (data.notes && data.notes.toLowerCase().includes(q))
        );
      });
    }

    return list;
  });

  async loadData(): Promise<void> {
    this.isLoading.set(true);
    try {
      const [materialsList, unitsList] = await Promise.all([
        this.masterDataService.getMaterials(),
        this.masterDataService.getUnits(),
      ]);
      this.materials.set(materialsList);
      this.units.set(unitsList);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data bahan baku.';
      toast.error(msg);
    } finally {
      this.isLoading.set(false);
    }
  }

  setStatusFilter(status: 'all' | 'active' | 'inactive'): void {
    this.statusFilter.set(status);
  }

  getMaterialData(material: MasterRecord): MaterialData {
    return (material.data || {
      packagingUnit: '-',
      packagingQuantity: 1,
      baseUnit: '-',
      conversionFactor: 1,
      referencePackagePrice: 0,
      notes: '',
    }) as MaterialData;
  }

  getBaseUnitPrice(data: MaterialData): number {
    const totalBase = (data.packagingQuantity || 1) * (data.conversionFactor || 1);
    if (totalBase <= 0) return 0;
    return Math.round((data.referencePackagePrice || 0) / totalBase);
  }

  openCreateModal(): void {
    this.modalMode.set('create');
    this.selectedMaterial.set(null);
    this.formName.set('');

    const defaultUnit = this.units().find((u) => u.code === 'ROLL')?.code || this.units()[0]?.code || 'ROLL';
    const defaultBase = this.units().find((u) => u.code === 'KG')?.code || this.units()[0]?.code || 'KG';

    this.formPackagingUnit.set(defaultUnit);
    this.formPackagingQuantity.set(1);
    this.formBaseUnit.set(defaultBase);
    this.formConversionFactor.set(1);
    this.formReferencePackagePrice.set(0);
    this.formNotes.set('');
    this.formIsActive.set(true);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  openEditModal(material: MasterRecord): void {
    this.modalMode.set('edit');
    this.selectedMaterial.set(material);
    this.formName.set(material.name);

    const data = this.getMaterialData(material);
    this.formPackagingUnit.set(data.packagingUnit || 'ROLL');
    this.formPackagingQuantity.set(data.packagingQuantity || 1);
    this.formBaseUnit.set(data.baseUnit || 'KG');
    this.formConversionFactor.set(data.conversionFactor || 1);
    this.formReferencePackagePrice.set(data.referencePackagePrice || 0);
    this.formNotes.set(data.notes || '');
    this.formIsActive.set(material.is_active);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    if (this.isSubmitting()) return;
    this.isModalOpen.set(false);
  }

  async saveMaterial(): Promise<void> {
    this.formError.set(null);
    const name = this.formName().trim();
    if (!name) {
      this.formError.set('Nama bahan baku wajib diisi.');
      return;
    }
    if (this.formPackagingQuantity() <= 0) {
      this.formError.set('Kuantitas kemasan harus lebih dari 0.');
      return;
    }
    if (this.formConversionFactor() <= 0) {
      this.formError.set('Faktor konversi harus lebih dari 0.');
      return;
    }
    if (this.formReferencePackagePrice() < 0) {
      this.formError.set('Harga kemasan tidak boleh negatif.');
      return;
    }

    this.isSubmitting.set(true);

    const payload = {
      name,
      packagingUnit: this.formPackagingUnit(),
      packagingQuantity: this.formPackagingQuantity(),
      baseUnit: this.formBaseUnit(),
      conversionFactor: this.formConversionFactor(),
      referencePackagePrice: this.formReferencePackagePrice(),
      notes: this.formNotes(),
    };

    try {
      if (this.modalMode() === 'create') {
        const created = await this.masterDataService.createMaterial(payload);
        toast.success(`Bahan baku "${created.name}" berhasil ditambahkan.`);
      } else {
        const current = this.selectedMaterial();
        if (!current) return;
        const updated = await this.masterDataService.updateMaterial(current.id, {
          ...payload,
          isActive: this.formIsActive(),
        });
        toast.success(`Bahan baku "${updated.name}" berhasil diperbarui.`);
      }

      this.isModalOpen.set(false);
      await this.loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan bahan baku.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async toggleStatus(material: MasterRecord): Promise<void> {
    const nextStatus = !material.is_active;
    const data = this.getMaterialData(material);
    try {
      await this.masterDataService.updateMaterial(material.id, {
        name: material.name,
        packagingUnit: data.packagingUnit,
        packagingQuantity: data.packagingQuantity,
        baseUnit: data.baseUnit,
        conversionFactor: data.conversionFactor,
        referencePackagePrice: data.referencePackagePrice,
        notes: data.notes,
        isActive: nextStatus,
      });
      toast.success(`Status "${material.name}" diubah menjadi ${nextStatus ? 'Aktif' : 'Nonaktif'}.`);
      await this.loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengubah status bahan baku.';
      toast.error(msg);
    }
  }
}
