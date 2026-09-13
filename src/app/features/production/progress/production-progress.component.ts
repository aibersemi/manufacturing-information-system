import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorClock,
  phosphorFileText,
  phosphorMagnifyingGlass,
  phosphorPackage,
  phosphorScissors,
  phosphorShirtFolded,
  phosphorTag,
  phosphorTrendUp,
  phosphorWarningCircle,
  phosphorWrench,
} from '@ng-icons/phosphor-icons/regular';
import {
  EligibleBundleItem,
  ProductionService,
} from '../../../core/services/production.service';

@Component({
  selector: 'app-production-progress',
  imports: [CommonModule, FormsModule, NgIcon],
  providers: [
    provideIcons({
      phosphorTrendUp,
      phosphorArrowsClockwise,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorMagnifyingGlass,
      phosphorPackage,
      phosphorScissors,
      phosphorShirtFolded,
      phosphorTag,
      phosphorWrench,
      phosphorClock,
      phosphorFileText,
    }),
  ],
  templateUrl: './production-progress.component.html',
})
export class ProductionProgressComponent implements OnInit {
  private readonly productionService = inject(ProductionService);

  readonly progressSummary = this.productionService.progressSummary;
  readonly isLoading = this.productionService.isLoading;

  readonly bundles = signal<EligibleBundleItem[]>([]);
  readonly bundleSearch = signal<string>('');
  readonly bundleStageFilter = signal<string>('all');

  // Computed KPIs
  readonly totalTargetPcs = computed(() =>
    this.progressSummary().reduce((acc, p) => acc + p.targetPcs, 0)
  );

  readonly totalCuttingPcs = computed(() =>
    this.progressSummary().reduce((acc, p) => acc + p.actualCuttingPcs, 0)
  );

  readonly totalPrintingPcs = computed(() =>
    this.progressSummary().reduce((acc, p) => acc + p.actualPrintingPcs, 0)
  );

  readonly totalSewingPcs = computed(() =>
    this.progressSummary().reduce((acc, p) => acc + p.actualSewingPcs, 0)
  );

  readonly totalPackingPcs = computed(() =>
    this.progressSummary().reduce((acc, p) => acc + p.actualPackingPcs, 0)
  );

  readonly overallCompletion = computed(() => {
    const target = this.totalTargetPcs();
    if (target === 0) return 0;
    return Math.min(100, Math.round((this.totalPackingPcs() / target) * 100));
  });

  // Filtered Bundles
  readonly filteredBundles = computed(() => {
    const query = this.bundleSearch().toLowerCase().trim();
    const stage = this.bundleStageFilter();

    return this.bundles().filter((b) => {
      const bMatch = b.bundle_code.toLowerCase().includes(query);
      const prodMatch = (b.product_name || '').toLowerCase().includes(query);
      const ppMatch = (b.production_order_number || '').toLowerCase().includes(query);
      const lotMatch = (b.lot_code || '').toLowerCase().includes(query);
      const matchesQuery = !query || bMatch || prodMatch || ppMatch || lotMatch;

      const matchesStage = stage === 'all' || b.stage === stage;

      return matchesQuery && matchesStage;
    });
  });

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    try {
      await Promise.all([
        this.productionService.getProgressSummary(),
        this.productionService.getAllBundles().then((b) => this.bundles.set(b)),
      ]);
    } catch (err: unknown) {
      console.error('Error loading production progress:', err);
    }
  }

  getStageClass(stage: string): string {
    switch (stage) {
      case 'cutting':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300';
      case 'printing':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300';
      case 'sewing':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
      case 'packing':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
      default:
        return 'bg-muted text-muted-foreground';
    }
  }

  getConditionBadge(condition: string): { label: string; class: string } {
    switch (condition) {
      case 'available':
        return { label: 'Tersedia', class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' };
      case 'assigned':
        return { label: 'Direservasi', class: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' };
      case 'in_progress':
        return { label: 'Dikerjakan', class: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' };
      case 'repair_hold':
        return { label: 'Tertahan Perbaikan', class: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' };
      case 'completed':
        return { label: 'Selesai', class: 'bg-muted text-muted-foreground' };
      default:
        return { label: condition, class: 'bg-muted text-muted-foreground' };
    }
  }
}
