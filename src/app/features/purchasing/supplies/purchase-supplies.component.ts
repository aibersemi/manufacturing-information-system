import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheckCircle,
  phosphorCreditCard,
  phosphorEye,
  phosphorFileText,
  phosphorMagnifyingGlass,
  phosphorPackage,
  phosphorPlus,
  phosphorReceipt,
  phosphorTrash,
  phosphorWarningCircle,
  phosphorX,
  phosphorXCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmButton } from '@spartan-ng/helm/button';
import { toast } from 'ngx-sonner';
import { CompanyService } from '../../../core/services/company.service';
import {
  BusinessDocument,
  MasterRecord,
  PurchasingInventoryService,
  PurchaseLineInput,
} from '../../../core/services/purchasing-inventory.service';

interface SupplyLineForm {
  itemId: string;
  description: string;
  unitCode: string;
  conversionFactor: number;
  quantity: number;
  unitPrice: number;
}

@Component({
  selector: 'app-purchase-supplies',
  imports: [CommonModule, FormsModule, NgIcon, HlmButton],
  providers: [
    provideIcons({
      phosphorPlus,
      phosphorArrowsClockwise,
      phosphorMagnifyingGlass,
      phosphorCheckCircle,
      phosphorXCircle,
      phosphorWarningCircle,
      phosphorEye,
      phosphorTrash,
      phosphorX,
      phosphorCreditCard,
      phosphorReceipt,
      phosphorPackage,
      phosphorFileText,
    }),
  ],
  templateUrl: './purchase-supplies.component.html',
})
export class PurchaseSuppliesComponent {
  private readonly purchasingService = inject(PurchasingInventoryService);
  private readonly companyService = inject(CompanyService);

