import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorCircleNotch,
  phosphorCube,
  phosphorFileText,
  phosphorMagnifyingGlass,
  phosphorPencilSimple,
  phosphorPlus,
  phosphorTrash,
  phosphorWarningCircle,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { CompanyService } from '../../../core/services/company.service';
import {
  BomData,
  BomMaterialLine,
  MasterDataService,
  MasterRecord,
  MaterialData,
  ProductData,
  ProductWithRouting,
} from '../../../core/services/master-data.service';

export interface EditableBomLine {
  materialId: string;
  quantity: number;
  unitCode: string;
}

export interface ProductBomItem {
  product: ProductWithRouting;
  bomRecord: MasterRecord | null;
  bomData: BomData | null;
  linesCount: number;
  estimatedMaterialCost: number;
}

@Component({
  selector: 'app-bom',
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    NgIcon,
    HlmButton,
    HlmCardImports,
  ],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorCheckCircle,
      phosphorCircleNotch,
      phosphorCube,
      phosphorFileText,
      phosphorMagnifyingGlass,
      phosphorPencilSimple,
      phosphorPlus,
      phosphorTrash,
      phosphorWarningCircle,
      phosphorX,
    }),
  ],
  templateUrl: './bom.component.html',
})
export class BomComponent {
  private readonly masterDataService = inject(MasterDataService);
  private readonly companyService = inject(CompanyService);

  constructor() {
    effect(() => {
      const companyId = this.companyService.activeCompanyId();
      if (companyId) {
        this.loadData();
      }
    });
  }

