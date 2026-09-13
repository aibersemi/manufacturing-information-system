import { inject, Injectable, signal } from '@angular/core';
import { Json, Tables } from '../../../types/database.types';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { SupabaseService } from './supabase.service';

export type BusinessDocument = Tables<'business_document'>;
export type BusinessDocumentLine = Tables<'business_document_line'>;

export interface CustomerOrderLineInput {
  itemId: string;
  quantity: number;
  unitPrice: number;
  description?: string;
  unitCode?: string;
  notes?: string;
}

export interface CreateCustomerOrderPayload {
  customerId: string;
  orderNumber?: string;
  orderDate: string;
  targetDeliveryDate?: string | null;
  notes?: string;
  lines: CustomerOrderLineInput[];
}

export interface CustomerOrderLine extends BusinessDocumentLine {
  product?: {
    id: string;
    name: string;
    sku?: string | null;
  } | null;
}

export interface CustomerOrder {
  id: string;
  companyId: string;
  documentNumber: string;
  transactionDate: string;
  counterpartyId: string;
  customerName: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
  poStatus: 'open' | 'completed' | 'void' | string;
  deliveryStatus: 'unshipped' | 'partial_delivery' | 'full_delivery' | string;
  targetDeliveryDate?: string | null;
  notes?: string;
  lines?: CustomerOrderLine[];
  createdAt: string;
}

export interface SalesInvoiceLineInput {
  itemId: string;
  quantity: number;
  unitPrice: number;
  description?: string;
  unitCode?: string;
  notes?: string;
  fallbackUnitCost?: number;
}

export interface CreateSalesInvoicePayload {
  customerId: string;
  poId?: string | null;
  invoiceDate: string;
  fundingMethod: 'receivable' | 'cash';
  cashAccountId?: string | null;
  notes?: string;
  lines: SalesInvoiceLineInput[];
}

export interface SalesInvoiceLine extends BusinessDocumentLine {
  product?: {
    id: string;
    name: string;
    sku?: string | null;
  } | null;
}

export interface SalesInvoice {
  id: string;
  companyId: string;
  documentNumber: string | null;
  transactionDate: string;
  counterpartyId: string;
  customerName: string;
  sourceDocumentId?: string | null;
  sourceOrderNumber?: string | null;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: 'draft' | 'posted' | 'void' | string;
  paymentStatus: 'Belum Dibayar' | 'Sebagian Dibayar' | 'Lunas';
  fundingMethod: 'receivable' | 'cash';
  cashAccountId?: string | null;
  cashAccountName?: string | null;
  notes?: string;
  voidReason?: string | null;
  lines?: SalesInvoiceLine[];
  createdAt: string;
}

