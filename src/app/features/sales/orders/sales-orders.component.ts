import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorEye,
  phosphorFileText,
  phosphorMagnifyingGlass,
  phosphorPackage,
  phosphorPlus,
  phosphorShoppingCart,
  phosphorTrash,
  phosphorTrendUp,
  phosphorTruck,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  CreateCustomerOrderPayload,
  CustomerOrder,
  SalesService,
} from '../../../core/services/sales.service';
import { Tables } from '../../../../types/database.types';

interface OrderLineForm {
  itemId: string;
  quantity: number;
  unitPrice: number;
  unitCode: string;
  notes: string;
}

@Component({
  selector: 'app-sales-orders',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
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
      phosphorTrendUp,
      phosphorShoppingCart,
      phosphorTruck,
    }),
  ],
  templateUrl: './sales-orders.component.html',
})
export class SalesOrdersComponent implements OnInit {
  private readonly salesService = inject(SalesService);
  private readonly router = inject(Router);

  readonly orders = computed(() => this.salesService.customerOrders());
  readonly isLoading = computed(() => this.salesService.loading());
  readonly customers = signal<Tables<'master_record'>[]>([]);
  readonly products = signal<Tables<'master_record'>[]>([]);

  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Search & Filter
  readonly searchQuery = signal('');
  readonly statusFilter = signal<'all' | 'unshipped' | 'partial_delivery' | 'full_delivery'>('all');

  // Modal State
  readonly isModalOpen = signal(false);
  readonly isDetailModalOpen = signal(false);
  readonly selectedOrder = signal<CustomerOrder | null>(null);
  readonly isSubmitting = signal(false);
  readonly formError = signal<string | null>(null);

  // Form Fields
  readonly formCustomerId = signal('');
  readonly formOrderNumber = signal('');
  readonly formOrderDate = signal(new Date().toISOString().slice(0, 10));
  readonly formTargetDeliveryDate = signal('');
  readonly formNotes = signal('');
  readonly formLines = signal<OrderLineForm[]>([
    {
      itemId: '',
      quantity: 10,
      unitPrice: 50000,
      unitCode: 'pcs',
      notes: '',
    },
  ]);

  // KPI Computations
  readonly totalOrderAmount = computed(() =>
    this.orders().reduce((sum, o) => sum + o.totalAmount, 0)
  );

  readonly totalOrderedQty = computed(() =>
    this.orders().reduce(
      (sum, o) => sum + (o.lines || []).reduce((lSum, l) => lSum + Number(l.quantity), 0),
      0
    )
  );

  readonly openOrdersCount = computed(
    () => this.orders().filter((o) => o.deliveryStatus !== 'full_delivery').length
  );

  readonly filteredOrders = computed(() => {
    const list = this.orders();
    const query = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();

    return list.filter((order) => {
      const matchStatus = status === 'all' || order.deliveryStatus === status;
      if (!matchStatus) return false;

      if (!query) return true;
      const num = order.documentNumber.toLowerCase();
      const customer = order.customerName.toLowerCase();
      const notes = (order.notes || '').toLowerCase();
      return num.includes(query) || customer.includes(query) || notes.includes(query);
    });
  });

  async ngOnInit(): Promise<void> {
    await this.loadInitialData();
  }

  async loadInitialData(): Promise<void> {
    try {
      this.errorMessage.set(null);
      const [customers, products] = await Promise.all([
        this.salesService.getActiveCustomers(),
        this.salesService.getActiveProducts(),
        this.salesService.getCustomerOrders(),
      ]);
      this.customers.set(customers);
      this.products.set(products);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data pesanan pelanggan.';
      this.errorMessage.set(msg);
    }
  }

  async refreshData(): Promise<void> {
    try {
      this.errorMessage.set(null);
      await this.salesService.getCustomerOrders();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyegarkan data.';
      this.errorMessage.set(msg);
    }
  }

  openCreateModal(): void {
    this.formCustomerId.set('');
    this.formOrderNumber.set('');
    this.formOrderDate.set(new Date().toISOString().slice(0, 10));
    this.formTargetDeliveryDate.set('');
    this.formNotes.set('');
    this.formLines.set([
      {
        itemId: this.products()[0]?.id || '',
        quantity: 10,
        unitPrice: 50000,
        unitCode: 'pcs',
        notes: '',
      },
    ]);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.formError.set(null);
  }

  addLine(): void {
    const defaultProduct = this.products()[0];
    this.formLines.update((lines) => [
      ...lines,
      {
        itemId: defaultProduct?.id || '',
        quantity: 10,
        unitPrice: 50000,
        unitCode: 'pcs',
        notes: '',
      },
    ]);
  }

  removeLine(index: number): void {
    if (this.formLines().length <= 1) {
      this.formError.set('Pesanan wajib memiliki minimal satu baris produk.');
      return;
    }
    this.formLines.update((lines) => lines.filter((_, i) => i !== index));
  }

  calculateFormTotal(): number {
    return this.formLines().reduce(
      (sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0),
      0
    );
  }

  async submitOrder(): Promise<void> {
    this.formError.set(null);

    const customerId = this.formCustomerId();
    if (!customerId) {
      this.formError.set('Pelanggan wajib dipilih.');
      return;
    }

    const lines = this.formLines();
    if (!lines.length) {
      this.formError.set('Minimal satu baris produk harus diisi.');
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.itemId) {
        this.formError.set(`Pilih produk pada baris ${i + 1}.`);
        return;
      }
      if (line.quantity <= 0) {
        this.formError.set(`Kuantitas baris ${i + 1} harus lebih besar dari nol.`);
        return;
      }
      if (line.unitPrice < 0) {
        this.formError.set(`Harga satuan baris ${i + 1} tidak boleh negatif.`);
        return;
      }
    }

    this.isSubmitting.set(true);
    try {
      const payload: CreateCustomerOrderPayload = {
        customerId,
        orderNumber: this.formOrderNumber().trim() || undefined,
        orderDate: this.formOrderDate(),
        targetDeliveryDate: this.formTargetDeliveryDate() || undefined,
        notes: this.formNotes().trim() || undefined,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          unitCode: l.unitCode || 'pcs',
          notes: l.notes || undefined,
        })),
      };

      const result = await this.salesService.createCustomerOrder(payload);
      this.successMessage.set(
        `Pesanan pelanggan ${result?.documentNumber || ''} berhasil dibuat!`
      );
      this.closeModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan saat menyimpan pesanan.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openDetailModal(order: CustomerOrder): void {
    this.selectedOrder.set(order);
    this.isDetailModalOpen.set(true);
  }

  closeDetailModal(): void {
    this.isDetailModalOpen.set(false);
    this.selectedOrder.set(null);
  }

  createInvoiceFromOrder(order: CustomerOrder): void {
    this.closeDetailModal();
    this.router.navigate(['/workspace/sales'], {
      queryParams: { poId: order.id, customerId: order.counterpartyId },
    });
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
