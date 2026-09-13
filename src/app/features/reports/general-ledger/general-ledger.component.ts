import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorBookOpen,
  phosphorCalendarBlank,
  phosphorFileText,
  phosphorMagnifyingGlass,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  CoaAccountOption,
  GeneralLedgerReport,
  ReportService,
} from '../../../core/services/report.service';

@Component({
  selector: 'app-general-ledger',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorBookOpen,
      phosphorArrowsClockwise,
      phosphorCalendarBlank,
      phosphorMagnifyingGlass,
      phosphorFileText,
    }),
  ],
  templateUrl: './general-ledger.component.html',
})
export class GeneralLedgerComponent implements OnInit {
  readonly reportService = inject(ReportService);

  readonly selectedAccountId = signal<string | null>(null);
  readonly dateFrom = signal<string>(this.reportService.dateFrom());
  readonly dateTo = signal<string>(this.reportService.dateTo());
  readonly accountSearch = signal<string>('');

  readonly availableAccounts = computed<CoaAccountOption[]>(() =>
    this.reportService.availableAccounts()
  );
  readonly generalLedger = computed<GeneralLedgerReport | null>(() =>
    this.reportService.generalLedger()
  );
  readonly loading = computed(() => this.reportService.loading());

  readonly filteredAccounts = computed(() => {
    const list = this.availableAccounts();
    const query = this.accountSearch().toLowerCase().trim();
    if (!query) return list;
    return list.filter(
      (acc) =>
        acc.code.toLowerCase().includes(query) ||
        acc.name.toLowerCase().includes(query) ||
        acc.level3.toLowerCase().includes(query)
    );
  });

  async ngOnInit(): Promise<void> {
    const accounts = await this.reportService.loadAvailableAccounts();
    if (accounts.length > 0 && !this.selectedAccountId()) {
      this.selectedAccountId.set(accounts[0].id);
      this.refreshData();
    }
  }

  onAccountSelected(accountId: string): void {
    this.selectedAccountId.set(accountId);
    this.refreshData();
  }

  async refreshData(): Promise<void> {
    const accId = this.selectedAccountId();
    if (!accId) return;
    this.reportService.setDateRange(this.dateFrom(), this.dateTo());
    await this.reportService.loadGeneralLedger(accId, this.dateFrom(), this.dateTo(), 100, 0);
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