export interface PostSalesReceiptPayload {
  invoiceId: string;
  cashAccountId: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface SalesReceipt {
  id: string;
  companyId: string;
  receiptNumber: string;
  transactionDate: string;
  customerId: string;
  customerName: string;
  sourceInvoiceId?: string | null;
  invoiceNumber?: string | null;
  amount: number;
  cashAccountId?: string | null;
  cashAccountName?: string | null;
  notes?: string;
  createdAt: string;
}

export interface SalesFulfillmentSummaryItem {
  id: string;
  poNumber: string;
  orderDate: string;
  customerId: string;
  customerName: string;
  targetDeliveryDate?: string | null;
  poStatus: string;
  deliveryStatus: 'unshipped' | 'partial_delivery' | 'full_delivery';
  totalOrderedQty: number;
  totalDeliveredQty: number;
  remainingQty: number;
  totalAmount: number;
  fulfillmentRate: number;
  lines: {
    lineId: string;
    itemId: string;
    productName: string;
    sku?: string | null;
    orderedQty: number;
    deliveredQty: number;
    remainingQty: number;
    unitPrice: number;
    unitCode: string;
  }[];
  invoiceHistory: {
    invoiceId: string;
    invoiceNumber: string;
    invoiceDate: string;
    totalAmount: number;
    paidAmount: number;
    status: string;
  }[];
}

export interface SalesFulfillmentSummary {
  totalOrders: number;
  totalOrderedQty: number;
  totalDeliveredQty: number;
  totalRemainingQty: number;
  totalOrderAmount: number;
  items: SalesFulfillmentSummaryItem[];
}

export interface CreatePoResult {
  success: boolean;
  id: string;
  documentNumber: string;
  totalAmount: number;
}

export interface CreateInvoiceResult {
  success: boolean;
  id: string;
  totalAmount: number;
}

export interface PostInvoiceResult {
  success: boolean;
  id: string;
  documentNumber: string;
  totalAmount: number;
  cogsTotal: number;
  journalNumber: string;
  deliveryStatus: string;
}

export interface VoidInvoiceResult {
  success: boolean;
  id: string;
  documentNumber: string;
  status: string;
}

export interface PostReceiptResult {
  success: boolean;
  receiptId: string;
  receiptNumber: string;
  invoiceNumber: string;
  paidAmount: number;
  remainingBalance: number;
}

interface RawPoRow {
  id: string;
  company_id: string;
  document_number: string | null;
  transaction_date: string;
  counterparty_id: string;
  total_amount: number;
  paid_amount: number;
  status: string;
  data: Record<string, unknown> | null;
  created_at: string;
  customer?: { id: string; name: string } | null;
  lines?: (BusinessDocumentLine & {
    product?: { id: string; name: string; sku?: string | null } | null;
  })[];
}

interface RawInvoiceRow {
  id: string;
  company_id: string;
  document_number: string | null;
  transaction_date: string;
  counterparty_id: string;
  source_document_id?: string | null;
  total_amount: number;
  paid_amount: number;
  status: string;
  data: Record<string, unknown> | null;
  void_reason?: string | null;
  created_at: string;
  customer?: { id: string; name: string } | null;
  source_po?: { id: string; document_number: string } | null;
  lines?: (BusinessDocumentLine & {
    product?: { id: string; name: string; sku?: string | null } | null;
  })[];
}

interface RawReceiptRow {
  id: string;
  company_id: string;
  document_number: string | null;
  transaction_date: string;
  counterparty_id: string;
  source_document_id?: string | null;
  total_amount: number;
  paid_amount: number;
  status: string;
  data: Record<string, unknown> | null;
  created_at: string;
  customer?: { id: string; name: string } | null;
  invoice?: { id: string; document_number: string } | null;
}

@Injectable({
  providedIn: 'root',
})
export class SalesService {
  private readonly supabase = inject(SupabaseService);
  private readonly companyService = inject(CompanyService);
  private readonly authService = inject(AuthService);

  readonly customerOrders = signal<CustomerOrder[]>([]);
  readonly salesInvoices = signal<SalesInvoice[]>([]);
  readonly receivableInvoices = signal<SalesInvoice[]>([]);
  readonly salesReceipts = signal<SalesReceipt[]>([]);
  readonly fulfillmentSummary = signal<SalesFulfillmentSummary | null>(null);
  readonly loading = signal<boolean>(false);

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

  private requireCurrentUserId(): string {
    const user = this.authService.currentUser();
    if (!user?.id) {
      throw new Error('Pengguna tidak terautentikasi.');
    }
    return user.id;
  }

  // ============================================================================
  // 1. PESANAN PENJUALAN (CUSTOMER PO)
  // ============================================================================

