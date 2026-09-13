import { inject, Injectable } from '@angular/core';
import { Json, Tables, TablesInsert, TablesUpdate } from '../../../types/database.types';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { SupabaseService } from './supabase.service';

export type UnitDefinition = Tables<'unit_definition'>;
export type MasterRecord = Tables<'master_record'>;
export type WageRate = Tables<'wage_rate'>;
export type ProductionProductRouting = Tables<'production_product_routing'>;

export interface CustomerData {
  [key: string]: unknown;
  phone: string;
  address: string;
}

export interface SupplierData {
  [key: string]: unknown;
  phone: string;
  email: string;
  bank: string;
  accountNumber: string;
  accountHolder: string;
  address: string;
}

export interface MaterialData {
  [key: string]: unknown;
  packagingUnit: string;
  packagingQuantity: number;
  baseUnit: string;
  conversionFactor: number;
  referencePackagePrice: number;
  notes: string;
}

export interface ProductData {
  [key: string]: unknown;
  salesUnit: string;
  referenceSalesPrice: number;
  description: string;
}

export interface BomMaterialLine {
  materialId: string;
  quantity: number;
  unitCode: string;
}

export interface BomData {
  [key: string]: unknown;
  productId: string;
  materialLines: BomMaterialLine[];
}

export interface EmployeeData {
  [key: string]: unknown;
  phone: string;
  address: string;
  roleCategory?: string;
}

export interface ProductWithRouting extends MasterRecord {
  requiresPrinting: boolean;
}

export interface WageRatesByProduct {
  productId: string;
  sku: string;
  productName: string;
  cutting: number;
  printing: number;
  sewing: number;
  packing: number;
}

@Injectable({
  providedIn: 'root',
})
export class MasterDataService {
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
  // 1. SATUAN PENGUKURAN (UNIT OF MEASURE / UOM)
  // ============================================================================

  async getUnits(): Promise<UnitDefinition[]> {
    const companyId = await this.requireActiveCompanyId();
    const { data, error } = await this.supabase.client
      .from('unit_definition')
      .select('*')
      .eq('company_id', companyId)
      .order('code', { ascending: true });

    if (error) throw new Error(`Gagal memuat satuan UOM: ${error.message}`);
    return (data ?? []) as UnitDefinition[];
  }

