import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorCreditCard,
  phosphorCurrencyDollar,
  phosphorEye,
  phosphorFileText,
  phosphorMagnifyingGlass,
  phosphorReceipt,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { CompanyService } from '../../../core/services/company.service';
import {
  BusinessDocument,
  MasterRecord,
  PurchasingInventoryService,
} from '../../../core/services/purchasing-inventory.service';

@Component({
  selector: 'app-purchase-payments',
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
      phosphorFileText,
      phosphorCurrencyDollar,
    }),
  ],
  templateUrl: './purchase-payments.component.html',
})
export class PurchasePaymentsComponent {
  private readonly purchasingService = inject(PurchasingInventoryService);
  private readonly companyService = inject(CompanyService);

  readonly payablePurchases = signal<BusinessDocument[]>([]);
  readonly paymentHistory = signal<BusinessDocument[]>([]);
  readonly cashAccounts = signal<MasterRecord[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly activeTab = signal<'unpaid' | 'history'>('unpaid');
  readonly searchQuery = signal('');

  // Modal Pembayaran
  readonly isPayModalOpen = signal(false);
  readonly selectedPurchase = signal<BusinessDocument | null>(null);
  readonly formAmount = signal(0);
  readonly formCashAccountId = signal('');
  readonly formPaymentDate = signal(new Date().toISOString().slice(0, 10));
  readonly formNotes = signal('');
  readonly isSubmitting = signal(false);
  readonly formError = signal<string | null>(null);

  // Total Outstanding AP KPI
  readonly totalOutstanding = computed(() => {
    return this.payablePurchases().reduce((acc, doc) => {
      const remaining = Number(doc.total_amount) - Number(doc.paid_amount);
      return acc + (remaining > 0 ? remaining : 0);
    }, 0);
  });

  readonly filteredPurchases = computed(() => {
    const list = this.payablePurchases();
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;

    return list.filter((doc) => {
      const num = (doc.document_number || '').toLowerCase();
      const party = (doc as unknown as { counterparty?: { name: string } }).counterparty;
      const partyName = (party?.name || '').toLowerCase();
      return num.includes(q) || partyName.includes(q);
    });
  });

  readonly filteredHistory = computed(() => {
    const list = this.paymentHistory();
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;

    return list.filter((doc) => {
      const num = (doc.document_number || '').toLowerCase();
      const party = (doc as unknown as { counterparty?: { name: string } }).counterparty;
      const partyName = (party?.name || '').toLowerCase();
      return num.includes(q) || partyName.includes(q);
    });
  });

  constructor() {
    effect(() => {
      const companyId = this.companyService.activeCompanyId();
      if (companyId) {
        this.loadData();
      }
    });
  }

  async loadData(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const [payables, history, cash] = await Promise.all([
        this.purchasingService.getPayablePurchases(),
        this.purchasingService.getPaymentHistory(),
        this.purchasingService.getCashAccounts(),
      ]);
      this.payablePurchases.set(payables);
      this.paymentHistory.set(history);
      this.cashAccounts.set(cash);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat data pembayaran');
    } finally {
      this.isLoading.set(false);
    }
  }

  openPaymentModal(doc: BusinessDocument): void {
    const remaining = Number(doc.total_amount) - Number(doc.paid_amount);
    this.selectedPurchase.set(doc);
    this.formAmount.set(remaining);
    this.formCashAccountId.set(this.cashAccounts()[0]?.id || '');
    this.formPaymentDate.set(new Date().toISOString().slice(0, 10));
    this.formNotes.set(`Pelunasan pembelian ${doc.document_number || ''}`);
    this.formError.set(null);
    this.isPayModalOpen.set(true);
  }

  closePaymentModal(): void {
    this.selectedPurchase.set(null);
    this.isPayModalOpen.set(false);
    this.formError.set(null);
  }

  async submitPayment(): Promise<void> {
    const doc = this.selectedPurchase();
    if (!doc) return;

    const remaining = Number(doc.total_amount) - Number(doc.paid_amount);
    const amount = Number(this.formAmount());

    if (!this.formCashAccountId()) {
      this.formError.set('Pilih akun Kas/Bank sumber dana pembayaran.');
      return;
    }
    if (amount <= 0) {
      this.formError.set('Jumlah pembayaran harus lebih dari 0.');
      return;
    }
    if (amount > remaining) {
      this.formError.set(`Jumlah pembayaran tidak boleh melebihi sisa hutang (${this.formatCurrency(remaining)}).`);
      return;
    }

    this.isSubmitting.set(true);
    this.formError.set(null);

    try {
      const res = await this.purchasingService.payPurchase({
        purchaseId: doc.id,
        cashAccountId: this.formCashAccountId(),
        amount: amount,
        date: this.formPaymentDate(),
        notes: this.formNotes(),
      });

      this.successMessage.set(`Pembayaran berhasil dibukukan dengan nomor bukti: ${res.paymentNumber}`);
      this.closePaymentModal();
      await this.loadData();
      setTimeout(() => this.successMessage.set(null), 3000);
    } catch (err: unknown) {
      this.formError.set(err instanceof Error ? err.message : 'Gagal memproses pembayaran');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  formatCurrency(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
