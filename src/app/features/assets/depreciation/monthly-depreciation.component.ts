import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArchive,
  phosphorArrowsClockwise,
  phosphorCalendarBlank,
  phosphorChartPieSlice,
  phosphorCheckCircle,
  phosphorClock,
  phosphorCube,
  phosphorFileText,
  phosphorGear,
  phosphorListChecks,
  phosphorMoney,
  phosphorWarningCircle,
  phosphorX,
  phosphorXCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { toast } from '@spartan-ng/brain/sonner';
import { AssetService } from '../../../core/services/asset.service';

@Component({
  selector: 'app-monthly-depreciation',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorChartPieSlice,
      phosphorCube,
      phosphorArrowsClockwise,
      phosphorCalendarBlank,
      phosphorMoney,
      phosphorClock,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorXCircle,
      phosphorFileText,
      phosphorListChecks,
      phosphorArchive,
      phosphorGear,
      phosphorX,
    }),
  ],
  templateUrl: './monthly-depreciation.component.html',
})
export class MonthlyDepreciationComponent implements OnInit {
  readonly assetService = inject(AssetService);

  // Period Selector (YYYY-MM)
  readonly selectedPeriod = signal<string>(new Date().toISOString().slice(0, 7));
  readonly activeTab = signal<'eligible' | 'ineligible' | 'history'>('eligible');

  // Selection for Posting
  readonly selectedAssetIds = signal<Set<string>>(new Set());

  // Post Dialog State
  readonly isPostDialogOpen = signal(false);
  readonly postNotes = signal<string>('');

  // Data from Service
  readonly preview = computed(() => this.assetService.depreciationPreview());
  readonly history = computed(() => this.assetService.depreciationHistory());
  readonly loading = computed(() => this.assetService.loading());

  // Computed KPIs
  readonly eligibleAssets = computed(() => this.preview()?.eligibleAssets || []);
  readonly ineligibleAssets = computed(() => this.preview()?.ineligibleAssets || []);

  readonly totalEligibleCount = computed(() => this.eligibleAssets().length);
  readonly totalEligibleAmount = computed(() => this.preview()?.totalEligibleAmount || 0);
  readonly totalIneligibleCount = computed(() => this.ineligibleAssets().length);

  // Selected for posting summary
  readonly selectedAssetsList = computed(() => {
    const set = this.selectedAssetIds();
    return this.eligibleAssets().filter((a) => set.has(a.assetId));
  });

  readonly selectedTotalAmount = computed(() =>
    this.selectedAssetsList().reduce((sum, a) => sum + a.depreciationAmount, 0)
  );

  readonly isAllSelected = computed(() => {
    const list = this.eligibleAssets();
    if (list.length === 0) return false;
    return list.every((a) => this.selectedAssetIds().has(a.assetId));
  });

  ngOnInit(): void {
    this.loadData();
  }

  async loadData(): Promise<void> {
    try {
      await Promise.all([
        this.loadPreview(),
        this.assetService.loadDepreciationHistory(),
      ]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data penyusutan.');
    }
  }

  async loadPreview(): Promise<void> {
    const p = this.selectedPeriod();
    if (!p) return;

    try {
      const summary = await this.assetService.loadDepreciationPreview(p);
      // Automatically select all eligible assets initially
      const allIds = new Set(summary.eligibleAssets.map((a) => a.assetId));
      this.selectedAssetIds.set(allIds);
      this.postNotes.set(`Penyusutan Periode ${p}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat pratinjau penyusutan.');
    }
  }

  onPeriodChange(newPeriod: string): void {
    this.selectedPeriod.set(newPeriod);
    this.loadPreview();
  }

  toggleSelectAll(): void {
    if (this.isAllSelected()) {
      this.selectedAssetIds.set(new Set());
    } else {
      const allIds = new Set(this.eligibleAssets().map((a) => a.assetId));
      this.selectedAssetIds.set(allIds);
    }
  }

  toggleAssetSelection(assetId: string): void {
    this.selectedAssetIds.update((set) => {
      const next = new Set(set);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }

  openPostDialog(): void {
    if (this.selectedAssetIds().size === 0) {
      toast.error('Pilih minimal satu aset yang akan disusutkan.');
      return;
    }
    this.isPostDialogOpen.set(true);
  }

  closePostDialog(): void {
    this.isPostDialogOpen.set(false);
  }

  async confirmPostDepreciation(): Promise<void> {
    const assetIds = Array.from(this.selectedAssetIds());
    if (assetIds.length === 0) {
      toast.error('Pilih minimal satu aset.');
      return;
    }

    try {
      const res = await this.assetService.postMonthlyDepreciation(
        this.selectedPeriod(),
        assetIds,
        this.postNotes().trim() || undefined
      );

      toast.success(
        `Bukti penyusutan ${res.documentNumber} berhasil diposting untuk ${res.assetCount} unit aset (${this.formatRupiah(res.totalAmount)}).`
      );
      this.closePostDialog();
      await this.loadData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal memposting penyusutan bulanan.');
    }
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
