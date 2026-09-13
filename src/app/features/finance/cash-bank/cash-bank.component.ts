import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorArrowsLeftRight,
  phosphorBank,
  phosphorCheckCircle,
  phosphorCreditCard,
  phosphorFunnel,
  phosphorMagnifyingGlass,
  phosphorMoney,
  phosphorPlus,
  phosphorReceipt,
  phosphorTrendDown,
  phosphorTrendUp,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  FinanceService,
} from '../../../core/services/finance.service';

@Component({
  selector: 'app-cash-bank',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorBank,
      phosphorMoney,
      phosphorCreditCard,
      phosphorArrowsLeftRight,
      phosphorArrowsClockwise,
      phosphorPlus,
      phosphorMagnifyingGlass,
      phosphorFunnel,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorX,
      phosphorTrendUp,
      phosphorTrendDown,
      phosphorReceipt,
    }),
  ],
  templateUrl: './cash-bank.component.html',
})
export class CashBankComponent implements OnInit {
  private readonly financeService = inject(FinanceService);

  readonly cashAccounts = computed(() => this.financeService.cashAccounts());
  readonly cashMovements = computed(() => this.financeService.cashMovements());
  readonly cashTransfers = computed(() => this.financeService.cashTransfers());
  readonly isLoading = computed(() => this.financeService.loading());

  // Filter & Search
  readonly searchQuery = signal('');
  readonly selectedAccountFilter = signal<string>('all');
  readonly movementTypeFilter = signal<string>('all');
  readonly activeView = signal<'movements' | 'transfers'>('movements');

  // Feedback Messages
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal(false);

  // Transfer Modal
  readonly isTransferModalOpen = signal(false);
  readonly transferSourceId = signal('');
  readonly transferDestinationId = signal('');
  readonly transferAmount = signal<number | null>(null);
  readonly transferDate = signal(new Date().toISOString().slice(0, 10));
  readonly transferNotes = signal('');

  // Metrik KPI
  readonly totalCashBalance = computed(() =>
    this.cashAccounts().reduce((sum, a) => sum + (a.isActive ? a.balance : 0), 0)
  );

  readonly activeAccountsCount = computed(
    () => this.cashAccounts().filter((a) => a.isActive).length
  );

  readonly totalTransfersCount = computed(() => this.cashTransfers().length);

  readonly filteredMovements = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const accId = this.selectedAccountFilter();
    const mt = this.movementTypeFilter();

    return this.cashMovements().filter((m) => {
      const matchSearch =
        !q ||
        m.cashAccountName.toLowerCase().includes(q) ||
        (m.notes && m.notes.toLowerCase().includes(q));

      const matchAccount = accId === 'all' || m.cashAccountId === accId;
      const matchType =
        mt === 'all' ||
        (mt === 'in' &&
          ['receipt', 'revenue', 'income', 'opening_balance', 'transfer_in'].includes(
            m.movementType
          )) ||
        (mt === 'out' &&
          ['expense', 'disbursement', 'transfer_out'].includes(m.movementType));

      return matchSearch && matchAccount && matchType;
    });
  });

  async ngOnInit(): Promise<void> {
    await this.refreshData();
  }

  async refreshData(): Promise<void> {
    this.errorMessage.set(null);
    try {
      await Promise.all([
        this.financeService.loadCashAccounts(),
        this.financeService.loadCashMovements(),
        this.financeService.loadCashTransfers(),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data kas & bank.';
      this.errorMessage.set(msg);
    }
  }

  openTransferModal(): void {
    this.transferSourceId.set('');
    this.transferDestinationId.set('');
    this.transferAmount.set(null);
    this.transferDate.set(new Date().toISOString().slice(0, 10));
    this.transferNotes.set('');
    this.errorMessage.set(null);
    this.isTransferModalOpen.set(true);
  }

  closeTransferModal(): void {
    this.isTransferModalOpen.set(false);
  }

  getSourceAccountBalance(): number {
    const srcId = this.transferSourceId();
    if (!srcId) return 0;
    const found = this.cashAccounts().find((a) => a.id === srcId);
    return found ? found.balance : 0;
  }

  async submitTransfer(): Promise<void> {
    const src = this.transferSourceId();
    const dst = this.transferDestinationId();
    const amt = this.transferAmount();
    const dt = this.transferDate();

    if (!src || !dst) {
      this.errorMessage.set('Rekening sumber dan rekening tujuan wajib dipilih.');
      return;
    }

    if (src === dst) {
      this.errorMessage.set('Rekening sumber dan rekening tujuan tidak boleh sama.');
      return;
    }

    if (!amt || amt <= 0) {
      this.errorMessage.set('Nominal transfer harus lebih besar dari 0.');
      return;
    }

    const currentBalance = this.getSourceAccountBalance();
    if (currentBalance < amt) {
      this.errorMessage.set(
        `Saldo rekening sumber tidak mencukupi (Saldo: Rp ${currentBalance.toLocaleString()}, Diperlukan: Rp ${amt.toLocaleString()}).`
      );
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.financeService.postCashTransfer({
        sourceCashId: src,
        destinationCashId: dst,
        amount: amt,
        transferDate: dt,
        notes: this.transferNotes() || undefined,
      });

      this.successMessage.set('Transfer antar rekening kas/bank berhasil diposting.');
      this.closeTransferModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses transfer.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }

  isIncomeMovement(movementType: string): boolean {
    return ['receipt', 'revenue', 'income', 'opening_balance', 'transfer_in'].includes(
      movementType
    );
  }
}
