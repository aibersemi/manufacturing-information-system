import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCalendarBlank,
  phosphorCheckCircle,
  phosphorFunnel,
  phosphorMagnifyingGlass,
  phosphorScales,
  phosphorWarningCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { ReportService } from '../../../core/services/report.service';

@Component({
  selector: 'app-trial-balance',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorScales,
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorFunnel,
      phosphorCalendarBlank,
      phosphorCheckCircle,
      phosphorWarningCircle,
    }),
  ],
  templateUrl: './trial-balance.component.html',
})
export class TrialBalanceComponent implements OnInit {
  readonly reportService = inject(ReportService);

  readonly dateFrom = signal<string>(this.reportService.dateFrom());
  readonly dateTo = signal<string>(this.reportService.dateTo());
  readonly searchQuery = signal<string>('');
  readonly selectedLevel1 = signal<string>('ALL');

  readonly trialBalance = computed(() => this.reportService.trialBalance());
  readonly loading = computed(() => this.reportService.loading());

  readonly filteredAccounts = computed(() => {
    const data = this.trialBalance();
    if (!data?.accounts) return [];

    let list = data.accounts;
    const query = this.searchQuery().toLowerCase().trim();
    const l1 = this.selectedLevel1();

    if (l1 !== 'ALL') {
      list = list.filter((acc) => acc.level1 === l1);
    }

    if (query) {
      list = list.filter(
        (acc) =>
          acc.code.toLowerCase().includes(query) ||
          acc.name.toLowerCase().includes(query) ||
          acc.level2.toLowerCase().includes(query) ||
          acc.level3.toLowerCase().includes(query)
      );
    }

    return list;
  });

  readonly availableLevels = computed(() => {
    const data = this.trialBalance();
    if (!data?.accounts) return [];
    const levels = new Set<string>();
    data.accounts.forEach((acc) => {
      if (acc.level1) levels.add(acc.level1);
    });
    return Array.from(levels).sort();
  });

  ngOnInit(): void {
    this.refreshData();
  }

  async refreshData(): Promise<void> {
    this.reportService.setDateRange(this.dateFrom(), this.dateTo());
    await this.reportService.loadTrialBalance(this.dateFrom(), this.dateTo());
  }

  setLevelFilter(level: string): void {
    this.selectedLevel1.set(level);
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