  async createUnit(data: { code: string; name: string; decimalScale: number }): Promise<UnitDefinition> {
    const companyId = await this.requireActiveCompanyId();
    const normalizedCode = (data.code || '').trim().toUpperCase();
    const normalizedName = (data.name || '').trim();

    if (!normalizedCode || !/^[A-Z0-9_-]+$/.test(normalizedCode)) {
      throw new Error('Kode UOM hanya boleh berupa huruf kapital, angka, dash, dan underscore tanpa spasi.');
    }
    if (!normalizedName) {
      throw new Error('Nama satuan UOM wajib diisi.');
    }
    if (data.decimalScale < 0 || data.decimalScale > 6) {
      throw new Error('Skala desimal harus antara 0 sampai 6.');
    }

    const payload: TablesInsert<'unit_definition'> = {
      company_id: companyId,
      code: normalizedCode,
      name: normalizedName,
      decimal_scale: data.decimalScale,
      is_active: true,
      version: 1,
    };

    const { data: created, error } = await this.supabase.client
      .from('unit_definition')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error(`Kode UOM "${normalizedCode}" sudah terdaftar.`);
      }
      throw new Error(`Gagal membuat satuan UOM: ${error.message}`);
    }

    const createdRecord = created as UnitDefinition;

    await this.logAudit({
      action: 'uom.create',
      targetType: 'unit_definition',
      targetId: `${companyId}:${normalizedCode}`,
      details: { code: normalizedCode, name: normalizedName, decimalScale: data.decimalScale },
      after: createdRecord,
    });

    return createdRecord;
  }

  async updateUnit(
    code: string,
    data: { name: string; decimalScale?: number; isActive?: boolean },
  ): Promise<UnitDefinition> {
    const companyId = await this.requireActiveCompanyId();
    const normalizedName = (data.name || '').trim();
    if (!normalizedName) {
      throw new Error('Nama satuan UOM wajib diisi.');
    }

    const { data: existing, error: findError } = await this.supabase.client
      .from('unit_definition')
      .select('*')
      .eq('company_id', companyId)
      .eq('code', code)
      .single();

    if (findError || !existing) {
      throw new Error(`Satuan UOM "${code}" tidak ditemukan.`);
    }

    const payload: TablesUpdate<'unit_definition'> = {
      name: normalizedName,
      version: existing.version + 1,
    };

    if (data.decimalScale !== undefined) {
      if (data.decimalScale < 0 || data.decimalScale > 6) {
        throw new Error('Skala desimal harus antara 0 sampai 6.');
      }
      payload.decimal_scale = data.decimalScale;
    }

    if (data.isActive !== undefined) {
      payload.is_active = data.isActive;
    }

    const { data: updated, error: updateError } = await this.supabase.client
      .from('unit_definition')
      .update(payload)
      .eq('company_id', companyId)
      .eq('code', code)
      .select('*')
      .single();

    if (updateError) throw new Error(`Gagal memperbarui UOM: ${updateError.message}`);

    const updatedRecord = updated as UnitDefinition;

    await this.logAudit({
      action: 'uom.update',
      targetType: 'unit_definition',
      targetId: `${companyId}:${code}`,
      details: data,
      before: existing,
      after: updatedRecord,
    });

    return updatedRecord;
  }

  // ============================================================================
  // 2. PELANGGAN & PEMASOK (CUSTOMERS & SUPPLIERS)
  // ============================================================================

  async getCustomers(): Promise<MasterRecord[]> {
    return this.getMasterRecords('customer');
  }

  async createCustomer(data: { name: string; phone: string; address: string }): Promise<MasterRecord> {
    return this.createMasterRecord('customer', data.name, {
      phone: (data.phone || '').trim(),
      address: (data.address || '').trim(),
    });
  }

  async updateCustomer(
    id: string,
    data: { name: string; phone: string; address: string; isActive?: boolean },
  ): Promise<MasterRecord> {
    return this.updateMasterRecord(
      id,
      'customer',
      data.name,
      {
        phone: (data.phone || '').trim(),
        address: (data.address || '').trim(),
      },
      data.isActive,
    );
  }

  async getSuppliers(): Promise<MasterRecord[]> {
    return this.getMasterRecords('supplier');
  }

  async createSupplier(data: {
    name: string;
    phone: string;
    email: string;
    bank: string;
    accountNumber: string;
    accountHolder: string;
    address: string;
  }): Promise<MasterRecord> {
    return this.createMasterRecord('supplier', data.name, {
      phone: (data.phone || '').trim(),
      email: (data.email || '').trim(),
      bank: (data.bank || '').trim(),
      accountNumber: (data.accountNumber || '').trim(),
      accountHolder: (data.accountHolder || '').trim(),
      address: (data.address || '').trim(),
    });
  }

  async updateSupplier(
    id: string,
    data: {
      name: string;
      phone: string;
      email: string;
      bank: string;
      accountNumber: string;
      accountHolder: string;
      address: string;
      isActive?: boolean;
    },
  ): Promise<MasterRecord> {
    return this.updateMasterRecord(
      id,
      'supplier',
      data.name,
      {
        phone: (data.phone || '').trim(),
        email: (data.email || '').trim(),
        bank: (data.bank || '').trim(),
        accountNumber: (data.accountNumber || '').trim(),
        accountHolder: (data.accountHolder || '').trim(),
        address: (data.address || '').trim(),
      },
      data.isActive,
    );
  }

  // ============================================================================
  // 3. BAHAN BAKU / MATERIAL
  // ============================================================================

  async getMaterials(): Promise<MasterRecord[]> {
    return this.getMasterRecords('material');
  }

  async createMaterial(data: {
    name: string;
    packagingUnit: string;
    packagingQuantity: number;
    baseUnit: string;
    conversionFactor: number;
    referencePackagePrice: number;
    notes: string;
  }): Promise<MasterRecord> {
    const rawName = (data.name || '').trim();
    if (!rawName) throw new Error('Nama material wajib diisi.');
    if (data.packagingQuantity <= 0) throw new Error('Kuantitas kemasan harus lebih dari 0.');
    if (data.conversionFactor <= 0) throw new Error('Faktor konversi harus lebih dari 0.');
    if (data.referencePackagePrice < 0) throw new Error('Harga referensi tidak boleh negatif.');

    const meta: MaterialData = {
      packagingUnit: (data.packagingUnit || '').trim().toUpperCase(),
      packagingQuantity: Number(data.packagingQuantity),
      baseUnit: (data.baseUnit || '').trim().toUpperCase(),
      conversionFactor: Number(data.conversionFactor),
      referencePackagePrice: Math.round(Number(data.referencePackagePrice)),
      notes: (data.notes || '').trim(),
    };

    return this.createMasterRecord('material', rawName, meta);
  }

  async updateMaterial(
    id: string,
    data: {
      name: string;
      packagingUnit: string;
      packagingQuantity: number;
      baseUnit: string;
      conversionFactor: number;
      referencePackagePrice: number;
      notes: string;
      isActive?: boolean;
    },
  ): Promise<MasterRecord> {
    const rawName = (data.name || '').trim();
    if (!rawName) throw new Error('Nama material wajib diisi.');
    if (data.packagingQuantity <= 0) throw new Error('Kuantitas kemasan harus lebih dari 0.');
    if (data.conversionFactor <= 0) throw new Error('Faktor konversi harus lebih dari 0.');
    if (data.referencePackagePrice < 0) throw new Error('Harga referensi tidak boleh negatif.');

    const meta: MaterialData = {
      packagingUnit: (data.packagingUnit || '').trim().toUpperCase(),
      packagingQuantity: Number(data.packagingQuantity),
      baseUnit: (data.baseUnit || '').trim().toUpperCase(),
      conversionFactor: Number(data.conversionFactor),
      referencePackagePrice: Math.round(Number(data.referencePackagePrice)),
      notes: (data.notes || '').trim(),
    };

    return this.updateMasterRecord(id, 'material', rawName, meta, data.isActive);
  }

  // ============================================================================
  // 4. PRODUK & SKU (PRODUCTS & ROUTING)
  // ============================================================================

  async getProducts(): Promise<ProductWithRouting[]> {
    const companyId = await this.requireActiveCompanyId();

    const [productsRes, routingsRes] = await Promise.all([
      this.supabase.client
        .from('master_record')
        .select('*')
        .eq('company_id', companyId)
        .eq('record_kind', 'product')
        .order('name', { ascending: true }),
      this.supabase.client
        .from('production_product_routing')
        .select('*')
        .eq('company_id', companyId),
    ]);

    if (productsRes.error) throw new Error(`Gagal memuat produk: ${productsRes.error.message}`);
    if (routingsRes.error) throw new Error(`Gagal memuat routing: ${routingsRes.error.message}`);

    const routingMap = new Map<string, boolean>();
    for (const r of routingsRes.data || []) {
      routingMap.set(r.product_id, r.requires_printing);
    }

    return (productsRes.data || []).map((prod) => ({
      ...(prod as MasterRecord),
      requiresPrinting: routingMap.get(prod.id) ?? false,
    }));
  }

  async createProduct(data: {
    sku: string;
    name: string;
    salesUnit: string;
    referenceSalesPrice: number;
    description: string;
    requiresPrinting: boolean;
  }): Promise<ProductWithRouting> {
    const companyId = await this.requireActiveCompanyId();
    const rawSku = (data.sku || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '_');
    const rawName = (data.name || '').trim();

    if (!rawSku || !/^[A-Z0-9_-]+$/.test(rawSku)) {
      throw new Error('SKU hanya boleh berupa huruf kapital, angka, dash, dan garis bawah tanpa spasi.');
    }
    if (!rawName) throw new Error('Nama produk wajib diisi.');
    if (data.referenceSalesPrice < 0) throw new Error('Harga jual referensi tidak boleh negatif.');

    const meta: ProductData = {
      salesUnit: (data.salesUnit || 'PCS').trim().toUpperCase(),
      referenceSalesPrice: Math.round(Number(data.referenceSalesPrice)),
      description: (data.description || '').trim(),
    };

    const payload: TablesInsert<'master_record'> = {
      company_id: companyId,
      record_kind: 'product',
      sku: rawSku,
      name: rawName,
      data: meta as unknown as Json,
      is_active: true,
      version: 1,
      created_by_user_id: this.authService.currentUser()?.id,
    };

    const { data: created, error } = await this.supabase.client
      .from('master_record')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error(`SKU "${rawSku}" sudah terdaftar pada perusahaan ini.`);
      }
      throw new Error(`Gagal membuat produk: ${error.message}`);
    }

    const createdProduct = created as MasterRecord;

    // Simpan konfigurasi routing produksi
    const routingPayload: TablesInsert<'production_product_routing'> = {
      company_id: companyId,
      product_id: createdProduct.id,
      requires_printing: data.requiresPrinting,
      configured_at: new Date().toISOString(),
      configured_by_user_id: this.authService.currentUser()?.id,
    };

    await this.supabase.client.from('production_product_routing').upsert(routingPayload);

    await this.logAudit({
      action: 'master.product.create',
      targetType: 'product',
      targetId: createdProduct.id,
      details: { sku: rawSku, name: rawName, requiresPrinting: data.requiresPrinting },
      after: createdProduct,
    });

    return {
      ...createdProduct,
      requiresPrinting: data.requiresPrinting,
    };
  }

  async updateProduct(
    id: string,
    data: {
      name: string;
      salesUnit: string;
      referenceSalesPrice: number;
      description: string;
      requiresPrinting: boolean;
      isActive?: boolean;
    },
  ): Promise<ProductWithRouting> {
    const companyId = await this.requireActiveCompanyId();
    const rawName = (data.name || '').trim();
    if (!rawName) throw new Error('Nama produk wajib diisi.');
    if (data.referenceSalesPrice < 0) throw new Error('Harga jual referensi tidak boleh negatif.');

    const { data: existing, error: findError } = await this.supabase.client
      .from('master_record')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', id)
      .eq('record_kind', 'product')
      .single();

    if (findError || !existing) throw new Error('Produk tidak ditemukan.');

    const meta: ProductData = {
      salesUnit: (data.salesUnit || 'PCS').trim().toUpperCase(),
      referenceSalesPrice: Math.round(Number(data.referenceSalesPrice)),
      description: (data.description || '').trim(),
    };

    const payload: TablesUpdate<'master_record'> = {
      name: rawName,
      data: meta as unknown as Json,
      version: existing.version + 1,
      updated_by_user_id: this.authService.currentUser()?.id,
      updated_at: new Date().toISOString(),
    };

    if (data.isActive !== undefined) {
      payload.is_active = data.isActive;
    }

    const { data: updated, error: updateError } = await this.supabase.client
      .from('master_record')
      .update(payload)
      .eq('company_id', companyId)
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) throw new Error(`Gagal memperbarui produk: ${updateError.message}`);

    const updatedProduct = updated as MasterRecord;

    // Perbarui routing produksi
    const routingPayload: TablesInsert<'production_product_routing'> = {
      company_id: companyId,
      product_id: id,
      requires_printing: data.requiresPrinting,
      configured_at: new Date().toISOString(),
      configured_by_user_id: this.authService.currentUser()?.id,
    };
    await this.supabase.client.from('production_product_routing').upsert(routingPayload);

    await this.logAudit({
      action: 'master.product.update',
      targetType: 'product',
      targetId: id,
      details: { name: rawName, requiresPrinting: data.requiresPrinting, isActive: data.isActive },
      before: existing,
      after: updatedProduct,
    });

    return {
      ...updatedProduct,
      requiresPrinting: data.requiresPrinting,
    };
  }

  // ============================================================================
  // 5. BILL OF MATERIALS / FORMULA BOM
  // ============================================================================

  async getBoms(): Promise<MasterRecord[]> {
    return this.getMasterRecords('bom');
  }

  async getBomByProductId(productId: string): Promise<MasterRecord | null> {
    const companyId = await this.requireActiveCompanyId();
    const { data, error } = await this.supabase.client
      .from('master_record')
      .select('*')
      .eq('company_id', companyId)
      .eq('record_kind', 'bom')
      .contains('data', { productId })
      .maybeSingle();

    if (error) {
      console.warn('Gagal membaca BOM by productId:', error.message);
      return null;
    }
    return (data as MasterRecord) || null;
  }

  async saveBom(
    productId: string,
    productName: string,
    materialLines: BomMaterialLine[],
  ): Promise<MasterRecord> {
    const companyId = await this.requireActiveCompanyId();

    // Validasi baris material
    if (materialLines.length === 0) {
      throw new Error('Formula BOM harus memiliki minimal satu komponen material.');
    }

    const materialIds = materialLines.map((l) => l.materialId);
    const uniqueIds = new Set(materialIds);
    if (uniqueIds.size !== materialIds.length) {
      throw new Error('Komponen material tidak boleh duplikat dalam satu formula BOM.');
    }

    for (const line of materialLines) {
      if (!line.materialId) throw new Error('Komponen material wajib dipilih.');
      if (line.quantity <= 0) throw new Error('Kuantitas bahan pada formula BOM harus lebih dari 0.');
      if (!line.unitCode) throw new Error('Satuan UOM komponen material wajib diisi.');
    }

    const bomData: BomData = {
      productId,
      materialLines: materialLines.map((l) => ({
        materialId: l.materialId,
        quantity: Number(l.quantity),
        unitCode: l.unitCode.trim().toUpperCase(),
      })),
    };

    const existingBom = await this.getBomByProductId(productId);

    if (existingBom) {
      const payload: TablesUpdate<'master_record'> = {
        name: `BOM - ${productName}`,
        data: bomData as unknown as Json,
        version: existingBom.version + 1,
        updated_by_user_id: this.authService.currentUser()?.id,
        updated_at: new Date().toISOString(),
      };

      const { data: updated, error } = await this.supabase.client
        .from('master_record')
        .update(payload)
        .eq('company_id', companyId)
        .eq('id', existingBom.id)
        .select('*')
        .single();

      if (error) throw new Error(`Gagal memperbarui formula BOM: ${error.message}`);

      const updatedRecord = updated as MasterRecord;
      await this.logAudit({
        action: 'master.bom.save',
        targetType: 'bom',
        targetId: updatedRecord.id,
        details: { productId, lineCount: materialLines.length },
        before: existingBom,
        after: updatedRecord,
      });

      return updatedRecord;
    }

    const insertPayload: TablesInsert<'master_record'> = {
      company_id: companyId,
      record_kind: 'bom',
      name: `BOM - ${productName}`,
      data: bomData as unknown as Json,
      is_active: true,
      version: 1,
      created_by_user_id: this.authService.currentUser()?.id,
    };

    const { data: created, error } = await this.supabase.client
      .from('master_record')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) throw new Error(`Gagal membuat formula BOM: ${error.message}`);

    const createdRecord = created as MasterRecord;
    await this.logAudit({
      action: 'master.bom.save',
      targetType: 'bom',
      targetId: createdRecord.id,
      details: { productId, lineCount: materialLines.length },
      after: createdRecord,
    });

    return createdRecord;
  }

  // ============================================================================
  // 6. KARYAWAN / TENAGA KERJA (EMPLOYEES)
  // ============================================================================

  async getEmployees(): Promise<MasterRecord[]> {
    return this.getMasterRecords('employee');
  }

  async createEmployee(data: {
    name: string;
    phone: string;
    address: string;
    roleCategory?: string;
  }): Promise<MasterRecord> {
    return this.createMasterRecord('employee', data.name, {
      phone: (data.phone || '').trim(),
      address: (data.address || '').trim(),
      roleCategory: data.roleCategory || 'Operator Jahit',
    });
  }

  async updateEmployee(
    id: string,
    data: {
      name: string;
      phone: string;
      address: string;
      roleCategory?: string;
      isActive?: boolean;
    },
  ): Promise<MasterRecord> {
    return this.updateMasterRecord(
      id,
      'employee',
      data.name,
      {
        phone: (data.phone || '').trim(),
        address: (data.address || '').trim(),
        roleCategory: data.roleCategory || 'Operator Jahit',
      },
      data.isActive,
    );
  }

  // ============================================================================
  // 7. TARIF UPAH BORONGAN (WAGE RATES)
  // ============================================================================

  async getWageRates(): Promise<WageRate[]> {
    const companyId = await this.requireActiveCompanyId();
    const { data, error } = await this.supabase.client
      .from('wage_rate')
      .select('*')
      .eq('company_id', companyId);

    if (error) throw new Error(`Gagal memuat tarif upah: ${error.message}`);
    return (data ?? []) as WageRate[];
  }

  async getWageRatesGroupedByProduct(): Promise<WageRatesByProduct[]> {
    await this.requireActiveCompanyId();

    const [products, rates] = await Promise.all([
      this.getProducts(),
      this.getWageRates(),
    ]);

    const activeProducts = products.filter((p) => p.is_active);
    const rateMap = new Map<string, Record<string, number>>();

    for (const r of rates) {
      const existing = rateMap.get(r.product_id) || {};
      existing[r.service_kind] = Number(r.rate);
      rateMap.set(r.product_id, existing);
    }

    return activeProducts.map((p) => {
      const productRates = rateMap.get(p.id) || {};
      return {
        productId: p.id,
        sku: p.sku || '',
        productName: p.name,
        cutting: productRates['cutting'] ?? 0,
        printing: productRates['printing'] ?? 0,
        sewing: productRates['sewing'] ?? 0,
        packing: productRates['packing'] ?? 0,
      };
    });
  }

  async saveProductWageRates(
    productId: string,
    sku: string,
    rates: { cutting: number; printing: number; sewing: number; packing: number },
  ): Promise<void> {
    const companyId = await this.requireActiveCompanyId();
    const userId = this.authService.currentUser()?.id;

    const services: { kind: 'cutting' | 'printing' | 'sewing' | 'packing'; rate: number }[] = [
      { kind: 'cutting', rate: Math.max(0, Math.round(Number(rates.cutting || 0))) },
      { kind: 'printing', rate: Math.max(0, Math.round(Number(rates.printing || 0))) },
      { kind: 'sewing', rate: Math.max(0, Math.round(Number(rates.sewing || 0))) },
      { kind: 'packing', rate: Math.max(0, Math.round(Number(rates.packing || 0))) },
    ];

    const cleanSku = (sku || '').trim().toUpperCase();

    for (const s of services) {
      const code = `WR-${cleanSku}-${s.kind.toUpperCase()}`;

      // Periksa apakah rate sudah ada
      const { data: existing } = await this.supabase.client
        .from('wage_rate')
        .select('*')
        .eq('company_id', companyId)
        .eq('product_id', productId)
        .eq('service_kind', s.kind)
        .maybeSingle();

      const payload: TablesInsert<'wage_rate'> = {
        company_id: companyId,
        product_id: productId,
        service_kind: s.kind,
        code,
        rate: s.rate,
        version: existing ? existing.version + 1 : 1,
        created_by_user_id: existing ? existing.created_by_user_id : userId,
        updated_by_user_id: userId,
        updated_at: new Date().toISOString(),
      };

      const { error } = await this.supabase.client
        .from('wage_rate')
        .upsert(payload, { onConflict: 'company_id,product_id,service_kind' });

      if (error) {
        throw new Error(`Gagal menyimpan tarif upah ${s.kind}: ${error.message}`);
      }
    }

    await this.logAudit({
      action: 'master.wage_rate.save',
      targetType: 'wage_rate',
      targetId: `${companyId}:${productId}`,
      details: { sku: cleanSku, rates },
    });
  }

  // ============================================================================
  // GENERIC MASTER RECORD HELPERS
  // ============================================================================

  private async getMasterRecords(kind: string): Promise<MasterRecord[]> {
    const companyId = await this.requireActiveCompanyId();
    const { data, error } = await this.supabase.client
      .from('master_record')
      .select('*')
      .eq('company_id', companyId)
      .eq('record_kind', kind)
      .order('name', { ascending: true });

    if (error) throw new Error(`Gagal memuat data ${kind}: ${error.message}`);
    return (data ?? []) as MasterRecord[];
  }

  private async createMasterRecord(
    kind: string,
    name: string,
    metadata: Record<string, unknown>,
  ): Promise<MasterRecord> {
    const companyId = await this.requireActiveCompanyId();
    const rawName = (name || '').trim();

    if (!rawName) throw new Error(`Nama ${kind} wajib diisi.`);

    // Validasi keunikan nama secara case-insensitive
    const { data: existingDuplicate } = await this.supabase.client
      .from('master_record')
      .select('id')
      .eq('company_id', companyId)
      .eq('record_kind', kind)
      .ilike('name', rawName)
      .maybeSingle();

    if (existingDuplicate) {
      throw new Error(`Nama ${kind} "${rawName}" sudah terdaftar.`);
    }

    const payload: TablesInsert<'master_record'> = {
      company_id: companyId,
      record_kind: kind,
      name: rawName,
      data: metadata as unknown as Json,
      is_active: true,
      version: 1,
      created_by_user_id: this.authService.currentUser()?.id,
    };

    const { data: created, error } = await this.supabase.client
      .from('master_record')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw new Error(`Gagal menambahkan ${kind}: ${error.message}`);

    const record = created as MasterRecord;
    await this.logAudit({
      action: `master.${kind}.create`,
      targetType: kind,
      targetId: record.id,
      details: { name: rawName, metadata },
      after: record,
    });

    return record;
  }

  private async updateMasterRecord(
    id: string,
    kind: string,
    name: string,
    metadata: Record<string, unknown>,
    isActive?: boolean,
  ): Promise<MasterRecord> {
    const companyId = await this.requireActiveCompanyId();
    const rawName = (name || '').trim();

    if (!rawName) throw new Error(`Nama ${kind} wajib diisi.`);

    const { data: existing, error: findError } = await this.supabase.client
      .from('master_record')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', id)
      .eq('record_kind', kind)
      .single();

    if (findError || !existing) throw new Error(`Data ${kind} tidak ditemukan.`);

    // Validasi keunikan nama selain ID ini
    const { data: duplicate } = await this.supabase.client
      .from('master_record')
      .select('id')
      .eq('company_id', companyId)
      .eq('record_kind', kind)
      .ilike('name', rawName)
      .neq('id', id)
      .maybeSingle();

    if (duplicate) {
      throw new Error(`Nama ${kind} "${rawName}" sudah digunakan entitas lain.`);
    }

    const payload: TablesUpdate<'master_record'> = {
      name: rawName,
      data: metadata as unknown as Json,
      version: existing.version + 1,
      updated_by_user_id: this.authService.currentUser()?.id,
      updated_at: new Date().toISOString(),
    };

    if (isActive !== undefined) {
      payload.is_active = isActive;
    }

    const { data: updated, error: updateError } = await this.supabase.client
      .from('master_record')
      .update(payload)
      .eq('company_id', companyId)
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) throw new Error(`Gagal memperbarui ${kind}: ${updateError.message}`);

    const record = updated as MasterRecord;
    await this.logAudit({
      action: `master.${kind}.update`,
      targetType: kind,
      targetId: id,
      details: { name: rawName, metadata, isActive },
      before: existing,
      after: record,
    });

    return record;
  }

  // ============================================================================
  // AUDIT LOG HELPER
  // ============================================================================

  private async logAudit(params: {
    action: string;
    targetType: string;
    targetId: string;
    details?: Record<string, unknown>;
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    try {
      const companyId = this.companyService.activeCompanyId();
      if (!companyId) return;

      await this.supabase.client.from('audit_log').insert({
        company_id: companyId,
        actor_user_id: this.authService.currentUser()?.id,
        action: params.action,
        target_type: params.targetType,
        target_id: params.targetId,
        result: 'success',
        details: (params.details ?? {}) as Json,
        before: params.before ? (params.before as Json) : null,
        after: params.after ? (params.after as Json) : null,
      });
    } catch (err) {
      console.warn('Peringatan: Gagal mencatat audit log:', err);
    }
  }
}
