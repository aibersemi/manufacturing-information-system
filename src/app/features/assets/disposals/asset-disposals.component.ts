import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCalendarBlank,
  phosphorCheckCircle,
  phosphorCube,
  phosphorEye,
  phosphorFileText,
  phosphorFunnel,
  phosphorMagnifyingGlass,
  phosphorMoney,
  phosphorPlus,
  phosphorTrash,
  phosphorTrendDown,
  phosphorTrendUp,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { toast } from '@spartan-ng/brain/sonner';
import {
  AssetDisposalDocument,
  AssetService,
  PostAssetDisposalPayload,
} from '../../../core/services/asset.service';
import { FinanceService } from '../../../core/services/finance.service';

@Component({
  selector: 'app-asset-disposals',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorTrash,
      phosphorCube,
      phosphorPlus,
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorFunnel,
      phosphorMoney,
      phosphorTrendUp,
      phosphorTrendDown,
      phosphorCalendarBlank,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorEye,
      phosphorFileText,
      phosphorX,
    }),
  ],
  templateUrl: './asset-disposals.component.html',
})
export class AssetDisposalsComponent implements OnInit {
  readonly Math = Math;
  readonly assetService = inject(AssetService);
  readonly financeService = inject(FinanceService);

  readonly searchQuery = signal('');

  // Modals & Dialogs
  readonly isCreateModalOpen = signal(false);
  readonly isConfirmDialogOpen = signal(false);
  readonly isDetailModalOpen = signal(false);
  readonly selectedDisposal = signal<AssetDisposalDocument | null>(null);

  // Form State
  readonly formAssetId = signal<string>('');
  readonly formDisposalDate = signal<string>(new Date().toISOString().slice(0, 10));
  readonly formProceeds = signal<number>(0);
  readonly formCashAccountId = signal<string>('');
  readonly formReason = signal<string>('');

  // Service Signals
  readonly disposals = computed(() => this.assetService.assetDisposals());
  readonly allAssets = computed(() => this.assetService.assets());
  readonly cashAccounts = computed(() => this.financeService.cashAccounts());
  readonly loading = computed(() => this.assetService.loading());

  // Active Assets available for disposal
  readonly availableAssets = computed(() =>
    this.allAssets().filter((a) => a.status === 'active')
  );

  // Currently selected asset in disposal form
  readonly formSelectedAsset = computed(() => {
    const id = this.formAssetId();
    if (!id) return null;
    return this.availableAssets().find((a) => a.id === id) || null;
  });

  // Real-time Gain / Loss Calculation
  readonly calculatedBookValue = computed(() => {
    const a = this.formSelectedAsset();
    if (!a) return 0;
    return a.acquisitionCost - a.accumulatedDepreciation;
  });

  readonly calculatedDifference = computed(() => {
    const proceeds = Number(this.formProceeds()) || 0;
    const bv = this.calculatedBookValue();
    return proceeds - bv;
  });

  readonly isGain = computed(() => this.calculatedDifference() > 0);
  readonly isLoss = computed(() => this.calculatedDifference() < 0);
  readonly isBreakeven = computed(() => this.calculatedDifference() === 0);

  // KPIs
  readonly totalDisposalsCount = computed(() => this.disposals().length);

  readonly totalProceedsAmount = computed(() =>
    this.disposals().reduce((sum, d) => sum + d.proceeds, 0)
  );

  readonly totalNetGain = computed(() =>
    this.disposals().reduce((sum, d) => sum + d.gain, 0)
  );

  readonly totalNetLoss = computed(() =>
    this.disposals().reduce((sum, d) => sum + d.loss, 0)
  );

  readonly filteredDisposals = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return this.disposals();

    return this.disposals().filter(
      (d) =>
        d.documentNumber.toLowerCase().includes(q) ||
        d.assetCode.toLowerCase().includes(q) ||
        d.assetName.toLowerCase().includes(q) ||
        d.reason.toLowerCase().includes(q)
    );
  });

  ngOnInit(): void {
    this.loadData();
  }

  async loadData(): Promise<void> {
    try {
      await Promise.all([
        this.assetService.loadAssetDisposals(),
        this.assetService.loadAssets(),
        this.financeService.loadCashAccounts(),
      ]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data pelepasan aset.');
    }
  }

  openCreateModal(): void {
    this.formAssetId.set('');
    this.formDisposalDate.set(new Date().toISOString().slice(0, 10));
    this.formProceeds.set(0);
    this.formCashAccountId.set('');
    this.formReason.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  openConfirmDialog(): void {
    if (!this.formAssetId()) {
      toast.error('Pilih aset yang akan dilepas.');
      return;
    }
    if (this.formProceeds() > 0 && !this.formCashAccountId()) {
      toast.error('Pilih rekening kas/bank penampung hasil penjualan pelepasan aset.');
      return;
    }
    if (!this.formReason().trim()) {
      toast.error('Alasan pelepasan aset wajib diisi.');
      return;
    }
    this.isConfirmDialogOpen.set(true);
  }

  closeConfirmDialog(): void {
    this.isConfirmDialogOpen.set(false);
  }

  async executeDisposal(): Promise<void> {
    const payload: PostAssetDisposalPayload = {
      assetId: this.formAssetId(),
      disposalDate: this.formDisposalDate(),
      proceeds: Number(this.formProceeds()) || 0,
      cashAccountId: this.formProceeds() > 0 ? this.formCashAccountId() : undefined,
      reason: this.formReason().trim(),
    };

    try {
      const res = await this.assetService.postAssetDisposal(payload);
      toast.success(
        `Pelepasan aset ${res.documentNumber} berhasil diposting. Jurnal pengeluaran aset telah dibukukan.`
      );
      this.closeConfirmDialog();
      this.closeCreateModal();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal memproses pelepasan aset.');
    }
  }

  openDetailModal(disposal: AssetDisposalDocument): void {
    this.selectedDisposal.set(disposal);
    this.isDetailModalOpen.set(true);
  }

  closeDetailModal(): void {
    this.isDetailModalOpen.set(false);
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
