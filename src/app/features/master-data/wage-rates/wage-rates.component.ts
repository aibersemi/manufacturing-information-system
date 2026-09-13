import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorCircleNotch,
  phosphorCurrencyDollar,
  phosphorMagnifyingGlass,
  phosphorPackage,
  phosphorPaintBrush,
  phosphorPencilSimple,
  phosphorScissors,
  phosphorTShirt,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { CompanyService } from '../../../core/services/company.service';
import {
  MasterDataService,
  WageRatesByProduct,
} from '../../../core/services/master-data.service';

@Component({
  selector: 'app-wage-rates',
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    NgIcon,
    HlmButton,
    HlmCardImports,
  ],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorCheckCircle,
      phosphorCircleNotch,
      phosphorCurrencyDollar,
      phosphorMagnifyingGlass,
      phosphorPackage,
      phosphorPaintBrush,
      phosphorPencilSimple,
      phosphorScissors,
      phosphorTShirt,
      phosphorX,
    }),
  ],
  templateUrl: './wage-rates.component.html',
})
export class WageRatesComponent {
  private readonly masterDataService = inject(MasterDataService);
  private readonly companyService = inject(CompanyService);

  constructor() {
    effect(() => {
      const companyId = this.companyService.activeCompanyId();
      if (companyId) {
        this.loadRates();
      }
    });
  }

  readonly productRates = signal<WageRatesByProduct[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly searchQuery = signal<string>('');

  // Modal State
  readonly isModalOpen = signal<boolean>(false);
  readonly selectedItem = signal<WageRatesByProduct | null>(null);

  // Form Signals
  readonly formCutting = signal<number>(0);
  readonly formPrinting = signal<number>(0);
  readonly formSewing = signal<number>(0);
  readonly formPacking = signal<number>(0);
  readonly formError = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  readonly totalFormRate = computed(() => {
    return (
      (this.formCutting() || 0) +
      (this.formPrinting() || 0) +
      (this.formSewing() || 0) +
      (this.formPacking() || 0)
    );
  });

  readonly filteredProductRates = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    let list = this.productRates();

    if (q) {
      list = list.filter((p) => {
        return (
          p.sku.toLowerCase().includes(q) ||
          p.productName.toLowerCase().includes(q)
        );
      });
    }

    return list;
  });

  async loadRates(): Promise<void> {
    this.isLoading.set(true);
    try {
      const data = await this.masterDataService.getWageRatesGroupedByProduct();
      this.productRates.set(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat matriks tarif upah.';
      toast.error(msg);
    } finally {
      this.isLoading.set(false);
    }
  }

  getTotalRate(item: WageRatesByProduct): number {
    return item.cutting + item.printing + item.sewing + item.packing;
  }

  openEditModal(item: WageRatesByProduct): void {
    this.selectedItem.set(item);
    this.formCutting.set(item.cutting);
    this.formPrinting.set(item.printing);
    this.formSewing.set(item.sewing);
    this.formPacking.set(item.packing);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    if (this.isSubmitting()) return;
    this.isModalOpen.set(false);
  }

  async saveRates(): Promise<void> {
    this.formError.set(null);
    const item = this.selectedItem();
    if (!item) return;

    if (
      this.formCutting() < 0 ||
      this.formPrinting() < 0 ||
      this.formSewing() < 0 ||
      this.formPacking() < 0
    ) {
      this.formError.set('Tarif upah tidak boleh bernilai negatif.');
      return;
    }

    this.isSubmitting.set(true);

    try {
      await this.masterDataService.saveProductWageRates(item.productId, item.sku, {
        cutting: this.formCutting(),
        printing: this.formPrinting(),
        sewing: this.formSewing(),
        packing: this.formPacking(),
      });

      toast.success(`Tarif upah untuk "${item.productName}" (${item.sku}) berhasil disimpan.`);
      this.isModalOpen.set(false);
      await this.loadRates();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan tarif upah.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
