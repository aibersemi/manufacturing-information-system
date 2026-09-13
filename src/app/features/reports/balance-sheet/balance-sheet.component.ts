import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCalendarBlank,
  phosphorCheckCircle,
  phosphorScales,
  phosphorWarningCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { BalanceSheetSummary, ReportService } from '../../../core/services/report.service';

@Component({
  selector: 'app-balance-sheet',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorScales,
      phosphorArrowsClockwise,
      phosphorCalendarBlank,
      phosphorCheckCircle,
      phosphorWarningCircle,
    }),
  ],
  templateUrl: './balance-sheet.component.html',
})
export class BalanceSheetComponent implements OnInit {
  readonly reportService = inject(ReportService);

  readonly asOfDate = signal<string>(this.reportService.dateTo());

  readonly balanceSheet = computed<BalanceSheetSummary | null>(() => this.reportService.balanceSheet());
  readonly loading = computed(() => this.reportService.loading());

  ngOnInit(): void {
    this.refreshData();
  }

  async refreshData(): Promise<void> {
    await this.reportService.loadBalanceSheet(this.asOfDate());
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
