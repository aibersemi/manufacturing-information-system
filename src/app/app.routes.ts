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
        path: 'production/repairs',
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
