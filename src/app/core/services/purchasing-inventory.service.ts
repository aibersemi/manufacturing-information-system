import { inject, Injectable } from '@angular/core';
import { Tables, TablesInsert } from '../../../types/database.types';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { SupabaseService } from './supabase.service';

export interface BusinessDocumentData {
  fundingMethod?: 'payable' | 'cash' | string;
  cashAccountId?: string | null;
  notes?: string;
  purchaseDocumentNumber?: string;
  cashAccountName?: string;
  [key: string]: unknown;
}

export type BusinessDocument = Omit<Tables<'business_document'>, 'data'> & {
  data?: BusinessDocumentData | null;
  counterparty?: { id: string; name: string } | null;
  lines?: BusinessDocumentLine[];
  purchase?: { id: string; document_number: string } | null;
  paid_amount?: number;
};
export type BusinessDocumentLine = Tables<'business_document_line'>;
export type InventoryMovement = Tables<'inventory_movement'> & {
  item?: { id: string; name: string; code?: string } | null;
  doc?: { id: string; document_number: string } | null;
};
export type ProductionMaterialUnit = Tables<'production_material_unit'> & {
  material?: { id: string; name: string; code?: string } | null;
  doc?: { id: string; document_number: string } | null;
};
export type MasterRecord = Tables<'master_record'>;

export interface PurchaseLineInput {
  id?: string;
  itemId?: string | null;
  accountId?: string | null;
  description: string;
  unitCode: string;
  conversionFactor: number;
  quantity: number;
  unitPrice: number;
  totalAmount?: number;
  data?: Record<string, unknown>;
}

export interface PurchaseDraftPayload {
  id?: string;
  documentKind: 'purchase_material' | 'purchase_supplies' | 'purchase_non_production';
  counterpartyId: string;
  transactionDate: string;
  fundingMethod: 'payable' | 'cash';
  cashAccountId?: string | null;
  notes?: string;
  lines: PurchaseLineInput[];
}

export interface PurchaseFilterOptions {
  search?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface InventorySummaryItem {
  item_id: string;
  item_name: string;
  item_kind: string;
  unit_code: string;
  inventory_state: string;
  total_in: number;
  total_out: number;
  current_stock: number;
  moving_avg_cost: number;
  total_valuation: number;
}

export interface PurchasePaymentPayload {
  purchaseId: string;
  cashAccountId: string;
  amount: number;
  date: string;
  notes?: string;
}

@Injectable({
  providedIn: 'root',
})
export class PurchasingInventoryService {
  private readonly supabase = inject(SupabaseService);
  private readonly companyService = inject(CompanyService);
  private readonly authService = inject(AuthService);

  private async requireActiveCompanyId(): Promise<string> {
    let companyId = this.companyService.activeCompanyId();
    if (!companyId) {
      companyId = await this.companyService.waitForActiveCompany();
    }
    if (!companyId) {
      throw new Error('Tidak ada perusahaan/fasilitas aktif yang dipilih.');
    }
    return companyId;
  }

  // ============================================================================
  // 1. DOKUMEN PEMBELIAN (PURCHASE DOCUMENTS)
  // ============================================================================

