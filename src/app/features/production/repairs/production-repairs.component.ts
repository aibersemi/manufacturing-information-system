import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorClock,
  phosphorCoins,
  phosphorFileText,
  phosphorMagnifyingGlass,
  phosphorTag,
  phosphorUser,
  phosphorWarningCircle,
  phosphorWrench,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import {
  OperatorProfileItem,
  ProductionService,
  RepairCaseWithDetails,
} from '../../../core/services/production.service';

@Component({
  selector: 'app-production-repairs',
  imports: [CommonModule, FormsModule, NgIcon],
  providers: [
    provideIcons({
      phosphorWrench,
      phosphorArrowsClockwise,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorMagnifyingGlass,
      phosphorClock,
      phosphorUser,
      phosphorCoins,
      phosphorTag,
      phosphorFileText,
      phosphorX,
    }),
  ],
  templateUrl: './production-repairs.component.html',
})
export class ProductionRepairsComponent implements OnInit {
  private readonly productionService = inject(ProductionService);

  readonly repairCases = this.productionService.repairCases;
  readonly isLoading = this.productionService.isLoading;

  // Search & Filter
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<'all' | 'pending_assignment' | 'in_progress' | 'completed'>('all');

  // Modal Penugasan
  readonly isAssignModalOpen = signal<boolean>(false);
  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly selectedCase = signal<RepairCaseWithDetails | null>(null);
  readonly selectedOperatorId = signal<string>('');
  readonly wageMode = signal<'unpaid' | 'reference' | 'custom'>('reference');
  readonly customRate = signal<number | null>(null);
  readonly assignNotes = signal<string>('');

  // Operator List
  readonly operators = signal<OperatorProfileItem[]>([]);

  // Computed KPIs
  readonly totalCases = computed(() => this.repairCases().length);
  readonly pendingCases = computed(
    () => this.repairCases().filter((c) => c.business_status === 'pending_assignment').length
  );
  readonly inProgressCases = computed(
    () => this.repairCases().filter((c) => c.business_status === 'in_progress').length
  );
  readonly totalDefectivePcs = computed(() =>
    this.repairCases().reduce((acc, c) => acc + Number(c.quantity), 0)
  );

  // Filtered Cases
  readonly filteredCases = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const filter = this.statusFilter();

    return this.repairCases().filter((c) => {
      const bCodeMatch = c.bundle_code?.toLowerCase().includes(query) ?? false;
      const ppMatch = c.production_order_number?.toLowerCase().includes(query) ?? false;
      const reasonMatch = c.issue_reason?.toLowerCase().includes(query) ?? false;
      const prodMatch = c.product_name?.toLowerCase().includes(query) ?? false;
      const matchesSearch = !query || bCodeMatch || ppMatch || reasonMatch || prodMatch;

      const matchesStatus = filter === 'all' || c.business_status === filter;

      return matchesSearch && matchesStatus;
    });
  });

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    try {
      this.errorMessage.set(null);
      await this.productionService.getRepairCases();
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat kasus perbaikan.');
    }
  }

  async openAssignModal(repairCase: RepairCaseWithDetails): Promise<void> {
    this.selectedCase.set(repairCase);
    this.wageMode.set('reference');
    this.customRate.set(null);
    this.assignNotes.set('');
    this.errorMessage.set(null);

    try {
      // Ambil operator untuk jenis pekerjaan perbaikan (misal printing/sablon atau sewing/jahit)
      const ops = await this.productionService.getOperatorProfiles(repairCase.repair_work_kind);
      this.operators.set(ops);
      if (ops.length > 0) {
        this.selectedOperatorId.set(ops[0].id);
      }
      this.isAssignModalOpen.set(true);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat profil operator.');
    }
  }

  closeAssignModal(): void {
    this.isAssignModalOpen.set(false);
    this.selectedCase.set(null);
  }

  async submitAssign(): Promise<void> {
    const rCase = this.selectedCase();
    const opId = this.selectedOperatorId();
    const mode = this.wageMode();

    if (!rCase) return;
    if (!opId) {
      this.errorMessage.set('Pilih operator yang ditugaskan.');
      return;
    }

    if (mode === 'custom' && (this.customRate() === null || this.customRate()! < 0)) {
      this.errorMessage.set('Tarif khusus wajib berupa angka non-negatif.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      const res = await this.productionService.assignRepair({
        repairCaseId: rCase.id,
        operatorId: opId,
        wageMode: mode,
        customRate: this.customRate() ?? undefined,
        notes: this.assignNotes(),
      });

      this.successMessage.set(
        `SPK Perbaikan ${res.spkNumber} berhasil diterbitkan dengan mode kompensasi ${res.compensationMode}!`
      );
      this.closeAssignModal();
      await this.loadData();
      setTimeout(() => this.successMessage.set(null), 4000);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal menugaskan perbaikan.');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
