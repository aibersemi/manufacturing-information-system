import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorCreditCard,
  phosphorEye,
  phosphorFileText,
  phosphorMagnifyingGlass,
  phosphorPackage,
  phosphorPlus,
  phosphorPrinter,
  phosphorReceipt,
  phosphorTrash,
  phosphorTrendUp,
  phosphorWarningCircle,
  phosphorX,
  phosphorXCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  CreateSalesInvoicePayload,
  CustomerOrder,
  SalesInvoice,
  SalesService,
} from '../../../core/services/sales.service';
import { Tables } from '../../../../types/database.types';

interface InvoiceLineForm {
  itemId: string;
  quantity: number;
  unitPrice: number;
  unitCode: string;
  maxAvailableQty?: number;
  notes?: string;
  fallbackUnitCost?: number;
}

@Component({
  selector: 'app-sales-invoices',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorPlus,
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorCheckCircle,
      phosphorXCircle,
      phosphorWarningCircle,
      phosphorEye,
      phosphorTrash,
      phosphorX,
      phosphorCreditCard,
      phosphorReceipt,
      phosphorPackage,
      phosphorFileText,
      phosphorTrendUp,
      phosphorPrinter,
    }),
  ],
  templateUrl: './sales-invoices.component.html',
})
export class SalesInvoicesComponent implements OnInit {
  private readonly salesService = inject(SalesService);
  private readonly route = inject(ActivatedRoute);

  readonly invoices = computed(() => this.salesService.salesInvoices());
  readonly isLoading = computed(() => this.salesService.loading());
  readonly customers = signal<Tables<'master_record'>[]>([]);
  readonly products = signal<Tables<'master_record'>[]>([]);
  readonly cashAccounts = signal<Tables<'master_record'>[]>([]);
  readonly openOrders = signal<CustomerOrder[]>([]);

  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Search & Filter
  readonly searchQuery = signal('');
  readonly statusFilter = signal<'all' | 'draft' | 'posted' | 'void'>('all');
  readonly paymentStatusFilter = signal<'all' | 'unpaid' | 'partial' | 'paid'>('all');

  // Modal State
  readonly isModalOpen = signal(false);
  readonly isDetailModalOpen = signal(false);
  readonly selectedInvoice = signal<SalesInvoice | null>(null);
  readonly isSubmitting = signal(false);
  readonly formError = signal<string | null>(null);

  // Void Modal State
  readonly isVoidModalOpen = signal(false);
  readonly voidInvoiceId = signal<string | null>(null);
  readonly voidInvoiceNumber = signal<string | null>(null);
  readonly voidReason = signal('');

  // Form Fields
  readonly formSourceType = signal<'direct' | 'po'>('direct');
  readonly formPoId = signal('');
  readonly formCustomerId = signal('');
  readonly formInvoiceDate = signal(new Date().toISOString().slice(0, 10));
  readonly formFundingMethod = signal<'receivable' | 'cash'>('receivable');
  readonly formCashAccountId = signal('');
  readonly formNotes = signal('');
  readonly formLines = signal<InvoiceLineForm[]>([
    {
      itemId: '',
      quantity: 1,
      unitPrice: 50000,
      unitCode: 'pcs',
      notes: '',
      fallbackUnitCost: 0,
    },
  ]);

  // KPI Computations
  readonly totalSalesAmount = computed(() =>
    this.invoices()
      .filter((inv) => inv.status === 'posted')
      .reduce((sum, inv) => sum + inv.totalAmount, 0)
  );

  readonly totalOutstandingAR = computed(() =>
    this.invoices()
      .filter((inv) => inv.status === 'posted')
      .reduce((sum, inv) => sum + inv.outstandingAmount, 0)
  );

  readonly postedInvoicesCount = computed(
    () => this.invoices().filter((inv) => inv.status === 'posted').length
  );

