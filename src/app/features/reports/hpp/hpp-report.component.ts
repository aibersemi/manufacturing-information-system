import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import {
  phosphorFileText,
  phosphorArrowsClockwise,
  phosphorDownloadSimple,
  phosphorPrinter,
  phosphorCheckCircle,
  phosphorWarningCircle,
  phosphorTrendUp,
  phosphorTrendDown,
  phosphorCoins,
  phosphorUsersThree,
  phosphorFactory,
  phosphorPackage,
  phosphorScales,
} from '@ng-icons/phosphor-icons/regular';
import { ReportService } from '../../../core/services/report.service';

@Component({
  selector: 'app-hpp-report',
  standalone: true,
  imports: [CommonModule, FormsModule, NgIconComponent],
  templateUrl: './hpp-report.component.html',
  viewProviders: [
    provideIcons({
      phosphorFileText,
      phosphorArrowsClockwise,
      phosphorDownloadSimple,
      phosphorPrinter,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorTrendUp,
      phosphorTrendDown,
      phosphorCoins,
      phosphorUsersThree,
      phosphorFactory,
      phosphorPackage,
      phosphorScales,
    }),
  ],
})
export class HppReportComponent implements OnInit {
  readonly reportService = inject(ReportService);

  // Filter signals
  readonly dateFrom = signal<string>(this.reportService.dateFrom());
  readonly dateTo = signal<string>(this.reportService.dateTo());

  // Active detail tab: 'material' | 'labor' | 'overhead' | 'sku' | 'reconciliation'
  readonly activeDetailTab = signal<'material' | 'labor' | 'overhead' | 'sku' | 'reconciliation'>('material');

  // Computed state
  readonly loading = computed(() => this.reportService.loading());
  readonly errorMessage = computed(() => this.reportService.error());
  readonly summaryData = computed(() => this.reportService.hppSummary());

  readonly directMaterialCost = computed(() => this.summaryData()?.directMaterialCost ?? 0);
  readonly directLaborCost = computed(() => this.summaryData()?.directLaborCost ?? 0);
  readonly factoryOverhead = computed(() => this.summaryData()?.factoryOverhead ?? 0);
  readonly totalManufacturingCost = computed(() => this.summaryData()?.totalManufacturingCost ?? 0);
  readonly isMatched = computed(() => this.summaryData()?.cogsReconciliation.isMatched ?? true);
  readonly cogsDifference = computed(() => this.summaryData()?.cogsReconciliation.difference ?? 0);

  ngOnInit(): void {
    this.loadHppSummary();
  }

  async loadHppSummary(): Promise<void> {
    await this.reportService.loadHppSummary(this.dateFrom(), this.dateTo());
  }

  formatRupiah(amount: number | null | undefined): string {
    const val = amount || 0;
    return 'Rp ' + Number(val).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  formatNumber(val: number | null | undefined): string {
    return Number(val || 0).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  formatPct(val: number | null | undefined): string {
    const num = Number(val || 0);
    const prefix = num > 0 ? '+' : '';
    return prefix + num.toFixed(2) + '%';
  }

  exportCsv(): void {
    const data = this.summaryData();
    if (!data) return;

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += `LAPORAN HARGA POKOK PRODUKSI (HPP) & PABRIKASI\n`;
    csvContent += `Periode:;${this.dateFrom()} s/d ${this.dateTo()}\n\n`;

    // Ringkasan 3 Unsur Biaya
    csvContent += `RINGKASAN BIAYA PRODUKSI\n`;
    csvContent += `Komponen Biaya;Jumlah (IDR)\n`;
    csvContent += `Bahan Baku Langsung;${data.directMaterialCost}\n`;
    csvContent += `Tenaga Kerja Langsung (SPK 4 Tahap);${data.directLaborCost}\n`;
    csvContent += `Overhead Pabrik;${data.factoryOverhead}\n`;
    csvContent += `TOTAL BIAYA PRODUKSI;${data.totalManufacturingCost}\n\n`;

    // Rincian Bahan Baku
    csvContent += `RINCIAN BAHAN BAKU TERPAKAI\n`;
    csvContent += `ID Item;Nama Bahan;Kuantitas Terpakai;Total Biaya (IDR)\n`;
    for (const item of data.materialsBreakdown) {
      csvContent += `"${item.itemId}";"${item.itemName}";${item.quantityUsed};${item.totalCost}\n`;
    }
    csvContent += `\n`;

    // Rincian Tenaga Kerja Langsung
    csvContent += `RINCIAN TENAGA KERJA LANGSUNG (UPAH SPK)\n`;
    csvContent += `Tahap SPK;Jumlah Upah (IDR)\n`;
    csvContent += `Potong (Cutting);${data.laborBreakdown.cutting}\n`;
    csvContent += `Sablon/Bordir (Printing);${data.laborBreakdown.printing}\n`;
    csvContent += `Jahit (Sewing);${data.laborBreakdown.sewing}\n`;
    csvContent += `Finishing & Packing;${data.laborBreakdown.packing}\n`;
    csvContent += `Head Fee / Mandor;${data.laborBreakdown.headFee}\n`;
    csvContent += `Total Upah Langsung;${data.directLaborCost}\n\n`;

    // Evaluasi SKU
    csvContent += `EVALUASI HPP PER SKU vs BOM STANDAR\n`;
    csvContent += `Kode SKU;Nama Produk;Qty Produksi;Qty Terjual;HPP Aktual/Unit;BOM Standar/Unit;Varians Unit;Varians %\n`;
    for (const sku of data.productsBreakdown) {
      csvContent += `"${sku.sku}";"${sku.name}";${sku.quantityProduced};${sku.quantitySold};${sku.actualHppPerUnit};${sku.bomStandardHpp};${sku.variance};${sku.variancePercent}%\n`;
    }
    csvContent += `\n`;

    // Rekonsiliasi GL
    csvContent += `REKONSILIASI DENGAN BUKU BESAR (GL)\n`;
    csvContent += `COGS dari Produksi Fisik;${data.cogsReconciliation.actualCogs}\n`;
    csvContent += `COGS di GL (Buku Besar);${data.cogsReconciliation.glCogs}\n`;
    csvContent += `Selisih (Variance);${data.cogsReconciliation.difference}\n`;
    csvContent += `Status Rekonsiliasi;${data.cogsReconciliation.isMatched ? 'MATCHED' : 'DISCREPANCY'}\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `hpp-manufacturing-report_${this.dateFrom()}_${this.dateTo()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  printReport(): void {
    window.print();
  }
}
