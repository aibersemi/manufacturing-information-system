import { createRouter } from "@tanstack/react-router";
import { balanceSheetRoute } from "./routes/accounting/balance-sheet";
import { cashFlowsRoute } from "./routes/accounting/cash-flows";
import { generalLedgerRoute } from "./routes/accounting/general-ledger";
import { incomeStatementRoute } from "./routes/accounting/income-statement";
import { journalsRoute } from "./routes/accounting/journals";
import { trialBalanceRoute } from "./routes/accounting/trial-balance";
import { controlCenterRoute } from "./routes/control-center";
import { dashboardRoute } from "./routes/dashboard";
import { dashboardHomeRoute } from "./routes/dashboard-home";
import { assetsListRoute } from "./routes/finance/assets";
import { costAllocationsRoute } from "./routes/finance/cost-allocations";
import { assetDepreciationRoute } from "./routes/finance/depreciation";
import { operationalExpensesRoute } from "./routes/finance/expenses";
import { paymentRequestsRoute } from "./routes/finance/payment-requests";
import { pettyCashRoute } from "./routes/finance/petty-cash";
import { purchaseInvoicesRoute } from "./routes/finance/purchase-invoices";
import { purchasePaymentsRoute } from "./routes/finance/purchase-payments";
import { salesInvoicesRoute } from "./routes/finance/sales-invoices";
import { salesPaymentsRoute } from "./routes/finance/sales-payments";
import { indexRoute } from "./routes/index";
import { materialIssuesRoute } from "./routes/inventory/issues";
import { productBatchesRoute } from "./routes/inventory/product-batches";
import { purchasesRoute } from "./routes/inventory/purchases";
import { materialReceiptsRoute } from "./routes/inventory/receipts";
import { stockRoute } from "./routes/inventory/stock";
import { stockAdjustmentsRoute } from "./routes/inventory/stock-adjustments";
import { stockOpnamesRoute } from "./routes/inventory/stock-opnames";
import { attendanceRoute } from "./routes/labor/attendance";
import { cashAdvancesRoute } from "./routes/labor/cash-advances";
import { pieceRatePaymentsRoute } from "./routes/labor/payments";
import { operatorWorkLogsRoute } from "./routes/labor/work-logs";
import { loginRoute } from "./routes/login";
import { bankAccountsRoute } from "./routes/masterdata/bank-accounts";
import { bomsRoute } from "./routes/masterdata/boms";
import { bomDetailRoute } from "./routes/masterdata/boms.$bomId";
import { chartOfAccountsRoute } from "./routes/masterdata/chart-of-accounts";
import { costCategoriesRoute } from "./routes/masterdata/cost-categories";
import { customersRoute } from "./routes/masterdata/customers";
import { materialsRoute } from "./routes/masterdata/materials";
import { pieceRatesRoute } from "./routes/masterdata/piece-rates";
import { productsRoute } from "./routes/masterdata/products";
import { routingsRoute } from "./routes/masterdata/routings";
import { routingDetailRoute } from "./routes/masterdata/routings.$routingId";
import { suppliersRoute } from "./routes/masterdata/suppliers";
import { uomsRoute } from "./routes/masterdata/uoms";
import { productionCostsRoute } from "./routes/production/costs";
import { jobPacketsRoute } from "./routes/production/job-packets";
import { productionOrdersRoute } from "./routes/production/orders";
import { productionOrderDetailRoute } from "./routes/production/orders.$orderId";
import { productionProgressRoute } from "./routes/production/progress";
import { qcRoute } from "./routes/production/qc";
import { reworkRoute } from "./routes/production/rework";
import { scrapRoute } from "./routes/production/scrap";
import { progressVerificationRoute } from "./routes/production/verify";
import { reportsRoute } from "./routes/reports";
import { rootRoute } from "./routes/root";
import { salesOrdersRoute } from "./routes/sales/orders";
import { salesOrderDetailRoute } from "./routes/sales/orders.$orderId";
import { operatorsRoute } from "./routes/settings/operators";
import { tenantsRoute } from "./routes/settings/tenants";
import { usersRoute } from "./routes/settings/users";

const routeTree = rootRoute.addChildren([
	indexRoute,
	loginRoute,
	dashboardRoute.addChildren([
		dashboardHomeRoute,
		customersRoute,
		suppliersRoute,
		materialsRoute,
		productsRoute,
		uomsRoute,
		salesOrdersRoute,
		salesOrderDetailRoute,
		productionOrdersRoute,
		productionOrderDetailRoute,
		jobPacketsRoute,
		stockRoute,
		purchasesRoute,
		attendanceRoute,
		pettyCashRoute,
		paymentRequestsRoute,
		journalsRoute,
		reportsRoute,
		controlCenterRoute,
		tenantsRoute,
		usersRoute,
		operatorsRoute,
		materialReceiptsRoute,
		materialIssuesRoute,
		productionProgressRoute,
		progressVerificationRoute,
		operatorWorkLogsRoute,
		cashAdvancesRoute,
		pieceRatePaymentsRoute,
		salesInvoicesRoute,
		salesPaymentsRoute,
		purchaseInvoicesRoute,
		purchasePaymentsRoute,
		operationalExpensesRoute,
		assetsListRoute,
		assetDepreciationRoute,
		bomsRoute,
		bomDetailRoute,
		routingDetailRoute,
		routingsRoute,
		pieceRatesRoute,
		chartOfAccountsRoute,
		bankAccountsRoute,
		costCategoriesRoute,
		qcRoute,
		reworkRoute,
		scrapRoute,
		productionCostsRoute,
		stockOpnamesRoute,
		stockAdjustmentsRoute,
		productBatchesRoute,
		costAllocationsRoute,
		generalLedgerRoute,
		trialBalanceRoute,
		incomeStatementRoute,
		balanceSheetRoute,
		cashFlowsRoute,
	]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
