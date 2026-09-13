import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorBank,
  phosphorCheckCircle,
  phosphorCreditCard,
  phosphorCurrencyDollar,
  phosphorEye,
  phosphorFileText,
  phosphorHandCoins,
  phosphorMagnifyingGlass,
  phosphorPlus,
  phosphorReceipt,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  PostSalesReceiptPayload,
  SalesInvoice,
  SalesService,
} from '../../../core/services/sales.service';
import { Tables } from '../../../../types/database.types';

@Component({
  selector: 'app-sales-receipts',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorEye,
      phosphorX,
      phosphorCreditCard,
      phosphorReceipt,
      phosphorHandCoins,
      phosphorBank,
      phosphorCurrencyDollar,
      phosphorPlus,
      phosphorFileText,
    }),
  ],
  templateUrl: './sales-receipts.component.html',
})
export class SalesReceiptsComponent implements OnInit {
  private readonly salesService = inject(SalesService);

  readonly receivableInvoices = computed(() => this.salesService.receivableInvoices());
  readonly receipts = computed(() => this.salesService.salesReceipts());
  readonly isLoading = computed(() => this.salesService.loading());
  readonly cashAccounts = signal<Tables<'master_record'>[]>([]);

  readonly activeTab = signal<'outstanding' | 'history'>('outstanding');
  readonly searchQuery = signal('');

  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Modal State
  readonly isPayModalOpen = signal(false);
  readonly selectedInvoice = signal<SalesInvoice | null>(null);
  readonly formAmount = signal<number>(0);
  readonly formCashAccountId = signal<string>('');
  readonly formReceiptDate = signal<string>(new Date().toISOString().slice(0, 10));
  readonly formNotes = signal<string>('');
  readonly isSubmitting = signal<boolean>(false);
  readonly formError = signal<string | null>(null);

  // KPI Computations
  readonly totalOutstandingAR = computed(() =>
    this.receivableInvoices().reduce((sum, inv) => sum + inv.outstandingAmount, 0)
  );

  readonly totalReceiptsAmount = computed(() =>
    this.receipts().reduce((sum, r) => sum + r.amount, 0)
  );

  readonly outstandingInvoicesCount = computed(() => this.receivableInvoices().length);

  readonly filteredInvoices = computed(() => {
    const list = this.receivableInvoices();
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) return list;

    return list.filter(
      (inv) =>
        (inv.documentNumber && inv.documentNumber.toLowerCase().includes(query)) ||
        inv.customerName.toLowerCase().includes(query) ||
        (inv.sourceOrderNumber && inv.sourceOrderNumber.toLowerCase().includes(query))
    );
  });

  readonly filteredReceipts = computed(() => {
    const list = this.receipts();
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) return list;

    return list.filter(
      (r) =>
        r.receiptNumber.toLowerCase().includes(query) ||
        r.customerName.toLowerCase().includes(query) ||
        (r.invoiceNumber && r.invoiceNumber.toLowerCase().includes(query)) ||
        (r.cashAccountName && r.cashAccountName.toLowerCase().includes(query))
    );
  });

  async ngOnInit(): Promise<void> {
    await this.loadInitialData();
  }

  async loadInitialData(): Promise<void> {
    try {
      this.errorMessage.set(null);
      const [cashAccounts] = await Promise.all([
        this.salesService.getCashAccounts(),
        this.salesService.getReceivableInvoices(),
        this.salesService.getReceiptHistory(),
      ]);
      this.cashAccounts.set(cashAccounts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data piutang.';
      this.errorMessage.set(msg);
    }
  }

  async refreshData(): Promise<void> {
    try {
      this.errorMessage.set(null);
      await Promise.all([
        this.salesService.getReceivableInvoices(),
        this.salesService.getReceiptHistory(),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyegarkan data piutang.';
      this.errorMessage.set(msg);
    }
  }

  openPayModal(invoice: SalesInvoice): void {
    this.selectedInvoice.set(invoice);
    this.formAmount.set(invoice.outstandingAmount);
    this.formCashAccountId.set(this.cashAccounts()[0]?.id || '');
    this.formReceiptDate.set(new Date().toISOString().slice(0, 10));
    this.formNotes.set(`Penerimaan pembayaran faktur ${invoice.documentNumber || ''}`);
    this.formError.set(null);
    this.isPayModalOpen.set(true);
  }

  closePayModal(): void {
    this.isPayModalOpen.set(false);
    this.selectedInvoice.set(null);
    this.formError.set(null);
  }

  setFullAmount(): void {
    const inv = this.selectedInvoice();
    if (inv) {
      this.formAmount.set(inv.outstandingAmount);
    }
  }

  async submitPayment(): Promise<void> {
    this.formError.set(null);
    const invoice = this.selectedInvoice();
    if (!invoice) return;

    const amount = Number(this.formAmount());
    if (isNaN(amount) || amount <= 0) {
      this.formError.set('Jumlah pembayaran harus lebih besar dari Rp 0.');
      return;
    }

    if (amount > invoice.outstandingAmount) {
      this.formError.set(
        `Jumlah pembayaran (${this.formatRupiah(amount)}) tidak boleh melebihi sisa piutang (${this.formatRupiah(invoice.outstandingAmount)}).`
      );
      return;
    }

    const cashAccountId = this.formCashAccountId();
    if (!cashAccountId) {
      this.formError.set('Pilih akun Kas/Bank penerima.');
      return;
    }

    this.isSubmitting.set(true);
    try {
      const payload: PostSalesReceiptPayload = {
        invoiceId: invoice.id,
        cashAccountId,
        amount,
        date: this.formReceiptDate(),
        notes: this.formNotes().trim() || undefined,
      };

      const result = await this.salesService.payInvoice(payload);
      this.successMessage.set(
        `Pembayaran berhasil dicatat dengan bukti kas masuk ${result?.receiptNumber || ''}!`
      );
      this.closePayModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan saat memproses penerimaan piutang.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
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
