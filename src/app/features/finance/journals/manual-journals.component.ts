import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorArrowsLeftRight,
  phosphorBookOpen,
  phosphorCheckCircle,
  phosphorEye,
  phosphorFileText,
  phosphorFunnel,
  phosphorMagnifyingGlass,
  phosphorMoney,
  phosphorPlus,
  phosphorScales,
  phosphorTrash,
  phosphorWarningCircle,
  phosphorX,
  phosphorXCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  FinanceService,
  ManualJournalItem,
} from '../../../core/services/finance.service';

export interface JournalLineFormItem {
  accountId: string;
  debit: number | null;
  credit: number | null;
  description: string;
}

@Component({
  selector: 'app-manual-journals',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorBookOpen,
      phosphorScales,
      phosphorMoney,
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
      phosphorFileText,
      phosphorArrowsLeftRight,
    }),
  ],
  templateUrl: './manual-journals.component.html',
})
export class ManualJournalsComponent implements OnInit {
  private readonly financeService = inject(FinanceService);

  readonly manualJournals = computed(() => this.financeService.manualJournals());
  readonly ledgerAccounts = computed(() => this.financeService.ledgerAccounts());
  readonly isLoading = computed(() => this.financeService.loading());

  // Akun GL yang diizinkan (seluruh akun aktif kecuali akun virtual presentation 3-3.0.00)
  readonly allowedAccounts = computed(() =>
    this.ledgerAccounts().filter((a) => a.is_active && a.code !== '3-3.0.00')
  );

  // Filter & Search
  readonly searchQuery = signal('');
  readonly statusFilter = signal<'all' | 'posted' | 'reversed' | 'reversal'>('all');

  // Feedback Messages
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal(false);

  // Modal Create
  readonly isCreateModalOpen = signal(false);
  readonly transactionDate = signal(new Date().toISOString().slice(0, 10));
  readonly journalDescription = signal('');
  readonly journalLines = signal<JournalLineFormItem[]>([
    { accountId: '', debit: null, credit: null, description: '' },
    { accountId: '', debit: null, credit: null, description: '' },
  ]);

  // Modal Detail & Reverse
  readonly selectedJournalForDetail = signal<ManualJournalItem | null>(null);
  readonly selectedJournalForReverse = signal<ManualJournalItem | null>(null);
  readonly reverseReason = signal('');

  // Metrik KPI
  readonly totalPostedJournalsCount = computed(
    () => this.manualJournals().filter((j) => j.status === 'posted').length
  );

  readonly totalReversalsCount = computed(
    () => this.manualJournals().filter((j) => j.status === 'reversed' || !!j.reversalOfId).length
  );

  readonly totalMemorialValueThisMonth = computed(() => {
    const now = new Date();
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.manualJournals()
      .filter((j) => j.transactionDate.startsWith(curMonth) && j.status === 'posted')
      .reduce((sum, j) => {
        const debitSum = j.lines.reduce((lSum, l) => lSum + l.debit, 0);
        return sum + debitSum;
      }, 0);
  });

  // Real-time Balancing in Form
  readonly totalFormDebit = computed(() =>
    this.journalLines().reduce((sum, l) => sum + (l.debit || 0), 0)
  );

  readonly totalFormCredit = computed(() =>
    this.journalLines().reduce((sum, l) => sum + (l.credit || 0), 0)
  );

  readonly formDifference = computed(() =>
    Math.abs(this.totalFormDebit() - this.totalFormCredit())
  );

  readonly isFormBalanced = computed(
    () => this.totalFormDebit() > 0 && this.totalFormDebit() === this.totalFormCredit()
  );

  // Filtered Journals List
  readonly filteredJournals = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const sf = this.statusFilter();

    return this.manualJournals().filter((j) => {
      const matchSearch =
        !q ||
        j.entryNumber.toLowerCase().includes(q) ||
        (j.description && j.description.toLowerCase().includes(q)) ||
        (j.memo && j.memo.toLowerCase().includes(q)) ||
        j.lines.some(
          (l) =>
            l.accountCode.toLowerCase().includes(q) ||
            l.accountName.toLowerCase().includes(q) ||
            (l.description && l.description.toLowerCase().includes(q))
        );

      let matchStatus = true;
      if (sf === 'posted') {
        matchStatus = j.status === 'posted' && !j.reversalOfId;
      } else if (sf === 'reversed') {
        matchStatus = j.status === 'reversed';
      } else if (sf === 'reversal') {
        matchStatus = !!j.reversalOfId;
      }

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
        this.financeService.loadManualJournals(),
        this.financeService.loadLedgerAccounts(),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat daftar jurnal memorial.';
      this.errorMessage.set(msg);
    }
  }

