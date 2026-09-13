import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MasterDataService } from '../../../core/services/master-data.service';
import { ProductionOrderDetail, ProductionService } from '../../../core/services/production.service';
import { ProductionOrdersComponent } from './production-orders.component';

describe('ProductionOrdersComponent', () => {
  let component: ProductionOrdersComponent;
  let fixture: ComponentFixture<ProductionOrdersComponent>;
  let mockProductionService: {
    productionOrders: ReturnType<typeof signal<ProductionOrderDetail[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getProductionOrders: ReturnType<typeof vi.fn>;
    getProductionOrderById: ReturnType<typeof vi.fn>;
    createProductionOrder: ReturnType<typeof vi.fn>;
  };
  let mockMasterDataService: {
    getProducts: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockProductionService = {
      productionOrders: signal<ProductionOrderDetail[]>([
        {
          id: 'pp-1',
          company_id: 'company-123',
          document_kind: 'production_order',
          document_number: 'PP-260913-001',
          status: 'draft',
          transaction_date: '2026-09-20',
          total_amount: 0,
          paid_amount: 0,
          version: 1,
          created_at: '2026-09-13T00:00:00Z',
          updated_at: '2026-09-13T00:00:00Z',
          data: { code_locked: false, total_target_pcs: 200, notes: 'Pesanan uji' },
          lines: [
            {
              id: 'line-1',
              company_id: 'company-123',
              document_id: 'pp-1',
              line_number: 1,
              quantity: 200,
              data: { requiresPrinting: true },
              requiresPrinting: true,
              product: { id: 'prod-1', name: 'Kaos Polos', sku: 'KP-01' },
              description: 'Target SKU Kaos Polos',
              conversion_factor: 1,
              unit_price: 0,
              subtotal: 0,
              total_amount: 0,
              revision: 1,
              is_current: true,
              version: 1,
              created_at: '2026-09-13T00:00:00Z',
              account_id: null,
              item_id: 'prod-1',
              unit_code: 'PCS',
            },
          ],
        } as unknown as ProductionOrderDetail,
      ]),
      isLoading: signal(false),
      getProductionOrders: vi.fn().mockResolvedValue([]),
      getProductionOrderById: vi.fn().mockResolvedValue({
        id: 'pp-1',
        document_number: 'PP-260913-001',
        lines: [],
        spks: [],
      }),
      createProductionOrder: vi.fn().mockResolvedValue({
        id: 'pp-2',
        documentNumber: 'PP-260913-002',
      }),
    };

    mockMasterDataService = {
      getProducts: vi.fn().mockResolvedValue([
        { id: 'prod-1', name: 'Kaos Polos', sku: 'KP-01', requiresPrinting: true },
      ]),
    };

    await TestBed.configureTestingModule({
      imports: [ProductionOrdersComponent],
      providers: [
        { provide: ProductionService, useValue: mockProductionService },
        { provide: MasterDataService, useValue: mockMasterDataService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductionOrdersComponent);
    component = fixture.componentInstance;
  });

  it('should initialize and display production orders', async () => {
    expect(component).toBeTruthy();
    await component.loadData();
    expect(mockProductionService.getProductionOrders).toHaveBeenCalled();
    expect(mockMasterDataService.getProducts).toHaveBeenCalled();
    expect(component.orders().length).toBe(1);
    expect(component.totalTargetPcs()).toBe(200);
  });

  it('should open and close create modal', () => {
    component.openCreateModal();
    expect(component.isCreateModalOpen()).toBe(true);
    component.closeCreateModal();
    expect(component.isCreateModalOpen()).toBe(false);
  });

  it('should create production order on submit', async () => {
    component.openCreateModal();
    component.formLines.set([{ productId: 'prod-1', quantity: 150 }]);
    await component.submitCreateOrder();

    expect(mockProductionService.createProductionOrder).toHaveBeenCalledWith({
      targetDate: expect.any(String),
      notes: '',
      lines: [{ productId: 'prod-1', quantity: 150 }],
    });
    expect(component.isCreateModalOpen()).toBe(false);
  });
});
