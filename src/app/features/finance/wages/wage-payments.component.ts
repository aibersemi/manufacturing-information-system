import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorBank,
  phosphorCheckCircle,
  phosphorCurrencyDollar,
  phosphorFileText,
  phosphorFunnel,
  phosphorMagnifyingGlass,
  phosphorMoney,
  phosphorScissors,
  phosphorUser,
  phosphorUsers,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  FinanceService,
  WageLiabilityItem,
} from '../../../core/services/finance.service';

@Component({
  selector: 'app-wage-payments',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorCurrencyDollar,
      phosphorMoney,
      phosphorBank,
      phosphorUser,
      phosphorUsers,
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorFunnel,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorX,
      phosphorFileText,
      phosphorScissors,
    }),
  ],
  templateUrl: './wage-payments.component.html',
})
export class WagePaymentsComponent implements OnInit {
  private readonly financeService = inject(FinanceService);

  readonly wageLiabilities = computed(() => this.financeService.wageLiabilities());
  readonly cashAccounts = computed(() => this.financeService.cashAccounts());
  readonly isLoading = computed(() => this.financeService.loading());

  // Filter & Search
  readonly searchQuery = signal('');
  readonly statusFilter = signal<'unpaid' | 'paid' | 'all'>('unpaid');
  readonly serviceKindFilter = signal<string>('all');
  readonly selectedEmployeeFilter = signal<string>('all');

  // Multi-select for Payment
  readonly selectedLiabilityIds = signal<string[]>([]);

  // Feedback Messages
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal(false);

  // Payment Modal
  readonly isPaymentModalOpen = signal(false);
  readonly paymentDate = signal(new Date().toISOString().slice(0, 10));
  readonly selectedCashAccountId = signal('');
  readonly paymentNotes = signal('');

