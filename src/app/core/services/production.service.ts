import { inject, Injectable, signal } from '@angular/core';
import { Json, Tables } from '../../../types/database.types';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { SupabaseService } from './supabase.service';

export type BusinessDocument = Tables<'business_document'>;
export type BusinessDocumentLine = Tables<'business_document_line'>;
export type ProductionWorkOrder = Tables<'production_work_order'>;
export type ProductionBundle = Tables<'production_bundle'>;
export type ProductionRepairCase = Tables<'production_repair_case'>;
export type ProductionMaterialUnit = Tables<'production_material_unit'>;
export type ProductionOperatorProfile = Tables<'production_operator_profile'>;

export interface ProductionOrderLineInput {
  productId: string;
  quantity: number;
}

export interface CreateProductionOrderPayload {
  targetDate: string;
  notes?: string;
  lines: ProductionOrderLineInput[];
}

export type ProductionOrderDetail = Omit<BusinessDocument, 'data'> & {
  data?: Record<string, unknown> | null;
  lines: (BusinessDocumentLine & {
    product?: { id: string; name: string; sku?: string | null };
    requiresPrinting?: boolean;
  })[];
  spks?: SpkWithDetails[];
};

export interface CreateSpkPayload {
  productionOrderId: string;
  stage: 'cutting' | 'printing' | 'sewing' | 'packing';
  operatorId: string;
  targetPcs?: number;
  notes?: string;
  bundleIds?: string[];
}

export interface SpkWithDetails {
  id: string;
  document_id: string;
  document_number: string;
  production_order_id: string;
  production_order_number?: string;
  stage: 'cutting' | 'printing' | 'sewing' | 'packing' | 'repair';
  operator_profile_id: string;
  operator_name?: string;
  operator_employee_id?: string;
  business_status: 'draft' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  target_pcs?: number;
  notes?: string;
  assigned_at?: string | null;
  created_at: string;
  bundle_count?: number;
}

export interface EligibleBundleItem {
  id: string;
  bundle_code: string;
  product_id: string;
  product_name?: string;
  product_sku?: string | null;
  initial_quantity: number;
  active_quantity: number;
  stage: string;
  work_condition: string;
  lot_code?: string;
  production_order_id: string;
  production_order_number?: string;
  requires_printing?: boolean;
}

export interface CuttingActualLine {
  productId: string;
  quantity: number;
}

export interface CuttingBundleInput {
  productId: string;
  quantity: number;
  bundleCode?: string;
}

export interface ConfirmCuttingPayload {
  spkId: string;
  rollId: string;
  actualDate: string;
  actualLines: CuttingActualLine[];
  bundles: CuttingBundleInput[];
}

export interface ConfirmPrintingPayload {
  spkId: string;
  bundleId: string;
  successQty: number;
  repairQty: number;
  rejectQty: number;
  notes?: string;
}

export interface AssignRepairPayload {
  repairCaseId: string;
  operatorId: string;
  wageMode: 'unpaid' | 'reference' | 'custom';
  customRate?: number;
  notes?: string;
}

export interface ProductionProgressSummaryItem {
  id: string;
  documentNumber: string;
  targetDate: string;
  status: string;
  codeLocked: boolean;
  notes: string;
  targetPcs: number;
  actualCuttingPcs: number;
  actualPrintingPcs: number;
  actualSewingPcs: number;
  actualPackingPcs: number;
  activeBundleCount: number;
  activeRepairCount: number;
  completionPercentage: number;
}

export interface RepairCaseWithDetails extends ProductionRepairCase {
  bundle_code?: string;
  product_id?: string;
  product_name?: string;
  product_sku?: string | null;
  source_spk_number?: string;
  repair_spk_number?: string;
  production_order_number?: string;
}