  async getPurchaseDocuments(
    kind: 'purchase_material' | 'purchase_supplies' | 'purchase_non_production',
    options?: PurchaseFilterOptions
  ): Promise<BusinessDocument[]> {
    const companyId = await this.requireActiveCompanyId();

    let query = this.supabase.client
      .from('business_document')
      .select('*, counterparty:master_record!counterparty_id(id, name, data), lines:business_document_line(*)')
      .eq('company_id', companyId)
      .eq('document_kind', kind);

    if (options?.status && options.status !== 'all') {
      query = query.eq('status', options.status);
    }

    if (options?.startDate) {
      query = query.gte('transaction_date', options.startDate);
    }

    if (options?.endDate) {
      query = query.lte('transaction_date', options.endDate);
    }

    const { data, error } = await query.order('transaction_date', { ascending: false }).order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Gagal memuat daftar dokumen pembelian: ${error.message}`);
    }

    let results = (data ?? []) as unknown as BusinessDocument[];

    if (options?.search && options.search.trim()) {
      const q = options.search.trim().toLowerCase();
      results = results.filter((doc) => {
        const docNum = (doc.document_number || '').toLowerCase();
        const counterparty = (doc as unknown as { counterparty?: { name: string } }).counterparty;
        const partyName = (counterparty?.name || '').toLowerCase();
        return docNum.includes(q) || partyName.includes(q);
      });
    }

    return results;
  }

  async getPurchaseDocumentById(id: string): Promise<BusinessDocument> {
    const companyId = await this.requireActiveCompanyId();

    const { data, error } = await this.supabase.client
      .from('business_document')
      .select('*, counterparty:master_record!counterparty_id(id, name, data), lines:business_document_line(*)')
      .eq('company_id', companyId)
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new Error(`Dokumen pembelian tidak ditemukan: ${error?.message || ''}`);
    }

    return data as unknown as BusinessDocument;
  }

  async savePurchaseDraft(payload: PurchaseDraftPayload): Promise<BusinessDocument> {
    const companyId = await this.requireActiveCompanyId();
    const currentUser = this.authService.currentUser();

    if (!payload.counterpartyId) {
      throw new Error('Pemasok wajib dipilih.');
    }
    if (!payload.transactionDate) {
      throw new Error('Tanggal transaksi wajib diisi.');
    }
    if (!payload.lines || payload.lines.length === 0) {
      throw new Error('Dokumen pembelian wajib memiliki minimal satu baris item.');
    }

    // Validasi & hitung baris item
    let totalDocAmount = 0;
    const preparedLines: TablesInsert<'business_document_line'>[] = [];

    for (const [idx, line] of payload.lines.entries()) {
      const qty = Number(line.quantity);
      const price = Number(line.unitPrice);
      const conv = Number(line.conversionFactor) || 1;

      if (qty <= 0) {
        throw new Error(`Kuantitas baris ${idx + 1} harus lebih dari 0.`);
      }
      if (price < 0) {
        throw new Error(`Harga satuan baris ${idx + 1} tidak boleh negatif.`);
      }
      if (conv <= 0) {
        throw new Error(`Faktor konversi baris ${idx + 1} harus lebih dari 0.`);
      }

      const lineTotal = Math.round(qty * price);
      totalDocAmount += lineTotal;

      preparedLines.push({
        company_id: companyId,
        document_id: payload.id || '00000000-0000-0000-0000-000000000000', // placeholder jika dokumen baru
        line_number: idx + 1,
        item_id: line.itemId || null,
        account_id: line.accountId || null,
        description: line.description || '',
        unit_code: line.unitCode || '',
        conversion_factor: conv,
        quantity: qty,
        unit_price: price,
        subtotal: lineTotal,
        total_amount: lineTotal,
        data: (line.data ?? {}) as unknown as TablesInsert<'business_document_line'>['data'],
        is_current: true,
        revision: 1,
        version: 1,
      });
    }

    const docData = {
      fundingMethod: payload.fundingMethod || 'payable',
      cashAccountId: payload.fundingMethod === 'cash' ? payload.cashAccountId : null,
      notes: payload.notes || '',
    };

    let documentId = payload.id;
    let savedDoc: BusinessDocument;

    if (documentId) {
      // Pastikan masih draft
      const existing = await this.getPurchaseDocumentById(documentId);
      if (existing.status !== 'draft') {
        throw new Error('Hanya dokumen dengan status draft yang dapat diubah.');
      }

      const { data: updated, error: updateErr } = await this.supabase.client
        .from('business_document')
        .update({
          counterparty_id: payload.counterpartyId,
          transaction_date: payload.transactionDate,
          total_amount: totalDocAmount,
          data: docData,
          updated_by_user_id: currentUser?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', documentId)
        .eq('company_id', companyId)
        .select('*')
        .single();

      if (updateErr || !updated) {
        throw new Error(`Gagal memperbarui draft pembelian: ${updateErr?.message || ''}`);
      }
      savedDoc = updated as BusinessDocument;

      // Hapus baris lama, masukkan baris baru
      await this.supabase.client
        .from('business_document_line')
        .delete()
        .eq('document_id', documentId)
        .eq('company_id', companyId);

    } else {
      // Buat dokumen draft baru
      const newDocPayload: TablesInsert<'business_document'> = {
        company_id: companyId,
        document_kind: payload.documentKind,
        status: 'draft',
        transaction_date: payload.transactionDate,
        counterparty_id: payload.counterpartyId,
        total_amount: totalDocAmount,
        paid_amount: 0,
        data: docData,
        created_by_user_id: currentUser?.id ?? null,
        version: 1,
      };

      const { data: created, error: createErr } = await this.supabase.client
        .from('business_document')
        .insert(newDocPayload)
        .select('*')
        .single();

      if (createErr || !created) {
        throw new Error(`Gagal membuat draft pembelian baru: ${createErr?.message || ''}`);
      }
      savedDoc = created as BusinessDocument;
      documentId = savedDoc.id;
    }

    // Masukkan baris dokumen
    const linesToInsert = preparedLines.map((l) => ({
      ...l,
      document_id: documentId!,
    }));

    const { error: lineErr } = await this.supabase.client
      .from('business_document_line')
      .insert(linesToInsert);

    if (lineErr) {
      throw new Error(`Gagal menyimpan baris rincian pembelian: ${lineErr.message}`);
    }

    return savedDoc;
  }

  async postPurchase(documentId: string): Promise<{ success: boolean; documentNumber: string }> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      throw new Error('Pengguna tidak terautentikasi.');
    }

    const { data, error } = await this.supabase.client.rpc('post_purchase_document', {
      p_document_id: documentId,
      p_user_id: currentUser.id,
    });

    if (error) {
      throw new Error(`Gagal memposting pembelian: ${error.message}`);
    }

    const result = data as { success?: boolean; documentNumber?: string };
    return {
      success: true,
      documentNumber: result.documentNumber ?? '',
    };
  }

  async voidPurchase(documentId: string, reason: string): Promise<{ success: boolean }> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      throw new Error('Pengguna tidak terautentikasi.');
    }

    const trimmedReason = (reason || '').trim();
    if (!trimmedReason) {
      throw new Error('Alasan pembatalan (void) wajib dicantumkan.');
    }

    const { data, error } = await this.supabase.client.rpc('void_purchase_document', {
      p_document_id: documentId,
      p_user_id: currentUser.id,
      p_reason: trimmedReason,
    });

    if (error) {
      throw new Error(`Gagal membatalkan dokumen pembelian: ${error.message}`);
    }

    return { success: (data as { success?: boolean })?.success ?? true };
  }

  // ============================================================================
  // 2. PEMBAYARAN PEMBELIAN / HUTANG (PURCHASE PAYMENT)
  // ============================================================================

  async getPayablePurchases(): Promise<BusinessDocument[]> {
    const companyId = await this.requireActiveCompanyId();

    const { data, error } = await this.supabase.client
      .from('business_document')
      .select('*, counterparty:master_record!counterparty_id(id, name, data), subledger:subledger_entry!source_document_id(*)')
      .eq('company_id', companyId)
      .eq('status', 'posted')
      .in('document_kind', ['purchase_material', 'purchase_supplies', 'purchase_non_production'])
      .order('transaction_date', { ascending: false });

    if (error) {
      throw new Error(`Gagal memuat tagihan pembelian belum lunas: ${error.message}`);
    }

    // Filter dokumen yang sisa tagihannya > 0
    const results = ((data ?? []) as unknown as BusinessDocument[]).filter((doc) => {
      const remaining = Number(doc.total_amount) - Number(doc.paid_amount);
      return remaining > 0;
    });

    return results;
  }

  async getPaymentHistory(): Promise<BusinessDocument[]> {
    const companyId = await this.requireActiveCompanyId();

    const { data, error } = await this.supabase.client
      .from('business_document')
      .select('*, counterparty:master_record!counterparty_id(id, name, data), purchase:business_document!source_document_id(id, document_number, total_amount)')
      .eq('company_id', companyId)
      .eq('document_kind', 'purchase_payment')
      .eq('status', 'posted')
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Gagal memuat riwayat pembayaran pembelian: ${error.message}`);
    }

