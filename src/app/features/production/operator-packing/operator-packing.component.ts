import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorFileText,
  phosphorPackage,
  phosphorTag,
  phosphorUser,
  phosphorWarningCircle,
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
  notes: string;
  isConfirmed: boolean;
}

export interface ConfirmedPackingResult {
  actualId: string;
  actualNumber: string;
  bundleCode: string;
  successQuantity: number;
  wageAmount: number;
  spkCompleted: boolean;
}

@Component({
  selector: 'app-operator-packing',
  imports: [CommonModule, FormsModule, NgIcon],
  providers: [
    provideIcons({
      phosphorPackage,
      phosphorArrowsClockwise,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorXCircle,
      phosphorTag,
      phosphorFileText,
      phosphorUser,
    }),
  ],
  templateUrl: './operator-packing.component.html',
})
export class OperatorPackingComponent implements OnInit {
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

  // Active Packing SPKs
  readonly packingSpks = signal<SpkWithDetails[]>([]);
  readonly selectedSpkId = signal<string>('');
  readonly selectedSpk = signal<SpkWithDetails | null>(null);

  // Bundles for the selected SPK
  readonly bundleEntries = signal<BundleEntry[]>([]);

  // Last confirmed result
  readonly lastResult = signal<ConfirmedPackingResult | null>(null);

  readonly confirmedCount = computed(
    () => this.bundleEntries().filter((b) => b.isConfirmed).length
  );

  readonly totalBundles = computed(() => this.bundleEntries().length);

  async ngOnInit(): Promise<void> {
    await this.loadPackingSpks();
  }

  async loadPackingSpks(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const allSpks = await this.productionService.getSpkList('packing');
      const active = allSpks.filter(
        (s) => s.business_status === 'assigned' || s.business_status === 'in_progress'
      );
      this.packingSpks.set(active);

      if (active.length > 0 && !this.selectedSpkId()) {
        await this.onSelectSpk(active[0].id);
      }
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat SPK Packing.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onSelectSpk(spkId: string): Promise<void> {
    if (this.selectedSpkId() !== spkId) {
      this.lastResult.set(null);
    }
    this.selectedSpkId.set(spkId);
    const spk = this.packingSpks().find((s) => s.id === spkId) || null;
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
        notes: '',
        isConfirmed: b.stage === 'packing',
      }));

      this.bundleEntries.set(entries);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat ikatan SPK Packing.');
    } finally {
      this.isLoading.set(false);
    }
  }

  updateEntry(
    index: number,
    field: 'successQty' | 'notes',
    value: number | string
  ): void {
    this.bundleEntries.update((list) => {
      const updated = [...list];
      const target = { ...updated[index] };

      if (field === 'notes') {
        target.notes = String(value);
      } else if (field === 'successQty') {
        const num = Math.max(0, Math.floor(Number(value) || 0));
        target.successQty = num;
      }

      updated[index] = target;
      return updated;
    });
  }

  isEntryValid(entry: BundleEntry): boolean {
    return entry.successQty > 0 && entry.successQty === entry.bundle.active_quantity;
  }

  isEntryBalanced(entry: BundleEntry): boolean {
    return this.isEntryValid(entry);
  }

  async confirmBundleResult(index: number): Promise<void> {
    const entry = this.bundleEntries()[index];
    const spk = this.selectedSpk();

    if (!spk || !entry) return;

    if (entry.successQty <= 0) {
      this.errorMessage.set('Kuantitas hasil packing harus lebih besar dari 0.');
      return;
    }

    if (entry.successQty !== entry.bundle.active_quantity) {
      this.errorMessage.set(
        `Kuantitas hasil packing (${entry.successQty} PCS) wajib tepat sama dengan kuantitas aktif ikatan (${entry.bundle.active_quantity} PCS).`
      );
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      const res = await this.productionService.confirmPacking({
        spkId: spk.document_id,
        bundleId: entry.bundle.id,
        successQty: entry.successQty,
        notes: entry.notes,
      });

      this.lastResult.set(res);
      const wageFormatted = `Rp ${res.wageAmount.toLocaleString('id-ID')}`;
      const baseMsg = `Hasil packing ${res.bundleCode} (${res.actualNumber}) berhasil dicatat! Kuantitas produk jadi: ${res.successQuantity} PCS. Tagihan upah borongan: ${wageFormatted}.`;

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
        await this.loadPackingSpks();
      } else {
        this.successMessage.set(baseMsg);
      }
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal mengonfirmasi hasil packing.');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
