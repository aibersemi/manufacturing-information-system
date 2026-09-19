import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowDownLeft,
  phosphorArrowUpRight,
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorDatabase,
  phosphorFileText,
  phosphorMagnifyingGlass,
  phosphorPackage,
  phosphorScissors,
  phosphorStack,
  phosphorWarningCircle,
  phosphorX,
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
import {
  EligibleBundleItem,
  ProductionService,
} from '../../core/services/production.service';

export type InventoryTab =
  | 'stok-bahan'
  | 'stok-masuk'
  | 'stok-keluar'
  | 'stok-produksi'
  | 'stok-produk-jadi'
  | 'summary'
  | 'ledger'
  | 'rolls';

export interface FinishedGoodsItem {
  id: string;
  name: string;
  item_name: string;
  sku?: string | null;
  product_sku?: string | null;
  item_kind?: string;
  stage?: string;
  work_condition?: string;
  quantity: number;
  current_stock?: number;
  active_quantity?: number;
  unit_code: string;
  moving_avg_cost: number;
  total_valuation: number;
  source_type: 'inventory_summary' | 'completed_bundle';
}

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
      phosphorX,
      phosphorArrowDownLeft,
      phosphorArrowUpRight,
      phosphorScissors,
    }),
  ],
  templateUrl: './inventory.component.html',
})
export class InventoryComponent {
  private readonly purchasingService = inject(PurchasingInventoryService);
  private readonly productionService = inject(ProductionService, { optional: true });
  private readonly companyService = inject(CompanyService);
  private readonly route = inject(ActivatedRoute, { optional: true });

  readonly summaryItems = signal<InventorySummaryItem[]>([]);
  readonly movements = signal<InventoryMovement[]>([]);
  readonly rolls = signal<ProductionMaterialUnit[]>([]);
  readonly productionBundles = signal<EligibleBundleItem[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly activeTab = signal<InventoryTab>('stok-bahan');
  readonly searchQuery = signal('');

  // ============================================================================
  // 1. METRIK KPI RINGKASAN
  // ============================================================================

  // Total Valuasi Bahan
  readonly totalValuasiBahan = computed(() => {
    const materials = this.summaryItems().filter(
      (i) => i.item_kind === 'material' || i.inventory_state === 'material'
    );
    if (materials.length === 0 && this.summaryItems().length > 0) {
      return this.summaryItems().reduce((acc, item) => acc + Number(item.total_valuation || 0), 0);
    }
    return materials.reduce((acc, item) => acc + Number(item.total_valuation || 0), 0);
  });

  // Kompatibilitas metrik lama
  readonly totalValuation = computed(() => this.totalValuasiBahan());

  // Total Barang Masuk
  readonly totalMasuk = computed(() => {
    return this.movements()
      .filter((m) => m.movement_type === 'purchase_receipt' || Number(m.quantity) > 0)
      .reduce((acc, m) => acc + Math.abs(Number(m.quantity || 0)), 0);
  });

  // Total Barang Keluar & Waste
  readonly totalKeluar = computed(() => {
    const keluarTypes = ['production_issue', 'sales_issue', 'production_reject', 'waste'];
    return this.movements()
      .filter((m) => (m.movement_type && keluarTypes.includes(m.movement_type)) || Number(m.quantity) < 0)
      .reduce((acc, m) => acc + Math.abs(Number(m.quantity || 0)), 0);
  });

  // Total WIP Ikatan
  readonly totalWipIkatan = computed(() => {
    return this.productionBundles()
      .filter((b) => b.stage !== 'packing' || b.work_condition !== 'completed')
      .reduce((acc, b) => acc + Number(b.active_quantity || 0), 0);
  });

  // Total Produk Jadi Siap Jual
  readonly totalProdukJadi = computed(() => {
    const summaryProductQty = this.summaryItems()
      .filter((i) => i.item_kind === 'product' || i.inventory_state === 'product')
      .reduce((acc, i) => acc + Number(i.current_stock || 0), 0);
    const bundleProductQty = this.productionBundles()
      .filter((b) => b.stage === 'packing' || b.work_condition === 'completed')
      .reduce((acc, b) => acc + Number(b.active_quantity || 0), 0);
    return summaryProductQty + bundleProductQty;
  });

  readonly totalProdukJadiSiapJual = computed(() => this.totalProdukJadi());

  readonly totalItemsCount = computed(() => {
    return this.summaryItems().length;
  });

  readonly availableRollsCount = computed(() => {
    return this.rolls().filter((r) => r.status === 'available').length;
  });

  // ============================================================================
  // 2. COMPUTED SIGNALS UNTUK 5 KATEGORI SPESIFIK
  // ============================================================================

  // Kategori 1: Stok Bahan (Material & Perlengkapan Baku)
  readonly stokBahanList = computed(() => {
    const list = this.summaryItems().filter(
      (item) => item.item_kind === 'material' || item.inventory_state === 'material'
    );
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (item) => item.item_name.toLowerCase().includes(q) || item.unit_code.toLowerCase().includes(q)
    );
  });