  readonly filteredInvoices = computed(() => {
    const list = this.invoices();
    const query = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();
    const payStatus = this.paymentStatusFilter();

    return list.filter((inv) => {
      const matchStatus = status === 'all' || inv.status === status;
      if (!matchStatus) return false;

      if (payStatus !== 'all') {
        if (payStatus === 'unpaid' && inv.paymentStatus !== 'Belum Dibayar') return false;
        if (payStatus === 'partial' && inv.paymentStatus !== 'Sebagian Dibayar') return false;
        if (payStatus === 'paid' && inv.paymentStatus !== 'Lunas') return false;
      }

      if (!query) return true;
      const num = (inv.documentNumber || 'draft').toLowerCase();
      const customer = inv.customerName.toLowerCase();
      const sourcePo = (inv.sourceOrderNumber || '').toLowerCase();
      const notes = (inv.notes || '').toLowerCase();
      return (
        num.includes(query) ||
        customer.includes(query) ||
        sourcePo.includes(query) ||
        notes.includes(query)
      );
    });
  });

  async ngOnInit(): Promise<void> {
    await this.loadInitialData();

    // Cek jika diarahkan dari Customer PO dengan query param
    this.route.queryParams.subscribe((params) => {
      if (params['poId']) {
        this.openCreateModalWithPo(params['poId'], params['customerId']);
      }
    });
  }

  async loadInitialData(): Promise<void> {
    try {
      this.errorMessage.set(null);
      const [customers, products, cashAccounts, orders] = await Promise.all([
        this.salesService.getActiveCustomers(),
        this.salesService.getActiveProducts(),
        this.salesService.getCashAccounts(),
        this.salesService.getCustomerOrders(),
        this.salesService.getSalesInvoices(),
      ]);
      this.customers.set(customers);
      this.products.set(products);
      this.cashAccounts.set(cashAccounts);
      this.openOrders.set(orders.filter((o) => o.deliveryStatus !== 'full_delivery'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data faktur penjualan.';
      this.errorMessage.set(msg);
    }
  }

  async refreshData(): Promise<void> {
    try {
      this.errorMessage.set(null);
      await this.salesService.getSalesInvoices();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyegarkan data.';
      this.errorMessage.set(msg);
    }
  }

  openCreateModal(): void {
    this.formSourceType.set('direct');
    this.formPoId.set('');
    this.formCustomerId.set(this.customers()[0]?.id || '');
    this.formInvoiceDate.set(new Date().toISOString().slice(0, 10));
    this.formFundingMethod.set('receivable');
    this.formCashAccountId.set(this.cashAccounts()[0]?.id || '');
    this.formNotes.set('');
    this.formLines.set([
      {
        itemId: this.products()[0]?.id || '',
        quantity: 1,
        unitPrice: 50000,
        unitCode: 'pcs',
        notes: '',
        fallbackUnitCost: 0,
      },
    ]);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  openCreateModalWithPo(poId: string, customerId?: string): void {
    this.openCreateModal();
    this.formSourceType.set('po');
    this.formPoId.set(poId);
    if (customerId) {
      this.formCustomerId.set(customerId);
    }
    this.onPoSelected(poId);
  }

  onPoSelected(poId: string): void {
    if (!poId) return;
    const po = this.openOrders().find((o) => o.id === poId);
    if (po) {
      this.formCustomerId.set(po.counterpartyId);
      if (po.lines && po.lines.length > 0) {
        this.formLines.set(
          po.lines.map((l) => ({
            itemId: l.item_id || '',
            quantity: Number(l.quantity),
            unitPrice: Number(l.unit_price),
            unitCode: l.unit_code || 'pcs',
            maxAvailableQty: Number(l.quantity),
            notes: ((l.data as Record<string, unknown> | null)?.['notes'] as string) || '',
            fallbackUnitCost: 0,
          }))
        );
      }
    }
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
        quantity: 1,
        unitPrice: 50000,
        unitCode: 'pcs',
        notes: '',
        fallbackUnitCost: 0,
      },
    ]);
  }