  readonly products = signal<ProductWithRouting[]>([]);
  readonly materials = signal<MasterRecord[]>([]);
  readonly boms = signal<MasterRecord[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly filterConfigured = signal<'all' | 'configured' | 'unconfigured'>('all');

  // Modal State
  readonly isModalOpen = signal<boolean>(false);
  readonly selectedProduct = signal<ProductWithRouting | null>(null);
  readonly currentBomRecord = signal<MasterRecord | null>(null);
  readonly editableLines = signal<EditableBomLine[]>([]);
  readonly formError = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  // Map bahan untuk lookup cepat
  readonly materialMap = computed(() => {
    const map = new Map<string, MasterRecord>();
    for (const m of this.materials()) {
      map.set(m.id, m);
    }
    return map;
  });

  // Gabungkan daftar produk dengan status BOM-nya
  readonly productBomList = computed<ProductBomItem[]>(() => {
    const bomsMap = new Map<string, MasterRecord>();
    for (const b of this.boms()) {
      const data = b.data as BomData | null;
      if (data?.productId) {
        bomsMap.set(data.productId, b);
      }
    }

    const matMap = this.materialMap();

    return this.products().map((prod) => {
      const bomRecord = bomsMap.get(prod.id) || null;
      const bomData = (bomRecord?.data as BomData) || null;
      const lines = bomData?.materialLines || [];

      let cost = 0;
      for (const line of lines) {
        const mat = matMap.get(line.materialId);
        if (mat) {
          const mData = (mat.data || {}) as MaterialData;
          const totalBase = (mData.packagingQuantity || 1) * (mData.conversionFactor || 1);
          const basePrice = totalBase > 0 ? (mData.referencePackagePrice || 0) / totalBase : 0;
          cost += basePrice * line.quantity;
        }
      }

      return {
        product: prod,
        bomRecord,
        bomData,
        linesCount: lines.length,
        estimatedMaterialCost: Math.round(cost),
      };
    });
  });

  readonly filteredProductBoms = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const filter = this.filterConfigured();
    let list = this.productBomList();

    if (filter === 'configured') {
      list = list.filter((item) => item.bomData && item.bomData.materialLines.length > 0);
    } else if (filter === 'unconfigured') {
      list = list.filter((item) => !item.bomData || item.bomData.materialLines.length === 0);
    }

    if (q) {
      list = list.filter((item) => {
        const p = item.product;
        return (
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          p.name.toLowerCase().includes(q)
        );
      });
    }

    return list;
  });

  // Estimasi biaya pada modal yang sedang diedit
  readonly currentModalEstimatedCost = computed(() => {
    let cost = 0;
    const matMap = this.materialMap();
    for (const line of this.editableLines()) {
      if (!line.materialId || line.quantity <= 0) continue;
      const mat = matMap.get(line.materialId);
      if (mat) {
        const mData = (mat.data || {}) as MaterialData;
        const totalBase = (mData.packagingQuantity || 1) * (mData.conversionFactor || 1);
        const basePrice = totalBase > 0 ? (mData.referencePackagePrice || 0) / totalBase : 0;
        cost += basePrice * line.quantity;
      }
    }
    return Math.round(cost);
  });

  async loadData(): Promise<void> {
    this.isLoading.set(true);
    try {
      const [productsList, materialsList, bomsList] = await Promise.all([
        this.masterDataService.getProducts(),
        this.masterDataService.getMaterials(),
        this.masterDataService.getBoms(),
      ]);
      this.products.set(productsList);
      this.materials.set(materialsList);
      this.boms.set(bomsList);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data BOM.';
      toast.error(msg);
    } finally {
      this.isLoading.set(false);
    }
  }

  setFilter(filter: 'all' | 'configured' | 'unconfigured'): void {
    this.filterConfigured.set(filter);
  }

  getProductData(product: ProductWithRouting): ProductData {
    return (product.data || {}) as ProductData;
  }

  getMaterialName(materialId: string): string {
    const mat = this.materialMap().get(materialId);
    return mat ? mat.name : 'Material Tidak Ditemukan';
  }

  openBomEditor(item: ProductBomItem): void {
    this.selectedProduct.set(item.product);
    this.currentBomRecord.set(item.bomRecord);
    this.formError.set(null);

    if (item.bomData && item.bomData.materialLines.length > 0) {
      this.editableLines.set(
        item.bomData.materialLines.map((l) => ({
          materialId: l.materialId,
          quantity: l.quantity,
          unitCode: l.unitCode,
        })),
      );
    } else {
      // Default: siapkan 1 baris kosong jika ada bahan
      const defaultMaterial = this.materials()[0];
      if (defaultMaterial) {
        const mData = (defaultMaterial.data || {}) as MaterialData;
        this.editableLines.set([
          {
            materialId: defaultMaterial.id,
            quantity: 1,
            unitCode: mData.baseUnit || 'PCS',
          },
        ]);
      } else {
        this.editableLines.set([]);
      }
    }

    this.isModalOpen.set(true);
  }

  closeModal(): void {
    if (this.isSubmitting()) return;
    this.isModalOpen.set(false);
  }

  addLine(): void {
    const defaultMaterial = this.materials()[0];
    const unitCode = defaultMaterial ? ((defaultMaterial.data || {}) as MaterialData).baseUnit || 'PCS' : 'PCS';
    this.editableLines.update((lines) => [
      ...lines,
      {
        materialId: defaultMaterial ? defaultMaterial.id : '',
        quantity: 1,
        unitCode,
      },
    ]);
  }

  removeLine(index: number): void {
    this.editableLines.update((lines) => lines.filter((_, i) => i !== index));
  }

  onMaterialChange(index: number, materialId: string): void {
    const mat = this.materialMap().get(materialId);
    const mData = mat ? ((mat.data || {}) as MaterialData) : null;
    const baseUnit = mData?.baseUnit || 'PCS';

    this.editableLines.update((lines) =>
      lines.map((l, i) => (i === index ? { ...l, materialId, unitCode: baseUnit } : l)),
    );
  }

  updateLineQuantity(index: number, quantity: number): void {
    this.editableLines.update((lines) =>
      lines.map((l, i) => (i === index ? { ...l, quantity: Number(quantity) } : l)),
    );
  }

  async saveBom(): Promise<void> {
    this.formError.set(null);
    const product = this.selectedProduct();
    if (!product) return;

    const lines = this.editableLines();
    if (lines.length === 0) {
      this.formError.set('Formula BOM harus memiliki minimal satu komponen material.');
      return;
    }

    // Cek duplikasi material
    const matIds = lines.map((l) => l.materialId);
    const hasDuplicate = new Set(matIds).size !== matIds.length;
    if (hasDuplicate) {
      this.formError.set('Terdapat komponen bahan baku yang dipilih lebih dari satu kali.');
      return;
    }

    for (const line of lines) {
      if (!line.materialId) {
        this.formError.set('Semua baris wajib memilih bahan baku.');
        return;
      }
      if (line.quantity <= 0) {
        this.formError.set('Kuantitas pemakaian bahan harus lebih dari 0.');
        return;
      }
    }

    this.isSubmitting.set(true);

    try {
      const payload: BomMaterialLine[] = lines.map((l) => ({
        materialId: l.materialId,
        quantity: l.quantity,
        unitCode: l.unitCode,
      }));

      await this.masterDataService.saveBom(product.id, product.name, payload);
      toast.success(`Formula BOM untuk "${product.name}" berhasil disimpan.`);
      this.isModalOpen.set(false);
      await this.loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan formula BOM.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