  // Kategori 2: Stok Masuk (Purchase Receipts & Positive Movements)
  readonly stokMasukList = computed(() => {
    const list = this.movements().filter(
      (m) => m.movement_type === 'purchase_receipt' || Number(m.quantity) > 0
    );
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => {
      const itemName = ((m as unknown as { item?: { name: string } }).item?.name || '').toLowerCase();
      const docNum = ((m as unknown as { doc?: { document_number: string } }).doc?.document_number || '').toLowerCase();
      return itemName.includes(q) || docNum.includes(q);
    });
  });

  // Kategori 3: Stok Keluar (Production Issue, Sales Issue, Production Reject/Waste)
  readonly stokKeluarList = computed(() => {
    const keluarTypes = ['production_issue', 'sales_issue', 'production_reject', 'waste'];
    const list = this.movements().filter(
      (m) =>
        (m.movement_type && keluarTypes.includes(m.movement_type)) ||
        Number(m.quantity) < 0
    );
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => {
      const itemName = ((m as unknown as { item?: { name: string } }).item?.name || '').toLowerCase();
      const docNum = ((m as unknown as { doc?: { document_number: string } }).doc?.document_number || '').toLowerCase();
      const movType = (m.movement_type || '').toLowerCase();
      return itemName.includes(q) || docNum.includes(q) || movType.includes(q);
    });
  });

  // Kategori 4: Stok Produksi (WIP Ikatan Komponen Setengah Jadi)
  readonly stokProduksiList = computed(() => {
    const list = this.productionBundles().filter(
      (b) => b.stage !== 'packing' || b.work_condition !== 'completed'
    );
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter((b) => {
      const code = (b.bundle_code || '').toLowerCase();
      const prodName = (b.product_name || '').toLowerCase();
      const sku = (b.product_sku || '').toLowerCase();
      const lot = (b.lot_code || '').toLowerCase();
      return code.includes(q) || prodName.includes(q) || sku.includes(q) || lot.includes(q);
    });
  });

  // Kategori 5: Stok Produk Jadi Siap Jual (SKU Produk Jadi)
  readonly stokProdukJadiList = computed<FinishedGoodsItem[]>(() => {
    const list: FinishedGoodsItem[] = [];

    // Saldo produk jadi dari ringkasan inventori
    for (const item of this.summaryItems()) {
      if (item.item_kind === 'product' || item.inventory_state === 'product') {
        list.push({
          id: item.item_id,
          name: item.item_name,
          item_name: item.item_name,
          sku: item.item_name,
          product_sku: item.item_name,
          item_kind: item.item_kind,
          quantity: item.current_stock,
          current_stock: item.current_stock,
          active_quantity: item.current_stock,
          unit_code: item.unit_code || 'pcs',
          moving_avg_cost: item.moving_avg_cost,
          total_valuation: item.total_valuation,
          source_type: 'inventory_summary',
        });
      }
    }

    // Ikatan produksi siap jual (selesai packing)
    for (const bundle of this.productionBundles()) {
      if (bundle.stage === 'packing' || bundle.work_condition === 'completed') {
        list.push({
          id: bundle.id,
          name: bundle.product_name || 'Produk Jadi',
          item_name: bundle.product_name || 'Produk Jadi',
          sku: bundle.product_sku || bundle.bundle_code,
          product_sku: bundle.product_sku || bundle.bundle_code,
          stage: bundle.stage,
          work_condition: bundle.work_condition,
          quantity: bundle.active_quantity,
          current_stock: bundle.active_quantity,
          active_quantity: bundle.active_quantity,
          unit_code: 'pcs',
          moving_avg_cost: 0,
          total_valuation: 0,
          source_type: 'completed_bundle',
        });
      }
    }

    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => {
      const name = p.name.toLowerCase();
      const sku = (p.sku || '').toLowerCase();
      return name.includes(q) || sku.includes(q);
    });
  });

  // ============================================================================
  // 3. KOMPATIBILITAS DATA LAMA (LEGACY FILTERED SIGNALS)
  // ============================================================================

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
    // Sinkronkan tab dari ActivatedRoute query param 'tab' jika tersedia
    if (this.route) {
      const initialTab = this.route.snapshot?.queryParamMap?.get('tab');
      if (initialTab && this.isValidTab(initialTab)) {
        this.activeTab.set(initialTab as InventoryTab);
      }
      this.route.queryParams?.subscribe((params) => {
        const tabParam = params?.['tab'];
        if (tabParam && this.isValidTab(tabParam)) {
          this.activeTab.set(tabParam as InventoryTab);
        }
      });
    }

    effect(() => {
      const companyId = this.companyService.activeCompanyId();
      if (companyId) {
        this.loadData();
      }
    });
  }

  setActiveTab(tab: InventoryTab): void {
    this.activeTab.set(tab);
  }

  isValidTab(tab: string): boolean {
    const validTabs: InventoryTab[] = [
      'stok-bahan',
      'stok-masuk',
      'stok-keluar',
      'stok-produksi',
      'stok-produk-jadi',
      'summary',
      'ledger',
      'rolls',
    ];
    return validTabs.includes(tab as InventoryTab);
  }

  async loadData(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const [sum, movs, rls, bundles] = await Promise.all([
        this.purchasingService.getInventorySummary(),
        this.purchasingService.getInventoryMovements(),
        this.purchasingService.getMaterialRolls(),
        this.productionService ? this.productionService.getAllBundles() : Promise.resolve([]),
      ]);
      this.summaryItems.set(sum);
      this.movements.set(movs);
      this.rolls.set(rls);
      this.productionBundles.set(bundles || []);
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

  getAbsNumber(val: number): string {
    return Number(Math.abs(val || 0)).toLocaleString('id-ID');
  }

  getStageLabel(stage: string): string {
    switch (stage) {
      case 'cutting':
        return 'Potong';
      case 'printing':
        return 'Sablon';
      case 'sewing':
        return 'Jahit';
      case 'packing':
        return 'Packing';
      default:
        return stage || '-';
    }
  }

  getConditionLabel(condition: string): string {
    switch (condition) {
      case 'available':
        return 'Tersedia';
      case 'in_progress':
        return 'Dalam Proses';
      case 'repair_hold':
        return 'Tertahan Perbaikan';
      case 'completed':
        return 'Selesai';
      case 'rejected':
        return 'Afkir / Rusak';
      default:
        return condition || '-';
    }
  }

  getMovementTypeLabel(type: string | null): string {
    if (!type) return 'Mutasi Stok';
    switch (type) {
      case 'purchase_receipt':
        return 'Pembelian Masuk';
      case 'production_issue':
        return 'Pemakaian Potong';
      case 'sales_issue':
        return 'Penjualan Jadi';
      case 'production_reject':
        return 'Sisa Kain / Waste';
      case 'adjustment_in':
        return 'Penyesuaian Masuk';
      case 'adjustment_out':
        return 'Penyesuaian Keluar';
      default:
        return type;
    }
  }
}
