import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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

interface WorkOrderItem {
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
  imports: [HlmCardImports, HlmBadge, HlmButton, NgIcon, FormsModule],
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
export class DashboardComponent {
  private readonly authService = inject(AuthService);

  readonly searchQuery = signal('');

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

  readonly recentWorkOrders = computed<WorkOrderItem[]>(() => [
    {
      id: '1',
      code: 'WO-2026-0891',
      line: 'Lini Silikon A (Fab-1)',
      item: 'Wafer IC 12nm Power Management',
      targetUnits: 3000,
      completedUnits: 2850,
      status: 'processing',
      operator: 'Budi Santoso',
    },
    {
      id: '2',
      code: 'WO-2026-0892',
      line: 'Packaging Cleanroom 2',
      item: 'Microcontroller QFN-32 Packaging',
      targetUnits: 5000,
      completedUnits: 4980,
      status: 'quality_check',
      operator: 'Siti Rahma',
    },
    {
      id: '3',
      code: 'WO-2026-0893',
      line: 'Fabrikasi Substrat B',
      item: 'Silicon Carbide (SiC) Base Substrate',
      targetUnits: 1500,
      completedUnits: 1500,
      status: 'completed',
      operator: 'Ahmad Fauzi',
    },
    {
      id: '4',
      code: 'WO-2026-0894',
      line: 'Testing & Burn-in Line 3',
      item: 'Automotive Grade Sensor IC',
      targetUnits: 2000,
      completedUnits: 450,
      status: 'processing',
      operator: 'Dedi Kurniawan',
    },
    {
      id: '5',
      code: 'WO-2026-0895',
      line: 'Die Attach Unit 1',
      item: 'RF Transceiver Front-End Module',
      targetUnits: 4000,
      completedUnits: 0,
      status: 'queued',
      operator: 'Rina Wijaya',
    },
  ]);

  readonly statusFilter = signal<'all' | 'active' | 'completed'>('all');

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
        (status === 'active' && (wo.status === 'processing' || wo.status === 'quality_check' || wo.status === 'queued')) ||
        (status === 'completed' && wo.status === 'completed');

      return matchQuery && matchStatus;
    });
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
}
