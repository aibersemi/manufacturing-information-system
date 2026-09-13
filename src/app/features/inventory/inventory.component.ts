import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorDatabase,
  phosphorFileText,
  phosphorMagnifyingGlass,
  phosphorPackage,
  phosphorStack,
  phosphorWarningCircle,
  phosphorXCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { CompanyService } from '../../core/services/company.service';
import {
  InventoryMovement,
  InventorySummaryItem,
  ProductionMaterialUnit,
  PurchasingInventoryService,
} from '../../core/services/purchasing-inventory.service';

@Component({
  selector: 'app-inventory',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorPackage,
      phosphorDatabase,
      phosphorStack,
      phosphorFileText,
      phosphorCheckCircle,
      phosphorXCircle,
      phosphorWarningCircle,
    }),
  ],
  templateUrl: './inventory.component.html',
})
export class InventoryComponent {
  private readonly purchasingService = inject(PurchasingInventoryService);
  private readonly companyService = inject(CompanyService);

  readonly summaryItems = signal<InventorySummaryItem[]>([]);
  readonly movements = signal<InventoryMovement[]>([]);
  readonly rolls = signal<ProductionMaterialUnit[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly activeTab = signal<'summary' | 'ledger' | 'rolls'>('summary');
  readonly searchQuery = signal('');

  // Total Valuasi KPI
  readonly totalValuation = computed(() => {
    return this.summaryItems().reduce((acc, item) => acc + Number(item.total_valuation || 0), 0);
  });

  readonly totalItemsCount = computed(() => {
    return this.summaryItems().length;
  });

  readonly availableRollsCount = computed(() => {
    return this.rolls().filter((r) => r.status === 'available').length;
  });

  readonly filteredSummary = computed(() => {
    const list = this.summaryItems();
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => item.item_name.toLowerCase().includes(q));
  });

  readonly filteredMovements = computed(() => {
    const list = this.movements();
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => {
      const itemName = ((m as unknown as { item?: { name: string } }).item?.name || '').toLowerCase();
      const docNum = ((m as unknown as { doc?: { document_number: string } }).doc?.document_number || '').toLowerCase();
      return itemName.includes(q) || docNum.includes(q);
    });
  });

  readonly filteredRolls = computed(() => {
    const list = this.rolls();
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const code = (r.physical_code || '').toLowerCase();
      const matName = ((r as unknown as { material?: { name: string } }).material?.name || '').toLowerCase();
      return code.includes(q) || matName.includes(q);
    });
  });

  constructor() {
    effect(() => {
      const companyId = this.companyService.activeCompanyId();
      if (companyId) {
        this.loadData();
      }
    });
  }

  async loadData(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const [sum, movs, rls] = await Promise.all([
        this.purchasingService.getInventorySummary(),
        this.purchasingService.getInventoryMovements(),
        this.purchasingService.getMaterialRolls(),
      ]);
      this.summaryItems.set(sum);
      this.movements.set(movs);
      this.rolls.set(rls);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat inventaris');
    } finally {
      this.isLoading.set(false);
    }
  }

  formatCurrency(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }

  formatNumber(val: number): string {
    return Number(val || 0).toLocaleString('id-ID');
  }
}
