import { inject, Injectable, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { SupabaseService } from './supabase.service';
import type { Json } from '../../../types/database.types';

export interface AssetPurchaseLineInput {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateAssetPurchasePayload {
  supplierId: string;
  transactionDate: string;
  notes?: string;
  lines: AssetPurchaseLineInput[];
}

export interface AssetPurchaseLine {
  id: string;
  lineNumber: number;
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  totalAmount: number;
}

export interface AssetPurchaseDocument {
  id: string;
  documentNumber: string;
  transactionDate: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  totalAmount: number;
  paidAmount: number;
  status: 'draft' | 'posted' | 'void' | string;
  notes: string;
  totalUnits: number;
  lines: AssetPurchaseLine[];
  postedAt: string | null;
  createdAt: string;
}

export interface AssetCategory {
  id: string;
  code: string;
  name: string;
}

export type AssetStatus = 'active' | 'candidate' | 'disposed' | 'cancelled';

export interface AssetRecordItem {
  id: string;
  companyId: string;
  assetCode: string;
  name: string;
  status: AssetStatus;
  categoryId: string | null;
  categoryName?: string | null;
  sourceDocumentId: string | null;
  sourceDocumentNumber?: string | null;
  sourcePurchaseLineId: string | null;
  acquisitionCost: number;
  residualValue: number;
  depreciationMethod: 'straight_line' | 'declining_balance' | null;
  usefulLifeMonths: number | null;
  capitalizationDate: string | null;
  depreciationStartDate: string | null;
  accumulatedDepreciation: number;
  bookValue: number;
  location: string | null;
  custodian: string | null;
  serialNumber: string | null;
  data: Record<string, unknown>;
  isLocked: boolean;
  isSetupComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateAssetParametersPayload {
  categoryId?: string | null;
  depreciationMethod?: 'straight_line' | 'declining_balance' | null;
  usefulLifeMonths?: number | null;
  residualValue?: number | null;
  depreciationStartDate?: string | null;
  location?: string | null;
  custodian?: string | null;
  serialNumber?: string | null;
}

export interface EligibleAssetPreview {
  assetId: string;
  assetCode: string;
  name: string;
  categoryName: string;
  acquisitionCost: number;
  residualValue: number;
  depreciationMethod: string;
  usefulLifeMonths: number;
  periodNumber: number;
  accumulatedDepreciation: number;
  bookValueBefore: number;
  depreciationAmount: number;
  bookValueAfter: number;
}

export interface IneligibleAssetPreview {
  assetId: string;
  assetCode: string;
  name: string;
  categoryName: string;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  reason: string;
}

export interface DepreciationPreviewSummary {
  periodMonth: string;
  totalEligibleAssets: number;
  totalEligibleAmount: number;
  totalIneligibleAssets: number;
  eligibleAssets: EligibleAssetPreview[];
  ineligibleAssets: IneligibleAssetPreview[];
}

export interface DepreciationEntryItem {
  id: string;
  assetId: string;
  assetCode?: string;
  assetName?: string;
  periodMonth: string;
  amount: number;
  postedAt: string;
}

export interface DepreciationDocument {
  id: string;
  documentNumber: string;
  periodMonth: string;
  transactionDate: string;
  totalAmount: number;
  assetCount: number;
  status: string;
  notes: string;
  postedAt: string;
  entries?: DepreciationEntryItem[];
}

export interface AssetDisposalDocument {
  id: string;
  documentNumber: string;
  transactionDate: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  bookValue: number;
  proceeds: number;
  gain: number;
  loss: number;
  cashAccountId: string | null;
  reason: string;
  status: string;
  postedAt: string;
}

export interface PostAssetDisposalPayload {
  assetId: string;
  disposalDate: string;
  proceeds: number;
  cashAccountId?: string | null;
  reason?: string;
}

interface RawAssetQueryRow {
  id: string;
  company_id: string;
  asset_code: string;
  name: string;
  status: AssetStatus;
  category_id: string | null;
  category: { id: string; name: string; code: string } | null;
  source_document_id: string | null;
  source_document: { id: string; document_number: string } | null;
  source_purchase_line_id: string | null;
  acquisition_cost: number;
  residual_value: number;
  depreciation_method: 'straight_line' | 'declining_balance' | null;
  useful_life_months: number | null;
  capitalization_date: string | null;
  depreciation_start_date: string | null;
  accumulated_depreciation: number;
  location: string | null;
  custodian: string | null;
  serial_number: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function mapRawAssetToRecord(row: RawAssetQueryRow): AssetRecordItem {
  const acqCost = Number(row.acquisition_cost) || 0;
  const accDep = Number(row.accumulated_depreciation) || 0;
  const resVal = Number(row.residual_value) || 0;
  const bookVal = acqCost - accDep;
  const isLocked = accDep > 0;
  const isSetupComplete =
    row.depreciation_method !== null &&
    row.useful_life_months !== null &&
    Number(row.useful_life_months) > 0 &&
    row.depreciation_start_date !== null;

  return {
    id: row.id,
    companyId: row.company_id,
    assetCode: row.asset_code,
    name: row.name,
    status: row.status,
    categoryId: row.category_id,
    categoryName: row.category?.name || null,
    sourceDocumentId: row.source_document_id,
    sourceDocumentNumber: row.source_document?.document_number || null,
    sourcePurchaseLineId: row.source_purchase_line_id,
    acquisitionCost: acqCost,
    residualValue: resVal,
    depreciationMethod: row.depreciation_method,
    usefulLifeMonths: row.useful_life_months ? Number(row.useful_life_months) : null,
    capitalizationDate: row.capitalization_date,
    depreciationStartDate: row.depreciation_start_date,
    accumulatedDepreciation: accDep,
    bookValue: bookVal,
    location: row.location || null,
    custodian: row.custodian || null,
    serialNumber: row.serial_number || null,
    data: (row.data || {}) as Record<string, unknown>,
    isLocked,
    isSetupComplete,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable({
  providedIn: 'root',
})
export class AssetService {
  private readonly supabase = inject(SupabaseService);
  private readonly companyService = inject(CompanyService);
  private readonly authService = inject(AuthService);

  // State Reaktif
  readonly assetPurchases = signal<AssetPurchaseDocument[]>([]);
  readonly assets = signal<AssetRecordItem[]>([]);
  readonly selectedAsset = signal<AssetRecordItem | null>(null);
  readonly depreciationPreview = signal<DepreciationPreviewSummary | null>(null);
  readonly depreciationHistory = signal<DepreciationDocument[]>([]);
  readonly assetDisposals = signal<AssetDisposalDocument[]>([]);
  readonly categories = signal<AssetCategory[]>([]);
  readonly loading = signal<boolean>(false);

  private async requireActiveCompanyId(): Promise<string> {
    let companyId = this.companyService.activeCompanyId();
    if (!companyId) {
      companyId = await this.companyService.waitForActiveCompany();
    }
    if (!companyId) {
      throw new Error('Perusahaan aktif belum dipilih.');
    }
    return companyId;
  }

  private requireCurrentUserId(): string {
    const user = this.authService.currentUser();
    if (!user?.id) {
      throw new Error('Pengguna belum terautentikasi.');
    }
    return user.id;
  }

  // ============================================================================
  // 1. Pengadaan Aset Tetap (Asset Purchases)
  // ============================================================================

  async loadAssetPurchases(): Promise<AssetPurchaseDocument[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();

      const { data, error } = await this.supabase.client
        .from('business_document')
        .select(
          `
          id,
          document_number,
          transaction_date,
          counterparty_id,
          total_amount,
          paid_amount,
          status,
          data,
          posted_at,
          created_at,
          counterparty:master_record!counterparty_id(id, name),
          lines:business_document_line(*)
        `
        )
        .eq('company_id', companyId)
        .eq('document_kind', 'asset_purchase')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Gagal memuat daftar pengadaan aset: ${error.message}`);
      }

      const mapped: AssetPurchaseDocument[] = (data || []).map((doc) => {
        const docRecord = doc as Record<string, unknown>;
        const docData = (docRecord['data'] || {}) as Record<string, unknown>;
        const rawLines = (docRecord['lines'] || []) as Record<string, unknown>[];
        const lines: AssetPurchaseLine[] = rawLines
          .filter((l) => l['is_current'] !== false)
          .map((l) => ({
            id: String(l['id'] || ''),
            lineNumber: Number(l['line_number']) || 0,
            description: String(l['description'] || ''),
            quantity: Number(l['quantity']) || 0,
            unitPrice: Number(l['unit_price']) || 0,
            subtotal: Number(l['subtotal']) || 0,
            totalAmount: Number(l['total_amount']) || 0,
          }));

        const totalUnits = lines.reduce((acc, curr) => acc + curr.quantity, 0);

        return {
          id: doc.id,
          documentNumber: doc.document_number || 'DRAFT',
          transactionDate: doc.transaction_date,
          counterpartyId: doc.counterparty_id,
          counterpartyName: doc.counterparty?.name || null,
          totalAmount: Number(doc.total_amount) || 0,
          paidAmount: Number(doc.paid_amount) || 0,
          status: doc.status,
          notes: String(docData['notes'] || ''),
          totalUnits,
          lines,
          postedAt: doc.posted_at,
          createdAt: doc.created_at,
        };
      });

      this.assetPurchases.set(mapped);
      return mapped;
    } finally {
      this.loading.set(false);
    }
  }

  async createAssetPurchase(payload: CreateAssetPurchasePayload): Promise<{ id: string; documentNumber: string }> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      if (!payload.supplierId) {
        throw new Error('Pemasok wajib dipilih.');
      }
      if (!payload.lines || payload.lines.length === 0) {
        throw new Error('Minimal satu baris aset wajib diisi.');
      }

      const formattedLines = payload.lines.map((l) => ({
        name: l.name.trim(),
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
      }));

      const { data, error } = await this.supabase.client.rpc('create_asset_purchase', {
        p_company_id: companyId,
        p_supplier_id: payload.supplierId,
        p_transaction_date: payload.transactionDate,
        p_notes: payload.notes || '',
        p_lines: formattedLines as unknown as Json,
        p_user_id: userId,
      });

      if (error) {
        throw new Error(error.message);
      }

      const res = data as unknown as { id: string; documentNumber: string };
      await this.loadAssetPurchases();
      return { id: res.id, documentNumber: res.documentNumber };
    } finally {
      this.loading.set(false);
    }
  }

  async postAssetPurchase(documentId: string): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('post_asset_purchase', {
        p_company_id: companyId,
        p_document_id: documentId,
        p_user_id: userId,
      });

      if (error) {
        throw new Error(error.message);
      }

      await Promise.all([this.loadAssetPurchases(), this.loadAssets()]);
    } finally {
      this.loading.set(false);
    }
  }

  async cancelAssetPurchase(documentId: string, reason: string): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      if (!reason || !reason.trim()) {
        throw new Error('Alasan pembatalan wajib diisi.');
      }

      const { error } = await this.supabase.client.rpc('cancel_asset_purchase', {
        p_company_id: companyId,
        p_document_id: documentId,
        p_reason: reason.trim(),
        p_user_id: userId,
      });

      if (error) {
        throw new Error(error.message);
      }

      await Promise.all([this.loadAssetPurchases(), this.loadAssets()]);
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 2. Register Aset & Pengaturan Penyusutan (Asset Register)
  // ============================================================================

  async loadCategories(): Promise<AssetCategory[]> {
    const companyId = await this.requireActiveCompanyId();

    const { data, error } = await this.supabase.client
      .from('configuration_category')
      .select('id, code, name')
      .eq('company_id', companyId)
      .eq('category_kind', 'asset')
      .order('name', { ascending: true });

    if (error) {
      throw new Error(`Gagal memuat kategori aset: ${error.message}`);
    }

    const cats: AssetCategory[] = (data || []).map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
    }));
    this.categories.set(cats);
    return cats;
  }

  async loadAssets(filter?: { categoryId?: string; status?: string; search?: string }): Promise<AssetRecordItem[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();

      let query = this.supabase.client
        .from('asset_record')
        .select(
          `
          id,
          company_id,
          asset_code,
          name,
          status,
          category_id,
          source_document_id,
          source_purchase_line_id,
          acquisition_cost,
          residual_value,
          depreciation_method,
          useful_life_months,
          capitalization_date,
          depreciation_start_date,
          accumulated_depreciation,
          location,
          custodian,
          serial_number,
          data,
          created_at,
          updated_at,
          category:configuration_category!category_id(id, name, code),
          source_document:business_document!source_document_id(id, document_number)
        `
        )
        .eq('company_id', companyId)
        .order('asset_code', { ascending: true });

      if (filter?.status && filter.status !== 'all') {
        query = query.eq('status', filter.status);
      }

      if (filter?.categoryId && filter.categoryId !== 'all') {
        query = query.eq('category_id', filter.categoryId);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Gagal memuat register aset: ${error.message}`);
      }

      const items: AssetRecordItem[] = ((data as unknown as RawAssetQueryRow[]) || []).map(
        mapRawAssetToRecord
      );

      // Local search filtering if specified
      let filtered = items;
      if (filter?.search && filter.search.trim()) {
        const q = filter.search.trim().toLowerCase();
        filtered = items.filter(
          (a) =>
            a.assetCode.toLowerCase().includes(q) ||
            a.name.toLowerCase().includes(q) ||
            (a.location && a.location.toLowerCase().includes(q)) ||
            (a.custodian && a.custodian.toLowerCase().includes(q)) ||
            (a.serialNumber && a.serialNumber.toLowerCase().includes(q))
        );
      }

      this.assets.set(filtered);
      return filtered;
    } finally {
      this.loading.set(false);
    }
  }

  async getAssetById(id: string): Promise<AssetRecordItem> {
    const companyId = await this.requireActiveCompanyId();

    const { data, error } = await this.supabase.client
      .from('asset_record')
      .select(
        `
        id,
        company_id,
        asset_code,
        name,
        status,
        category_id,
        source_document_id,
        source_purchase_line_id,
        acquisition_cost,
        residual_value,
        depreciation_method,
        useful_life_months,
        capitalization_date,
        depreciation_start_date,
        accumulated_depreciation,
        location,
        custodian,
        serial_number,
        data,
        created_at,
        updated_at,
        category:configuration_category!category_id(id, name, code),
        source_document:business_document!source_document_id(id, document_number)
      `
      )
      .eq('company_id', companyId)
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new Error(`Aset tidak ditemukan: ${error?.message || 'Data kosong'}`);
    }

    const item = mapRawAssetToRecord(data as unknown as RawAssetQueryRow);

    this.selectedAsset.set(item);
    return item;
  }

  async updateAssetParameters(assetId: string, payload: UpdateAssetParametersPayload): Promise<void> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      const { error } = await this.supabase.client.rpc('update_asset_parameters', {
        p_company_id: companyId,
        p_asset_id: assetId,
        p_category_id: payload.categoryId ?? undefined,
        p_depreciation_method: payload.depreciationMethod ?? undefined,
        p_useful_life_months: payload.usefulLifeMonths ? Number(payload.usefulLifeMonths) : undefined,
        p_residual_value: payload.residualValue !== undefined && payload.residualValue !== null ? Number(payload.residualValue) : undefined,
        p_depreciation_start_date: payload.depreciationStartDate ?? undefined,
        p_location: payload.location ?? undefined,
        p_custodian: payload.custodian ?? undefined,
        p_serial_number: payload.serialNumber ?? undefined,
        p_user_id: userId,
      });

      if (error) {
        throw new Error(error.message);
      }

      await this.loadAssets();
      if (this.selectedAsset()?.id === assetId) {
        await this.getAssetById(assetId);
      }
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 3. Penyusutan Bulanan (Monthly Depreciation)
  // ============================================================================

  async loadDepreciationPreview(periodMonth: string): Promise<DepreciationPreviewSummary> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();

      const { data, error } = await this.supabase.client.rpc('get_depreciation_preview', {
        p_company_id: companyId,
        p_period_month: periodMonth,
      });

      if (error) {
        throw new Error(`Gagal memuat pratinjau penyusutan: ${error.message}`);
      }

      const res = data as unknown as {
        periodMonth: string;
        totalEligibleAssets: number;
        totalEligibleAmount: number;
        totalIneligibleAssets: number;
        eligibleAssets: {
          assetId: string;
          assetCode: string;
          name: string;
          categoryName?: string;
          acquisitionCost: number;
          residualValue: number;
          depreciationMethod: 'straight_line' | 'declining_balance';
          usefulLifeMonths: number;
          periodNumber: number;
          accumulatedDepreciation: number;
          bookValueBefore: number;
          depreciationAmount: number;
          bookValueAfter: number;
        }[];
        ineligibleAssets: {
          assetId: string;
          assetCode: string;
          name: string;
          categoryName?: string;
          acquisitionCost: number;
          accumulatedDepreciation: number;
          reason?: string;
        }[];
      };

      const eligibleAssets: EligibleAssetPreview[] = (res.eligibleAssets || []).map((e) => ({
        assetId: e.assetId,
        assetCode: e.assetCode,
        name: e.name,
        categoryName: e.categoryName || '-',
        acquisitionCost: Number(e.acquisitionCost) || 0,
        residualValue: Number(e.residualValue) || 0,
        depreciationMethod: e.depreciationMethod,
        usefulLifeMonths: Number(e.usefulLifeMonths) || 0,
        periodNumber: Number(e.periodNumber) || 0,
        accumulatedDepreciation: Number(e.accumulatedDepreciation) || 0,
        bookValueBefore: Number(e.bookValueBefore) || 0,
        depreciationAmount: Number(e.depreciationAmount) || 0,
        bookValueAfter: Number(e.bookValueAfter) || 0,
      }));

      const ineligibleAssets: IneligibleAssetPreview[] = (res.ineligibleAssets || []).map((ie) => ({
        assetId: ie.assetId,
        assetCode: ie.assetCode,
        name: ie.name,
        categoryName: ie.categoryName || '-',
        acquisitionCost: Number(ie.acquisitionCost) || 0,
        accumulatedDepreciation: Number(ie.accumulatedDepreciation) || 0,
        reason: ie.reason || 'Tidak memenuhi syarat',
      }));

      const summary: DepreciationPreviewSummary = {
        periodMonth: res.periodMonth,
        totalEligibleAssets: Number(res.totalEligibleAssets) || eligibleAssets.length,
        totalEligibleAmount: Number(res.totalEligibleAmount) || 0,
        totalIneligibleAssets: Number(res.totalIneligibleAssets) || ineligibleAssets.length,
        eligibleAssets,
        ineligibleAssets,
      };

      this.depreciationPreview.set(summary);
      return summary;
    } finally {
      this.loading.set(false);
    }
  }

  async postMonthlyDepreciation(
    periodMonth: string,
    assetIds: string[],
    notes?: string
  ): Promise<{ id: string; documentNumber: string; totalAmount: number; assetCount: number }> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      if (!assetIds || assetIds.length === 0) {
        throw new Error('Pilih minimal satu aset yang akan disusutkan.');
      }

      const { data, error } = await this.supabase.client.rpc('post_monthly_depreciation', {
        p_company_id: companyId,
        p_period_month: periodMonth,
        p_asset_ids: assetIds as unknown as Json,
        p_notes: notes ?? undefined,
        p_user_id: userId,
      });

      if (error) {
        throw new Error(error.message);
      }

      const res = data as unknown as {
        id: string;
        documentNumber: string;
        totalAmount: number;
        assetCount: number;
      };
      await Promise.all([
        this.loadDepreciationPreview(periodMonth),
        this.loadDepreciationHistory(),
        this.loadAssets(),
      ]);

      return {
        id: res.id,
        documentNumber: res.documentNumber,
        totalAmount: Number(res.totalAmount) || 0,
        assetCount: Number(res.assetCount) || 0,
      };
    } finally {
      this.loading.set(false);
    }
  }

  async loadDepreciationHistory(): Promise<DepreciationDocument[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();

      const { data, error } = await this.supabase.client
        .from('business_document')
        .select(
          `
          id,
          document_number,
          transaction_date,
          total_amount,
          status,
          data,
          posted_at,
          lines:business_document_line(*)
        `
        )
        .eq('company_id', companyId)
        .eq('document_kind', 'depreciation')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Gagal memuat riwayat penyusutan: ${error.message}`);
      }

      const history: DepreciationDocument[] = (data || []).map((doc) => {
        const docRecord = doc as Record<string, unknown>;
        const docData = (docRecord['data'] || {}) as Record<string, unknown>;
        return {
          id: String(docRecord['id']),
          documentNumber: String(docRecord['document_number'] || '-'),
          periodMonth: String(docData['periodMonth'] || ''),
          transactionDate: String(docRecord['transaction_date']),
          totalAmount: Number(docRecord['total_amount']) || 0,
          assetCount: Number(docData['assetCount']) || ((docRecord['lines'] as unknown[])?.length || 0),
          status: String(docRecord['status']),
          notes: String(docData['notes'] || ''),
          postedAt: docRecord['posted_at'] ? String(docRecord['posted_at']) : '',
        };
      });

      this.depreciationHistory.set(history);
      return history;
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 4. Pelepasan Aset Tetap (Asset Disposals)
  // ============================================================================

  async loadAssetDisposals(): Promise<AssetDisposalDocument[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();

      const { data, error } = await this.supabase.client
        .from('business_document')
        .select(
          `
          id,
          document_number,
          transaction_date,
          total_amount,
          paid_amount,
          status,
          data,
          posted_at
        `
        )
        .eq('company_id', companyId)
        .eq('document_kind', 'asset_disposal')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Gagal memuat daftar pelepasan aset: ${error.message}`);
      }

      const disposals: AssetDisposalDocument[] = (data || []).map((doc) => {
        const docRecord = doc as Record<string, unknown>;
        const docData = (docRecord['data'] || {}) as Record<string, unknown>;
        return {
          id: String(docRecord['id']),
          documentNumber: String(docRecord['document_number'] || '-'),
          transactionDate: String(docRecord['transaction_date']),
          assetId: String(docData['assetId'] || ''),
          assetCode: String(docData['assetCode'] || ''),
          assetName: String(docData['assetName'] || ''),
          acquisitionCost: Number(docData['acquisitionCost']) || Number(docRecord['total_amount']) || 0,
          accumulatedDepreciation: Number(docData['accumulatedDepreciation']) || 0,
          bookValue: Number(docData['bookValue']) || 0,
          proceeds: Number(docData['proceeds']) || Number(docRecord['paid_amount']) || 0,
          gain: Number(docData['gain']) || 0,
          loss: Number(docData['loss']) || 0,
          cashAccountId: docData['cashAccountId'] ? String(docData['cashAccountId']) : null,
          reason: String(docData['reason'] || ''),
          status: String(docRecord['status']),
          postedAt: docRecord['posted_at'] ? String(docRecord['posted_at']) : '',
        };
      });

      this.assetDisposals.set(disposals);
      return disposals;
    } finally {
      this.loading.set(false);
    }
  }

  async postAssetDisposal(
    payload: PostAssetDisposalPayload
  ): Promise<{ id: string; documentNumber: string; bookValue: number; proceeds: number; gain: number; loss: number }> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();
      const userId = this.requireCurrentUserId();

      if (!payload.assetId) {
        throw new Error('Aset yang dilepas wajib dipilih.');
      }
      if (payload.proceeds > 0 && !payload.cashAccountId) {
        throw new Error('Rekening Kas/Bank penampung wajib dipilih jika hasil penjualan lebih dari nol.');
      }

      const { data, error } = await this.supabase.client.rpc('post_asset_disposal', {
        p_company_id: companyId,
        p_asset_id: payload.assetId,
        p_disposal_date: payload.disposalDate,
        p_proceeds: Number(payload.proceeds) || 0,
        p_cash_account_id: payload.cashAccountId ?? undefined,
        p_reason: payload.reason ?? undefined,
        p_user_id: userId,
      });

      if (error) {
        throw new Error(error.message);
      }

      const res = data as unknown as {
        id: string;
        documentNumber: string;
        bookValue: number;
        proceeds: number;
        gain: number;
        loss: number;
      };
      await Promise.all([this.loadAssetDisposals(), this.loadAssets()]);

      return {
        id: res.id,
        documentNumber: res.documentNumber,
        bookValue: Number(res.bookValue) || 0,
        proceeds: Number(res.proceeds) || 0,
        gain: Number(res.gain) || 0,
        loss: Number(res.loss) || 0,
      };
    } finally {
      this.loading.set(false);
    }
  }
}
