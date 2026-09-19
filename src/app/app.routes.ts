import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';
import { ownerGuard } from './core/guards/owner.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layout/dashboard-layout/dashboard-layout.component').then(
        (m) => m.DashboardLayoutComponent
      ),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'workspace/customers',
        loadComponent: () =>
          import('./features/master-data/customers/customers.component').then(
            (m) => m.CustomersComponent
          ),
      },
      {
        path: 'workspace/suppliers',
        loadComponent: () =>
          import('./features/master-data/suppliers/suppliers.component').then(
            (m) => m.SuppliersComponent
          ),
      },
      {
        path: 'workspace/materials',
        loadComponent: () =>
          import('./features/master-data/materials/materials.component').then(
            (m) => m.MaterialsComponent
          ),
      },
      {
        path: 'workspace/materials/uom',
        loadComponent: () =>
          import('./features/master-data/uom/uom.component').then(
            (m) => m.UomComponent
          ),
      },
      {
        path: 'workspace/products',
        loadComponent: () =>
          import('./features/master-data/products/products.component').then(
            (m) => m.ProductsComponent
          ),
      },
      {
        path: 'workspace/bom',
        loadComponent: () =>
          import('./features/master-data/bom/bom.component').then(
            (m) => m.BomComponent
          ),
      },
      {
        path: 'workspace/employees',
        loadComponent: () =>
          import('./features/master-data/employees/employees.component').then(
            (m) => m.EmployeesComponent
          ),
      },
      {
        path: 'workspace/wage-rates',
        loadComponent: () =>
          import('./features/master-data/wage-rates/wage-rates.component').then(
            (m) => m.WageRatesComponent
          ),
      },
      {
        path: 'customers',
        redirectTo: 'workspace/customers',
        pathMatch: 'full',
      },
      {
        path: 'suppliers',
        redirectTo: 'workspace/suppliers',
        pathMatch: 'full',
      },
      {
        path: 'materials',
        redirectTo: 'workspace/materials',
        pathMatch: 'full',
      },
      {
        path: 'products',
        redirectTo: 'workspace/products',
        pathMatch: 'full',
      },
      {
        path: 'bom',
        redirectTo: 'workspace/bom',
        pathMatch: 'full',
      },
      {
        path: 'employees',
        redirectTo: 'workspace/employees',
        pathMatch: 'full',
      },
      {
        path: 'wage-rates',
        redirectTo: 'workspace/wage-rates',
        pathMatch: 'full',
      },
      // Purchasing & Inventory Module
      {
        path: 'workspace/purchase-materials',
        loadComponent: () =>
          import('./features/purchasing/materials/purchase-materials.component').then(
            (m) => m.PurchaseMaterialsComponent
          ),
      },
      {
        path: 'workspace/purchase-supplies',
        loadComponent: () =>
          import('./features/purchasing/supplies/purchase-supplies.component').then(
            (m) => m.PurchaseSuppliesComponent
          ),
      },
      {
        path: 'workspace/purchase-non-production',
        loadComponent: () =>
          import('./features/purchasing/non-production/purchase-non-production.component').then(
            (m) => m.PurchaseNonProductionComponent
          ),
      },
      {
        path: 'workspace/purchase-payments',
        loadComponent: () =>
          import('./features/purchasing/payments/purchase-payments.component').then(
            (m) => m.PurchasePaymentsComponent
          ),
      },
      {
        path: 'workspace/inventory',
        loadComponent: () =>
          import('./features/inventory/inventory.component').then(
            (m) => m.InventoryComponent
          ),
      },
      // Operasional Produksi & SPK (Fase 5)
      {
        path: 'workspace/production-orders',
        loadComponent: () =>
          import('./features/production/orders/production-orders.component').then(
            (m) => m.ProductionOrdersComponent
          ),
      },
      {
        path: 'workspace/spk',
        loadComponent: () =>
          import('./features/production/spk/spk.component').then(
            (m) => m.SpkComponent
          ),
      },
      {
        path: 'workspace/operator-cutting',
        loadComponent: () =>
          import('./features/production/operator-cutting/operator-cutting.component').then(
            (m) => m.OperatorCuttingComponent
          ),
      },
      {
        path: 'workspace/operator-printing',
        loadComponent: () =>
          import('./features/production/operator-printing/operator-printing.component').then(
            (m) => m.OperatorPrintingComponent
          ),
      },
      {
        path: 'workspace/operator-sewing',
        loadComponent: () =>
          import('./features/production/operator-sewing/operator-sewing.component').then(
            (m) => m.OperatorSewingComponent
          ),
      },
      {
        path: 'workspace/production-repairs',
        loadComponent: () =>
          import('./features/production/repairs/production-repairs.component').then(
            (m) => m.ProductionRepairsComponent
          ),
      },
      {
        path: 'workspace/production-progress',
        loadComponent: () =>
          import('./features/production/progress/production-progress.component').then(
            (m) => m.ProductionProgressComponent
          ),
      },
      // Penjualan & Piutang (Fase 6: Sales & Receivables)
      {
        path: 'workspace/sales-orders',
        loadComponent: () =>
          import('./features/sales/orders/sales-orders.component').then(
            (m) => m.SalesOrdersComponent
          ),
      },
      {
        path: 'workspace/sales',
        loadComponent: () =>
          import('./features/sales/invoices/sales-invoices.component').then(
            (m) => m.SalesInvoicesComponent
          ),
      },
      {
        path: 'workspace/sales-receipts',
        loadComponent: () =>
          import('./features/sales/receipts/sales-receipts.component').then(
            (m) => m.SalesReceiptsComponent
          ),
      },
      {
        path: 'workspace/sales-fulfillment',
        loadComponent: () =>
          import('./features/sales/fulfillment/sales-fulfillment.component').then(
            (m) => m.SalesFulfillmentComponent
          ),
      },
      // Keuangan & Akuntansi (Fase 7: Finance, Accounting & General Ledger)
      {
        path: 'workspace/finance/coa',
        loadComponent: () =>
          import('./features/finance/coa/coa.component').then(
            (m) => m.CoaComponent
          ),
      },
      {
        path: 'workspace/finance/cash-bank',
        loadComponent: () =>
          import('./features/finance/cash-bank/cash-bank.component').then(
            (m) => m.CashBankComponent
          ),
      },
      {
        path: 'workspace/finance/expenses',
        loadComponent: () =>
          import('./features/finance/expenses/operating-expenses.component').then(
            (m) => m.OperatingExpensesComponent
          ),
      },
      {
        path: 'workspace/finance/wages',
        loadComponent: () =>
          import('./features/finance/wages/wage-payments.component').then(
            (m) => m.WagePaymentsComponent
          ),
      },
      {
        path: 'workspace/finance/prepaid',
        loadComponent: () =>
          import('./features/finance/prepaid/prepaid-expenses.component').then(
            (m) => m.PrepaidExpensesComponent
          ),
      },
      {
        path: 'workspace/finance/opening-balance',
        loadComponent: () =>
          import('./features/finance/opening-balance/opening-balance.component').then(
            (m) => m.OpeningBalanceComponent
          ),
      },
      {
        path: 'workspace/finance/journals',
        loadComponent: () =>
          import('./features/finance/journals/manual-journals.component').then(
            (m) => m.ManualJournalsComponent
          ),
      },
      {
        path: 'workspace/finance/period-close',
        loadComponent: () =>
          import('./features/finance/period-close/period-close.component').then(
            (m) => m.PeriodCloseComponent
          ),
      },
      // Aset Tetap & Penyusutan (Fase 8: Fixed Assets & Depreciation)
      {
        path: 'workspace/asset-purchases',
        loadComponent: () =>
          import('./features/assets/purchases/asset-purchases.component').then(
            (m) => m.AssetPurchasesComponent
          ),
      },
      {
        path: 'workspace/assets',
        loadComponent: () =>
          import('./features/assets/register/asset-register.component').then(
            (m) => m.AssetRegisterComponent
          ),
      },
      {
        path: 'workspace/depreciation',
        loadComponent: () =>
          import('./features/assets/depreciation/monthly-depreciation.component').then(
            (m) => m.MonthlyDepreciationComponent
          ),
      },
      {
        path: 'workspace/asset-disposals',
        loadComponent: () =>
          import('./features/assets/disposals/asset-disposals.component').then(
            (m) => m.AssetDisposalsComponent
          ),
      },
      // Laporan Keuangan, HPP & Rekonsiliasi (Fase 9: Financial Reporting, HPP & Reconciliation)
      {
        path: 'workspace/reports',
        redirectTo: 'workspace/reports/trial-balance',
        pathMatch: 'full',
      },
      {
        path: 'workspace/reports/trial-balance',
        loadComponent: () =>
          import('./features/reports/trial-balance/trial-balance.component').then(
            (m) => m.TrialBalanceComponent
          ),
      },
      {
        path: 'workspace/reports/profit-loss',
        loadComponent: () =>
          import('./features/reports/profit-loss/profit-loss.component').then(
            (m) => m.ProfitLossComponent
          ),
      },
      {
        path: 'workspace/reports/balance-sheet',
        loadComponent: () =>
          import('./features/reports/balance-sheet/balance-sheet.component').then(
            (m) => m.BalanceSheetComponent
          ),
      },
      {
        path: 'workspace/reports/cash-flow',
        loadComponent: () =>
          import('./features/reports/cash-flow/cash-flow.component').then(
            (m) => m.CashFlowComponent
          ),
      },
      {
        path: 'workspace/reports/general-ledger',
        loadComponent: () =>
          import('./features/reports/general-ledger/general-ledger.component').then(
            (m) => m.GeneralLedgerComponent
          ),
      },
      {
        path: 'workspace/reports/hpp',
        loadComponent: () =>
          import('./features/reports/hpp/hpp-report.component').then(
            (m) => m.HppReportComponent
          ),
      },
      {
        path: 'workspace/reports/reconciliation',
        loadComponent: () =>
          import('./features/reports/reconciliation/reconciliation.component').then(
            (m) => m.ReconciliationComponent
          ),
      },
      {
        path: 'asset-purchases',
        redirectTo: 'workspace/asset-purchases',
        pathMatch: 'full',
      },
      {
        path: 'fixed-assets',
        redirectTo: 'workspace/assets',
        pathMatch: 'full',
      },
      {
        path: 'assets',
        redirectTo: 'workspace/assets',
        pathMatch: 'full',
      },
      {
        path: 'depreciation',
        redirectTo: 'workspace/depreciation',
        pathMatch: 'full',
      },
      {
        path: 'asset-disposals',
        redirectTo: 'workspace/asset-disposals',
        pathMatch: 'full',
      },
      {
        path: 'coa',
        redirectTo: 'workspace/finance/coa',
        pathMatch: 'full',
      },
      {
        path: 'cash',
        redirectTo: 'workspace/finance/cash-bank',
        pathMatch: 'full',
      },
      {
        path: 'cash-bank',
        redirectTo: 'workspace/finance/cash-bank',
        pathMatch: 'full',
      },
      {
        path: 'expenses',
        redirectTo: 'workspace/finance/expenses',
        pathMatch: 'full',
      },
      {
        path: 'wages',
        redirectTo: 'workspace/finance/wages',
        pathMatch: 'full',
      },
      {
        path: 'prepaid',
        redirectTo: 'workspace/finance/prepaid',
        pathMatch: 'full',
      },
      {
        path: 'opening-balance',
        redirectTo: 'workspace/finance/opening-balance',
        pathMatch: 'full',
      },
      {
        path: 'journals',
        redirectTo: 'workspace/finance/journals',
        pathMatch: 'full',
      },
      {
        path: 'period-close',
        redirectTo: 'workspace/finance/period-close',
        pathMatch: 'full',
      },
      {
        path: 'reports',
        redirectTo: 'workspace/reports/trial-balance',
        pathMatch: 'full',
      },
      {
        path: 'trial-balance',
        redirectTo: 'workspace/reports/trial-balance',
        pathMatch: 'full',
      },
      {
        path: 'profit-loss',
        redirectTo: 'workspace/reports/profit-loss',
        pathMatch: 'full',
      },
      {
        path: 'balance-sheet',
        redirectTo: 'workspace/reports/balance-sheet',
        pathMatch: 'full',
      },
      {
        path: 'cash-flow',
        redirectTo: 'workspace/reports/cash-flow',
        pathMatch: 'full',
      },
      {
        path: 'general-ledger',
        redirectTo: 'workspace/reports/general-ledger',
        pathMatch: 'full',
      },
      {
        path: 'hpp',
        redirectTo: 'workspace/reports/hpp',
        pathMatch: 'full',
      },
      {
        path: 'hpp-report',
        redirectTo: 'workspace/reports/hpp',
        pathMatch: 'full',
      },
      {
        path: 'reconciliation',
        redirectTo: 'workspace/reports/reconciliation',
        pathMatch: 'full',
      },
      {
        path: 'sales',
        redirectTo: 'workspace/sales',
        pathMatch: 'full',
      },
      {
        path: 'orders',
        redirectTo: 'workspace/sales-orders',
        pathMatch: 'full',
      },
      {
        path: 'purchasing',
        redirectTo: 'workspace/purchase-materials',
        pathMatch: 'full',
      },
      {
        path: 'inventory',
        redirectTo: 'workspace/inventory',
        pathMatch: 'full',
      },
      {
        path: 'production',
        redirectTo: 'workspace/production-orders',
        pathMatch: 'full',
      },
      {
        path: 'production/orders',
        redirectTo: 'workspace/production-orders',
        pathMatch: 'full',
      },
      {
        path: 'production/spk',
        redirectTo: 'workspace/spk',
        pathMatch: 'full',
      },
      {
        path: 'production/operator/cutting',
        redirectTo: 'workspace/operator-cutting',
        pathMatch: 'full',
      },
      {
        path: 'production/operator/printing',
        redirectTo: 'workspace/operator-printing',
        pathMatch: 'full',
      },
      {
        path: 'production/operator/sewing',
        redirectTo: 'workspace/operator-sewing',
        pathMatch: 'full',
      },
      {
        path: 'operator-sewing',
        redirectTo: 'workspace/operator-sewing',
        pathMatch: 'full',
      },
      {
        path: 'production/repairs',
        redirectTo: 'workspace/production-repairs',
        pathMatch: 'full',
      },
      {
        path: 'quality',
        redirectTo: 'workspace/production-repairs',
        pathMatch: 'full',
      },
      {
        path: 'production/progress',
        redirectTo: 'workspace/production-progress',
        pathMatch: 'full',
      },
      {
        path: 'work-orders',
        redirectTo: 'workspace/production-orders',
        pathMatch: 'full',
      },
      {
        path: 'workspace/companies',
        canActivate: [ownerGuard],
        loadComponent: () =>
          import('./features/settings/companies/companies.component').then(
            (m) => m.CompaniesComponent
          ),
      },
      {
        path: 'workspace/users-access',
        canActivate: [ownerGuard],
        loadComponent: () =>
          import('./features/settings/users-access/users-access.component').then(
            (m) => m.UsersAccessComponent
          ),
      },
      {
        path: 'workspace/profile',
        loadComponent: () =>
          import('./features/settings/profile/profile.component').then(
            (m) => m.ProfileComponent
          ),
      },
      {
        path: 'settings',
        redirectTo: 'workspace/profile',
        pathMatch: 'full',
      },
      {
        path: 'workspace/settings',
        redirectTo: 'workspace/profile',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
    canActivate: [guestGuard],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