  // Daftar Pekerja Unik dari Liabilities
  readonly uniqueEmployees = computed(() => {
    const map = new Map<string, string>();
    for (const item of this.wageLiabilities()) {
      if (!map.has(item.employeeId)) {
        map.set(item.employeeId, item.employeeName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  });

  // Metrik KPI
  readonly totalUnpaidLiability = computed(() =>
    this.wageLiabilities()
      .filter((w) => !w.isPaid)
      .reduce((sum, w) => sum + w.outstandingAmount, 0)
  );

  readonly totalPaidAmount = computed(() =>
    this.wageLiabilities()
      .filter((w) => w.isPaid)
      .reduce((sum, w) => sum + w.grossAmount, 0)
  );

  readonly unpaidOperatorsCount = computed(() => {
    const set = new Set<string>();
    for (const w of this.wageLiabilities()) {
      if (!w.isPaid) {
        set.add(w.employeeId);
      }
    }
    return set.size;
  });

  readonly totalLiabilitiesCount = computed(() => this.wageLiabilities().length);

  // Filtered List
  readonly filteredLiabilities = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const sf = this.statusFilter();
    const kf = this.serviceKindFilter();
    const ef = this.selectedEmployeeFilter();

    return this.wageLiabilities().filter((w) => {
      const matchSearch =
        !q ||
        w.employeeName.toLowerCase().includes(q) ||
        w.serviceKind.toLowerCase().includes(q) ||
        (w.sourceDocumentNumber && w.sourceDocumentNumber.toLowerCase().includes(q));

      const matchStatus =
        sf === 'all' || (sf === 'unpaid' && !w.isPaid) || (sf === 'paid' && w.isPaid);

      const matchKind = kf === 'all' || w.serviceKind.toLowerCase() === kf.toLowerCase();
      const matchEmp = ef === 'all' || w.employeeId === ef;

      return matchSearch && matchStatus && matchKind && matchEmp;
    });
  });

  // Selected Items Detail
  readonly selectedLiabilitiesList = computed(() => {
    const ids = new Set(this.selectedLiabilityIds());
    return this.wageLiabilities().filter((w) => ids.has(w.id));
  });

  readonly selectedTotalAmount = computed(() =>
    this.selectedLiabilitiesList().reduce((sum, w) => sum + w.outstandingAmount, 0)
  );

  readonly activeSelectedEmployee = computed(() => {
    const list = this.selectedLiabilitiesList();
    if (list.length === 0) return null;
    return { id: list[0].employeeId, name: list[0].employeeName };
  });

  async ngOnInit(): Promise<void> {
    await this.refreshData();
  }

  async refreshData(): Promise<void> {
    this.errorMessage.set(null);
    try {
      await Promise.all([
        this.financeService.loadWageLiabilities(),
        this.financeService.loadCashAccounts(),
      ]);
      // Reset seleksi jika data dimuat ulang
      this.selectedLiabilityIds.set([]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat kewajiban upah.';
      this.errorMessage.set(msg);
    }
  }

  toggleSelectLiability(item: WageLiabilityItem): void {
    if (item.isPaid) return;

    const current = this.selectedLiabilityIds();
    const exists = current.includes(item.id);

    if (exists) {
      this.selectedLiabilityIds.set(current.filter((id) => id !== item.id));
    } else {
      // Validasi: seluruh item yang dipilih harus dari operator yang sama
      const activeEmp = this.activeSelectedEmployee();
      if (activeEmp && activeEmp.id !== item.employeeId) {
        this.errorMessage.set(
          `Satu voucher pembayaran kas keluar hanya untuk satu operator. Saat ini Anda memilih item untuk ${activeEmp.name}. Hapus seleksi sebelumnya jika ingin memilih operator lain.`
        );
        return;
      }
      this.errorMessage.set(null);
      this.selectedLiabilityIds.set([...current, item.id]);
    }
  }

  isLiabilitySelected(id: string): boolean {
    return this.selectedLiabilityIds().includes(id);
  }

  canSelectLiability(item: WageLiabilityItem): boolean {
    if (item.isPaid) return false;
    const activeEmp = this.activeSelectedEmployee();
    if (!activeEmp) return true;
    return activeEmp.id === item.employeeId;
  }

  selectAllForOperator(empId: string): void {
    const unpaids = this.wageLiabilities().filter(
      (w) => w.employeeId === empId && !w.isPaid
    );
    this.selectedLiabilityIds.set(unpaids.map((w) => w.id));
    this.errorMessage.set(null);
  }

  clearSelection(): void {
    this.selectedLiabilityIds.set([]);
  }

  openPaymentModal(): void {
    if (this.selectedLiabilityIds().length === 0) {
      this.errorMessage.set('Pilih minimal satu kewajiban upah yang akan dibayar.');
      return;
    }

    const firstActiveCash = this.cashAccounts().find((a) => a.isActive);
    this.selectedCashAccountId.set(firstActiveCash ? firstActiveCash.id : '');
    this.paymentDate.set(new Date().toISOString().slice(0, 10));
    this.paymentNotes.set(
      `Pembayaran upah borongan untuk ${this.activeSelectedEmployee()?.name || 'Operator'}`
    );
    this.errorMessage.set(null);
    this.isPaymentModalOpen.set(true);
  }

  closePaymentModal(): void {
    this.isPaymentModalOpen.set(false);
  }

  getSelectedAccountBalance(): number {
    const id = this.selectedCashAccountId();
    if (!id) return 0;
    const found = this.cashAccounts().find((a) => a.id === id);
    return found ? found.balance : 0;
  }

  async submitPayment(): Promise<void> {
    const emp = this.activeSelectedEmployee();
    const cashId = this.selectedCashAccountId();
    const ids = this.selectedLiabilityIds();
    const amt = this.selectedTotalAmount();
    const date = this.paymentDate();

    if (!emp || ids.length === 0) {
      this.errorMessage.set('Tidak ada kewajiban upah yang dipilih.');
      return;
    }

    if (!cashId) {
      this.errorMessage.set('Rekening kas/bank pembayar wajib dipilih.');
      return;
    }

    if (this.getSelectedAccountBalance() < amt) {
      this.errorMessage.set(
        `Saldo rekening kas tidak mencukupi (Saldo: ${this.formatRupiah(this.getSelectedAccountBalance())}, Diperlukan: ${this.formatRupiah(amt)}).`
      );
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.financeService.postWagePayment({
        employeeId: emp.id,
        cashAccountId: cashId,
        paymentDate: date,
        liabilityIds: ids,
        notes: this.paymentNotes() || undefined,
      });

      this.successMessage.set(
        `Pembayaran upah sebesar ${this.formatRupiah(amt)} untuk ${emp.name} berhasil diposting.`
      );
      this.clearSelection();
      this.closePaymentModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses pembayaran upah.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }

  translateServiceKind(kind: string): string {
    const map: Record<string, string> = {
      cutting: 'Potong (Cutting)',
      printing: 'Sablon (Printing)',
      sewing: 'Jahit (Sewing)',
      finishing: 'Finishing',
      qc: 'Pemeriksaan QC',
      packing: 'Packing & Lipat',
    };
    return map[kind.toLowerCase()] || kind;
  }
}
