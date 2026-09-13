import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorEye,
  phosphorFileText,
  phosphorMagnifyingGlass,
  phosphorPackage,
  phosphorPlus,
  phosphorScissors,
  phosphorShirtFolded,
  phosphorTag,
  phosphorUser,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import {
  EligibleBundleItem,
  OperatorProfileItem,
  ProductionOrderDetail,
  ProductionService,
} from '../../../core/services/production.service';

type StageType = 'cutting' | 'printing' | 'sewing' | 'packing';

@Component({
  selector: 'app-spk',
  imports: [CommonModule, FormsModule, NgIcon],
  providers: [
    provideIcons({
      phosphorPlus,
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorEye,
      phosphorX,
      phosphorPackage,
      phosphorFileText,
      phosphorScissors,
      phosphorShirtFolded,
      phosphorTag,
      phosphorUser,
    }),
  ],
  templateUrl: './spk.component.html',
})
export class SpkComponent implements OnInit {
  private readonly productionService = inject(ProductionService);

  readonly spkList = this.productionService.spkList;
  readonly isLoading = this.productionService.isLoading;

  // Active Stage Tab
  readonly activeStage = signal<StageType>('cutting');

  // Search & Filter
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<'all' | 'assigned' | 'in_progress' | 'completed'>('all');

  // Modal State
  readonly isCreateModalOpen = signal<boolean>(false);
  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Form Fields
  readonly selectedPpId = signal<string>('');
  readonly selectedOperatorId = signal<string>('');
  readonly targetPcs = signal<number | null>(null);
  readonly notes = signal<string>('');
  readonly selectedBundleIds = signal<string[]>([]);

  // Dependency Data
  readonly productionOrders = signal<ProductionOrderDetail[]>([]);
  readonly operators = signal<OperatorProfileItem[]>([]);
  readonly eligibleBundles = signal<EligibleBundleItem[]>([]);

  // Filtered SPK List by active stage & search
  readonly filteredSpk = computed(() => {
    const stage = this.activeStage();
    const query = this.searchQuery().toLowerCase().trim();
    const status = this.statusFilter();

    return this.spkList().filter((spk) => {
      const matchesStage = spk.stage === stage;
      const numMatch = spk.document_number?.toLowerCase().includes(query) ?? false;
      const opMatch = spk.operator_name?.toLowerCase().includes(query) ?? false;
      const ppMatch = spk.production_order_number?.toLowerCase().includes(query) ?? false;
      const matchesSearch = !query || numMatch || opMatch || ppMatch;

      const matchesStatus = status === 'all' || spk.business_status === status;

      return matchesStage && matchesSearch && matchesStatus;
    });
  });

  // Selected Bundles Total Pcs
  readonly selectedBundlesTotalPcs = computed(() => {
    const ids = new Set(this.selectedBundleIds());
    return this.eligibleBundles()
      .filter((b) => ids.has(b.id))
      .reduce((sum, b) => sum + b.active_quantity, 0);
  });

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    try {
      this.errorMessage.set(null);
      await Promise.all([
        this.productionService.getSpkList(this.activeStage()),
        this.productionService.getProductionOrders().then((orders) => this.productionOrders.set(orders)),
      ]);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat data SPK.');
    }
  }

  async setStage(stage: StageType): Promise<void> {
    this.activeStage.set(stage);
    await this.productionService.getSpkList(stage);
  }

  async openCreateModal(): Promise<void> {
    this.errorMessage.set(null);
    this.selectedPpId.set('');
    this.selectedOperatorId.set('');
    this.targetPcs.set(null);
    this.notes.set('');
    this.selectedBundleIds.set([]);

    try {
      const [ops, bundles] = await Promise.all([
        this.productionService.getOperatorProfiles(this.activeStage()),
        this.activeStage() !== 'cutting'
          ? this.productionService.getEligibleBundles(this.activeStage() as 'printing' | 'sewing' | 'packing')
          : Promise.resolve([]),
      ]);
      this.operators.set(ops);
      this.eligibleBundles.set(bundles);

      if (ops.length > 0) {
        this.selectedOperatorId.set(ops[0].id);
      }
      if (this.productionOrders().length > 0) {
        this.selectedPpId.set(this.productionOrders()[0].id);
      }

      this.isCreateModalOpen.set(true);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal menyiapkan data formulir SPK.');
    }
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  toggleBundleSelection(bundleId: string): void {
    this.selectedBundleIds.update((current) => {
      if (current.includes(bundleId)) {
        return current.filter((id) => id !== bundleId);
      }
      return [...current, bundleId];
    });
  }

  selectAllBundles(): void {
    const all = this.eligibleBundles().map((b) => b.id);
    this.selectedBundleIds.set(all);
  }

  deselectAllBundles(): void {
    this.selectedBundleIds.set([]);
  }

  async submitCreateSpk(): Promise<void> {
    const ppId = this.selectedPpId();
    const opId = this.selectedOperatorId();
    const stage = this.activeStage();

    if (!ppId) {
      this.errorMessage.set('Pilih Perintah Produksi acuan.');
      return;
    }
    if (!opId) {
      this.errorMessage.set('Pilih Operator yang ditugaskan.');
      return;
    }

    if (stage !== 'cutting' && this.selectedBundleIds().length === 0) {
      this.errorMessage.set(`SPK tahapan ${stage} wajib memilih minimal 1 ikatan komponen.`);
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      const res = await this.productionService.createSpk({
        productionOrderId: ppId,
        stage,
        operatorId: opId,
        targetPcs: this.targetPcs() ?? undefined,
        notes: this.notes(),
        bundleIds: stage !== 'cutting' ? this.selectedBundleIds() : undefined,
      });

      this.successMessage.set(`SPK ${res.documentNumber} (${stage}) berhasil diterbitkan!`);
      this.closeCreateModal();
      await this.productionService.getSpkList(stage);
      setTimeout(() => this.successMessage.set(null), 4000);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal membuat SPK.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  getStageLabel(stage: string): string {
    switch (stage) {
      case 'cutting':
        return 'Potong';
      case 'printing':
        return 'Sablon';
      case 'sewing':
        return 'Jahit';
      case 'packing':
        return 'Packing';
      default:
        return stage;
    }
  }
}
