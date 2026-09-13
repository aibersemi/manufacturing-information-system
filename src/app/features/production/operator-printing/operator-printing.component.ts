import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorFileText,
  phosphorShirtFolded,
  phosphorTag,
  phosphorUser,
  phosphorWarningCircle,
  phosphorWrench,
  phosphorXCircle,
} from '@ng-icons/phosphor-icons/regular';
import {
  EligibleBundleItem,
  ProductionService,
  SpkWithDetails,
} from '../../../core/services/production.service';

interface BundleEntry {
  bundle: EligibleBundleItem;
  successQty: number;
  repairQty: number;
  rejectQty: number;
  notes: string;
  isConfirmed: boolean;
}

@Component({
  selector: 'app-operator-printing',
  imports: [CommonModule, FormsModule, NgIcon],
  providers: [
    provideIcons({
      phosphorShirtFolded,
      phosphorArrowsClockwise,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorXCircle,
      phosphorWrench,
      phosphorTag,
      phosphorFileText,
      phosphorUser,
    }),
  ],
  templateUrl: './operator-printing.component.html',
})
export class OperatorPrintingComponent implements OnInit {
  private readonly productionService = inject(ProductionService);

  readonly isLoading = signal<boolean>(false);
  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Active Printing SPKs
  readonly printingSpks = signal<SpkWithDetails[]>([]);
  readonly selectedSpkId = signal<string>('');
  readonly selectedSpk = signal<SpkWithDetails | null>(null);

  // Bundles for the selected SPK
  readonly bundleEntries = signal<BundleEntry[]>([]);

  // Last confirmed result
  readonly lastResult = signal<{
    bundleCode: string;
    actualNumber: string;
    successQuantity: number;
    repairQuantity: number;
    rejectQuantity: number;
    wageAmount: number;
    repairCaseId: string | null;
  } | null>(null);

  readonly confirmedCount = computed(
    () => this.bundleEntries().filter((b) => b.isConfirmed).length
  );

  readonly totalBundles = computed(() => this.bundleEntries().length);

  async ngOnInit(): Promise<void> {
    await this.loadPrintingSpks();
  }

  async loadPrintingSpks(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const allSpks = await this.productionService.getSpkList('printing');
      const active = allSpks.filter(
        (s) => s.business_status === 'assigned' || s.business_status === 'in_progress'
      );
      this.printingSpks.set(active);

      if (active.length > 0 && !this.selectedSpkId()) {
        await this.onSelectSpk(active[0].id);
      }
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat SPK Sablon.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onSelectSpk(spkId: string): Promise<void> {
    this.selectedSpkId.set(spkId);
    const spk = this.printingSpks().find((s) => s.id === spkId) || null;
    this.selectedSpk.set(spk);
    this.lastResult.set(null);

    if (!spk) return;

    try {
      this.isLoading.set(true);
      // Ambil seluruh bundle yang ditautkan ke SPK ini
      const allBundles = await this.productionService.getAllBundles();
      // Filter bundle yang work order-nya adalah SPK ini (melalui work_order_bundle atau reservation)
      // Kita bisa query langsung dari Supabase untuk bundles pada work_order
      const { data: woBundles } = await (this.productionService as unknown as {
        supabase: {
          client: {
            from: (t: string) => {
              select: (cols: string) => {
                eq: (col: string, val: string) => Promise<{ data: { bundle_id: string }[] | null }>;
              };
            };
          };
        };
      }).supabase.client
        .from('production_work_order_bundle')
        .select('bundle_id')
        .eq('work_order_id', spk.document_id);

      const assignedBundleIds = new Set((woBundles || []).map((w) => w.bundle_id));

      const spkBundles = allBundles.filter((b) => assignedBundleIds.has(b.id));

      const entries: BundleEntry[] = spkBundles.map((b) => ({
        bundle: b,
        successQty: b.active_quantity,
        repairQty: 0,
        rejectQty: 0,
        notes: '',
        isConfirmed: b.stage === 'printing' || b.work_condition === 'repair_hold',
      }));

      this.bundleEntries.set(entries);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat ikatan SPK Sablon.');
    } finally {
      this.isLoading.set(false);
    }
  }

  updateEntry(
    index: number,
    field: 'successQty' | 'repairQty' | 'rejectQty' | 'notes',
    value: number | string
  ): void {
    this.bundleEntries.update((list) => {
      const updated = [...list];
      const target = { ...updated[index] };

      if (field === 'notes') {
        target.notes = String(value);
      } else {
        const num = Math.max(0, Math.floor(Number(value) || 0));
        target[field] = num;
      }

      updated[index] = target;
      return updated;
    });
  }

  isEntryBalanced(entry: BundleEntry): boolean {
    const total = entry.successQty + entry.repairQty + entry.rejectQty;
    return total === entry.bundle.active_quantity;
  }

  async confirmBundleResult(index: number): Promise<void> {
    const entry = this.bundleEntries()[index];
    const spk = this.selectedSpk();

    if (!spk) return;

    if (!this.isEntryBalanced(entry)) {
      this.errorMessage.set(
        `Total hasil (${entry.successQty + entry.repairQty + entry.rejectQty} PCS) wajib tepat sama dengan kuantitas aktif ikatan (${entry.bundle.active_quantity} PCS).`
      );
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      const res = await this.productionService.confirmPrinting({
        spkId: spk.document_id,
        bundleId: entry.bundle.id,
        successQty: entry.successQty,
        repairQty: entry.repairQty,
        rejectQty: entry.rejectQty,
        notes: entry.notes,
      });

      this.lastResult.set(res);
      this.successMessage.set(
        `Hasil sablon ${res.bundleCode} berhasil dicatat! Berhasil: ${res.successQuantity}, Cacat: ${res.repairQuantity}, Reject: ${res.rejectQuantity}. Upah: Rp ${res.wageAmount.toLocaleString()}`
      );

      // Update state entry
      this.bundleEntries.update((list) => {
        const updated = [...list];
        updated[index] = {
          ...updated[index],
          isConfirmed: true,
        };
        return updated;
      });

      if (res.spkCompleted) {
        this.successMessage.set(`Seluruh ikatan pada SPK ${spk.document_number} telah selesai diproses!`);
        await this.loadPrintingSpks();
      }
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal mengonfirmasi hasil sablon.');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