  removeLine(index: number): void {
    if (this.formLines().length <= 1) {
      this.formError.set('Faktur wajib memiliki minimal satu baris produk.');
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

  async submitInvoiceDraft(): Promise<void> {
    this.formError.set(null);

    const customerId = this.formCustomerId();
    if (!customerId) {
      this.formError.set('Pelanggan wajib dipilih.');
      return;
    }

    const fundingMethod = this.formFundingMethod();
    if (fundingMethod === 'cash' && !this.formCashAccountId()) {
      this.formError.set('Akun Kas/Bank wajib dipilih untuk penjualan tunai.');
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
      if (line.maxAvailableQty && line.quantity > line.maxAvailableQty) {
        this.formError.set(
          `Kuantitas baris ${i + 1} (${line.quantity}) melebihi pesanan (${line.maxAvailableQty}).`
        );
        return;
      }
    }

    this.isSubmitting.set(true);
    try {
      const payload: CreateSalesInvoicePayload = {
        customerId,
        poId: this.formSourceType() === 'po' ? this.formPoId() || null : null,
        invoiceDate: this.formInvoiceDate(),
        fundingMethod,
        cashAccountId: fundingMethod === 'cash' ? this.formCashAccountId() : null,
        notes: this.formNotes().trim() || undefined,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          unitCode: l.unitCode || 'pcs',
          notes: l.notes || undefined,
          fallbackUnitCost: l.fallbackUnitCost || 0,
        })),
      };

      const result = await this.salesService.createSalesInvoiceDraft(payload);
      this.successMessage.set('Draf faktur penjualan berhasil disimpan!');
      this.closeModal();

      // Opsional: tanyakan apakah mau langsung diposting
      if (result?.id) {
        await this.salesService.getSalesInvoices();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan saat menyimpan faktur.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async postInvoice(invoiceId: string): Promise<void> {
    if (!confirm('Apakah Anda yakin ingin memposting faktur penjualan ini? Stok barang jadi akan dikurangi dan jurnal penjualan serta HPP akan dibukukan secara atomik.')) {
      return;
    }

    this.errorMessage.set(null);
    try {
      const result = await this.salesService.postSalesInvoice(invoiceId);
      this.successMessage.set(
        `Faktur resmi ${result?.documentNumber || ''} berhasil diposting! Stok dan jurnal telah diperbarui.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memposting faktur penjualan.';
      this.errorMessage.set(msg);
    }
  }

  openVoidModal(invoice: SalesInvoice): void {
    this.voidInvoiceId.set(invoice.id);
    this.voidInvoiceNumber.set(invoice.documentNumber || 'Draf');
    this.voidReason.set('');
    this.isVoidModalOpen.set(true);
  }

  closeVoidModal(): void {
    this.isVoidModalOpen.set(false);
    this.voidInvoiceId.set(null);
    this.voidInvoiceNumber.set(null);
    this.voidReason.set('');
  }

  async confirmVoid(): Promise<void> {
    const id = this.voidInvoiceId();
    const reason = this.voidReason().trim();

    if (!id) return;
    if (!reason) {
      alert('Alasan pembatalan faktur wajib diisi.');
      return;
    }

    this.isSubmitting.set(true);
    try {
      await this.salesService.voidSalesInvoice(id, reason);
      this.successMessage.set(
        `Faktur ${this.voidInvoiceNumber() || ''} berhasil dibatalkan (void). Stok dan jurnal pembalik telah dicatat.`
      );
      this.closeVoidModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal membatalkan faktur penjualan.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openDetailModal(invoice: SalesInvoice): void {
    this.selectedInvoice.set(invoice);
    this.isDetailModalOpen.set(true);
  }

  closeDetailModal(): void {
    this.isDetailModalOpen.set(false);
    this.selectedInvoice.set(null);
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
