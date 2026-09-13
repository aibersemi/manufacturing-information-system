import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorEye,
  phosphorFileText,
  phosphorLock,
  phosphorLockOpen,
  phosphorMagnifyingGlass,
  phosphorPackage,
  phosphorPlus,
  phosphorScissors,
  phosphorTrash,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { MasterDataService, ProductWithRouting } from '../../../core/services/master-data.service';
import {
  ProductionOrderDetail,
  ProductionOrderLineInput,
  ProductionService,
} from '../../../core/services/production.service';

interface FormLine {
  productId: string;
  quantity: number;
}

@Component({
  selector: 'app-production-orders',
  imports: [CommonModule, FormsModule, NgIcon],
  providers: [
    provideIcons({
      phosphorPlus,
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorEye,
      phosphorTrash,
      phosphorX,
      phosphorPackage,
      phosphorFileText,
      phosphorLock,
      phosphorLockOpen,
      phosphorScissors,
    }),
  ],
  templateUrl: './production-orders.component.html',
})
export class ProductionOrdersComponent implements OnInit {
  private readonly productionService = inject(ProductionService);
  private readonly masterDataService = inject(MasterDataService);

  readonly orders = this.productionService.productionOrders;
  readonly isLoading = this.productionService.isLoading;

  // Filter & Search
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<'all' | 'draft' | 'locked'>('all');

  // Master Products
  readonly products = signal<ProductWithRouting[]>([]);

  // Modal State
  readonly isCreateModalOpen = signal<boolean>(false);
  readonly isDetailModalOpen = signal<boolean>(false);
  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Selected for Detail
  readonly selectedOrder = signal<ProductionOrderDetail | null>(null);

  // Form State
  readonly targetDate = signal<string>(new Date().toISOString().split('T')[0]);
  readonly notes = signal<string>('');
  readonly formLines = signal<FormLine[]>([{ productId: '', quantity: 100 }]);

  // Computed KPIs
  readonly totalOrders = computed(() => this.orders().length);
  readonly activeOrders = computed(() =>
    this.orders().filter((o) => (o.data as Record<string, unknown>)?.['code_locked'] === true).length
  );
  readonly totalTargetPcs = computed(() =>
    this.orders().reduce((acc, o) => {
      const pcs = (o.data as Record<string, unknown>)?.['total_target_pcs'];
      if (typeof pcs === 'number') return acc + pcs;
      const lineSum = (o.lines || []).reduce((lAcc, l) => lAcc + Number(l.quantity), 0);
      return acc + lineSum;
    }, 0)
  );
  readonly draftOrders = computed(() =>
    this.orders().filter((o) => (o.data as Record<string, unknown>)?.['code_locked'] !== true).length
  );

  // Filtered Orders
  readonly filteredOrders = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const filter = this.statusFilter();

    return this.orders().filter((order) => {
      const numMatch = order.document_number?.toLowerCase().includes(query) ?? false;
      const notesMatch = String((order.data as Record<string, unknown>)?.['notes'] || '')
        .toLowerCase()
        .includes(query);
      const skuMatch = (order.lines || []).some((l) =>
        l.product?.name?.toLowerCase().includes(query) || l.product?.sku?.toLowerCase().includes(query)
      );
      const matchesSearch = !query || numMatch || notesMatch || skuMatch;

      const isLocked = (order.data as Record<string, unknown>)?.['code_locked'] === true;
      let matchesFilter = true;
      if (filter === 'draft') matchesFilter = !isLocked;
      if (filter === 'locked') matchesFilter = isLocked;

      return matchesSearch && matchesFilter;
    });
  });

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    try {
      this.errorMessage.set(null);
      const [, prods] = await Promise.all([
        this.productionService.getProductionOrders(),
        this.masterDataService.getProducts(),
      ]);
      this.products.set(prods);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat data.');
    }
  }

  openCreateModal(): void {
    this.targetDate.set(new Date().toISOString().split('T')[0]);
    this.notes.set('');
    const firstProd = this.products().length > 0 ? this.products()[0].id : '';
    this.formLines.set([{ productId: firstProd, quantity: 100 }]);
    this.errorMessage.set(null);
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  addLine(): void {
    const firstProd = this.products().length > 0 ? this.products()[0].id : '';
    this.formLines.update((lines) => [...lines, { productId: firstProd, quantity: 100 }]);
  }

  removeLine(index: number): void {
    if (this.formLines().length > 1) {
      this.formLines.update((lines) => lines.filter((_, i) => i !== index));
    }
  }

  updateLine(index: number, field: keyof FormLine, value: string | number): void {
    this.formLines.update((lines) => {
      const updated = [...lines];
      updated[index] = {
        ...updated[index],
        [field]: field === 'quantity' ? Math.max(1, Math.floor(Number(value) || 1)) : value,
      };
      return updated;
    });
  }

  getProductRouting(productId: string): boolean {
    const prod = this.products().find((p) => p.id === productId);
    return prod?.requiresPrinting ?? false;
  }

  getProductName(productId: string): string {
    const prod = this.products().find((p) => p.id === productId);
    return prod ? `${prod.name} (${prod.sku || 'No SKU'})` : 'Pilih Produk';
  }

  async submitCreateOrder(): Promise<void> {
    const lines = this.formLines();
    if (lines.length === 0) {
      this.errorMessage.set('Wajib menambahkan minimal 1 target SKU.');
      return;
    }

    for (const l of lines) {
      if (!l.productId) {
        this.errorMessage.set('Pilih SKU yang valid untuk setiap baris.');
        return;
      }
      if (!l.quantity || l.quantity <= 0) {
        this.errorMessage.set('Kuantitas PCS harus bilangan bulat positif.');
        return;
      }
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      const payloadLines: ProductionOrderLineInput[] = lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
      }));

      const res = await this.productionService.createProductionOrder({
        targetDate: this.targetDate(),
        notes: this.notes(),
        lines: payloadLines,
      });

      this.successMessage.set(`Perintah Produksi ${res.documentNumber} berhasil dibuat!`);
      this.closeCreateModal();
      setTimeout(() => this.successMessage.set(null), 4000);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal membuat Perintah Produksi.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async viewOrderDetail(order: ProductionOrderDetail): Promise<void> {
    try {
      this.errorMessage.set(null);
      const detail = await this.productionService.getProductionOrderById(order.id);
      this.selectedOrder.set(detail);
      this.isDetailModalOpen.set(true);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat detail.');
    }
  }

  closeDetailModal(): void {
    this.isDetailModalOpen.set(false);
    this.selectedOrder.set(null);
  }

  isOrderLocked(order: ProductionOrderDetail): boolean {
    return (order.data as Record<string, unknown>)?.['code_locked'] === true;
  }

  getOrderTargetPcs(order: ProductionOrderDetail): number {
    const pcs = (order.data as Record<string, unknown>)?.['total_target_pcs'];
    if (typeof pcs === 'number') return pcs;
    return (order.lines || []).reduce((acc, l) => acc + Number(l.quantity), 0);
  }
}