    return (data ?? []) as unknown as BusinessDocument[];
  }

  async payPurchase(payload: PurchasePaymentPayload): Promise<{ success: boolean; paymentNumber: string }> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      throw new Error('Pengguna tidak terautentikasi.');
    }
    if (!payload.purchaseId) {
      throw new Error('Dokumen pembelian wajib dipilih.');
    }
    if (!payload.cashAccountId) {
      throw new Error('Akun Kas/Bank sumber dana wajib dipilih.');
    }
    if (payload.amount <= 0) {
      throw new Error('Jumlah pembayaran harus lebih dari 0.');
    }
    if (!payload.date) {
      throw new Error('Tanggal pembayaran wajib diisi.');
    }

    const { data, error } = await this.supabase.client.rpc('post_purchase_payment', {
      p_purchase_id: payload.purchaseId,
      p_cash_account_id: payload.cashAccountId,
      p_amount: payload.amount,
      p_date: payload.date,
      p_notes: payload.notes || '',
      p_user_id: currentUser.id,
    });

    if (error) {
      throw new Error(`Gagal memproses pembayaran hutang: ${error.message}`);
    }

    const result = data as { success?: boolean; paymentNumber?: string };
    return {
      success: true,
      paymentNumber: result.paymentNumber ?? '',
    };
  }

  // ============================================================================
  // 3. INVENTARIS & BUKU BESAR MUTASI (INVENTORY & LEDGER)
  // ============================================================================

  async getInventorySummary(): Promise<InventorySummaryItem[]> {
    const companyId = await this.requireActiveCompanyId();

    const { data, error } = await this.supabase.client.rpc('get_inventory_summary', {
      p_company_id: companyId,
    });

    if (error) {
      throw new Error(`Gagal memuat ringkasan stok inventaris: ${error.message}`);
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      item_id: String(row['item_id'] || ''),
      item_name: String(row['item_name'] || ''),
      item_kind: String(row['item_kind'] || ''),
      unit_code: String(row['unit_code'] || '-'),
      inventory_state: String(row['inventory_state'] || 'material'),
      total_in: Number(row['total_in'] || 0),
      total_out: Number(row['total_out'] || 0),
      current_stock: Number(row['current_stock'] || 0),
      moving_avg_cost: Number(row['moving_avg_cost'] || 0),
      total_valuation: Number(row['total_valuation'] || 0),
    }));
  }

  async getInventoryMovements(itemId?: string): Promise<InventoryMovement[]> {
    const companyId = await this.requireActiveCompanyId();

    let query = this.supabase.client
      .from('inventory_movement')
      .select('*, item:master_record!item_id(id, name, record_kind, data), doc:business_document!source_document_id(id, document_number, document_kind)')
      .eq('company_id', companyId);

    if (itemId) {
      query = query.eq('item_id', itemId);
    }

    const { data, error } = await query
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Gagal memuat kartu mutasi stok: ${error.message}`);
    }

    return (data ?? []) as unknown as InventoryMovement[];
  }

  async getMaterialRolls(materialId?: string): Promise<ProductionMaterialUnit[]> {
    const companyId = await this.requireActiveCompanyId();

    let query = this.supabase.client
      .from('production_material_unit')
      .select('*, material:master_record!material_id(id, name), doc:business_document!source_document_id(id, document_number)')
      .eq('company_id', companyId);

    if (materialId) {
      query = query.eq('material_id', materialId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Gagal memuat data roll kain: ${error.message}`);
    }

    return (data ?? []) as unknown as ProductionMaterialUnit[];
  }

  // ============================================================================
  // 4. DATA PENDUKUNG (DROPDOWN OPTION HELPERS)
  // ============================================================================

  async getCashAccounts(): Promise<MasterRecord[]> {
    const companyId = await this.requireActiveCompanyId();
    const { data, error } = await this.supabase.client
      .from('master_record')
      .select('*')
      .eq('company_id', companyId)
      .eq('record_kind', 'cash_account')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw new Error(`Gagal memuat akun kas: ${error.message}`);
    return (data ?? []) as MasterRecord[];
  }

  async getSuppliers(): Promise<MasterRecord[]> {
    const companyId = await this.requireActiveCompanyId();
    const { data, error } = await this.supabase.client
      .from('master_record')
      .select('*')
      .eq('company_id', companyId)
      .eq('record_kind', 'supplier')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw new Error(`Gagal memuat pemasok: ${error.message}`);
    return (data ?? []) as MasterRecord[];
  }

  async getMaterials(): Promise<MasterRecord[]> {
    const companyId = await this.requireActiveCompanyId();
    const { data, error } = await this.supabase.client
      .from('master_record')
      .select('*')
      .eq('company_id', companyId)
      .eq('record_kind', 'material')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw new Error(`Gagal memuat bahan baku: ${error.message}`);
    return (data ?? []) as MasterRecord[];
  }

  async getSupplies(): Promise<MasterRecord[]> {
    const companyId = await this.requireActiveCompanyId();
    const { data, error } = await this.supabase.client
      .from('master_record')
      .select('*')
      .eq('company_id', companyId)
      .eq('record_kind', 'production_supply')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw new Error(`Gagal memuat perlengkapan: ${error.message}`);
    return (data ?? []) as MasterRecord[];
  }
}
