import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorBuilding,
  phosphorCalendarBlank,
  phosphorCheckCircle,
  phosphorCreditCard,
  phosphorEye,
  phosphorFileText,
  phosphorFunnel,
  phosphorMagnifyingGlass,
  phosphorMoney,
  phosphorPlus,
  phosphorReceipt,
  phosphorTrash,
  phosphorWarningCircle,
  phosphorX,
  phosphorXCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { CompanyService } from '../../../core/services/company.service';
import {
  FinanceService,
  OperatingExpenseDocument,
} from '../../../core/services/finance.service';
import { MasterDataService, MasterRecord } from '../../../core/services/master-data.service';

export interface ExpenseLineFormItem {
  accountId: string;
  description: string;
  amount: number | null;
}

@Component({
  selector: 'app-operating-expenses',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorReceipt,
      phosphorMoney,
      phosphorCreditCard,
      phosphorCalendarBlank,
      phosphorPlus,
      phosphorTrash,
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorFunnel,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorXCircle,
      phosphorX,
      phosphorEye,
      phosphorBuilding,
      phosphorFileText,
    }),
  ],
  templateUrl: './operating-expenses.component.html',
})
export class OperatingExpensesComponent implements OnInit {
  private readonly financeService = inject(FinanceService);
  private readonly masterDataService = inject(MasterDataService);
  private readonly companyService = inject(CompanyService);

  readonly operatingExpenses = computed(() => this.financeService.operatingExpenses());
  readonly cashAccounts = computed(() => this.financeService.cashAccounts());
  readonly ledgerAccounts = computed(() => this.financeService.ledgerAccounts());
  readonly isLoading = computed(() => this.financeService.loading());

  // Akun Beban GL yang aktif
  readonly expenseAccounts = computed(() =>
    this.ledgerAccounts().filter((a) => a.account_type === 'expense' && a.is_active)
  );

  readonly suppliers = signal<MasterRecord[]>([]);

  // Filter & Search
  readonly searchQuery = signal('');
  readonly statusFilter = signal<'all' | 'posted' | 'void'>('all');
  readonly fundingMethodFilter = signal<'all' | 'cash' | 'payable'>('all');

  // Feedback Messages
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal(false);

  // Modal Create
  readonly isCreateModalOpen = signal(false);
  readonly expenseDate = signal(new Date().toISOString().slice(0, 10));
  readonly fundingMethod = signal<'cash' | 'payable'>('cash');
  readonly selectedCashAccountId = signal('');
  readonly selectedSupplierId = signal('');
  readonly expenseNotes = signal('');
  readonly expenseLines = signal<ExpenseLineFormItem[]>([
    { accountId: '', description: '', amount: null },
  ]);

  // Modal Detail & Void
  readonly selectedExpenseForDetail = signal<OperatingExpenseDocument | null>(null);
  readonly selectedExpenseForVoid = signal<OperatingExpenseDocument | null>(null);
  readonly voidReason = signal('');

  // Metrik KPI
  readonly totalExpenseThisMonth = computed(() => {
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.operatingExpenses()
      .filter((e) => e.status === 'posted' && e.transactionDate.startsWith(currentYearMonth))
      .reduce((sum, e) => sum + e.totalAmount, 0);
  });

  readonly totalCashExpenses = computed(() =>
    this.operatingExpenses()
      .filter((e) => e.status === 'posted' && e.fundingMethod === 'cash')
      .reduce((sum, e) => sum + e.totalAmount, 0)
  );

  readonly totalPayableExpenses = computed(() =>
    this.operatingExpenses()
      .filter((e) => e.status === 'posted' && e.fundingMethod === 'payable')
      .reduce((sum, e) => sum + e.totalAmount, 0)
  );

  readonly totalVoidExpensesCount = computed(
    () => this.operatingExpenses().filter((e) => e.status === 'void').length
  );

  readonly totalFormAmount = computed(() =>
    this.expenseLines().reduce((sum, l) => sum + (l.amount || 0), 0)
  );

  readonly filteredExpenses = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const sf = this.statusFilter();
    const ff = this.fundingMethodFilter();

