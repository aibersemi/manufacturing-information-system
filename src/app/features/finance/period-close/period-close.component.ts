import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCalendarBlank,
  phosphorCheckCircle,
  phosphorClock,
  phosphorHourglass,
  phosphorLock,
  phosphorLockOpen,
  phosphorMagnifyingGlass,
  phosphorScales,
  phosphorShieldCheck,
  phosphorWarningCircle,
  phosphorX,
  phosphorXCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { CompanyService } from '../../../core/services/company.service';
import {
  AccountingPeriodItem,
  FinanceService,
  PeriodIntegrityCheckResult,
} from '../../../core/services/finance.service';

@Component({
  selector: 'app-period-close',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorLock,
      phosphorLockOpen,
      phosphorShieldCheck,
      phosphorCalendarBlank,
      phosphorArrowsClockwise,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorXCircle,
      phosphorX,
      phosphorClock,
      phosphorHourglass,
      phosphorScales,
      phosphorMagnifyingGlass,
    }),
  ],
  templateUrl: './period-close.component.html',
})
export class PeriodCloseComponent implements OnInit {
  private readonly financeService = inject(FinanceService);
  private readonly companyService = inject(CompanyService);

  readonly accountingPeriods = computed(() => this.financeService.accountingPeriods());
  readonly activePeriod = computed(() => this.financeService.activePeriod());
  readonly isLoading = computed(() => this.financeService.loading());
  readonly isOwner = computed(() => this.companyService.isOwner());

  // Period Selection for Verification
  readonly selectedPeriodMonth = signal<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
  readonly integrityCheckResult = signal<PeriodIntegrityCheckResult | null>(null);
  readonly isChecking = signal(false);

  // Modal States
  readonly isCloseModalOpen = signal(false);
  readonly closeNotes = signal('');

  readonly isReopenModalOpen = signal(false);
  readonly selectedPeriodForReopen = signal<AccountingPeriodItem | null>(null);
  readonly reopenReason = signal('');

  // Feedback Messages
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal(false);

  // Metrik KPI
  readonly openPeriodsCount = computed(
    () => this.accountingPeriods().filter((p) => p.status === 'open').length
  );

  readonly closedPeriodsCount = computed(
    () => this.accountingPeriods().filter((p) => p.status === 'closed').length
  );

  readonly currentPeriodStatus = computed(() => {
    const cur = this.selectedPeriodMonth();
    const found = this.accountingPeriods().find((p) => p.periodMonth === cur);
    return found ? found.status : 'open';
  });

  async ngOnInit(): Promise<void> {
    await this.refreshData();
  }

  async refreshData(): Promise<void> {
    this.errorMessage.set(null);
    try {
      await this.financeService.loadAccountingPeriods();
      await this.runIntegrityCheck();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data periode akuntansi.';
      this.errorMessage.set(msg);
    }
  }

  async runIntegrityCheck(): Promise<void> {
    const month = this.selectedPeriodMonth();
    if (!month) return;

    this.isChecking.set(true);
    this.errorMessage.set(null);

    try {
      const result = await this.financeService.checkPeriodIntegrity(month);
      this.integrityCheckResult.set(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menjalankan audit integritas periode.';
      this.errorMessage.set(msg);
    } finally {
      this.isChecking.set(false);
    }
  }

  onMonthChange(newMonth: string): void {
    this.selectedPeriodMonth.set(newMonth);
    this.runIntegrityCheck();
  }

  openCloseModal(): void {
    const result = this.integrityCheckResult();
    if (!result || !result.canClose) {
      this.errorMessage.set('Seluruh pemeriksaan integritas harus lolos sebelum periode dapat ditutup.');
      return;
    }
    this.closeNotes.set(`Penutupan buku periode ${this.selectedPeriodMonth()}`);
    this.errorMessage.set(null);
    this.isCloseModalOpen.set(true);
  }

  closeCloseModal(): void {
    this.isCloseModalOpen.set(false);
  }

  async submitClose(): Promise<void> {
    const month = this.selectedPeriodMonth();
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.financeService.closePeriod(month);
      this.successMessage.set(`Periode akuntansi ${month} berhasil ditutup dan dikunci.`);
      this.closeCloseModal();
      await this.runIntegrityCheck();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menutup periode akuntansi.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openReopenModal(period: AccountingPeriodItem): void {
    if (!this.isOwner()) {
      this.errorMessage.set('Hanya Owner perusahaan yang memiliki otorisasi untuk membuka kembali periode buku.');
      return;
    }
    this.selectedPeriodForReopen.set(period);
    this.reopenReason.set('');
    this.errorMessage.set(null);
    this.isReopenModalOpen.set(true);
  }

  closeReopenModal(): void {
    this.selectedPeriodForReopen.set(null);
    this.isReopenModalOpen.set(false);
  }

  async submitReopen(): Promise<void> {
    const period = this.selectedPeriodForReopen();
    const reason = this.reopenReason().trim();

    if (!period) return;
    if (!reason) {
      this.errorMessage.set('Alasan pembukaan kembali periode wajib diisi untuk audit trail.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.financeService.reopenPeriod(period.periodMonth, reason);
      this.successMessage.set(`Periode ${period.periodMonth} berhasil dibuka kembali.`);
      this.closeReopenModal();
      await this.runIntegrityCheck();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal membuka kembali periode.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
