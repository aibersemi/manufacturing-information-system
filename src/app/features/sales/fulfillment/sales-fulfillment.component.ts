import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorClock,
  phosphorEye,
  phosphorFileText,
  phosphorMagnifyingGlass,
  phosphorPackage,
  phosphorPercent,
  phosphorTrendUp,
  phosphorTruck,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  SalesFulfillmentSummaryItem,
  SalesService,
} from '../../../core/services/sales.service';

@Component({
  selector: 'app-sales-fulfillment',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorEye,
      phosphorX,
      phosphorTruck,
      phosphorPackage,
      phosphorClock,
      phosphorPercent,
      phosphorTrendUp,
      phosphorFileText,
    }),
  ],
  templateUrl: './sales-fulfillment.component.html',
})
export class SalesFulfillmentComponent implements OnInit {
  private readonly salesService = inject(SalesService);

  readonly summary = computed(() => this.salesService.fulfillmentSummary());
  readonly isLoading = computed(() => this.salesService.loading());

  readonly searchQuery = signal('');
  readonly statusFilter = signal<'all' | 'unshipped' | 'partial_delivery' | 'full_delivery'>('all');

  readonly errorMessage = signal<string | null>(null);

  // Modal Detail Rincian SKU PO
  readonly isDetailModalOpen = signal(false);
  readonly selectedItem = signal<SalesFulfillmentSummaryItem | null>(null);

  readonly items = computed(() => this.summary()?.items || []);

  readonly overallFulfillmentRate = computed(() => {
    const s = this.summary();
    if (!s || s.totalOrderedQty === 0) return 0;
    return Math.round((s.totalDeliveredQty / s.totalOrderedQty) * 100);
  });

  readonly filteredItems = computed(() => {
    const list = this.items();
    const query = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();

    return list.filter((item) => {
      const matchStatus = status === 'all' || item.deliveryStatus === status;
      if (!matchStatus) return false;

      if (!query) return true;
      const num = item.poNumber.toLowerCase();
      const customer = item.customerName.toLowerCase();
      return num.includes(query) || customer.includes(query);
    });
  });

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    try {
      this.errorMessage.set(null);
      await this.salesService.getFulfillmentSummary();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat ringkasan pemenuhan pesanan.';
      this.errorMessage.set(msg);
    }
  }

  openDetailModal(item: SalesFulfillmentSummaryItem): void {
    this.selectedItem.set(item);
    this.isDetailModalOpen.set(true);
  }

  closeDetailModal(): void {
    this.isDetailModalOpen.set(false);
    this.selectedItem.set(null);
  }

  formatRupiah(value: number): string {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value || 0);
  }
}
