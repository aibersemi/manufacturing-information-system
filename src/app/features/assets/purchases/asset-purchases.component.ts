import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorBuilding,
  phosphorCalendarBlank,
  phosphorCheckCircle,
  phosphorCube,
  phosphorFileText,
  phosphorFunnel,
  phosphorMagnifyingGlass,
  phosphorMoney,
  phosphorPlus,
  phosphorShoppingCart,
  phosphorTrash,
  phosphorWarningCircle,
  phosphorX,
  phosphorXCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { toast } from '@spartan-ng/brain/sonner';
import {
  AssetPurchaseDocument,
  AssetPurchaseLineInput,
  AssetService,
} from '../../../core/services/asset.service';
import { MasterDataService, MasterRecord } from '../../../core/services/master-data.service';

@Component({
  selector: 'app-asset-purchases',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorShoppingCart,
      phosphorCube,
      phosphorPlus,
      phosphorTrash,
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorFunnel,
      phosphorCalendarBlank,
      phosphorBuilding,
      phosphorMoney,
      phosphorCheckCircle,
      phosphorWarningCircle,
      phosphorXCircle,
      phosphorX,
      phosphorFileText,
    }),
  ],
  templateUrl: './asset-purchases.component.html',
})
export class AssetPurchasesComponent implements OnInit {
  readonly assetService = inject(AssetService);
  private readonly masterDataService = inject(MasterDataService);

  readonly searchQuery = signal('');
  readonly statusFilter = signal<'all' | 'draft' | 'posted' | 'void'>('all');
  readonly suppliers = signal<MasterRecord[]>([]);

  // Modals & Dialogs
  readonly isCreateModalOpen = signal(false);
  readonly isPostDialogOpen = signal(false);
  readonly isCancelDialogOpen = signal(false);
  readonly isDetailModalOpen = signal(false);
  readonly selectedDoc = signal<AssetPurchaseDocument | null>(null);

  // Form State
  readonly formSupplierId = signal('');
  readonly formTransactionDate = signal(new Date().toISOString().slice(0, 10));
  readonly formNotes = signal('');
  readonly formLines = signal<AssetPurchaseLineInput[]>([
    { name: '', quantity: 1, unitPrice: 0 },
  ]);
  readonly cancelReason = signal('');

  // Computed KPIs
  readonly purchases = computed(() => this.assetService.assetPurchases());
  readonly loading = computed(() => this.assetService.loading());

  readonly totalPurchasesCount = computed(() => this.purchases().length);

  readonly totalPurchaseValue = computed(() =>
    this.purchases()
      .filter((p) => p.status !== 'void')
      .reduce((sum, p) => sum + p.totalAmount, 0)
  );

  readonly pendingDraftsCount = computed(
    () => this.purchases().filter((p) => p.status === 'draft').length
  );

  readonly filteredPurchases = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const st = this.statusFilter();