    return this.operatingExpenses().filter((e) => {
      const matchSearch =
        !q ||
        e.documentNumber.toLowerCase().includes(q) ||
        (e.notes && e.notes.toLowerCase().includes(q)) ||
        (e.supplierName && e.supplierName.toLowerCase().includes(q)) ||
        e.lines.some(
          (l) =>
            l.description.toLowerCase().includes(q) ||
            (l.accountName && l.accountName.toLowerCase().includes(q))
        );

      const matchStatus = sf === 'all' || e.status === sf;
      const matchFunding = ff === 'all' || e.fundingMethod === ff;

      return matchSearch && matchStatus && matchFunding;
    });
  });

  async ngOnInit(): Promise<void> {
    await this.refreshData();
  }

  async refreshData(): Promise<void> {
    this.errorMessage.set(null);
    try {
      const compId = this.companyService.activeCompanyId();
      const promises: Promise<unknown>[] = [
        this.financeService.loadOperatingExpenses(),
        this.financeService.loadCashAccounts(),
        this.financeService.loadLedgerAccounts(),
      ];
      if (compId) {
        promises.push(
          this.masterDataService.getSuppliers().then((sups) => {
            this.suppliers.set(sups || []);
          })
        );
      }
      await Promise.all(promises);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data biaya operasional.';
      this.errorMessage.set(msg);
    }
  }

  openCreateModal(): void {
    this.expenseDate.set(new Date().toISOString().slice(0, 10));
    this.fundingMethod.set('cash');
    const firstActiveCash = this.cashAccounts().find((a) => a.isActive);
    this.selectedCashAccountId.set(firstActiveCash ? firstActiveCash.id : '');
    this.selectedSupplierId.set('');
    this.expenseNotes.set('');
    this.expenseLines.set([{ accountId: '', description: '', amount: null }]);
    this.errorMessage.set(null);
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  addLine(): void {
    this.expenseLines.update((lines) => [
      ...lines,
      { accountId: '', description: '', amount: null },
    ]);
  }

  removeLine(index: number): void {
    if (this.expenseLines().length <= 1) return;
    this.expenseLines.update((lines) => lines.filter((_, i) => i !== index));
  }

  updateLine(index: number, patch: Partial<ExpenseLineFormItem>): void {
    this.expenseLines.update((lines) =>
      lines.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
    );
  }

  async submitExpense(): Promise<void> {
    const lines = this.expenseLines();
    const method = this.fundingMethod();
    const cashId = this.selectedCashAccountId();
    const supplierId = this.selectedSupplierId();
    const expDate = this.expenseDate();

    if (!expDate) {
      this.errorMessage.set('Tanggal transaksi wajib diisi.');
      return;
    }

    if (method === 'cash' && !cashId) {
      this.errorMessage.set('Rekening kas/bank wajib dipilih untuk metode tunai.');
      return;
    }

    if (lines.length === 0) {
      this.errorMessage.set('Minimal satu baris rincian biaya wajib diisi.');
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.accountId) {
        this.errorMessage.set(`Baris #${i + 1}: Akun beban GL wajib dipilih.`);
        return;
      }
      if (!l.description.trim()) {
        this.errorMessage.set(`Baris #${i + 1}: Deskripsi biaya wajib diisi.`);
        return;
      }
      if (!l.amount || l.amount <= 0) {
        this.errorMessage.set(`Baris #${i + 1}: Nominal harus lebih besar dari 0.`);
        return;
      }
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.financeService.postOperatingExpense({
        fundingMethod: method,
        cashAccountId: method === 'cash' ? cashId : undefined,
        supplierId: method === 'payable' && supplierId ? supplierId : undefined,
        expenseDate: expDate,
        notes: this.expenseNotes() || undefined,
        lines: lines.map((l) => ({
          account_id: l.accountId,
          description: l.description.trim(),
          amount: Number(l.amount),
        })),
      });

      this.successMessage.set('Biaya operasional berhasil dicatat dan diposting ke buku besar.');
      this.closeCreateModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan biaya operasional.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openDetailModal(expense: OperatingExpenseDocument): void {
    this.selectedExpenseForDetail.set(expense);
  }

  closeDetailModal(): void {
    this.selectedExpenseForDetail.set(null);
  }

  openVoidModal(expense: OperatingExpenseDocument): void {
    this.selectedExpenseForVoid.set(expense);
    this.voidReason.set('');
    this.errorMessage.set(null);
  }

  closeVoidModal(): void {
    this.selectedExpenseForVoid.set(null);
  }

  async submitVoid(): Promise<void> {
    const expense = this.selectedExpenseForVoid();
    const reason = this.voidReason().trim();

    if (!expense) return;
    if (!reason) {
      this.errorMessage.set('Alasan pembatalan (void) wajib diisi.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.financeService.voidOperatingExpense(expense.id, reason);

      this.successMessage.set(
        `Dokumen ${expense.documentNumber} berhasil dibatalkan (void) dan jurnal pembalik telah dibuat.`
      );
      this.closeVoidModal();
      if (this.selectedExpenseForDetail()?.id === expense.id) {
        this.closeDetailModal();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal membatalkan dokumen.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
