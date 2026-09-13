import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorBank,
  phosphorCalendarBlank,
  phosphorCheckCircle,
  phosphorClock,
  phosphorEye,
  phosphorFileText,
  phosphorHourglass,
  phosphorMagnifyingGlass,
  phosphorMoney,
  phosphorPlus,
  phosphorTrendUp,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  FinanceService,
  PrepaidExpenseItem,
} from '../../../core/services/finance.service';

@Component({
  selector: 'app-prepaid-expenses',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorHourglass,
      phosphorMoney,
      phosphorBank,
      phosphorCalendarBlank,
      phosphorPlus,
      phosphorClock,
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorX,
      phosphorEye,
      phosphorTrendUp,
      phosphorFileText,
    }),
  ],
  templateUrl: './prepaid-expenses.component.html',
})
export class PrepaidExpensesComponent implements OnInit {
  private readonly financeService = inject(FinanceService);

  readonly prepaidExpenses = computed(() => this.financeService.prepaidExpenses());
  readonly ledgerAccounts = computed(() => this.financeService.ledgerAccounts());
  readonly isLoading = computed(() => this.financeService.loading());

  // Akun Prepaid (Asset Lancar / Biaya Dibayar Dimuka)
  readonly assetAccounts = computed(() =>
    this.ledgerAccounts().filter((a) => a.account_type === 'asset' && a.is_active)
  );

  // Akun Beban Terkait (Beban Sewa, Asuransi, dll)
  readonly expenseAccounts = computed(() =>
    this.ledgerAccounts().filter((a) => a.account_type === 'expense' && a.is_active)
  );

  // Filter & Search
  readonly searchQuery = signal('');
  readonly statusFilter = signal<'all' | 'active' | 'completed'>('active');

  // Feedback Messages
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal(false);

  // Modal Create
  readonly isCreateModalOpen = signal(false);
  readonly description = signal('');
  readonly prepaidAccountId = signal('');
  readonly expenseAccountId = signal('');
  readonly startDate = signal(new Date().toISOString().slice(0, 10));
  readonly numberOfMonths = signal<number>(12);
  readonly originalAmount = signal<number | null>(null);

  // Modal Amortisasi
  readonly isAmortizeModalOpen = signal(false);
  readonly selectedPrepaidForAmortize = signal<PrepaidExpenseItem | null>(null);
  readonly amortizePeriodMonth = signal(new Date().toISOString().slice(0, 7)); // YYYY-MM

  // Modal Riwayat Entri
  readonly selectedPrepaidForHistory = signal<PrepaidExpenseItem | null>(null);

  // Metrik KPI
  readonly totalOriginalAmount = computed(() =>
    this.prepaidExpenses()
      .filter((p) => p.status === 'active')
      .reduce((sum, p) => sum + p.originalAmount, 0)
  );

  readonly totalAmortizedAmount = computed(() =>
    this.prepaidExpenses()
      .filter((p) => p.status === 'active')
      .reduce((sum, p) => sum + p.amortizedAmount, 0)
  );

  readonly totalRemainingAmount = computed(() =>
    this.prepaidExpenses()
      .filter((p) => p.status === 'active')
      .reduce((sum, p) => sum + p.remainingAmount, 0)
  );

  readonly activeContractsCount = computed(
    () => this.prepaidExpenses().filter((p) => p.status === 'active').length
  );

  // Filtered List
  readonly filteredExpenses = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const sf = this.statusFilter();

