import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorFileText,
  phosphorPackage,
  phosphorPlus,
  phosphorScissors,
  phosphorTag,
  phosphorTrash,
  phosphorWarningCircle,
} from '@ng-icons/phosphor-icons/regular';
import {
  CuttingActualLine,
  CuttingBundleInput,
  ProductionMaterialUnit,
  ProductionOrderDetail,
  ProductionService,
  SpkWithDetails,
} from '../../../core/services/production.service';

interface SkuOutputForm {
  productId: string;
  productName: string;
  productSku?: string | null;
  targetPcs: number;
  actualPcs: number;
}

interface BundleFormItem {
  productId: string;
  productName: string;
  quantity: number;
  bundleCode?: string;
}

@Component({
  selector: 'app-operator-cutting',
  imports: [CommonModule, FormsModule, NgIcon],
  providers: [
    provideIcons({
      phosphorScissors,
      phosphorArrowsClockwise,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorPackage,
      phosphorTag,
      phosphorFileText,
      phosphorPlus,
      phosphorTrash,
    }),
  ],
  templateUrl: './operator-cutting.component.html',
})
export class OperatorCuttingComponent implements OnInit {
  private readonly productionService = inject(ProductionService);

  readonly isLoading = signal<boolean>(false);
  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Available SPKs & Rolls
  readonly assignedSpks = signal<SpkWithDetails[]>([]);
  readonly availableRolls = signal<ProductionMaterialUnit[]>([]);

  // Selected State
  readonly selectedSpkId = signal<string>('');
  readonly selectedSpk = signal<SpkWithDetails | null>(null);
  readonly selectedSpkDetail = signal<ProductionOrderDetail | null>(null);
  readonly selectedRollId = signal<string>('');
  readonly actualDate = signal<string>(new Date().toISOString().split('T')[0]);

  // Dynamic Output Lines & Bundles
  readonly skuOutputs = signal<SkuOutputForm[]>([]);
  readonly bundles = signal<BundleFormItem[]>([]);

  // Last Confirmation Result
  readonly lastConfirmation = signal<{
    actualNumber: string;
    lotCode: string;
    totalActualPcs: number;
    bundleCount: number;
    wageAmount: number;
  } | null>(null);

  // Computed Totals
  readonly totalActualPcs = computed(() =>
    this.skuOutputs().reduce((acc, line) => acc + (Number(line.actualPcs) || 0), 0)
  );

  readonly totalBundlesPcs = computed(() =>
    this.bundles().reduce((acc, b) => acc + (Number(b.quantity) || 0), 0)
  );

  readonly isBundleCountMatching = computed(() => {
    return this.totalActualPcs() > 0 && this.totalActualPcs() === this.totalBundlesPcs();
  });

  async ngOnInit(): Promise<void> {
    await this.loadAssignedSpks();
  }

