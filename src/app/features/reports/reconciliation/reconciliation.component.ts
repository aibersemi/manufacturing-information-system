import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import {
  phosphorCheckCircle,
  phosphorWarningCircle,
  phosphorArrowsClockwise,
  phosphorDownloadSimple,
  phosphorPrinter,
  phosphorShieldCheck,
  phosphorShieldWarning,
  phosphorArrowSquareOut,
  phosphorScales,
  phosphorInfo,
} from '@ng-icons/phosphor-icons/regular';
import { ReportService } from '../../../core/services/report.service';

@Component({
  selector: 'app-reconciliation',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, NgIconComponent],
  templateUrl: './reconciliation.component.html',
  viewProviders: [
    provideIcons({
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorArrowsClockwise,
      phosphorDownloadSimple,
      phosphorPrinter,
      phosphorShieldCheck,
      phosphorShieldWarning,
      phosphorArrowSquareOut,
      phosphorScales,
      phosphorInfo,
    }),
  ],
})
export class ReconciliationComponent implements OnInit {
  readonly reportService = inject(ReportService);

  // Filter signal
  readonly asOfDate = signal<string>(this.reportService.dateTo());

  // Computed state
  readonly loading = computed(() => this.reportService.loading());
  readonly errorMessage = computed(() => this.reportService.error());
  readonly reconciliationData = computed(() => this.reportService.reconciliation());

  readonly allMatched = computed(() => this.reconciliationData()?.allMatched ?? false);
  readonly matchedCount = computed(() => this.reconciliationData()?.matchedCount ?? 0);
  readonly totalCount = computed(() => this.reconciliationData()?.totalCount ?? 0);
  readonly totalVariance = computed(() => {
    const items = this.reconciliationData()?.items;
    if (!items) return 0;
    return items.reduce((acc, item) => acc + Math.abs(item.variance), 0);
  });

  readonly reconciliationRatePct = computed(() => {
    const total = this.totalCount();
    if (!total) return 100;
    return Math.round((this.matchedCount() / total) * 100);
  });

  ngOnInit(): void {
    this.runReconciliation();
  }

  async runReconciliation(): Promise<void> {
    await this.reportService.loadReconciliation(this.asOfDate());
  }

  formatRupiah(amount: number | null | undefined): string {
    const val = amount || 0;
    return 'Rp ' + Number(val).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  getModuleRoute(key: string): string {
    switch (key) {
      case 'cash_bank':
        return '/workspace/finance/cash-bank';
      case 'receivable':
        return '/workspace/sales/orders';
      case 'supplier_payable':
        return '/workspace/purchasing/materials';
      case 'inventory':
        return '/workspace/inventory';
      case 'fixed_assets':
      case 'accumulated_depreciation':
        return '/workspace/assets';
      default:
        return '/workspace/finance/journals';
    }
  }

  exportCsv(): void {
    const data = this.reconciliationData();
    if (!data) return;

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += `LAPORAN REKONSILIASI SUB-BUKU BESAR & INTEGRITAS AUDIT\n`;
    csvContent += `Tanggal Cut-off Audit:;${data.asOfDate}\n`;
    csvContent += `Status Integritas:;${data.allMatched ? 'SISTEM SEIMBANG (MATCHED)' : 'DITEMUKAN ANOMALI (DISCREPANCY)'}\n`;
    csvContent += `Kontrol Terverifikasi:;${data.matchedCount} dari ${data.totalCount}\n`;
    csvContent += `Total Varians Absolut:;${this.totalVariance()}\n\n`;

    csvContent += `Pos Kontrol;Kategori;Kode Akun Kontrol;Saldo Subledger;Saldo Buku Besar (GL);Varians (Selisih);Status\n`;
    for (const item of data.items) {
      const status = item.isMatched ? 'SEIMBANG' : 'SELISIH';
      csvContent += `"${item.title}";"${item.category}";"${item.controlAccountCode}";${item.subledgerAmount};${item.glAmount};${item.variance};"${status}"\n`;
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `reconciliation-audit-report_${data.asOfDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  printReport(): void {
    window.print();
  }
}