export interface OperatorProfileItem {
  id: string;
  employee_id: string;
  employee_name: string;
  user_id: string;
  operator_role: string;
  is_active: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class ProductionService {
  private readonly supabase = inject(SupabaseService);
  private readonly companyService = inject(CompanyService);
  private readonly authService = inject(AuthService);

  // Reaktif state cache untuk list
  readonly productionOrders = signal<ProductionOrderDetail[]>([]);
  readonly spkList = signal<SpkWithDetails[]>([]);
  readonly repairCases = signal<RepairCaseWithDetails[]>([]);
  readonly progressSummary = signal<ProductionProgressSummaryItem[]>([]);
  readonly isLoading = signal<boolean>(false);

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
  // 1. MANAJEMEN PERINTAH PRODUKSI (PP)
  // ============================================================================

  async getProductionOrders(): Promise<ProductionOrderDetail[]> {
    const companyId = await this.requireActiveCompanyId();
    this.isLoading.set(true);

    try {
      const { data, error } = await this.supabase.client
        .from('business_document')
        .select(`
          *,
          lines:business_document_line!business_document_line_document_id_fkey(
            *,
            product:master_record!business_document_line_item_id_fkey(id, name, sku)
          )
        `)
        .eq('company_id', companyId)
        .eq('document_kind', 'production_order')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw new Error(`Gagal memuat Perintah Produksi: ${error.message}`);

      const formatted: ProductionOrderDetail[] = (data || []).map((doc) => {
        const docData = (doc.data || {}) as Record<string, unknown>;
        const rawLines = (doc.lines || []) as unknown as (BusinessDocumentLine & {
          product?: { id: string; name: string; sku?: string | null };
        })[];

        const lines = rawLines.map((line) => {
          const lineData = (line.data || {}) as Record<string, unknown>;
          return {
            ...line,
            requiresPrinting: (lineData['requiresPrinting'] ?? lineData['requires_printing']) === true,
          };
        });

        return {
          ...(doc as BusinessDocument),
          data: docData,
          lines,
        };
      });

      this.productionOrders.set(formatted);
      return formatted;
    } finally {
      this.isLoading.set(false);
    }
  }

  async getProductionOrderById(id: string): Promise<ProductionOrderDetail> {
    const companyId = await this.requireActiveCompanyId();

    const { data: doc, error } = await this.supabase.client
      .from('business_document')
      .select(`
        *,
        lines:business_document_line!business_document_line_document_id_fkey(
          *,
          product:master_record!business_document_line_item_id_fkey(id, name, sku)
        )
      `)
      .eq('id', id)
      .eq('company_id', companyId)
      .eq('document_kind', 'production_order')
      .single();

    if (error || !doc) throw new Error(`Perintah Produksi tidak ditemukan: ${error?.message}`);

    // Ambil SPK-SPK terkait
    const { data: spkDocs } = await this.supabase.client
      .from('business_document')
      .select(`
        id,
        document_number,
        transaction_date,
        data,
        work_order:production_work_order!document_id(
          stage,
          business_status,
          assigned_at,
          operator_profile:production_operator_profile(
            id,
            employee:master_record!employee_id(id, name)
          )
        )
      `)
      .eq('company_id', companyId)
      .eq('source_document_id', id)
      .like('document_kind', 'spk_%');

    const spks: SpkWithDetails[] = (spkDocs || []).map((s) => {
      const wo = Array.isArray(s.work_order) ? s.work_order[0] : s.work_order;
      const opProfile = wo?.operator_profile;
      const emp = Array.isArray(opProfile?.employee) ? opProfile?.employee[0] : opProfile?.employee;
      const sData = (s.data || {}) as Record<string, unknown>;

      return {
        id: s.id,
        document_id: s.id,
        document_number: s.document_number || '',
        production_order_id: id,
        stage: (wo?.stage || 'cutting') as SpkWithDetails['stage'],
        operator_profile_id: opProfile?.id || '',
        operator_name: emp?.name || 'Operator',
        operator_employee_id: emp?.id || '',
        business_status: (wo?.business_status || 'assigned') as SpkWithDetails['business_status'],
        target_pcs: Number(sData['target_pcs'] ?? 0),
        notes: String(sData['notes'] ?? ''),
        assigned_at: wo?.assigned_at,
        created_at: s.transaction_date,
      };
    });

    const rawLines = (doc.lines || []) as unknown as (BusinessDocumentLine & {
      product?: { id: string; name: string; sku?: string | null };
    })[];

    const lines = rawLines.map((line) => {
      const lineData = (line.data || {}) as Record<string, unknown>;
      return {
        ...line,
        requiresPrinting: (lineData['requiresPrinting'] ?? lineData['requires_printing']) === true,
      };
    });

    const docData =
      doc.data && typeof doc.data === 'object' && !Array.isArray(doc.data)
        ? (doc.data as Record<string, unknown>)
        : {};

    return {
      ...(doc as unknown as BusinessDocument),
      data: docData,
      lines,
      spks,
    } as ProductionOrderDetail;
  }

  async createProductionOrder(payload: CreateProductionOrderPayload): Promise<{
    id: string;
    documentNumber: string;
  }> {
    const companyId = await this.requireActiveCompanyId();
    const currentUser = this.authService.currentUser();
    if (!currentUser) throw new Error('Pengguna tidak terautentikasi.');

    const { data, error } = await this.supabase.client.rpc('create_production_order', {
      p_company_id: companyId,
      p_target_date: payload.targetDate,
      p_notes: payload.notes || '',
      p_lines: payload.lines as unknown as Json,
      p_user_id: currentUser.id,
    });

    if (error) throw new Error(error.message);

    const result = data as { id: string; documentNumber: string };
    await this.getProductionOrders();
    return result;
  }

  // ============================================================================
  // 2. MANAJEMEN SURAT PERINTAH KERJA (SPK)
  // ============================================================================

  async getSpkList(stage?: 'cutting' | 'printing' | 'sewing' | 'packing'): Promise<SpkWithDetails[]> {
    const companyId = await this.requireActiveCompanyId();
    this.isLoading.set(true);

    try {
      let query = this.supabase.client
        .from('production_work_order')
        .select(`
          document_id,
          stage,
          business_status,
          assigned_at,
          created_at,
          production_order_id,
          operator_profile_id,
          spk_doc:business_document!document_id(
            id,
            document_number,
            data
          ),
          parent_pp:business_document!production_order_id(
            id,
            document_number
          ),
          operator_profile:production_operator_profile(
            id,
            employee:master_record!employee_id(id, name)
          ),
          bundles:production_work_order_bundle!production_work_order_bundle_work_order_id_fkey(count)
        `)
        .eq('company_id', companyId);

      if (stage) {
        query = query.eq('stage', stage);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw new Error(`Gagal memuat SPK: ${error.message}`);

      const formatted: SpkWithDetails[] = (data || []).map((row) => {
        const spkDoc = Array.isArray(row.spk_doc) ? row.spk_doc[0] : row.spk_doc;
        const ppDoc = Array.isArray(row.parent_pp) ? row.parent_pp[0] : row.parent_pp;
        const opProfile = Array.isArray(row.operator_profile) ? row.operator_profile[0] : row.operator_profile;
        const emp = Array.isArray(opProfile?.employee) ? opProfile?.employee[0] : opProfile?.employee;
        const docData = (spkDoc?.data || {}) as Record<string, unknown>;
        const bundleCount = Array.isArray(row.bundles) ? (row.bundles[0]?.count ?? 0) : 0;

        return {
          id: row.document_id,
          document_id: row.document_id,
          document_number: spkDoc?.document_number || '',
          production_order_id: row.production_order_id,
          production_order_number: ppDoc?.document_number || '',
          stage: row.stage as SpkWithDetails['stage'],
          operator_profile_id: row.operator_profile_id,
          operator_name: emp?.name || 'Operator',
          operator_employee_id: emp?.id || '',
          business_status: row.business_status as SpkWithDetails['business_status'],
          target_pcs: Number(docData['target_pcs'] ?? 0),
          notes: String(docData['notes'] ?? ''),
          assigned_at: row.assigned_at,
          created_at: row.created_at,
          bundle_count: bundleCount,
        };
      });

      this.spkList.set(formatted);
      return formatted;
    } finally {
      this.isLoading.set(false);
    }
  }

  async createSpk(payload: CreateSpkPayload): Promise<{
    id: string;
    documentNumber: string;
    stage: string;
  }> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) throw new Error('Pengguna tidak terautentikasi.');

    const { data, error } = await this.supabase.client.rpc('create_spk', {
      p_pp_id: payload.productionOrderId,
      p_stage: payload.stage,
      p_operator_id: payload.operatorId,
      p_target_pcs: (payload.targetPcs ?? 0) as number,
      p_notes: payload.notes || '',
      p_bundle_ids: (payload.bundleIds || []) as unknown as Json,
      p_user_id: currentUser.id,
    });

    if (error) throw new Error(error.message);

    const result = data as { id: string; documentNumber: string; stage: string };
    await this.getSpkList(payload.stage);
    return result;
  }

