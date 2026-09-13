import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorBookOpen,
  phosphorCheck,
  phosphorCheckCircle,
  phosphorFunnel,
  phosphorMagnifyingGlass,
  phosphorPencilSimple,
  phosphorPlus,
  phosphorShieldCheck,
  phosphorSliders,
  phosphorWarningCircle,
  phosphorX,
  phosphorXCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  FinanceService,
  LedgerAccount,
  ReportAccountMappingItem,
} from '../../../core/services/finance.service';
import { CompanyService } from '../../../core/services/company.service';

@Component({
  selector: 'app-coa',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorBookOpen,
      phosphorPlus,
      phosphorMagnifyingGlass,
      phosphorArrowsClockwise,
      phosphorCheck,
      phosphorCheckCircle,
      phosphorXCircle,
      phosphorWarningCircle,
      phosphorX,
      phosphorShieldCheck,
      phosphorSliders,
      phosphorFunnel,
      phosphorPencilSimple,
    }),
  ],
  templateUrl: './coa.component.html',
})
export class CoaComponent implements OnInit {
  private readonly financeService = inject(FinanceService);
  private readonly companyService = inject(CompanyService);

  readonly activeTab = signal<'accounts' | 'system' | 'report'>('accounts');
  readonly accounts = computed(() => this.financeService.ledgerAccounts());
  readonly systemMappings = computed(() => this.financeService.systemMappings());
  readonly reportMappings = computed(() => this.financeService.reportMappings());
  readonly isLoading = computed(() => this.financeService.loading());

  readonly searchQuery = signal('');
  readonly typeFilter = signal<string>('all');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');

  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSaving = signal(false);

  // System mapping form state
  readonly editedSystemMappings = signal<Record<string, string>>({});

  // Report mapping form state
  readonly editedReportMappings = signal<
    Record<
      string,
      {
        managementPost: ReportAccountMappingItem['managementPost'];
        cashFlowActivity: ReportAccountMappingItem['cashFlowActivity'];
        cashFlowGroup: string | null;
      }
    >
  >({});

  // Modal toggle status confirmation
  readonly isToggleStatusModalOpen = signal(false);
  readonly selectedAccountForToggle = signal<LedgerAccount | null>(null);

  readonly filteredAccounts = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const type = this.typeFilter();
    const status = this.statusFilter();