  async loadAssignedSpks(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const allSpks = await this.productionService.getSpkList('cutting');
      // Hanya SPK yang belum selesai
      const activeSpks = allSpks.filter(
        (s) => s.business_status === 'assigned' || s.business_status === 'in_progress'
      );
      this.assignedSpks.set(activeSpks);

      if (activeSpks.length > 0 && !this.selectedSpkId()) {
        await this.onSelectSpk(activeSpks[0].id);
      }
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat SPK Potong.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onSelectSpk(spkId: string): Promise<void> {
    this.selectedSpkId.set(spkId);
    const spk = this.assignedSpks().find((s) => s.id === spkId) || null;
    this.selectedSpk.set(spk);
    this.selectedRollId.set('');
    this.lastConfirmation.set(null);

    if (!spk) return;

    try {
      this.isLoading.set(true);
      const [rolls, ppDetail] = await Promise.all([
        this.productionService.getAvailableRollsForSpk(spk.document_id),
        this.productionService.getProductionOrderById(spk.production_order_id),
      ]);

      this.availableRolls.set(rolls);
      this.selectedSpkDetail.set(ppDetail);

      if (rolls.length > 0) {
        this.selectedRollId.set(rolls[0].id);
      }

      // Inisialisasi baris SKU output dari target PP
      const outputs: SkuOutputForm[] = (ppDetail.lines || []).map((l) => ({
        productId: l.item_id || '',
        productName: l.product?.name || 'Produk',
        productSku: l.product?.sku,
        targetPcs: Number(l.quantity),
        actualPcs: Number(l.quantity),
      }));
      this.skuOutputs.set(outputs);

      // Inisialisasi otomatis pembagian bundle (default per 50 pcs)
      this.autoGenerateBundles(outputs, 50);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat rincian SPK & Roll kain.');
    } finally {
      this.isLoading.set(false);
    }
  }

  autoGenerateBundles(outputs: SkuOutputForm[], bundleSize = 50): void {
    const newBundles: BundleFormItem[] = [];

    for (const out of outputs) {
      let remaining = out.actualPcs;
      let bIndex = 1;

      while (remaining > 0) {
        const qty = Math.min(remaining, bundleSize);
        newBundles.push({
          productId: out.productId,
          productName: out.productName,
          quantity: qty,
          bundleCode: `IKT-${out.productSku || 'SKU'}-${String(bIndex).padStart(2, '0')}`,
        });
        remaining -= qty;
        bIndex++;
      }
    }

    this.bundles.set(newBundles);
  }

  updateActualPcs(index: number, val: number): void {
    this.skuOutputs.update((current) => {
      const updated = [...current];
      updated[index] = {
        ...updated[index],
        actualPcs: Math.max(0, Math.floor(Number(val) || 0)),
      };
      return updated;
    });
    // Re-generate bundles automatically
    this.autoGenerateBundles(this.skuOutputs(), 50);
  }

  addBundle(): void {
    const firstOutput = this.skuOutputs().length > 0 ? this.skuOutputs()[0] : null;
    if (!firstOutput) return;

    this.bundles.update((list) => [
      ...list,
      {
        productId: firstOutput.productId,
        productName: firstOutput.productName,
        quantity: 50,
        bundleCode: `IKT-${firstOutput.productSku || 'SKU'}-${String(list.length + 1).padStart(2, '0')}`,
      },
    ]);
  }

  removeBundle(index: number): void {
    if (this.bundles().length > 1) {
      this.bundles.update((list) => list.filter((_, i) => i !== index));
    }
  }

  updateBundle(index: number, field: keyof BundleFormItem, val: string | number): void {
    this.bundles.update((list) => {
      const updated = [...list];
      updated[index] = {
        ...updated[index],
        [field]: field === 'quantity' ? Math.max(1, Math.floor(Number(val) || 1)) : val,
      };
      return updated;
    });
  }

  async submitConfirmation(): Promise<void> {
    const spk = this.selectedSpk();
    const rollId = this.selectedRollId();
    const actDate = this.actualDate();

    if (!spk) {
      this.errorMessage.set('Pilih SPK Potong terlebih dahulu.');
      return;
    }
    if (!rollId) {
      this.errorMessage.set('Pilih Roll fisik kain yang digunakan.');
      return;
    }
    if (!this.isBundleCountMatching()) {
      this.errorMessage.set(
        `Total kuantitas pada ikatan (${this.totalBundlesPcs()} PCS) wajib tepat sama dengan total aktual potong (${this.totalActualPcs()} PCS).`
      );
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      const actualLines: CuttingActualLine[] = this.skuOutputs().map((o) => ({
        productId: o.productId,
        quantity: o.actualPcs,
      }));

      const payloadBundles: CuttingBundleInput[] = this.bundles().map((b) => ({
        productId: b.productId,
        quantity: b.quantity,
        bundleCode: b.bundleCode,
      }));

      const res = await this.productionService.confirmCutting({
        spkId: spk.document_id,
        rollId,
        actualDate: actDate,
        actualLines,
        bundles: payloadBundles,
      });

      this.lastConfirmation.set(res);
      this.successMessage.set(
        `Berhasil mengonfirmasi potongan! No. Dokumen: ${res.actualNumber}, Lot: ${res.lotCode}, Terbentuk: ${res.bundleCount} Ikatan.`
      );

      // Refresh list
      await this.loadAssignedSpks();
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal mengonfirmasi pemotongan kain.');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