  async getEligibleBundles(stage: 'printing' | 'sewing' | 'packing'): Promise<EligibleBundleItem[]> {
    const companyId = await this.requireActiveCompanyId();

    const { data, error } = await this.supabase.client
      .from('production_bundle')
      .select(`
        id,
        bundle_code,
        product_id,
        initial_quantity,
        active_quantity,
        stage,
        work_condition,
        production_order_id,
        product:master_record!product_id(id, name, sku),
        cutting_lot:production_cutting_lot!cutting_lot_id(lot_code),
        pp:business_document!production_order_id(id, document_number)
      `)
      .eq('company_id', companyId)
      .eq('work_condition', 'available')
      .gt('active_quantity', 0);

    if (error) throw new Error(`Gagal memuat ikatan: ${error.message}`);

    // Dapatkan juga daftar ikatan yang sedang direservasi
    const { data: reservedData } = await this.supabase.client
      .from('production_bundle_reservation')
      .select('bundle_id')
      .eq('company_id', companyId);

    const reservedIds = new Set((reservedData || []).map((r) => r.bundle_id));

    // Ambil semua routing SKU di perusahaan
    const { data: routings } = await this.supabase.client
      .from('production_product_routing')
      .select('product_id, requires_printing')
      .eq('company_id', companyId);

    const routingMap = new Map<string, boolean>();
    for (const r of routings || []) {
      routingMap.set(r.product_id, r.requires_printing);
    }

    const unreserved = (data || []).filter((b) => !reservedIds.has(b.id));

    const eligible: EligibleBundleItem[] = [];

    for (const b of unreserved) {
      const prod = Array.isArray(b.product) ? b.product[0] : b.product;
      const lot = Array.isArray(b.cutting_lot) ? b.cutting_lot[0] : b.cutting_lot;
      const pp = Array.isArray(b.pp) ? b.pp[0] : b.pp;
      const reqPrint = routingMap.get(b.product_id) ?? false;

      let isEligible = false;

      if (stage === 'printing') {
        // Sablon: harus selesai cutting dan SKU memerlukan sablon
        if (b.stage === 'cutting' && reqPrint) {
          isEligible = true;
        }
      } else if (stage === 'sewing') {
        // Jahit: jika perlu sablon harus stage printing, jika tanpa sablon boleh dari cutting
        if ((reqPrint && b.stage === 'printing') || (!reqPrint && b.stage === 'cutting')) {
          isEligible = true;
        }
      } else if (stage === 'packing') {
        // Packing: harus selesai tahap jahit
        if (b.stage === 'sewing') {
          isEligible = true;
        }
      }

      if (isEligible) {
        eligible.push({
          id: b.id,
          bundle_code: b.bundle_code,
          product_id: b.product_id,
          product_name: prod?.name || 'Produk',
          product_sku: prod?.sku,
          initial_quantity: Number(b.initial_quantity),
          active_quantity: Number(b.active_quantity),
          stage: b.stage,
          work_condition: b.work_condition,
          lot_code: lot?.lot_code,
          production_order_id: b.production_order_id,
          production_order_number: pp?.document_number,
          requires_printing: reqPrint,
        });
      }
    }

    return eligible;
  }