    return this.accounts().filter((acc) => {
      const matchSearch =
        !q ||
        acc.code.toLowerCase().includes(q) ||
        acc.name.toLowerCase().includes(q) ||
        acc.level1.toLowerCase().includes(q) ||
        acc.level2.toLowerCase().includes(q);

      const matchType = type === 'all' || acc.account_type === type;
      const matchStatus =
        status === 'all' ||
        (status === 'active' && acc.is_active) ||
        (status === 'inactive' && !acc.is_active);

      return matchSearch && matchType && matchStatus;
    });
  });

  // Metrik COA
  readonly totalAccounts = computed(() => this.accounts().length);
  readonly activeAccountsCount = computed(
    () => this.accounts().filter((a) => a.is_active).length
  );
  readonly systemMappedCount = computed(
    () => this.systemMappings().filter((m) => m.accountId && m.isCompatible).length
  );

  async ngOnInit(): Promise<void> {
    await this.refreshData();
  }

  async refreshData(): Promise<void> {
    this.errorMessage.set(null);
    try {
      await Promise.all([
        this.financeService.loadLedgerAccounts(),
        this.financeService.loadAccountingMappings(),
        this.financeService.loadReportAccountMappings(),
      ]);
      this.initMappingState();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data bagan akun.';
      this.errorMessage.set(msg);
    }
  }

  private initMappingState(): void {
    const sysState: Record<string, string> = {};
    for (const m of this.systemMappings()) {
      if (m.accountId) sysState[m.mappingKey] = m.accountId;
    }
    this.editedSystemMappings.set(sysState);

    const repState: Record<
      string,
      {
        managementPost: ReportAccountMappingItem['managementPost'];
        cashFlowActivity: ReportAccountMappingItem['cashFlowActivity'];
        cashFlowGroup: string | null;
      }
    > = {};
    for (const r of this.reportMappings()) {
      repState[r.accountId] = {
        managementPost: r.managementPost,
        cashFlowActivity: r.cashFlowActivity,
        cashFlowGroup: r.cashFlowGroup,
      };
    }
    this.editedReportMappings.set(repState);
  }

  openToggleStatusModal(account: LedgerAccount): void {
    this.selectedAccountForToggle.set(account);
    this.isToggleStatusModalOpen.set(true);
  }

  closeToggleStatusModal(): void {
    this.selectedAccountForToggle.set(null);
    this.isToggleStatusModalOpen.set(false);
  }

  async confirmToggleStatus(): Promise<void> {
    const account = this.selectedAccountForToggle();
    if (!account) return;

    this.isSaving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const nextStatus = !account.is_active;
      await this.financeService.updateAccountStatus(account.id, nextStatus);
      this.successMessage.set(
        `Akun ${account.code} - ${account.name} berhasil ${nextStatus ? 'diaktifkan' : 'dinonaktifkan'}.`
      );
      this.closeToggleStatusModal();
      await this.financeService.loadAccountingMappings();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengubah status akun.';
      this.errorMessage.set(msg);
    } finally {
      this.isSaving.set(false);
    }
  }

  updateSystemMappingSelection(mappingKey: string, accountId: string): void {
    this.editedSystemMappings.update((prev) => ({
      ...prev,
      [mappingKey]: accountId,
    }));
  }

  async saveSystemMappings(): Promise<void> {
    this.isSaving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const payload = Object.entries(this.editedSystemMappings()).map(
        ([mapping_key, account_id]) => ({
          mapping_key,
          account_id,
        })
      );

      await this.financeService.saveAccountingMappings(payload);
      this.successMessage.set('21 Pemetaan akun sistem berhasil disimpan secara atomik.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan pemetaan sistem.';
      this.errorMessage.set(msg);
    } finally {
      this.isSaving.set(false);
    }
  }

  updateReportPost(
    accountId: string,
    post: ReportAccountMappingItem['managementPost']
  ): void {
    this.editedReportMappings.update((prev) => ({
      ...prev,
      [accountId]: {
        ...prev[accountId],
        managementPost: post,
      },
    }));
  }

  updateReportCfActivity(
    accountId: string,
    activity: ReportAccountMappingItem['cashFlowActivity']
  ): void {
    this.editedReportMappings.update((prev) => ({
      ...prev,
      [accountId]: {
        ...prev[accountId],
        cashFlowActivity: activity,
        cashFlowGroup: null, // Reset group jika activity berubah
      },
    }));
  }

  updateReportCfGroup(accountId: string, group: string | null): void {
    this.editedReportMappings.update((prev) => ({
      ...prev,
      [accountId]: {
        ...prev[accountId],
        cashFlowGroup: group,
      },
    }));
  }

  async saveReportMappings(): Promise<void> {
    this.isSaving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const payload = Object.entries(this.editedReportMappings()).map(
        ([account_id, data]) => ({
          account_id,
          management_post: data.managementPost || null,
          cash_flow_activity: data.cashFlowActivity || null,
          cash_flow_group: data.cashFlowGroup || null,
        })
      );

      await this.financeService.saveReportAccountMappings(payload);
      this.successMessage.set('Konfigurasi pemetaan laporan berhasil disimpan.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan pemetaan laporan.';
      this.errorMessage.set(msg);
    } finally {
      this.isSaving.set(false);
    }
  }

  getCompatibleAccountsForSystemMapping(type: string): LedgerAccount[] {
    return this.accounts().filter((a) => a.account_type === type && a.is_active);
  }

  formatAccountTypeLabel(type: string): string {
    switch (type) {
      case 'asset':
        return 'Aktiva (Asset)';
      case 'liability':
        return 'Kewajiban (Liability)';
      case 'equity':
        return 'Modal (Equity)';
      case 'revenue':
        return 'Pendapatan (Revenue)';
      case 'expense':
        return 'Beban (Expense)';
      default:
        return type;
    }
  }
}
