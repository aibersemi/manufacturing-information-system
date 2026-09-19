import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorFileText,
  phosphorNeedle,
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
import { SupabaseService } from '../../../core/services/supabase.service';

export interface BundleEntry {
  bundle: EligibleBundleItem;
  successQty: number;
  repairQty: number;
  rejectQty: number;
  notes: string;
  isConfirmed: boolean;
}

export interface ConfirmedSewingResult {
  actualId: string;
  actualNumber: string;
  bundleCode: string;
  successQuantity: number;
  repairQuantity: number;
  rejectQuantity: number;
  wageAmount: number;
  repairCaseId: string | null;
  spkCompleted: boolean;
}

@Component({
  selector: 'app-operator-sewing',
  imports: [CommonModule, FormsModule, NgIcon],
  providers: [
    provideIcons({
      phosphorNeedle,
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
  templateUrl: './operator-sewing.component.html',
})
export class OperatorSewingComponent implements OnInit {
  private readonly productionService = inject(ProductionService);
  private readonly supabaseService = inject(SupabaseService, { optional: true });

  private get supabaseClient() {
    return (
      this.supabaseService?.client ??
      (this.productionService as unknown as { supabase?: SupabaseService }).supabase?.client
    );
  }

  readonly isLoading = signal<boolean>(false);
  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Active Sewing SPKs
  readonly sewingSpks = signal<SpkWithDetails[]>([]);
  readonly selectedSpkId = signal<string>('');
  readonly selectedSpk = signal<SpkWithDetails | null>(null);

  // Bundles for the selected SPK
  readonly bundleEntries = signal<BundleEntry[]>([]);

  // Last confirmed result
  readonly lastResult = signal<ConfirmedSewingResult | null>(null);

  readonly confirmedCount = computed(
    () => this.bundleEntries().filter((b) => b.isConfirmed).length
  );

  readonly totalBundles = computed(() => this.bundleEntries().length);

  async ngOnInit(): Promise<void> {
    await this.loadSewingSpks();
  }

  async loadSewingSpks(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const allSpks = await this.productionService.getSpkList('sewing');
      const active = allSpks.filter(
        (s) => s.business_status === 'assigned' || s.business_status === 'in_progress'
      );
      this.sewingSpks.set(active);

      if (active.length > 0 && !this.selectedSpkId()) {
        await this.onSelectSpk(active[0].id);
      }
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat SPK Jahit.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onSelectSpk(spkId: string): Promise<void> {
    if (this.selectedSpkId() !== spkId) {
      this.lastResult.set(null);
    }
    this.selectedSpkId.set(spkId);
    const spk = this.sewingSpks().find((s) => s.id === spkId) || null;
    this.selectedSpk.set(spk);

    if (!spk) {
      this.bundleEntries.set([]);
      return;
    }

    try {
      this.isLoading.set(true);
      const allBundles = await this.productionService.getAllBundles();

      const client = this.supabaseClient;
      let assignedBundleIds = new Set<string>();

      if (client) {
        const { data: woBundles } = await client
          .from('production_work_order_bundle')
          .select('bundle_id')
          .eq('work_order_id', spk.document_id);

        assignedBundleIds = new Set(
          (woBundles || []).map((w: { bundle_id: string }) => w.bundle_id)
        );
      }

      const spkBundles = allBundles.filter((b) => assignedBundleIds.has(b.id));

      const entries: BundleEntry[] = spkBundles.map((b) => ({
        bundle: b,
        successQty: b.active_quantity,
        repairQty: 0,
        rejectQty: 0,
        notes: '',
        isConfirmed: b.stage === 'sewing' || b.work_condition === 'repair_hold',
      }));

      this.bundleEntries.set(entries);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat ikatan SPK Jahit.');
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

    if (!spk || !entry) return;

    if (!this.isEntryBalanced(entry)) {
      this.errorMessage.set(
        `Total hasil (${entry.successQty + entry.repairQty + entry.rejectQty} PCS) wajib tepat sama dengan kuantitas aktif ikatan (${entry.bundle.active_quantity} PCS).`
      );
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      const res = await this.productionService.confirmSewing({
        spkId: spk.document_id,
        bundleId: entry.bundle.id,
        successQty: entry.successQty,
        repairQty: entry.repairQty,
        rejectQty: entry.rejectQty,
        notes: entry.notes,
      });

      this.lastResult.set(res);
      const wageFormatted = `Rp ${res.wageAmount.toLocaleString('id-ID')}`;
      const baseMsg = `Hasil jahit ${res.bundleCode} (${res.actualNumber}) berhasil dicatat! Berhasil: ${res.successQuantity} PCS, Cacat: ${res.repairQuantity} PCS, Reject: ${res.rejectQuantity} PCS. Tagihan upah borongan: ${wageFormatted}.`;

      this.bundleEntries.update((list) => {
        const updated = [...list];
        updated[index] = {
          ...updated[index],
          isConfirmed: true,
        };
        return updated;
      });

      if (res.spkCompleted) {
        this.successMessage.set(
          `${baseMsg} Seluruh ikatan pada SPK ${spk.document_number} telah selesai diproses!`
        );
        await this.loadSewingSpks();
      } else {
        this.successMessage.set(baseMsg);
      }
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal mengonfirmasi hasil jahit.');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