  // ============================================================================
  // 3. CATAT AKTUAL OPERATOR (POTONG & SABLON)
  // ============================================================================

  async getAvailableRollsForSpk(spkId: string): Promise<ProductionMaterialUnit[]> {
    const companyId = await this.requireActiveCompanyId();

    // 1. Dapatkan baris-baris target SKU pada SPK Potong
    const { data: spkLines, error: spkError } = await this.supabase.client
      .from('business_document_line')
      .select('item_id')
      .eq('document_id', spkId)
      .eq('company_id', companyId)
      .eq('is_current', true);

    if (spkError) throw new Error(`Gagal membaca detail SPK: ${spkError.message}`);

    const productIds = (spkLines || []).map((l) => l.item_id).filter(Boolean) as string[];

    // 2. Dapatkan material ID dari BOM aktif untuk SKU tersebut
    const { data: boms } = await this.supabase.client
      .from('master_record')
      .select('data')
      .eq('company_id', companyId)
      .eq('record_kind', 'bom')
      .eq('is_active', true);

    const validMaterialIds = new Set<string>();
    for (const b of boms || []) {
      const bData = (b.data || {}) as Record<string, unknown>;
      const pId = bData['productId'] as string;
      if (productIds.includes(pId)) {
        const lines = (bData['materialLines'] || []) as Record<string, unknown>[];
        for (const line of lines) {
          if (line['materialId']) {
            validMaterialIds.add(String(line['materialId']));
          }
        }
      }
    }

    // 3. Ambil unit fisik roll yang available
    const { data: rolls, error: rollsError } = await this.supabase.client
      .from('production_material_unit')
      .select(`
        *,
        material:master_record!material_id(id, name, code)
      `)
      .eq('company_id', companyId)
      .eq('status', 'available')
      .order('created_at', { ascending: true });

    if (rollsError) throw new Error(`Gagal memuat roll: ${rollsError.message}`);

    // Filter roll berdasarkan kesesuaian material BOM
    if (validMaterialIds.size > 0) {
      return (rolls || []).filter((r) => validMaterialIds.has(r.material_id)) as unknown as ProductionMaterialUnit[];
    }

    return (rolls || []) as unknown as ProductionMaterialUnit[];
  }

