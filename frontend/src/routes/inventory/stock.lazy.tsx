import type { ColumnDef } from "@tanstack/react-table";

import {
	useBackendApiInventoryListMaterialLedger,
	useBackendApiInventoryListProductLedger,
} from "@/api/generated/inventory/inventory";
import { AccessGuard } from "@/components/access-guard";
import { DataEmpty, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumberId } from "@/lib/i18n";
import * as m from "@/paraglide/messages";

type LedgerItem = {
	id: string;
	transaction_type: string;
	quantity: number | string;
	reference_document: string;
};

type LedgerCardProps = {
	title: string;
	items?: LedgerItem[];
	isLoading: boolean;
	emptyTitle: string;
	emptyDescription: string;
};

const ledgerColumns: ColumnDef<LedgerItem>[] = [
	{
		accessorKey: "transaction_type",
		header: m.stock_transaction_type(),
		cell: ({ row }) => <span className="font-medium">{row.original.transaction_type}</span>,
	},
	{
		accessorKey: "quantity",
		header: m.common_quantity(),
		cell: ({ row }) => formatNumberId(row.original.quantity, { maximumFractionDigits: 4 }),
	},
	{
		accessorKey: "reference_document",
		header: m.common_reference(),
	},
];

export function StockRouteScreen() {
	return (
		<AccessGuard anyOf={["inventory.stock.read"]}>
			<StockScreen />
		</AccessGuard>
	);
}

function LedgerCard({ title, items, isLoading, emptyTitle, emptyDescription }: LedgerCardProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<DataLoading />
				) : items?.length ? (
					<DataTable columns={ledgerColumns} data={items} getRowId={(item) => item.id} />
				) : (
					<DataEmpty title={emptyTitle} description={emptyDescription} />
				)}
			</CardContent>
		</Card>
	);
}

function StockScreen() {
	const { data: matRes, isLoading: matLoading } = useBackendApiInventoryListMaterialLedger();
	const { data: prodRes, isLoading: prodLoading } = useBackendApiInventoryListProductLedger();

	const materials = matRes?.data;
	const products = prodRes?.data;

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-bold">{m.stock_title()}</h1>
				<p className="text-sm text-muted-foreground">{m.stock_description()}</p>
			</div>

			<div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
				<LedgerCard
					title={m.stock_material_ledger()}
					items={materials}
					isLoading={matLoading}
					emptyTitle={m.stock_material_empty_title()}
					emptyDescription={m.stock_material_empty_description()}
				/>
				<LedgerCard
					title={m.stock_product_ledger()}
					items={products}
					isLoading={prodLoading}
					emptyTitle={m.stock_product_empty_title()}
					emptyDescription={m.stock_product_empty_description()}
				/>
			</div>
		</div>
	);
}
