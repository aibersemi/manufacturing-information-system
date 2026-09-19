import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanyService } from '../../core/services/company.service';
import { PurchasingInventoryService } from '../../core/services/purchasing-inventory.service';
import { EligibleBundleItem, ProductionService } from '../../core/services/production.service';
import { InventoryComponent } from './inventory.component';

describe('InventoryComponent', () => {
  let component: InventoryComponent;
  let fixture: ComponentFixture<InventoryComponent>;
  let mockPurchasingService: any;
  let mockProductionService: any;
  let mockCompanyService: any;
  let mockActivatedRoute: any;

  beforeEach(async () => {
    mockPurchasingService = {
      getInventorySummary: vi.fn().mockResolvedValue([
        {
          item_id: 'item-1',
          item_name: 'Cotton Combed 30s',
          item_kind: 'material',
          unit_code: 'm',
          inventory_state: 'material',
          total_in: 100,
          total_out: 25,
          current_stock: 75,
          moving_avg_cost: 60000,
          total_valuation: 4500000,
        },
      ]),
      getInventoryMovements: vi.fn().mockResolvedValue([
        {
          id: 'mov-1',
          movement_type: 'purchase_receipt',
          quantity: 100,
          unit_cost: 60000,
          total_cost: 6000000,
          transaction_date: '2026-09-13',
          item: { name: 'Cotton Combed 30s' },
          doc: { document_number: 'BL-202609-0001' },
        },
      ]),
      getMaterialRolls: vi.fn().mockResolvedValue([
        {
          id: 'roll-1',
          physical_code: 'BL-260913-001-L1-001',
          material: { name: 'Cotton Combed 30s' },
          initial_base_quantity: 25,
          stock_unit_code: 'm',
          status: 'available',
        },
      ]),
    };

    const mockBundle: EligibleBundleItem = {
      id: 'bundle-1',
      bundle_code: '260815-REINHARD-0-L-27-A1-1',
      product_id: 'prod-1',
      product_name: 'Jaket Reinhard L',
      product_sku: 'REINHARD-0-L',
      initial_quantity: 27,
      active_quantity: 27,
      stage: 'cutting',
      work_condition: 'available',
      lot_code: 'LOT-A1',
      production_order_id: 'po-1',
      production_order_number: 'SPK-202608-0001',
    };

    mockProductionService = {
      getAllBundles: vi.fn().mockResolvedValue([mockBundle]),
    };

    mockCompanyService = {
      activeCompanyId: signal('company-123'),
      waitForActiveCompany: vi.fn().mockResolvedValue('company-123'),
    };

    mockActivatedRoute = {
      queryParams: of({}),
      snapshot: {
        queryParamMap: {
          get: vi.fn().mockReturnValue(null),
        },
      },
    };

    await TestBed.configureTestingModule({
      imports: [InventoryComponent],
      providers: [
        { provide: PurchasingInventoryService, useValue: mockPurchasingService },
        { provide: ProductionService, useValue: mockProductionService },
        { provide: CompanyService, useValue: mockCompanyService },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InventoryComponent);
    component = fixture.componentInstance;
  });

  it('should create and load inventory summary, movements, rolls, and production bundles', async () => {
    expect(component).toBeTruthy();
    expect(component.activeTab()).toBe('stok-bahan');

    await component.loadData();

    expect(mockPurchasingService.getInventorySummary).toHaveBeenCalled();
    expect(mockPurchasingService.getInventoryMovements).toHaveBeenCalled();
    expect(mockPurchasingService.getMaterialRolls).toHaveBeenCalled();
    expect(mockProductionService.getAllBundles).toHaveBeenCalled();

    expect(component.summaryItems().length).toBe(1);
    expect(component.movements().length).toBe(1);
    expect(component.rolls().length).toBe(1);
    expect(component.productionBundles().length).toBe(1);

    expect(component.totalValuasiBahan()).toBe(4500000);
    expect(component.totalValuation()).toBe(4500000);
    expect(component.totalMasuk()).toBe(100);
    expect(component.totalWipIkatan()).toBe(27);
    expect(component.availableRollsCount()).toBe(1);
  });

  it('should filter summary by search query (backward compatibility)', () => {
    component.summaryItems.set([
      { item_id: '1', item_name: 'Cotton Combed', item_kind: 'material', unit_code: 'm', inventory_state: 'material', total_in: 50, total_out: 0, current_stock: 50, moving_avg_cost: 1000, total_valuation: 50000 },
      { item_id: '2', item_name: 'Benang Astra', item_kind: 'production_supply', unit_code: 'cones', inventory_state: 'production_supplies', total_in: 20, total_out: 0, current_stock: 20, moving_avg_cost: 500, total_valuation: 10000 },
    ]);

    component.searchQuery.set('astra');
    expect(component.filteredSummary().length).toBe(1);
    expect(component.filteredSummary()[0].item_name).toBe('Benang Astra');
  });

  it('should switch tabs across 5 new categories and legacy tabs', () => {
    component.setActiveTab('stok-masuk');
    expect(component.activeTab()).toBe('stok-masuk');

    component.setActiveTab('stok-keluar');
    expect(component.activeTab()).toBe('stok-keluar');

    component.setActiveTab('stok-produksi');
    expect(component.activeTab()).toBe('stok-produksi');

    component.setActiveTab('stok-produk-jadi');
    expect(component.activeTab()).toBe('stok-produk-jadi');

    component.activeTab.set('ledger');
    expect(component.activeTab()).toBe('ledger');

    component.activeTab.set('rolls');
    expect(component.activeTab()).toBe('rolls');

    component.setActiveTab('stok-bahan');
    expect(component.activeTab()).toBe('stok-bahan');
  });

  it('should filter stokBahanList for material items only', () => {
    component.summaryItems.set([
      { item_id: '1', item_name: 'Bahan RJN Hitam', item_kind: 'material', unit_code: 'm', inventory_state: 'material', total_in: 100, total_out: 10, current_stock: 90, moving_avg_cost: 20000, total_valuation: 1800000 },
      { item_id: '2', item_name: 'OPP Kemasan Plastik', item_kind: 'production_supply', unit_code: 'rim', inventory_state: 'production_supplies', total_in: 5, total_out: 1, current_stock: 4, moving_avg_cost: 115000, total_valuation: 460000 },
    ]);

    const bahanList = component.stokBahanList();
    expect(bahanList.length).toBe(1);
    expect(bahanList[0].item_name).toBe('Bahan RJN Hitam');
    expect(component.totalValuasiBahan()).toBe(1800000);
  });

  it('should filter stokMasukList for purchase receipt and positive movements', () => {
    component.movements.set([
      {
        id: 'm-1',
        company_id: 'c-1',
        business_date: '2026-09-13',
        item_id: 'i-1',
        movement_type: 'purchase_receipt',
        quantity: 50,
        unit_cost: 10000,
        total_cost: 500000,
        transaction_date: '2026-09-13',
        posted_at: '2026-09-13',
        inventory_state: 'material',
        created_at: '2026-09-13',
        lot_code: null,
        notes: null,
        receipt_snapshot: {},
        reference_document_id: null,
        reversal_of_id: null,
        source_document_id: null,
        source_line_id: null,
        item: { id: 'i-1', name: 'Bahan RJN' },
      },
      {
        id: 'm-2',
        company_id: 'c-1',
        business_date: '2026-09-14',
        item_id: 'i-1',
        movement_type: 'production_issue',
        quantity: -20,
        unit_cost: 10000,
        total_cost: 200000,
        transaction_date: '2026-09-14',
        posted_at: '2026-09-14',
        inventory_state: 'material',
        created_at: '2026-09-14',
        lot_code: null,
        notes: null,
        receipt_snapshot: {},
        reference_document_id: null,
        reversal_of_id: null,
        source_document_id: null,
        source_line_id: null,
        item: { id: 'i-1', name: 'Bahan RJN' },
      },
    ]);

    const masukList = component.stokMasukList();
    expect(masukList.length).toBe(1);
    expect(masukList[0].id).toBe('m-1');
    expect(component.totalMasuk()).toBe(50);
  });

  it('should filter stokKeluarList for production issue, sales issue, and waste', () => {
    component.movements.set([
      {
        id: 'm-in',
        company_id: 'c-1',
        business_date: '2026-09-13',
        item_id: 'i-1',
        movement_type: 'purchase_receipt',
        quantity: 100,
        unit_cost: 10000,
        total_cost: 1000000,
        transaction_date: '2026-09-13',
        posted_at: '2026-09-13',
        inventory_state: 'material',
        created_at: '2026-09-13',
        lot_code: null,
        notes: null,
        receipt_snapshot: {},
        reference_document_id: null,
        reversal_of_id: null,
        source_document_id: null,
        source_line_id: null,
      },
      {
        id: 'm-out-1',
        company_id: 'c-1',
        business_date: '2026-09-14',
        item_id: 'i-1',
        movement_type: 'production_issue',
        quantity: -40,
        unit_cost: 10000,
        total_cost: 400000,
        transaction_date: '2026-09-14',
        posted_at: '2026-09-14',
        inventory_state: 'material',
        created_at: '2026-09-14',
        lot_code: null,
        notes: null,
        receipt_snapshot: {},
        reference_document_id: null,
        reversal_of_id: null,
        source_document_id: null,
        source_line_id: null,
      },
      {
        id: 'm-out-2',
        company_id: 'c-1',
        business_date: '2026-09-15',
        item_id: 'i-2',
        movement_type: 'sales_issue',
        quantity: -10,
        unit_cost: 85000,
        total_cost: 850000,
        transaction_date: '2026-09-15',
        posted_at: '2026-09-15',
        inventory_state: 'product',
        created_at: '2026-09-15',
        lot_code: null,
        notes: null,
        receipt_snapshot: {},
        reference_document_id: null,
        reversal_of_id: null,
        source_document_id: null,
        source_line_id: null,
      },
      {
        id: 'm-out-3',
        company_id: 'c-1',
        business_date: '2026-09-16',
        item_id: 'i-1',
        movement_type: 'production_reject',
        quantity: -2,
        unit_cost: 10000,
        total_cost: 20000,
        transaction_date: '2026-09-16',
        posted_at: '2026-09-16',
        inventory_state: 'material',
        created_at: '2026-09-16',
        lot_code: null,
        notes: null,
        receipt_snapshot: {},
        reference_document_id: null,
        reversal_of_id: null,
        source_document_id: null,
        source_line_id: null,
      },
    ]);

    const keluarList = component.stokKeluarList();
    expect(keluarList.length).toBe(3);
    expect(component.totalKeluar()).toBe(52);
  });

  it('should filter stokProduksiList for WIP bundles (stage !== packing or condition !== completed)', () => {
    component.productionBundles.set([
      {
        id: 'b-wip-1',
        bundle_code: 'IKT-POT-01',
        product_id: 'p-1',
        product_name: 'Jaket M',
        initial_quantity: 30,
        active_quantity: 30,
        stage: 'cutting',
        work_condition: 'available',
        production_order_id: 'po-1',
      },
      {
        id: 'b-wip-2',
        bundle_code: 'IKT-SAB-01',
        product_id: 'p-1',
        product_name: 'Jaket M',
        initial_quantity: 28,
        active_quantity: 28,
        stage: 'printing',
        work_condition: 'available',
        production_order_id: 'po-1',
      },
      {
        id: 'b-wip-3',
        bundle_code: 'IKT-REP-01',
        product_id: 'p-1',
        product_name: 'Jaket M',
        initial_quantity: 5,
        active_quantity: 5,
        stage: 'packing',
        work_condition: 'repair_hold',
        production_order_id: 'po-1',
      },
      {
        id: 'b-done',
        bundle_code: 'IKT-FIN-01',
        product_id: 'p-1',
        product_name: 'Jaket M',
        initial_quantity: 25,
        active_quantity: 25,
        stage: 'packing',
        work_condition: 'completed',
        production_order_id: 'po-1',
      },
    ]);

    const produksiList = component.stokProduksiList();
    expect(produksiList.length).toBe(3);
    expect(component.totalWipIkatan()).toBe(63);
  });

  it('should filter stokProdukJadiList for finished products and completed bundles', () => {
    component.summaryItems.set([
      {
        item_id: 'prod-sku-1',
        item_name: 'Jaket REINHARD-0-S',
        item_kind: 'product',
        unit_code: 'pcs',
        inventory_state: 'product',
        total_in: 120,
        total_out: 20,
        current_stock: 100,
        moving_avg_cost: 77000,
        total_valuation: 7700000,
      },
    ]);

    component.productionBundles.set([
      {
        id: 'bundle-done-1',
        bundle_code: 'IKT-PACKED-01',
        product_id: 'p-2',
        product_name: 'Jaket REINHARD-0-M',
        product_sku: 'REINHARD-0-M',
        initial_quantity: 50,
        active_quantity: 50,
        stage: 'packing',
        work_condition: 'completed',
        production_order_id: 'po-2',
      },
    ]);

    const produkJadiList = component.stokProdukJadiList();
    expect(produkJadiList.length).toBe(2);
    expect(component.totalProdukJadi()).toBe(150);
    expect(component.totalProdukJadiSiapJual()).toBe(150);
  });

  it('should synchronize activeTab from ActivatedRoute queryParam tab', async () => {
    const routeWithParam = {
      queryParams: of({ tab: 'stok-produksi' }),
      snapshot: {
        queryParamMap: {
          get: (key: string) => (key === 'tab' ? 'stok-produksi' : null),
        },
      },
    };

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [InventoryComponent],
      providers: [
        { provide: PurchasingInventoryService, useValue: mockPurchasingService },
        { provide: ProductionService, useValue: mockProductionService },
        { provide: CompanyService, useValue: mockCompanyService },
        { provide: ActivatedRoute, useValue: routeWithParam },
      ],
    }).compileComponents();

    const customFixture = TestBed.createComponent(InventoryComponent);
    const customComp = customFixture.componentInstance;
    expect(customComp.activeTab()).toBe('stok-produksi');
  });
});