    return this.purchases().filter((p) => {
      const matchStatus = st === 'all' || p.status === st;
      const matchQuery =
        !q ||
        p.documentNumber.toLowerCase().includes(q) ||
        (p.counterpartyName && p.counterpartyName.toLowerCase().includes(q)) ||
        p.notes.toLowerCase().includes(q) ||
        p.lines.some((l) => l.description.toLowerCase().includes(q));
      return matchStatus && matchQuery;
    });
  });

  readonly formTotalAmount = computed(() =>
    this.formLines().reduce(
      (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0),
      0
    )
  );

  ngOnInit(): void {
    this.loadData();
  }

  async loadData(): Promise<void> {
    try {
      await Promise.all([
        this.assetService.loadAssetPurchases(),
        this.loadSuppliers(),
      ]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data pengadaan aset.');
    }
  }

  async loadSuppliers(): Promise<void> {
    try {
      const sups = await this.masterDataService.getSuppliers();
      this.suppliers.set(sups.filter((s) => s.is_active));
    } catch (err) {
      console.error('Failed to load suppliers:', err);
    }
  }

  // Create Modal
  openCreateModal(): void {
    this.formSupplierId.set('');
    this.formTransactionDate.set(new Date().toISOString().slice(0, 10));
    this.formNotes.set('');
    this.formLines.set([{ name: '', quantity: 1, unitPrice: 0 }]);
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  addLine(): void {
    this.formLines.update((lines) => [
      ...lines,
      { name: '', quantity: 1, unitPrice: 0 },
    ]);
  }

  removeLine(index: number): void {
    if (this.formLines().length <= 1) {
      toast.error('Pengadaan aset wajib memiliki minimal 1 baris item.');
      return;
    }
    this.formLines.update((lines) => lines.filter((_, i) => i !== index));
  }

  updateLineName(index: number, name: string): void {
    this.formLines.update((lines) => {
      const updated = [...lines];
      updated[index] = { ...updated[index], name };
      return updated;
    });
  }

  updateLineQuantity(index: number, quantity: number): void {
    this.formLines.update((lines) => {
      const updated = [...lines];
      updated[index] = { ...updated[index], quantity: Math.max(1, Math.floor(quantity)) };
      return updated;
    });
  }

  updateLineUnitPrice(index: number, unitPrice: number): void {
    this.formLines.update((lines) => {
      const updated = [...lines];
      updated[index] = { ...updated[index], unitPrice: Math.max(0, Math.floor(unitPrice)) };
      return updated;
    });
  }

  async savePurchase(): Promise<void> {
    if (!this.formSupplierId()) {
      toast.error('Silakan pilih pemasok terdaftar.');
      return;
    }

    const lines = this.formLines();
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].name.trim()) {
        toast.error(`Nama aset pada baris ${i + 1} wajib diisi.`);
        return;
      }
      if (lines[i].quantity <= 0) {
        toast.error(`Kuantitas pada baris ${i + 1} harus lebih dari 0.`);
        return;
      }
      if (lines[i].unitPrice <= 0) {
        toast.error(`Harga per unit pada baris ${i + 1} harus lebih dari Rp 0.`);
        return;
      }
    }

    try {
      const res = await this.assetService.createAssetPurchase({
        supplierId: this.formSupplierId(),
        transactionDate: this.formTransactionDate(),
        notes: this.formNotes().trim(),
        lines: this.formLines(),
      });
      toast.success(`Draf pengadaan aset ${res.documentNumber} berhasil dibuat.`);
      this.closeCreateModal();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuat pengadaan aset.');
    }
  }

  // Detail Modal
  openDetailModal(doc: AssetPurchaseDocument): void {
    this.selectedDoc.set(doc);
    this.isDetailModalOpen.set(true);
  }

  closeDetailModal(): void {
    this.isDetailModalOpen.set(false);
  }

  // Post Dialog
  openPostDialog(doc: AssetPurchaseDocument): void {
    this.selectedDoc.set(doc);
    this.isPostDialogOpen.set(true);
  }

  closePostDialog(): void {
    this.isPostDialogOpen.set(false);
  }

  async confirmPost(): Promise<void> {
    const doc = this.selectedDoc();
    if (!doc) return;

    try {
      await this.assetService.postAssetPurchase(doc.id);
      toast.success(`Pengadaan aset ${doc.documentNumber} berhasil diposting. Unit aset telah aktif di Register.`);
      this.closePostDialog();
      if (this.isDetailModalOpen()) {
        this.closeDetailModal();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal memposting pengadaan aset.');
    }
  }

  // Cancel Dialog
  openCancelDialog(doc: AssetPurchaseDocument): void {
    this.selectedDoc.set(doc);
    this.cancelReason.set('');
    this.isCancelDialogOpen.set(true);
  }

  closeCancelDialog(): void {
    this.isCancelDialogOpen.set(false);
  }

  async confirmCancel(): Promise<void> {
    const doc = this.selectedDoc();
    if (!doc) return;

    if (!this.cancelReason().trim()) {
      toast.error('Alasan pembatalan wajib diisi.');
      return;
    }

    try {
      await this.assetService.cancelAssetPurchase(doc.id, this.cancelReason().trim());
      toast.success(`Pengadaan aset ${doc.documentNumber} berhasil dibatalkan.`);
      this.closeCancelDialog();
      if (this.isDetailModalOpen()) {
        this.closeDetailModal();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal membatalkan pengadaan aset.');
    }
  }

  formatRupiah(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
