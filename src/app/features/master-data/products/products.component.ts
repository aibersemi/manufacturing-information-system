import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorCircleNotch,
  phosphorMagnifyingGlass,
  phosphorPaintBrush,
  phosphorPencilSimple,
  phosphorPlus,
  phosphorScissors,
  phosphorTag,
  phosphorToggleLeft,
  phosphorToggleRight,
  phosphorTShirt,
  phosphorX,
  phosphorXCircle,
} from '@ng-icons/phosphor-icons/regular';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { CompanyService } from '../../../core/services/company.service';
import {
  MasterDataService,
  ProductData,
  ProductWithRouting,
  UnitDefinition,
} from '../../../core/services/master-data.service';

@Component({
  selector: 'app-products',
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
      phosphorMagnifyingGlass,
      phosphorPaintBrush,
      phosphorPencilSimple,
      phosphorPlus,
      phosphorScissors,
      phosphorTag,
      phosphorToggleLeft,
      phosphorToggleRight,
      phosphorTShirt,
      phosphorX,
      phosphorXCircle,
    }),
  ],
  templateUrl: './products.component.html',
})
export class ProductsComponent {
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
  readonly units = signal<UnitDefinition[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');
  readonly routingFilter = signal<'all' | 'printing' | 'non_printing'>('all');

  // Modal State
  readonly isModalOpen = signal<boolean>(false);
  readonly modalMode = signal<'create' | 'edit'>('create');
  readonly selectedProduct = signal<ProductWithRouting | null>(null);

  // Form Signals
  readonly formSku = signal<string>('');
  readonly formName = signal<string>('');
  readonly formSalesUnit = signal<string>('PCS');
  readonly formReferenceSalesPrice = signal<number>(0);
  readonly formDescription = signal<string>('');
  readonly formRequiresPrinting = signal<boolean>(false);
  readonly formIsActive = signal<boolean>(true);
  readonly formError = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  readonly filteredProducts = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();
    const routing = this.routingFilter();
    let list = this.products();

    if (status === 'active') {
      list = list.filter((p) => p.is_active);
    } else if (status === 'inactive') {
      list = list.filter((p) => !p.is_active);
    }

    if (routing === 'printing') {
      list = list.filter((p) => p.requiresPrinting);
    } else if (routing === 'non_printing') {
      list = list.filter((p) => !p.requiresPrinting);
    }

    if (q) {
      list = list.filter((p) => {
        const data = this.getProductData(p);
        return (
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          p.name.toLowerCase().includes(q) ||
          data.salesUnit.toLowerCase().includes(q) ||
          (data.description && data.description.toLowerCase().includes(q))
        );
      });
    }

    return list;
  });

  async loadData(): Promise<void> {
    this.isLoading.set(true);
    try {
      const [productsList, unitsList] = await Promise.all([
        this.masterDataService.getProducts(),
        this.masterDataService.getUnits(),
      ]);
      this.products.set(productsList);
      this.units.set(unitsList);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data produk.';
      toast.error(msg);
    } finally {
      this.isLoading.set(false);
    }
  }

  setStatusFilter(status: 'all' | 'active' | 'inactive'): void {
    this.statusFilter.set(status);
  }

  setRoutingFilter(routing: 'all' | 'printing' | 'non_printing'): void {
    this.routingFilter.set(routing);
  }

  getProductData(product: ProductWithRouting): ProductData {
    return (product.data || {
      salesUnit: 'PCS',
      referenceSalesPrice: 0,
      description: '',
    }) as ProductData;
  }

  openCreateModal(): void {
    this.modalMode.set('create');
    this.selectedProduct.set(null);
    this.formSku.set('');
    this.formName.set('');
    this.formSalesUnit.set('PCS');
    this.formReferenceSalesPrice.set(0);
    this.formDescription.set('');
    this.formRequiresPrinting.set(false);
    this.formIsActive.set(true);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  openEditModal(product: ProductWithRouting): void {
    this.modalMode.set('edit');
    this.selectedProduct.set(product);
    this.formSku.set(product.sku || '');
    this.formName.set(product.name);

    const data = this.getProductData(product);
    this.formSalesUnit.set(data.salesUnit || 'PCS');
    this.formReferenceSalesPrice.set(data.referenceSalesPrice || 0);
    this.formDescription.set(data.description || '');
    this.formRequiresPrinting.set(product.requiresPrinting);
    this.formIsActive.set(product.is_active);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    if (this.isSubmitting()) return;
    this.isModalOpen.set(false);
  }

  async saveProduct(): Promise<void> {
    this.formError.set(null);

    const sku = this.formSku().trim().toUpperCase().replace(/\s+/g, '_');
    const name = this.formName().trim();

    if (this.modalMode() === 'create') {
      if (!sku) {
        this.formError.set('Kode SKU wajib diisi.');
        return;
      }
      if (!/^[A-Z0-9_-]+$/.test(sku)) {
        this.formError.set('SKU hanya boleh berupa huruf kapital, angka, dash, atau underscore.');
        return;
      }
    }

    if (!name) {
      this.formError.set('Nama produk wajib diisi.');
      return;
    }

    if (this.formReferenceSalesPrice() < 0) {
      this.formError.set('Harga jual referensi tidak boleh negatif.');
      return;
    }

    this.isSubmitting.set(true);

    try {
      if (this.modalMode() === 'create') {
        const created = await this.masterDataService.createProduct({
          sku,
          name,
          salesUnit: this.formSalesUnit(),
          referenceSalesPrice: this.formReferenceSalesPrice(),
          description: this.formDescription(),
          requiresPrinting: this.formRequiresPrinting(),
        });
        toast.success(`Produk "${created.name}" (${created.sku}) berhasil dibuat.`);
      } else {
        const current = this.selectedProduct();
        if (!current) return;
        const updated = await this.masterDataService.updateProduct(current.id, {
          name,
          salesUnit: this.formSalesUnit(),
          referenceSalesPrice: this.formReferenceSalesPrice(),
          description: this.formDescription(),
          requiresPrinting: this.formRequiresPrinting(),
          isActive: this.formIsActive(),
        });
        toast.success(`Produk "${updated.name}" berhasil diperbarui.`);
      }

      this.isModalOpen.set(false);
      await this.loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan produk.';
      this.formError.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async toggleStatus(product: ProductWithRouting): Promise<void> {
    const nextStatus = !product.is_active;
    const data = this.getProductData(product);
    try {
      await this.masterDataService.updateProduct(product.id, {
        name: product.name,
        salesUnit: data.salesUnit,
        referenceSalesPrice: data.referenceSalesPrice,
        description: data.description,
        requiresPrinting: product.requiresPrinting,
        isActive: nextStatus,
      });
      toast.success(`Status "${product.name}" diubah menjadi ${nextStatus ? 'Aktif' : 'Nonaktif'}.`);
      await this.loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengubah status produk.';
      toast.error(msg);
    }
  }
}
