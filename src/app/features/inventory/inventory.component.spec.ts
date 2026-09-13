import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanyService } from '../../core/services/company.service';
import { PurchasingInventoryService } from '../../core/services/purchasing-inventory.service';
import { InventoryComponent } from './inventory.component';

describe('InventoryComponent', () => {
  let component: InventoryComponent;
  let fixture: ComponentFixture<InventoryComponent>;
  let mockPurchasingService: any;
  let mockCompanyService: any;

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
          quantity: 100,
          unit_cost: 60000,
          total_cost: 6000000,
          transaction_date: '2026-09-13',
          item: { name: 'Cotton Combed 30s' },
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

    mockCompanyService = {
      activeCompanyId: signal('company-123'),
      waitForActiveCompany: vi.fn().mockResolvedValue('company-123'),
    };

    await TestBed.configureTestingModule({
      imports: [InventoryComponent],
      providers: [
        { provide: PurchasingInventoryService, useValue: mockPurchasingService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InventoryComponent);
    component = fixture.componentInstance;
  });

  it('should create and load inventory summary, movements, and rolls', async () => {
    expect(component).toBeTruthy();
    await component.loadData();
    expect(mockPurchasingService.getInventorySummary).toHaveBeenCalled();
    expect(mockPurchasingService.getInventoryMovements).toHaveBeenCalled();
    expect(mockPurchasingService.getMaterialRolls).toHaveBeenCalled();
    expect(component.summaryItems().length).toBe(1);
    expect(component.totalValuation()).toBe(4500000);
    expect(component.availableRollsCount()).toBe(1);
  });

  it('should filter summary by search query', () => {
    component.summaryItems.set([
      { item_id: '1', item_name: 'Cotton Combed', item_kind: 'material', unit_code: 'm', inventory_state: 'material', total_in: 50, total_out: 0, current_stock: 50, moving_avg_cost: 1000, total_valuation: 50000 },
      { item_id: '2', item_name: 'Benang Astra', item_kind: 'production_supply', unit_code: 'cones', inventory_state: 'production_supplies', total_in: 20, total_out: 0, current_stock: 20, moving_avg_cost: 500, total_valuation: 10000 },
    ]);

    component.searchQuery.set('astra');
    expect(component.filteredSummary().length).toBe(1);
    expect(component.filteredSummary()[0].item_name).toBe('Benang Astra');
  });

  it('should switch tabs', () => {
    component.activeTab.set('ledger');
    expect(component.activeTab()).toBe('ledger');
    component.activeTab.set('rolls');
    expect(component.activeTab()).toBe('rolls');
  });
});