  async getCustomerOrders(filter?: {
    status?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<CustomerOrder[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();

      let query = this.supabase.client
        .from('business_document')
        .select(
          `
          id, company_id, document_number, transaction_date, counterparty_id,
          total_amount, paid_amount, status, data, created_at,
          customer:master_record!counterparty_id(id, name),
          lines:business_document_line(
            id, line_number, item_id, description, unit_code,
            quantity, unit_price, subtotal, total_amount, data,
            product:master_record!item_id(id, name, sku)
          )
        `
        )
        .eq('company_id', companyId)
        .eq('document_kind', 'customer_po')
        .order('transaction_date', { ascending: false })
        .order('document_number', { ascending: false });

      if (filter?.status && filter.status !== 'all') {
        if (filter.status === 'open' || filter.status === 'completed') {
          query = query.filter('data->>poStatus', 'eq', filter.status);
        } else if (
          filter.status === 'unshipped' ||
          filter.status === 'partial_delivery' ||
          filter.status === 'full_delivery'
        ) {
          query = query.filter('data->>deliveryStatus', 'eq', filter.status);
        } else {
          query = query.eq('status', filter.status);
        }
      }

      if (filter?.startDate) {
        query = query.gte('transaction_date', filter.startDate);
      }
      if (filter?.endDate) {
        query = query.lte('transaction_date', filter.endDate);
      }

      const { data, error } = await query;
      if (error) throw error;

      const rawRows = (data || []) as unknown as RawPoRow[];
      let orders: CustomerOrder[] = rawRows.map((row) => {
        const rowData = row.data || {};
        return {
          id: row.id,
          companyId: row.company_id,
          documentNumber: row.document_number || '—',
          transactionDate: row.transaction_date,
          counterpartyId: row.counterparty_id,
          customerName: row.customer?.name || '—',
          totalAmount: Number(row.total_amount) || 0,
          paidAmount: Number(row.paid_amount) || 0,
          status: row.status,
          poStatus: (rowData['poStatus'] as string) || 'open',
          deliveryStatus: (rowData['deliveryStatus'] as string) || 'unshipped',
          targetDeliveryDate: (rowData['targetDeliveryDate'] as string) || null,
          notes: (rowData['notes'] as string) || '',
          createdAt: row.created_at,
          lines: (row.lines || []).map((l) => ({
            ...l,
            product: l.product || null,
          })),
        };
      });

      if (filter?.search) {
        const search = filter.search.toLowerCase().trim();
        orders = orders.filter(
          (o) =>
            o.documentNumber.toLowerCase().includes(search) ||
            o.customerName.toLowerCase().includes(search) ||
            (o.notes && o.notes.toLowerCase().includes(search))
        );
      }

      this.customerOrders.set(orders);
      return orders;
    } finally {
      this.loading.set(false);
    }
  }

  async getCustomerOrderById(id: string): Promise<CustomerOrder | null> {
    const companyId = await this.requireActiveCompanyId();

    const { data, error } = await this.supabase.client
      .from('business_document')
      .select(
        `
        id, company_id, document_number, transaction_date, counterparty_id,
        total_amount, paid_amount, status, data, created_at,
        customer:master_record!counterparty_id(id, name),
        lines:business_document_line(
          id, line_number, item_id, description, unit_code,
          quantity, unit_price, subtotal, total_amount, data,
          product:master_record!item_id(id, name, sku)
        )
      `
      )
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (error || !data) return null;

    const row = data as unknown as RawPoRow;
    const rowData = row.data || {};
    return {
      id: row.id,
      companyId: row.company_id,
      documentNumber: row.document_number || '—',
      transactionDate: row.transaction_date,
      counterpartyId: row.counterparty_id || '',
      customerName: row.customer?.name || '—',
      totalAmount: Number(row.total_amount) || 0,
      paidAmount: Number(row.paid_amount) || 0,
      status: row.status,
      poStatus: (rowData['poStatus'] as string) || 'open',
      deliveryStatus: (rowData['deliveryStatus'] as string) || 'unshipped',
      targetDeliveryDate: (rowData['targetDeliveryDate'] as string) || null,
      notes: (rowData['notes'] as string) || '',
      createdAt: row.created_at,
      lines: (row.lines || []).map((l) => ({
        ...l,
        product: l.product || null,
      })),
    };
  }

  async createCustomerOrder(payload: CreateCustomerOrderPayload): Promise<CreatePoResult> {
    const companyId = await this.requireActiveCompanyId();
    const userId = this.requireCurrentUserId();

    const { data, error } = await this.supabase.client.rpc('create_customer_po', {
      p_company_id: companyId,
      p_customer_id: payload.customerId,
      p_order_number: payload.orderNumber?.trim() || undefined,
      p_order_date: payload.orderDate,
      p_target_delivery_date: payload.targetDeliveryDate || undefined,
      p_notes: payload.notes || undefined,
      p_lines: payload.lines as unknown as Json,
      p_user_id: userId,
    });

    if (error) throw error;
    await this.getCustomerOrders();
    return data as unknown as CreatePoResult;
  }

  // ============================================================================
  // 2. FAKTUR PENJUALAN (SALES INVOICE)
  // ============================================================================

  async getSalesInvoices(filter?: {
    status?: string;
    paymentStatus?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<SalesInvoice[]> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();

      let query = this.supabase.client
        .from('business_document')
        .select(
          `
          id, company_id, document_number, transaction_date, counterparty_id,
          source_document_id, total_amount, paid_amount, status, data,
          void_reason, created_at,
          customer:master_record!counterparty_id(id, name),
          source_po:business_document!source_document_id(id, document_number),
          lines:business_document_line(
            id, line_number, item_id, description, unit_code,
            quantity, unit_price, subtotal, total_amount, data,
            product:master_record!item_id(id, name, sku)
          )
        `
        )
        .eq('company_id', companyId)
        .in('document_kind', ['sales_invoice', 'sale'])
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (filter?.status && filter.status !== 'all') {
        query = query.eq('status', filter.status);
      }

      if (filter?.startDate) {
        query = query.gte('transaction_date', filter.startDate);
      }
      if (filter?.endDate) {
        query = query.lte('transaction_date', filter.endDate);
      }

      const { data, error } = await query;
      if (error) throw error;

      const rawRows = (data || []) as unknown as RawInvoiceRow[];
      let invoices: SalesInvoice[] = rawRows.map((row) => {
        const rowData = row.data || {};
        const total = Number(row.total_amount) || 0;
        const paid = Number(row.paid_amount) || 0;
        const outstanding = Math.max(0, total - paid);

        let payStatus: 'Belum Dibayar' | 'Sebagian Dibayar' | 'Lunas' = 'Belum Dibayar';
        if (paid >= total && total > 0) {
          payStatus = 'Lunas';
        } else if (paid > 0) {
          payStatus = 'Sebagian Dibayar';
        }

        return {
          id: row.id,
          companyId: row.company_id,
          documentNumber: row.document_number,
          transactionDate: row.transaction_date,
          counterpartyId: row.counterparty_id,
          customerName: row.customer?.name || '—',
          sourceDocumentId: row.source_document_id,
          sourceOrderNumber: row.source_po?.document_number || null,
          totalAmount: total,
          paidAmount: paid,
          outstandingAmount: outstanding,
          status: row.status,
          paymentStatus: payStatus,
          fundingMethod: (rowData['fundingMethod'] as 'receivable' | 'cash') || 'receivable',
          cashAccountId: (rowData['cashAccountId'] as string) || null,
          notes: (rowData['notes'] as string) || '',
          voidReason: row.void_reason || null,
          createdAt: row.created_at,
          lines: (row.lines || []).map((l) => ({
            ...l,
            product: l.product || null,
          })),
        };
      });

      if (filter?.paymentStatus && filter.paymentStatus !== 'all') {
        if (filter.paymentStatus === 'unpaid') {
          invoices = invoices.filter((inv) => inv.paymentStatus === 'Belum Dibayar');
        } else if (filter.paymentStatus === 'partial') {
          invoices = invoices.filter((inv) => inv.paymentStatus === 'Sebagian Dibayar');
        } else if (filter.paymentStatus === 'paid') {
          invoices = invoices.filter((inv) => inv.paymentStatus === 'Lunas');
        }
      }

      if (filter?.search) {
        const search = filter.search.toLowerCase().trim();
        invoices = invoices.filter(
          (inv) =>
            (inv.documentNumber && inv.documentNumber.toLowerCase().includes(search)) ||
            inv.customerName.toLowerCase().includes(search) ||
            (inv.sourceOrderNumber && inv.sourceOrderNumber.toLowerCase().includes(search)) ||
            (inv.notes && inv.notes.toLowerCase().includes(search))
        );
      }

      this.salesInvoices.set(invoices);
      return invoices;
    } finally {
      this.loading.set(false);
    }
  }

  async getSalesInvoiceById(id: string): Promise<SalesInvoice | null> {
    const companyId = await this.requireActiveCompanyId();

    const { data, error } = await this.supabase.client
      .from('business_document')
      .select(
        `
        id, company_id, document_number, transaction_date, counterparty_id,
        source_document_id, total_amount, paid_amount, status, data,
        void_reason, created_at,
        customer:master_record!counterparty_id(id, name),
        source_po:business_document!source_document_id(id, document_number),
        lines:business_document_line(
          id, line_number, item_id, description, unit_code,
          quantity, unit_price, subtotal, total_amount, data,
          product:master_record!item_id(id, name, sku)
        )
      `
      )
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (error || !data) return null;

    const row = data as unknown as RawInvoiceRow;
    const rowData = row.data || {};
    const total = Number(row.total_amount) || 0;
    const paid = Number(row.paid_amount) || 0;
    const outstanding = Math.max(0, total - paid);

    let payStatus: 'Belum Dibayar' | 'Sebagian Dibayar' | 'Lunas' = 'Belum Dibayar';
    if (paid >= total && total > 0) {
      payStatus = 'Lunas';
    } else if (paid > 0) {
      payStatus = 'Sebagian Dibayar';
    }

    return {
      id: row.id,
      companyId: row.company_id,
      documentNumber: row.document_number,
      transactionDate: row.transaction_date,
      counterpartyId: row.counterparty_id || '',
      customerName: row.customer?.name || '—',
      sourceDocumentId: row.source_document_id,
      sourceOrderNumber: row.source_po?.document_number || null,
      totalAmount: total,
      paidAmount: paid,
      outstandingAmount: outstanding,
      status: row.status,
      paymentStatus: payStatus,
      fundingMethod: (rowData['fundingMethod'] as 'receivable' | 'cash') || 'receivable',
      cashAccountId: (rowData['cashAccountId'] as string) || null,
      notes: (rowData['notes'] as string) || '',
      voidReason: row.void_reason || null,
      createdAt: row.created_at,
      lines: (row.lines || []).map((l) => ({
        ...l,
        product: l.product || null,
      })),
    };
  }

  async createSalesInvoiceDraft(payload: CreateSalesInvoicePayload): Promise<CreateInvoiceResult> {
    const companyId = await this.requireActiveCompanyId();
    const userId = this.requireCurrentUserId();

    const { data, error } = await this.supabase.client.rpc('create_sales_invoice', {
      p_company_id: companyId,
      p_customer_id: payload.customerId,
      p_po_id: payload.poId || undefined,
      p_invoice_date: payload.invoiceDate,
      p_funding_method: payload.fundingMethod,
      p_cash_account_id: payload.cashAccountId || undefined,
      p_notes: payload.notes || undefined,
      p_lines: payload.lines as unknown as Json,
      p_user_id: userId,
    });

    if (error) throw error;
    await this.getSalesInvoices();
    return data as unknown as CreateInvoiceResult;
  }

  async postSalesInvoice(id: string): Promise<PostInvoiceResult> {
    const userId = this.requireCurrentUserId();

    const { data, error } = await this.supabase.client.rpc('post_sales_invoice', {
      p_document_id: id,
      p_user_id: userId,
    });

    if (error) throw error;
    await this.getSalesInvoices();
    await this.getCustomerOrders();
    return data as unknown as PostInvoiceResult;
  }

  async voidSalesInvoice(id: string, reason: string): Promise<VoidInvoiceResult> {
    const userId = this.requireCurrentUserId();

    const { data, error } = await this.supabase.client.rpc('void_sales_invoice', {
      p_document_id: id,
      p_user_id: userId,
      p_reason: reason,
    });

    if (error) throw error;
    await this.getSalesInvoices();
    await this.getCustomerOrders();
    return data as unknown as VoidInvoiceResult;
  }

  // ============================================================================
  // 3. PENERIMAAN PIUTANG (SALES RECEIPT)
  // ============================================================================

  async getReceivableInvoices(): Promise<SalesInvoice[]> {
    const companyId = await this.requireActiveCompanyId();

    const { data, error } = await this.supabase.client
      .from('business_document')
      .select(
        `
        id, company_id, document_number, transaction_date, counterparty_id,
        source_document_id, total_amount, paid_amount, status, data, created_at,
        customer:master_record!counterparty_id(id, name),
        source_po:business_document!source_document_id(id, document_number)
      `
      )
      .eq('company_id', companyId)
      .in('document_kind', ['sales_invoice', 'sale'])
      .eq('status', 'posted')
      .filter('data->>fundingMethod', 'eq', 'receivable')
      .order('transaction_date', { ascending: false });

    if (error) throw error;

    const rawRows = (data || []) as unknown as RawInvoiceRow[];
    const invoices: SalesInvoice[] = rawRows
      .map((row) => {
        const total = Number(row.total_amount) || 0;
        const paid = Number(row.paid_amount) || 0;
        const outstanding = Math.max(0, total - paid);
        const rowData = row.data || {};

        let payStatus: 'Belum Dibayar' | 'Sebagian Dibayar' | 'Lunas' = 'Belum Dibayar';
        if (paid >= total && total > 0) {
          payStatus = 'Lunas';
        } else if (paid > 0) {
          payStatus = 'Sebagian Dibayar';
        }

        return {
          id: row.id,
          companyId: row.company_id,
          documentNumber: row.document_number,
          transactionDate: row.transaction_date,
          counterpartyId: row.counterparty_id,
          customerName: row.customer?.name || '—',
          sourceDocumentId: row.source_document_id,
          sourceOrderNumber: row.source_po?.document_number || null,
          totalAmount: total,
          paidAmount: paid,
          outstandingAmount: outstanding,
          status: row.status,
          paymentStatus: payStatus,
          fundingMethod: 'receivable' as const,
          notes: (rowData['notes'] as string) || '',
          createdAt: row.created_at,
        };
      })
      .filter((inv) => inv.outstandingAmount > 0);

    this.receivableInvoices.set(invoices);
    return invoices;
  }

  async getReceiptHistory(): Promise<SalesReceipt[]> {
    const companyId = await this.requireActiveCompanyId();

    const { data, error } = await this.supabase.client
      .from('business_document')
      .select(
        `
        id, company_id, document_number, transaction_date, counterparty_id,
        source_document_id, total_amount, paid_amount, status, data, created_at,
        customer:master_record!counterparty_id(id, name),
        invoice:business_document!source_document_id(id, document_number)
      `
      )
      .eq('company_id', companyId)
      .eq('document_kind', 'sales_receipt')
      .eq('status', 'posted')
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    const rawRows = (data || []) as unknown as RawReceiptRow[];
    const receipts: SalesReceipt[] = rawRows.map((row) => {
      const rowData = row.data || {};
      return {
        id: row.id,
        companyId: row.company_id,
        receiptNumber: row.document_number || '—',
        transactionDate: row.transaction_date,
        customerId: row.counterparty_id,
        customerName: row.customer?.name || '—',
        sourceInvoiceId: row.source_document_id,
        invoiceNumber: row.invoice?.document_number || (rowData['invoiceNumber'] as string) || '—',
        amount: Number(row.total_amount) || 0,
        cashAccountId: (rowData['cashAccountId'] as string) || null,
        cashAccountName: (rowData['cashAccountName'] as string) || 'Kas/Bank',
        notes: (rowData['notes'] as string) || '',
        createdAt: row.created_at,
      };
    });

    this.salesReceipts.set(receipts);
    return receipts;
  }

  async payInvoice(payload: PostSalesReceiptPayload): Promise<PostReceiptResult> {
    const userId = this.requireCurrentUserId();

    const { data, error } = await this.supabase.client.rpc('post_sales_receipt', {
      p_invoice_id: payload.invoiceId,
      p_cash_account_id: payload.cashAccountId,
      p_amount: payload.amount,
      p_receipt_date: payload.date,
      p_notes: payload.notes || undefined,
      p_user_id: userId,
    });

    if (error) throw error;
    await this.getReceivableInvoices();
    await this.getReceiptHistory();
    await this.getSalesInvoices();
    return data as unknown as PostReceiptResult;
  }

  // ============================================================================
  // 4. RINGKASAN PEMENUHAN (FULFILLMENT TRACKING)
  // ============================================================================

  async getFulfillmentSummary(): Promise<SalesFulfillmentSummary> {
    this.loading.set(true);
    try {
      const companyId = await this.requireActiveCompanyId();

      const { data, error } = await this.supabase.client.rpc(
        'get_sales_fulfillment_summary',
        { p_company_id: companyId }
      );

      if (error) throw error;
      const result = (data as unknown as SalesFulfillmentSummary) || {
        totalOrders: 0,
        totalOrderedQty: 0,
        totalDeliveredQty: 0,
        totalRemainingQty: 0,
        totalOrderAmount: 0,
        items: [],
      };

      this.fulfillmentSummary.set(result);
      return result;
    } finally {
      this.loading.set(false);
    }
  }

  // ============================================================================
  // 5. DATA PENDUKUNG (DROPDOWN OPTION HELPERS)
  // ============================================================================

  async getCashAccounts(): Promise<Tables<'master_record'>[]> {
    const companyId = await this.requireActiveCompanyId();
    const { data, error } = await this.supabase.client
      .from('master_record')
      .select('*')
      .eq('company_id', companyId)
      .eq('record_kind', 'cash_account')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw new Error(`Gagal memuat akun kas: ${error.message}`);
    return (data ?? []) as Tables<'master_record'>[];
  }

  async getActiveCustomers(): Promise<Tables<'master_record'>[]> {
    const companyId = await this.requireActiveCompanyId();
    const { data, error } = await this.supabase.client
      .from('master_record')
      .select('*')
      .eq('company_id', companyId)
      .eq('record_kind', 'customer')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw new Error(`Gagal memuat pelanggan: ${error.message}`);
    return (data ?? []) as Tables<'master_record'>[];
  }

  async getActiveProducts(): Promise<Tables<'master_record'>[]> {
    const companyId = await this.requireActiveCompanyId();
    const { data, error } = await this.supabase.client
      .from('master_record')
      .select('*')
      .eq('company_id', companyId)
      .eq('record_kind', 'product')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw new Error(`Gagal memuat produk: ${error.message}`);
    return (data ?? []) as Tables<'master_record'>[];
  }
}
