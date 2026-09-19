import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorArrowUpRight,
  phosphorBuildings,
  phosphorCheckCircle,
  phosphorClipboardText,
  phosphorClock,
  phosphorCpu,
  phosphorMagnifyingGlass,
  phosphorPackage,
  phosphorPlus,
  phosphorPulse,
  phosphorShieldCheck,
  phosphorTrendUp,
  phosphorUser,
  phosphorWarningCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { AuthService } from '../../core/services/auth.service';
import { CompanyService } from '../../core/services/company.service';
import { ProductionService } from '../../core/services/production.service';

export interface WorkOrderItem {
  id: string;
  code: string;
  line: string;
  item: string;
  targetUnits: number;
  completedUnits: number;
  status: 'processing' | 'quality_check' | 'completed' | 'queued';
  operator: string;
}

@Component({
  selector: 'app-dashboard',
  imports: [HlmCardImports, HlmBadge, HlmButton, NgIcon, FormsModule, RouterLink],
  providers: [
    provideIcons({
      phosphorTrendUp,
      phosphorCpu,
      phosphorClipboardText,
      phosphorShieldCheck,
      phosphorWarningCircle,
      phosphorCheckCircle,
      phosphorClock,
      phosphorArrowUpRight,
      phosphorPlus,
      phosphorArrowsClockwise,
      phosphorPulse,
      phosphorMagnifyingGlass,
      phosphorBuildings,
      phosphorPackage,
      phosphorUser,
    }),
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly companyService = inject(CompanyService);
  private readonly productionService = inject(ProductionService);

  readonly searchQuery = signal('');
  readonly statusFilter = signal<'all' | 'active' | 'completed'>('all');
  readonly isLoading = signal(false);

  readonly currentUser = computed(() => this.authService.currentUser());

  readonly userEmail = computed(() => {
    return this.currentUser()?.email ?? '';
  });

  readonly userRole = computed(() => {
    const user = this.currentUser();
    const appRole = user?.app_metadata?.['role'] as string | undefined;
    const userRole = user?.user_metadata?.['role'] as string | undefined;
    return appRole || userRole || 'operator';
  });

  readonly companyName = computed(() => {
    return this.companyService.activeCompany()?.name || 'Fasilitas Manufaktur';
  });

  constructor() {
    effect(() => {
      const companyId = this.companyService.activeCompanyId();
      if (companyId) {
        void this.loadDashboardData();
      }
    });
  }

  async ngOnInit(): Promise<void> {
    await this.loadDashboardData();
  }

  async loadDashboardData(): Promise<void> {
    if (this.isLoading()) return;
    this.isLoading.set(true);
    try {
      await Promise.all([
        this.productionService.getProductionOrders().catch(() => []),
        this.productionService.getProgressSummary().catch(() => []),
        this.productionService.getSpkList().catch(() => []),
        this.productionService.getRepairCases().catch(() => []),
      ]);
    } finally {
      this.isLoading.set(false);
    }
  }

  async refreshData(): Promise<void> {
    await this.loadDashboardData();
  }

  readonly recentWorkOrders = computed<WorkOrderItem[]>(() => {
    const orders = this.productionService.productionOrders();
    const summaries = this.productionService.progressSummary();
    const spks = this.productionService.spkList();

    if (!orders || orders.length === 0) {
      return [];
    }

    return orders.map((po) => {
      const summary = summaries.find((s) => s.id === po.id || s.documentNumber === po.document_number);
      const poSpks = spks.filter((s) => s.production_order_id === po.id);
      const latestSpk = poSpks[poSpks.length - 1];

      const firstLineProduct = po.lines?.[0]?.product?.name;
      const lineCount = po.lines?.length ?? 0;
      let itemName = firstLineProduct || 'Produk Manufaktur';
      if (lineCount > 1) {
        itemName += ` (+${lineCount - 1} item)`;
      }

      const lineTargetSum = (po.lines || []).reduce((acc, l) => acc + (Number(l.quantity) || 0), 0);
      const targetUnits = summary?.targetPcs ?? (lineTargetSum > 0 ? lineTargetSum : 1);
      const completedUnits = summary?.actualPackingPcs ?? (po.status === 'completed' ? targetUnits : 0);

      let line = 'Antrean Produksi';
      if (summary) {
        if (summary.actualPackingPcs > 0) line = 'Lini Finishing & Packing';
        else if (summary.actualSewingPcs > 0) line = 'Lini Jahit (Sewing)';
        else if (summary.actualPrintingPcs > 0) line = 'Lini Sablon (Printing)';
        else if (summary.actualCuttingPcs > 0) line = 'Lini Potong (Cutting)';
        else if (latestSpk) {
          line = `Stasiun ${latestSpk.stage}`;
        }
      } else if (latestSpk) {
        line = `Stasiun ${latestSpk.stage}`;
      }

      const operator = latestSpk?.operator_name || 'Tim Produksi';

      let status: WorkOrderItem['status'] = 'queued';
      if (po.status === 'completed' || (summary && summary.completionPercentage >= 100)) {
        status = 'completed';
      } else if ((summary?.activeRepairCount ?? 0) > 0) {
        status = 'quality_check';
      } else if (
        po.status === 'in_progress' ||
        po.status === 'approved' ||
        (summary && (summary.actualCuttingPcs > 0 || summary.activeBundleCount > 0))
      ) {
        status = 'processing';
      }

      return {
        id: po.id,
        code: po.document_number || `WO-${po.id.slice(0, 8)}`,
        line,
        item: itemName,
        targetUnits,
        completedUnits,
        status,
        operator,
      };
    });
  });

  readonly filteredWorkOrders = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const status = this.statusFilter();
    return this.recentWorkOrders().filter((wo) => {
      const matchQuery =
        !query ||
        wo.code.toLowerCase().includes(query) ||
        wo.item.toLowerCase().includes(query) ||
        wo.line.toLowerCase().includes(query) ||
        wo.operator.toLowerCase().includes(query);

      const matchStatus =
        status === 'all' ||
        (status === 'active' &&
          (wo.status === 'processing' || wo.status === 'quality_check' || wo.status === 'queued')) ||
        (status === 'completed' && wo.status === 'completed');

      return matchQuery && matchStatus;
    });
  });

  readonly productionOutputMetric = computed(() => {
    const summaries = this.productionService.progressSummary();
    const orders = this.productionService.productionOrders();

    let totalCompleted = 0;
    let totalTarget = 0;

    if (summaries.length > 0) {
      for (const s of summaries) {
        totalCompleted += Number(s.actualPackingPcs) || 0;
        totalTarget += Number(s.targetPcs) || 0;
      }
    } else if (orders.length > 0) {
      for (const o of orders) {
        const sumQty = (o.lines || []).reduce((acc, l) => acc + (Number(l.quantity) || 0), 0);
        totalTarget += sumQty;
        if (o.status === 'completed') {
          totalCompleted += sumQty;
        }
      }
    }

    const percentage = totalTarget > 0 ? ((totalCompleted / totalTarget) * 100).toFixed(1) : '0';

    return {
      completedUnits: totalCompleted,
      targetUnits: totalTarget,
      percentage,
    };
  });

  readonly productionEfficiencyMetric = computed(() => {
    const summaries = this.productionService.progressSummary();
    const spks = this.productionService.spkList();

    if (summaries.length > 0) {
      const avgProgress =
        summaries.reduce((acc, s) => acc + (Number(s.completionPercentage) || 0), 0) / summaries.length;
      return {
        rate: avgProgress.toFixed(1),
        subtitle: `${summaries.length} batch produksi aktif`,
      };
    }

    if (spks.length > 0) {
      const completedSpk = spks.filter((s) => s.business_status === 'completed').length;
      const rate = ((completedSpk / spks.length) * 100).toFixed(1);
      return {
        rate,
        subtitle: `${completedSpk} dari ${spks.length} SPK selesai`,
      };
    }

    return {
      rate: '0',
      subtitle: 'Belum ada proses berjalan',
    };
  });

  readonly activeWorkOrdersMetric = computed(() => {
    const orders = this.recentWorkOrders();
    const totalActive = orders.filter((o) => o.status !== 'completed').length;
    const queuedCount = orders.filter((o) => o.status === 'queued').length;
    const inProgressCount = orders.filter((o) => o.status === 'processing' || o.status === 'quality_check').length;

    return {
      totalActive,
      queuedCount,
      inProgressCount,
    };
  });

  readonly qualityYieldMetric = computed(() => {
    const repairs = this.productionService.repairCases();
    const output = this.productionOutputMetric();

    const defectCount = repairs.length;
    const openRepairs = repairs.filter(
      (r) => r.business_status !== 'repaired' && r.business_status !== 'resolved' && r.business_status !== 'completed'
    ).length;

    const totalUnits = output.completedUnits || output.targetUnits;
    let yieldRate = 100;
    if (totalUnits > 0 && defectCount > 0) {
      const defectRate = (defectCount / totalUnits) * 100;
      yieldRate = Math.max(0, 100 - defectRate);
    } else if (defectCount > 0 && totalUnits === 0) {
      yieldRate = 95.0;
    }

    return {
      yieldRate: yieldRate.toFixed(1),
      defectCount,
      openRepairs,
    };
  });

  setStatusFilter(filter: 'all' | 'active' | 'completed'): void {
    this.statusFilter.set(filter);
  }

  getStatusBadgeVariant(status: WorkOrderItem['status']): 'default' | 'secondary' | 'outline' | 'destructive' {
    switch (status) {
      case 'completed':
        return 'default';
      case 'processing':
        return 'secondary';
      case 'quality_check':
        return 'outline';
      case 'queued':
      default:
        return 'outline';
    }
  }

  getStatusLabel(status: WorkOrderItem['status']): string {
    switch (status) {
      case 'completed':
        return 'Selesai';
      case 'processing':
        return 'Sedang Berjalan';
      case 'quality_check':
        return 'Pemeriksaan QC';
      case 'queued':
      default:
        return 'Dalam Antrean';
    }
  }

  getProgressPercent(completed: number, target: number): number {
    if (!target || target <= 0) return 0;
    return Math.min(100, Math.round((completed / target) * 100));
  }

  formatNumber(val: number): string {
    return (val || 0).toLocaleString();
  }
}