  async confirmCutting(payload: ConfirmCuttingPayload): Promise<{
    actualId: string;
    actualNumber: string;
    lotCode: string;
    totalActualPcs: number;
    bundleCount: number;
    wageAmount: number;
  }> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) throw new Error('Pengguna tidak terautentikasi.');

    const { data, error } = await this.supabase.client.rpc('confirm_operator_cutting', {
      p_spk_id: payload.spkId,
      p_roll_id: payload.rollId,
      p_actual_date: payload.actualDate,
      p_actual_lines: payload.actualLines as unknown as Json,
      p_bundles: payload.bundles as unknown as Json,
      p_user_id: currentUser.id,
    });

    if (error) throw new Error(error.message);

    return data as {
      actualId: string;
      actualNumber: string;
      lotCode: string;
      totalActualPcs: number;
      bundleCount: number;
      wageAmount: number;
    };
  }

  async confirmPrinting(payload: ConfirmPrintingPayload): Promise<{
    actualId: string;
    actualNumber: string;
    bundleCode: string;
    successQuantity: number;
    repairQuantity: number;
    rejectQuantity: number;
    wageAmount: number;
    repairCaseId: string | null;
    spkCompleted: boolean;
  }> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) throw new Error('Pengguna tidak terautentikasi.');

    const { data, error } = await this.supabase.client.rpc('confirm_operator_printing', {
      p_spk_id: payload.spkId,
      p_bundle_id: payload.bundleId,
      p_success_qty: payload.successQty,
      p_repair_qty: payload.repairQty,
      p_reject_qty: payload.rejectQty,
      p_notes: payload.notes || '',
      p_user_id: currentUser.id,
    });

    if (error) throw new Error(error.message);

    return data as {
      actualId: string;
      actualNumber: string;
      bundleCode: string;
      successQuantity: number;
      repairQuantity: number;
      rejectQuantity: number;
      wageAmount: number;
      repairCaseId: string | null;
      spkCompleted: boolean;
    };
  }

  // ============================================================================
  // 4. KASUS PERBAIKAN & PROGRESS PRODUKSI
  // ============================================================================

  async getRepairCases(): Promise<RepairCaseWithDetails[]> {
    const companyId = await this.requireActiveCompanyId();
    this.isLoading.set(true);

    try {
      const { data, error } = await this.supabase.client
        .from('production_repair_case')
        .select(`
          *,
          bundle:production_bundle!bundle_id(
            id,
            bundle_code,
            product_id,
            product:master_record!product_id(id, name, sku)
          ),
          source_wo:production_work_order!source_work_order_id(
            document_id,
            doc:business_document!document_id(document_number)
          ),
          repair_wo:production_work_order!repair_work_order_id(
            document_id,
            doc:business_document!document_id(document_number)
          ),
          pp:business_document!production_order_id(
            id,
            document_number
          )
        `)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) throw new Error(`Gagal memuat kasus perbaikan: ${error.message}`);

      const formatted: RepairCaseWithDetails[] = (data || []).map((row) => {
        const b = Array.isArray(row.bundle) ? row.bundle[0] : row.bundle;
        const prod = Array.isArray(b?.product) ? b?.product[0] : b?.product;
        const srcWo = Array.isArray(row.source_wo) ? row.source_wo[0] : row.source_wo;
        const srcDoc = Array.isArray(srcWo?.doc) ? srcWo?.doc[0] : srcWo?.doc;
        const repWo = Array.isArray(row.repair_wo) ? row.repair_wo[0] : row.repair_wo;
        const repDoc = Array.isArray(repWo?.doc) ? repWo?.doc[0] : repWo?.doc;
        const pp = Array.isArray(row.pp) ? row.pp[0] : row.pp;

        return {
          ...(row as ProductionRepairCase),
          bundle_code: b?.bundle_code,
          product_id: b?.product_id,
          product_name: prod?.name,
          product_sku: prod?.sku,
          source_spk_number: srcDoc?.document_number,
          repair_spk_number: repDoc?.document_number,
          production_order_number: pp?.document_number,
        };
      });

      this.repairCases.set(formatted);
      return formatted;
    } finally {
      this.isLoading.set(false);
    }
  }

  async assignRepair(payload: AssignRepairPayload): Promise<{
    repairCaseId: string;
    spkId: string;
    spkNumber: string;
    compensationMode: string;
    rateSnapshot: number;
  }> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) throw new Error('Pengguna tidak terautentikasi.');

    const { data, error } = await this.supabase.client.rpc('assign_repair_spk', {
      p_repair_case_id: payload.repairCaseId,
      p_operator_id: payload.operatorId,
      p_wage_mode: payload.wageMode,
      p_custom_rate: (payload.customRate ?? 0) as number,
      p_notes: payload.notes || '',
      p_user_id: currentUser.id,
    });

    if (error) throw new Error(error.message);

    const result = data as {
      repairCaseId: string;
      spkId: string;
      spkNumber: string;
      compensationMode: string;
      rateSnapshot: number;
    };
    await this.getRepairCases();
    return result;
  }

  async getProgressSummary(): Promise<ProductionProgressSummaryItem[]> {
    const companyId = await this.requireActiveCompanyId();
    this.isLoading.set(true);

    try {
      const { data, error } = await this.supabase.client.rpc('get_production_progress_summary', {
        p_company_id: companyId,
      });

      if (error) throw new Error(`Gagal memuat ringkasan progress: ${error.message}`);

      const summary = (data as unknown as ProductionProgressSummaryItem[]) || [];
      this.progressSummary.set(summary);
      return summary;
    } finally {
      this.isLoading.set(false);
    }
  }

  async getOperatorProfiles(stage?: string): Promise<OperatorProfileItem[]> {
    const companyId = await this.requireActiveCompanyId();

    // Auto-sync operator profiles terlebih dahulu
    await this.supabase.client.rpc('sync_production_operator_profiles', {
      p_company_id: companyId,
    });

    let roleFilter: string | null = null;
    if (stage === 'cutting') roleFilter = 'operator_potong';
    else if (stage === 'printing') roleFilter = 'operator_sablon';
    else if (stage === 'sewing') roleFilter = 'operator_jahit';
    else if (stage === 'packing') roleFilter = 'operator_packing';

    let query = this.supabase.client
      .from('production_operator_profile')
      .select(`
        id,
        employee_id,
        user_id,
        operator_role,
        is_active,
        employee:master_record!employee_id(id, name)
      `)
      .eq('company_id', companyId)
      .eq('is_active', true);

    if (roleFilter) {
      query = query.eq('operator_role', roleFilter);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Gagal memuat profil operator: ${error.message}`);

    return (data || []).map((row) => {
      const emp = Array.isArray(row.employee) ? row.employee[0] : row.employee;
      return {
        id: row.id,
        employee_id: row.employee_id,
        employee_name: emp?.name || 'Operator',
        user_id: row.user_id,
        operator_role: row.operator_role,
        is_active: row.is_active,
      };
    });
  }

  async getAllBundles(): Promise<EligibleBundleItem[]> {
    const companyId = await this.requireActiveCompanyId();

    const { data, error } = await this.supabase.client
      .from('production_bundle')
      .select(`
        id,
        bundle_code,
        product_id,
        initial_quantity,
        active_quantity,
        stage,
        work_condition,
        production_order_id,
        product:master_record!product_id(id, name, sku),
        cutting_lot:production_cutting_lot!cutting_lot_id(lot_code),
        pp:business_document!production_order_id(id, document_number)
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Gagal memuat ikatan: ${error.message}`);

    return (data || []).map((b) => {
      const prod = Array.isArray(b.product) ? b.product[0] : b.product;
      const lot = Array.isArray(b.cutting_lot) ? b.cutting_lot[0] : b.cutting_lot;
      const pp = Array.isArray(b.pp) ? b.pp[0] : b.pp;

      return {
        id: b.id,
        bundle_code: b.bundle_code,
        product_id: b.product_id,
        product_name: prod?.name || 'Produk',
        product_sku: prod?.sku,
        initial_quantity: Number(b.initial_quantity),
        active_quantity: Number(b.active_quantity),
        stage: b.stage,
        work_condition: b.work_condition,
        lot_code: lot?.lot_code,
        production_order_id: b.production_order_id,
        production_order_number: pp?.document_number,
      };
    });
  }
}
