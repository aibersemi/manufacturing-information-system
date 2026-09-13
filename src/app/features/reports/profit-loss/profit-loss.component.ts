import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCalendarBlank,
  phosphorChartBar,
  phosphorCheckCircle,
  phosphorTrendDown,
  phosphorTrendUp,
  phosphorWarningCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { ProfitLossSummary, ReportService } from '../../../core/services/report.service';

export type QuickPeriod = 'this_month' | 'this_quarter' | 'this_year' | 'custom';

@Component({
  selector: 'app-profit-loss',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorChartBar,
      phosphorArrowsClockwise,
      phosphorCalendarBlank,
      phosphorTrendUp,
      phosphorTrendDown,
      phosphorCheckCircle,
      phosphorWarningCircle,
    }),
  ],
  templateUrl: './profit-loss.component.html',
})
export class ProfitLossComponent implements OnInit {
  readonly reportService = inject(ReportService);

  readonly activePeriod = signal<QuickPeriod>('this_month');
  readonly dateFrom = signal<string>(this.reportService.dateFrom());
  readonly dateTo = signal<string>(this.reportService.dateTo());

  readonly profitLoss = computed<ProfitLossSummary | null>(() => this.reportService.profitLoss());
  readonly loading = computed(() => this.reportService.loading());

  ngOnInit(): void {
    this.setQuickPeriod('this_month');
  }

  setQuickPeriod(period: QuickPeriod): void {
    this.activePeriod.set(period);
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-11
    const pad = (n: number) => String(n).padStart(2, '0');

    if (period === 'this_month') {
      const from = `${year}-${pad(month + 1)}-01`;
      const to = `${year}-${pad(month + 1)}-${pad(now.getDate())}`;
      this.dateFrom.set(from);
      this.dateTo.set(to);
    } else if (period === 'this_quarter') {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      const from = `${year}-${pad(quarterStartMonth + 1)}-01`;
      const to = `${year}-${pad(month + 1)}-${pad(now.getDate())}`;
      this.dateFrom.set(from);
      this.dateTo.set(to);
    } else if (period === 'this_year') {
      const from = `${year}-01-01`;
      const to = `${year}-${pad(month + 1)}-${pad(now.getDate())}`;
      this.dateFrom.set(from);
      this.dateTo.set(to);
    }
    this.refreshData();
  }

  async refreshData(): Promise<void> {
    this.reportService.setDateRange(this.dateFrom(), this.dateTo());
    await this.reportService.loadProfitLoss(this.dateFrom(), this.dateTo());
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