  openCreateModal(): void {
    this.transactionDate.set(new Date().toISOString().slice(0, 10));
    this.journalDescription.set('');
    this.journalLines.set([
      { accountId: '', debit: null, credit: null, description: '' },
      { accountId: '', debit: null, credit: null, description: '' },
    ]);
    this.errorMessage.set(null);
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  addLine(): void {
    this.journalLines.update((lines) => [
      ...lines,
      { accountId: '', debit: null, credit: null, description: '' },
    ]);
  }

  removeLine(index: number): void {
    if (this.journalLines().length <= 2) return;
    this.journalLines.update((lines) => lines.filter((_, i) => i !== index));
  }

  updateLine(index: number, patch: Partial<JournalLineFormItem>): void {
    this.journalLines.update((lines) =>
      lines.map((item, idx) => {
        if (idx !== index) return item;
        const updated = { ...item, ...patch };
        // Jika mengisi debit, kosongkan credit jika sebelumnya ada
        if (patch.debit !== undefined && patch.debit !== null && patch.debit > 0) {
          updated.credit = null;
        }
        // Jika mengisi credit, kosongkan debit jika sebelumnya ada
        if (patch.credit !== undefined && patch.credit !== null && patch.credit > 0) {
          updated.debit = null;
        }
        return updated;
      })
    );
  }

  async submitJournal(): Promise<void> {
    const desc = this.journalDescription().trim();
    const date = this.transactionDate();
    const lines = this.journalLines();

    if (!desc) {
      this.errorMessage.set('Deskripsi / keterangan jurnal memorial wajib diisi.');
      return;
    }

    if (!date) {
      this.errorMessage.set('Tanggal transaksi jurnal wajib diisi.');
      return;
    }

    if (!this.isFormBalanced()) {
      this.errorMessage.set(
        `Jurnal harus seimbang (Total Debit = Total Kredit). Selisih: ${this.formatRupiah(this.formDifference())}.`
      );
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.accountId) {
        this.errorMessage.set(`Baris #${i + 1}: Akun GL wajib dipilih.`);
        return;
      }
      const hasDebit = l.debit && l.debit > 0;
      const hasCredit = l.credit && l.credit > 0;
      if (!hasDebit && !hasCredit) {
        this.errorMessage.set(`Baris #${i + 1}: Masukkan nominal debit atau kredit.`);
        return;
      }
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.financeService.postManualJournal({
        transactionDate: date,
        description: desc,
        lines: lines.map((l) => ({
          account_id: l.accountId,
          debit: l.debit || 0,
          credit: l.credit || 0,
          description: l.description.trim() || undefined,
        })),
      });

      this.successMessage.set('Jurnal memorial berhasil diposting ke buku besar.');
      this.closeCreateModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memposting jurnal memorial.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openReverseModal(journal: ManualJournalItem): void {
    this.selectedJournalForReverse.set(journal);
    this.reverseReason.set('');
    this.errorMessage.set(null);
  }

  closeReverseModal(): void {
    this.selectedJournalForReverse.set(null);
  }

  async submitReverse(): Promise<void> {
    const j = this.selectedJournalForReverse();
    const reason = this.reverseReason().trim();

    if (!j) return;
    if (!reason) {
      this.errorMessage.set('Alasan pembalikan jurnal wajib diisi.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.financeService.reverseManualJournal(j.id, reason);

      this.successMessage.set(
        `Jurnal ${j.entryNumber} berhasil dibalik dengan nomor pembalik baru.`
      );
      this.closeReverseModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal membalik jurnal.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openDetailModal(journal: ManualJournalItem): void {
    this.selectedJournalForDetail.set(journal);
  }

  closeDetailModal(): void {
    this.selectedJournalForDetail.set(null);
  }

  getJournalTotalAmount(journal: ManualJournalItem): number {
    return journal.lines.reduce((sum, l) => sum + l.debit, 0);
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
