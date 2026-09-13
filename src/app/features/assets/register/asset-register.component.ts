import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArmchair,
  phosphorArrowsClockwise,
  phosphorCalendarBlank,
  phosphorCheckCircle,
  phosphorClock,
  phosphorCube,
  phosphorEye,
  phosphorFileText,
  phosphorFunnel,
  phosphorGear,
  phosphorLock,
  phosphorLockOpen,
  phosphorMagnifyingGlass,
  phosphorMapPin,
  phosphorMoney,
  phosphorTag,
  phosphorUser,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { toast } from '@spartan-ng/brain/sonner';
import {
  AssetRecordItem,
  AssetService,
  UpdateAssetParametersPayload,
} from '../../../core/services/asset.service';

@Component({
  selector: 'app-asset-register',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorArmchair,
      phosphorCube,
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorFunnel,
      phosphorGear,
      phosphorMoney,
      phosphorTag,
      phosphorMapPin,
      phosphorUser,
      phosphorCalendarBlank,
      phosphorLock,
      phosphorLockOpen,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorEye,
      phosphorFileText,
      phosphorClock,
      phosphorX,
    }),
  ],
  templateUrl: './asset-register.component.html',
})
export class AssetRegisterComponent implements OnInit {
  readonly assetService = inject(AssetService);

  readonly searchQuery = signal('');
  readonly categoryFilter = signal<string>('all');
  readonly setupFilter = signal<'all' | 'ready' | 'needs_setup'>('all');
  readonly statusFilter = signal<'all' | 'active' | 'disposed' | 'cancelled'>('active');

  // Modal / Sheet State
  readonly isSettingsModalOpen = signal(false);
  readonly selectedAsset = signal<AssetRecordItem | null>(null);

  // Form Fields for Settings Modal
  readonly formCategoryId = signal<string>('');
  readonly formDepreciationMethod = signal<'straight_line' | 'declining_balance'>('straight_line');
  readonly formUsefulLifeMonths = signal<number>(48);
  readonly formResidualValue = signal<number>(0);
  readonly formDepreciationStartDate = signal<string>('');
  readonly formLocation = signal<string>('');
  readonly formCustodian = signal<string>('');
  readonly formSerialNumber = signal<string>('');

  // Computed data
  readonly assets = computed(() => this.assetService.assets());
  readonly categories = computed(() => this.assetService.categories());
  readonly loading = computed(() => this.assetService.loading());

  // KPIs
  readonly activeAssets = computed(() =>
    this.assets().filter((a) => a.status === 'active')
  );

  readonly totalActiveUnits = computed(() => this.activeAssets().length);

  readonly totalAcquisitionCost = computed(() =>
    this.activeAssets().reduce((sum, a) => sum + a.acquisitionCost, 0)
  );

  readonly totalAccumulatedDepreciation = computed(() =>
    this.activeAssets().reduce((sum, a) => sum + a.accumulatedDepreciation, 0)
  );

  readonly totalNetBookValue = computed(() =>
    this.activeAssets().reduce((sum, a) => sum + a.bookValue, 0)
  );

  // Filtered List
  readonly filteredAssets = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const cat = this.categoryFilter();
    const st = this.statusFilter();
    const setup = this.setupFilter();

    return this.assets().filter((a) => {
      const matchStatus = st === 'all' || a.status === st;
      const matchCategory = cat === 'all' || a.categoryId === cat;
      const matchSetup =
        setup === 'all' ||
        (setup === 'ready' && a.isSetupComplete) ||
        (setup === 'needs_setup' && !a.isSetupComplete);

      const matchQuery =
        !q ||
        a.assetCode.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.location && a.location.toLowerCase().includes(q)) ||
        (a.custodian && a.custodian.toLowerCase().includes(q)) ||
        (a.serialNumber && a.serialNumber.toLowerCase().includes(q));

      return matchStatus && matchCategory && matchSetup && matchQuery;
    });
  });

  ngOnInit(): void {
    this.loadData();
  }

  async loadData(): Promise<void> {
    try {
      await Promise.all([
        this.assetService.loadAssets(),
        this.assetService.loadCategories(),
      ]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat register aset.');
    }
  }

  openSettingsModal(asset: AssetRecordItem): void {
    this.selectedAsset.set(asset);
    this.formCategoryId.set(asset.categoryId || '');
    this.formDepreciationMethod.set(asset.depreciationMethod || 'straight_line');
    this.formUsefulLifeMonths.set(asset.usefulLifeMonths || 48);
    this.formResidualValue.set(asset.residualValue || 0);
    this.formDepreciationStartDate.set(
      asset.depreciationStartDate ||
        asset.capitalizationDate ||
        new Date().toISOString().slice(0, 10)
    );
    this.formLocation.set(asset.location || '');
    this.formCustodian.set(asset.custodian || '');
    this.formSerialNumber.set(asset.serialNumber || '');
    this.isSettingsModalOpen.set(true);
  }

  closeSettingsModal(): void {
    this.isSettingsModalOpen.set(false);
  }

  async saveSettings(): Promise<void> {
    const asset = this.selectedAsset();
    if (!asset) return;

    if (!asset.isLocked) {
      if (this.formUsefulLifeMonths() <= 0) {
        toast.error('Masa manfaat harus lebih dari 0 bulan.');
        return;
      }
      if (this.formResidualValue() < 0) {
        toast.error('Nilai residu tidak boleh bernilai negatif.');
        return;
      }
      if (this.formResidualValue() >= asset.acquisitionCost) {
        toast.error('Nilai residu harus lebih kecil dari biaya perolehan.');
        return;
      }
      if (!this.formDepreciationStartDate()) {
        toast.error('Tanggal mulai penyusutan wajib diisi.');
        return;
      }
    }

    const payload: UpdateAssetParametersPayload = {
      categoryId: this.formCategoryId() || null,
      depreciationMethod: this.formDepreciationMethod(),
      usefulLifeMonths: this.formUsefulLifeMonths(),
      residualValue: this.formResidualValue(),
      depreciationStartDate: this.formDepreciationStartDate(),
      location: this.formLocation().trim() || null,
      custodian: this.formCustodian().trim() || null,
      serialNumber: this.formSerialNumber().trim() || null,
    };

    try {
      await this.assetService.updateAssetParameters(asset.id, payload);
      toast.success(`Pengaturan aset ${asset.assetCode} berhasil diperbarui.`);
      this.closeSettingsModal();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui pengaturan aset.');
    }
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
