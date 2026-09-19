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

interface NonProductionLineForm {
  description: string;
  unitCode: string;
  quantity: number;
  unitPrice: number;
}

@Component({
  selector: 'app-purchase-non-production',
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
      phosphorFileText,
    }),
  ],
  templateUrl: './purchase-non-production.component.html',
})
export class PurchaseNonProductionComponent {
  private readonly purchasingService = inject(PurchasingInventoryService);
  private readonly companyService = inject(CompanyService);

  readonly documents = signal<BusinessDocument[]>([]);
  readonly suppliers = signal<MasterRecord[]>([]);
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
  readonly formLines = signal<NonProductionLineForm[]>([
    {
      description: '',
      unitCode: 'unit',
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
      const [docs, sups, cash] = await Promise.all([
        this.purchasingService.getPurchaseDocuments('purchase_non_production'),
        this.purchasingService.getSuppliers(),
        this.purchasingService.getCashAccounts(),
      ]);
      this.documents.set(docs);
      this.suppliers.set(sups);
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
        description: '',
        unitCode: 'unit',
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
    this.formLines.update((lines) => [
      ...lines,
      {
        description: '',
        unitCode: 'unit',
        quantity: 1,
        unitPrice: 0,
      },
    ]);
  }

  removeLine(index: number): void {
    if (this.formLines().length <= 1) return;
    this.formLines.update((lines) => lines.filter((_, i) => i !== index));
  }

  updateLineField(index: number, field: keyof NonProductionLineForm, value: unknown): void {
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
      this.formError.set('Pemasok/Vendor wajib dipilih.');
      return;
    }
    if (this.formLines().some((l) => !l.description.trim())) {
      this.formError.set('Seluruh baris wajib memiliki deskripsi barang atau jasa.');
      return;
    }

    this.isSubmitting.set(true);
    this.formError.set(null);

    try {
      const payloadLines: PurchaseLineInput[] = this.formLines().map((l) => ({
        description: l.description,
        unitCode: l.unitCode,
        conversionFactor: 1,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
      }));

      await this.purchasingService.savePurchaseDraft({
        id: this.editingDocId() || undefined,
        documentKind: 'purchase_non_production',
        counterpartyId: this.formSupplierId(),
        transactionDate: this.formTransactionDate(),
        fundingMethod: this.formFundingMethod(),
        cashAccountId: this.formFundingMethod() === 'cash' ? this.formCashAccountId() : null,
        notes: this.formNotes(),
        lines: payloadLines,
      });

      this.successMessage.set('Draft pengadaan non-produksi berhasil disimpan.');
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
    if (!confirm(`Posting pengadaan non-produksi ini? Jurnal beban dan kewajiban/kas akan dibukukan.`)) {
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
      this.successMessage.set('Dokumen non-produksi berhasil dibatalkan (void).');
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