  readonly documents = signal<BusinessDocument[]>([]);
  readonly suppliers = signal<MasterRecord[]>([]);
  readonly supplies = signal<MasterRecord[]>([]);
  readonly cashAccounts = signal<MasterRecord[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly searchQuery = signal('');
  readonly statusFilter = signal<'all' | 'draft' | 'posted' | 'void'>('all');

  readonly isModalOpen = signal(false);
  readonly isDetailModalOpen = signal(false);
  readonly selectedDoc = signal<BusinessDocument | null>(null);
  readonly isSubmitting = signal(false);
  readonly formError = signal<string | null>(null);

  readonly editingDocId = signal<string | null>(null);
  readonly formSupplierId = signal('');
  readonly formTransactionDate = signal(new Date().toISOString().slice(0, 10));
  readonly formFundingMethod = signal<'payable' | 'cash'>('payable');
  readonly formCashAccountId = signal('');
  readonly formNotes = signal('');
  readonly formLines = signal<SupplyLineForm[]>([
    {
      itemId: '',
      description: '',
      unitCode: 'pcs',
      conversionFactor: 1,
      quantity: 1,
      unitPrice: 0,
    },
  ]);

  readonly isVoidModalOpen = signal(false);
  readonly voidDocId = signal<string | null>(null);
  readonly voidReason = signal('');

  readonly filteredDocuments = computed(() => {
    const list = this.documents();
    const query = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();

    return list.filter((doc) => {
      const matchStatus = status === 'all' || doc.status === status;
      if (!matchStatus) return false;

      if (!query) return true;
      const num = (doc.document_number || '').toLowerCase();
      const party = (doc as unknown as { counterparty?: { name: string } }).counterparty;
      const partyName = (party?.name || '').toLowerCase();
      return num.includes(query) || partyName.includes(query);
    });
  });

  readonly totalFormAmount = computed(() => {
    return this.formLines().reduce((acc, line) => acc + (line.quantity * line.unitPrice), 0);
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
      const [docs, sups, supsItems, cash] = await Promise.all([
        this.purchasingService.getPurchaseDocuments('purchase_supplies'),
        this.purchasingService.getSuppliers(),
        this.purchasingService.getSupplies(),
        this.purchasingService.getCashAccounts(),
      ]);
      this.documents.set(docs);
      this.suppliers.set(sups);
      this.supplies.set(supsItems);
      this.cashAccounts.set(cash);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memuat data');
    } finally {
      this.isLoading.set(false);
    }
  }

  openCreateModal(): void {
    this.editingDocId.set(null);
    this.formSupplierId.set(this.suppliers()[0]?.id || '');
    this.formTransactionDate.set(new Date().toISOString().slice(0, 10));
    this.formFundingMethod.set('payable');
    this.formCashAccountId.set(this.cashAccounts()[0]?.id || '');
    this.formNotes.set('');
    this.formLines.set([
      {
        itemId: this.supplies()[0]?.id || '',
        description: this.supplies()[0]?.name || '',
        unitCode: (this.supplies()[0]?.data as Record<string, unknown> | undefined)?.['stockUnitCode'] as string || 'pcs',
        conversionFactor: 1,
        quantity: 1,
        unitPrice: 0,
      },
    ]);
    this.formError.set(null);
    this.isModalOpen.set(true);
  }

  openDetailModal(doc: BusinessDocument): void {
    this.selectedDoc.set(doc);
    this.isDetailModalOpen.set(true);
  }

  closeDetailModal(): void {
    this.selectedDoc.set(null);
    this.isDetailModalOpen.set(false);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.formError.set(null);
  }

  addLine(): void {
    const defaultSup = this.supplies()[0];
    this.formLines.update((lines) => [
      ...lines,
      {
        itemId: defaultSup?.id || '',
        description: defaultSup?.name || '',
        unitCode: (defaultSup?.data as Record<string, unknown> | undefined)?.['stockUnitCode'] as string || 'pcs',
        conversionFactor: 1,
        quantity: 1,
        unitPrice: 0,
      },
    ]);
  }

  removeLine(index: number): void {
    if (this.formLines().length <= 1) return;
    this.formLines.update((lines) => lines.filter((_, i) => i !== index));
  }

  onSupplyChange(index: number, supplyId: string): void {
    const sup = this.supplies().find((s) => s.id === supplyId);
    if (!sup) return;
    const data = (sup.data || {}) as Record<string, unknown>;
    const unit = String(data['stockUnitCode'] || data['unitCode'] || 'pcs');

    this.formLines.update((lines) => {
      const updated = [...lines];
      updated[index] = {
        ...updated[index],
        itemId: supplyId,
        description: sup.name,
        unitCode: unit,
      };
      return updated;
    });
  }

  updateLineField(index: number, field: keyof SupplyLineForm, value: unknown): void {
    this.formLines.update((lines) => {
      const updated = [...lines];
      updated[index] = {
        ...updated[index],
        [field]: value,
      };
      return updated;
    });
  }

  async saveDraft(): Promise<void> {
    if (!this.formSupplierId()) {
      this.formError.set('Pemasok wajib dipilih.');
      return;
    }
    if (this.formLines().length === 0) {
      this.formError.set('Minimal satu baris perlengkapan wajib diisi.');
      return;
    }

    this.isSubmitting.set(true);
    this.formError.set(null);

    try {
      const payloadLines: PurchaseLineInput[] = this.formLines().map((l) => ({
        itemId: l.itemId || null,
        description: l.description,
        unitCode: l.unitCode,
        conversionFactor: Number(l.conversionFactor) || 1,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        data: {
          stockUnitCode: l.unitCode,
        },
      }));

      await this.purchasingService.savePurchaseDraft({
        id: this.editingDocId() || undefined,
        documentKind: 'purchase_supplies',
        counterpartyId: this.formSupplierId(),
        transactionDate: this.formTransactionDate(),
        fundingMethod: this.formFundingMethod(),
        cashAccountId: this.formFundingMethod() === 'cash' ? this.formCashAccountId() : null,
        notes: this.formNotes(),
        lines: payloadLines,
      });

      this.successMessage.set('Draft pembelian perlengkapan pabrik berhasil disimpan.');
      this.closeModal();
      await this.loadData();
      setTimeout(() => this.successMessage.set(null), 3000);
    } catch (err: unknown) {
      this.formError.set(err instanceof Error ? err.message : 'Gagal menyimpan draft');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async postDocument(doc: BusinessDocument): Promise<void> {
    if (!confirm(`Posting pembelian perlengkapan ini? Stok dan hutang/kas akan diperbarui.`)) {
      return;
    }

    this.isLoading.set(true);
    try {
      const res = await this.purchasingService.postPurchase(doc.id);
      this.successMessage.set(`Dokumen ${res.documentNumber} berhasil diposting.`);
      await this.loadData();
      setTimeout(() => this.successMessage.set(null), 3000);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Gagal memposting dokumen');
    } finally {
      this.isLoading.set(false);
    }
  }

  openVoidModal(doc: BusinessDocument): void {
    this.voidDocId.set(doc.id);
    this.voidReason.set('');
    this.isVoidModalOpen.set(true);
  }

  closeVoidModal(): void {
    this.voidDocId.set(null);
    this.voidReason.set('');
    this.isVoidModalOpen.set(false);
  }

  async confirmVoid(): Promise<void> {
    const docId = this.voidDocId();
    const reason = this.voidReason().trim();

    if (!docId) return;
    if (!reason) {
      toast.error('Alasan pembatalan wajib diisi.');
      return;
    }

    this.isSubmitting.set(true);
    try {
      await this.purchasingService.voidPurchase(docId, reason);
      this.successMessage.set('Dokumen pembelian perlengkapan berhasil dibatalkan (void).');
      this.closeVoidModal();
      await this.loadData();
      setTimeout(() => this.successMessage.set(null), 3000);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal membatalkan dokumen');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  formatCurrency(val: number): string {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  }
}
