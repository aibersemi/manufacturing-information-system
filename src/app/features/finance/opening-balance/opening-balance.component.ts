import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorBookOpen,
  phosphorCheckCircle,
  phosphorEye,
  phosphorFileText,
  phosphorMagnifyingGlass,
  phosphorMoney,
  phosphorScales,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  FinanceService,
  OpeningBalanceDocument,
} from '../../../core/services/finance.service';

export interface OpeningBalanceRowItem {
  accountId: string;
  code: string;
  name: string;
  accountType: 'asset' | 'liability' | 'equity';
  debit: number | null;
  credit: number | null;
  description: string;
}

@Component({
  selector: 'app-opening-balance',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorScales,
      phosphorBookOpen,
      phosphorMoney,
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorX,
      phosphorEye,
      phosphorFileText,
    }),
  ],
  templateUrl: './opening-balance.component.html',
})
export class OpeningBalanceComponent implements OnInit {
  private readonly financeService = inject(FinanceService);

  readonly openingBalances = computed(() => this.financeService.openingBalances());
  readonly ledgerAccounts = computed(() => this.financeService.ledgerAccounts());
  readonly isLoading = computed(() => this.financeService.loading());

  // Akun Neraca (Aset, Kewajiban, Ekuitas)
  readonly balanceSheetAccounts = computed(() =>
    this.ledgerAccounts().filter(
      (a) =>
        ['asset', 'liability', 'equity'].includes(a.account_type) &&
        a.code !== '3-3.0.00' &&
        a.is_active
    )
  );

  // View state: 'editor' atau 'history'
  readonly activeView = signal<'editor' | 'history'>('editor');

  // Filter & Search di editor
  readonly searchQuery = signal('');
  readonly typeFilter = signal<'all' | 'asset' | 'liability' | 'equity'>('all');

  // Feedback Messages
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal(false);

  // Form State
  readonly balanceDate = signal(new Date().toISOString().slice(0, 10));
  readonly balanceNotes = signal('Saldo awal inisialisasi neraca dan kas pembukuan');
  readonly accountRows = signal<OpeningBalanceRowItem[]>([]);

  // Detail Modal
  readonly selectedDocumentForDetail = signal<OpeningBalanceDocument | null>(null);

  // Metrik Real-time Balancing
  readonly totalDebit = computed(() =>
    this.accountRows().reduce((sum, r) => sum + (r.debit || 0), 0)
  );

  readonly totalCredit = computed(() =>
    this.accountRows().reduce((sum, r) => sum + (r.credit || 0), 0)
  );

  readonly balanceDifference = computed(() =>
    Math.abs(this.totalDebit() - this.totalCredit())
  );

  readonly isBalanced = computed(
    () => this.totalDebit() > 0 && this.totalDebit() === this.totalCredit()
  );

  // Filtered Rows for Editor Table
  readonly filteredRows = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const tf = this.typeFilter();

    return this.accountRows().filter((r) => {
      const matchSearch =
        !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
      const matchType = tf === 'all' || r.accountType === tf;
      return matchSearch && matchType;
    });
  });

  async ngOnInit(): Promise<void> {
    await this.refreshData();
  }

  async refreshData(): Promise<void> {
    this.errorMessage.set(null);
    try {
      await Promise.all([
        this.financeService.loadLedgerAccounts(),
        this.financeService.loadOpeningBalances(),
      ]);
      this.initAccountRows();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data saldo awal.';
      this.errorMessage.set(msg);
    }
  }

  initAccountRows(): void {
    const accounts = this.balanceSheetAccounts();
    const existingRowsMap = new Map(this.accountRows().map((r) => [r.accountId, r]));

    const newRows: OpeningBalanceRowItem[] = accounts.map((acc) => {
      const existing = existingRowsMap.get(acc.id);
      return {
        accountId: acc.id,
        code: acc.code,
        name: acc.name,
        accountType: acc.account_type as 'asset' | 'liability' | 'equity',
        debit: existing?.debit ?? null,
        credit: existing?.credit ?? null,
        description: existing?.description ?? '',
      };
    });

    this.accountRows.set(newRows);
  }

  updateRow(accountId: string, patch: Partial<OpeningBalanceRowItem>): void {
    this.accountRows.update((rows) =>
      rows.map((r) => (r.accountId === accountId ? { ...r, ...patch } : r))
    );
  }

  resetEditor(): void {
    this.initAccountRows();
    this.balanceNotes.set('Saldo awal inisialisasi neraca dan kas pembukuan');
    this.errorMessage.set(null);
  }

  async submitOpeningBalance(): Promise<void> {
    if (!this.isBalanced()) {
      this.errorMessage.set(
        `Jurnal saldo awal harus seimbang (Total Debit = Total Kredit). Selisih saat ini: ${this.formatRupiah(this.balanceDifference())}.`
      );
      return;
    }

    const filledLines = this.accountRows().filter(
      (r) => (r.debit && r.debit > 0) || (r.credit && r.credit > 0)
    );

    if (filledLines.length === 0) {
      this.errorMessage.set('Isi setidaknya satu baris saldo debit dan kredit.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.financeService.postOpeningBalance({
        balanceDate: this.balanceDate(),
        notes: this.balanceNotes() || undefined,
        lines: filledLines.map((r) => ({
          account_id: r.accountId,
          debit: r.debit || 0,
          credit: r.credit || 0,
          description: r.description.trim() || undefined,
        })),
      });

      this.successMessage.set('Saldo awal neraca dan kas berhasil diposting ke buku besar.');
      this.activeView.set('history');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memposting saldo awal.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openDetailModal(doc: OpeningBalanceDocument): void {
    this.selectedDocumentForDetail.set(doc);
  }

  closeDetailModal(): void {
    this.selectedDocumentForDetail.set(null);
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }

  translateAccountType(type: string): string {
    const map: Record<string, string> = {
      asset: 'Aset / Aktiva',
      liability: 'Kewajiban / Hutang',
      equity: 'Ekuitas / Modal',
    };
    return map[type] || type;
  }
}