    return this.prepaidExpenses().filter((p) => {
      const matchSearch =
        !q ||
        p.description.toLowerCase().includes(q) ||
        p.prepaidAccountName.toLowerCase().includes(q) ||
        p.expenseAccountName.toLowerCase().includes(q);

      const matchStatus = sf === 'all' || p.status === sf;

      return matchSearch && matchStatus;
    });
  });

  async ngOnInit(): Promise<void> {
    await this.refreshData();
  }

  async refreshData(): Promise<void> {
    this.errorMessage.set(null);
    try {
      await Promise.all([
        this.financeService.loadPrepaidExpenses(),
        this.financeService.loadLedgerAccounts(),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data biaya dibayar dimuka.';
      this.errorMessage.set(msg);
    }
  }

  openCreateModal(): void {
    this.description.set('');
    this.prepaidAccountId.set('');
    this.expenseAccountId.set('');
    this.startDate.set(new Date().toISOString().slice(0, 10));
    this.numberOfMonths.set(12);
    this.originalAmount.set(null);
    this.errorMessage.set(null);
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  calculateMonthlyEstimate(): number {
    const total = this.originalAmount() || 0;
    const months = this.numberOfMonths() || 1;
    return months > 0 ? Math.round(total / months) : 0;
  }

  async submitCreate(): Promise<void> {
    const desc = this.description().trim();
    const pAcc = this.prepaidAccountId();
    const eAcc = this.expenseAccountId();
    const sDate = this.startDate();
    const months = this.numberOfMonths();
    const amt = this.originalAmount();

    if (!desc) {
      this.errorMessage.set('Deskripsi kontrak biaya dibayar dimuka wajib diisi.');
      return;
    }

    if (!pAcc) {
      this.errorMessage.set('Akun Prepaid (Aset) wajib dipilih.');
      return;
    }

    if (!eAcc) {
      this.errorMessage.set('Akun Beban terkait wajib dipilih.');
      return;
    }

    if (!sDate) {
      this.errorMessage.set('Tanggal mulai kontrak wajib diisi.');
      return;
    }

    if (!months || months <= 0) {
      this.errorMessage.set('Durasi amortisasi (bulan) harus lebih dari 0.');
      return;
    }

    if (!amt || amt <= 0) {
      this.errorMessage.set('Nilai kontrak harus lebih dari 0.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.financeService.createPrepaidExpense({
        description: desc,
        prepaidAccountId: pAcc,
        expenseAccountId: eAcc,
        startDate: sDate,
        numberOfMonths: months,
        originalAmount: amt,
      });

      this.successMessage.set('Kontrak biaya dibayar dimuka berhasil didaftarkan.');
      this.closeCreateModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mendaftarkan kontrak.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openAmortizeModal(item: PrepaidExpenseItem): void {
    this.selectedPrepaidForAmortize.set(item);
    this.amortizePeriodMonth.set(new Date().toISOString().slice(0, 7));
    this.errorMessage.set(null);
    this.isAmortizeModalOpen.set(true);
  }

  closeAmortizeModal(): void {
    this.selectedPrepaidForAmortize.set(null);
    this.isAmortizeModalOpen.set(false);
  }

  isPeriodAlreadyAmortized(item: PrepaidExpenseItem, period: string): boolean {
    return (item.entries || []).some((e) => e.periodMonth === period);
  }

  async submitAmortize(): Promise<void> {
    const item = this.selectedPrepaidForAmortize();
    const period = this.amortizePeriodMonth();

    if (!item) return;

    if (!period) {
      this.errorMessage.set('Bulan periode amortisasi wajib diisi (format YYYY-MM).');
      return;
    }

    if (this.isPeriodAlreadyAmortized(item, period)) {
      this.errorMessage.set(`Periode ${period} sudah diamortisasi sebelumnya untuk kontrak ini.`);
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.financeService.postPrepaidAmortization(item.id, period);

      this.successMessage.set(
        `Amortisasi periode ${period} untuk ${item.description} berhasil diposting ke buku besar.`
      );
      this.closeAmortizeModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses amortisasi.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openHistoryModal(item: PrepaidExpenseItem): void {
    this.selectedPrepaidForHistory.set(item);
  }

  closeHistoryModal(): void {
    this.selectedPrepaidForHistory.set(null);
  }

  getAmortizeMonthlyAmount(): number {
    const p = this.selectedPrepaidForAmortize();
    if (!p) return 0;
    const months = p.numberOfMonths || 1;
    return Math.round(p.originalAmount / months);
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
