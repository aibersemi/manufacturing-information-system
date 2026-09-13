import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowDownLeft,
  phosphorArrowUpRight,
  phosphorArrowsClockwise,
  phosphorBank,
  phosphorCalendarBlank,
  phosphorCheckCircle,
  phosphorTrendDown,
  phosphorTrendUp,
  phosphorWarningCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { CashFlowSummary, ReportService } from '../../../core/services/report.service';

@Component({
  selector: 'app-cash-flow',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorBank,
      phosphorArrowsClockwise,
      phosphorCalendarBlank,
      phosphorTrendUp,
      phosphorTrendDown,
      phosphorArrowDownLeft,
      phosphorArrowUpRight,
      phosphorCheckCircle,
      phosphorWarningCircle,
    }),
  ],
  templateUrl: './cash-flow.component.html',
})
export class CashFlowComponent implements OnInit {
  readonly reportService = inject(ReportService);

  readonly dateFrom = signal<string>(this.reportService.dateFrom());
  readonly dateTo = signal<string>(this.reportService.dateTo());

  readonly cashFlow = computed<CashFlowSummary | null>(() => this.reportService.cashFlow());
  readonly loading = computed(() => this.reportService.loading());

  ngOnInit(): void {
    this.refreshData();
  }

  async refreshData(): Promise<void> {
    this.reportService.setDateRange(this.dateFrom(), this.dateTo());
    await this.reportService.loadCashFlow(this.dateFrom(), this.dateTo());
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
