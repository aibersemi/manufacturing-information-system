import { describe, expect, it } from "vitest";
import { type Capability, can, canAll, canAny } from "@/lib/capabilities";
import { buildNavigation } from "@/lib/navigation";

function itemKeys(capabilities: Capability[]) {
	return buildNavigation(capabilities).flatMap((group) => group.items.map((item) => item.key));
}

describe("capability helpers", () => {
	const capabilities = ["dashboard.operator", "labor.attendance.self"];

	it("memeriksa capability tunggal", () => {
		expect(can(capabilities, "dashboard.operator")).toBe(true);
		expect(can(capabilities, "settings.users.read")).toBe(false);
		expect(can(undefined, "dashboard.operator")).toBe(false);
	});

	it("memeriksa salah satu capability", () => {
		expect(canAny(capabilities, ["settings.users.read", "labor.attendance.self"])).toBe(true);
		expect(canAny(capabilities, ["settings.users.read", "finance.assets.create"])).toBe(false);
	});

	it("memeriksa semua capability", () => {
		expect(canAll(capabilities, ["dashboard.operator", "labor.attendance.self"])).toBe(true);
		expect(canAll(capabilities, ["dashboard.operator", "settings.users.read"])).toBe(false);
	});
});

describe("navigation builder", () => {
	it("menampilkan menu super admin", () => {
		const keys = itemKeys([
			"dashboard.system",
			"tenant.switch",
			"settings.tenants.read",
			"settings.users.read",
			"settings.operators.read",
			"masterdata.customers.read",
			"masterdata.materials.read",
			"sales.orders.read",
			"production.orders.read",
			"production.job_packets.read",
			"inventory.stock.read",
			"inventory.purchases.read",
			"labor.attendance.read",
			"finance.petty_cash.create",
			"finance.payment_requests.pay",
			"accounting.journals.read",
			"reports.finance.read",
			"core.audit.read",
		]);

		expect(keys).toEqual(
			expect.arrayContaining(["home", "tenants", "users", "operators", "journals"]),
		);
	});

	it("menampilkan menu kepala konveksi tanpa accounting dan tenant settings", () => {
		const keys = itemKeys([
			"dashboard.operational",
			"settings.operators.read",
			"masterdata.customers.read",
			"sales.orders.read",
			"production.orders.read",
			"production.job_packets.read",
			"inventory.stock.read",
			"inventory.purchases.read",
			"labor.attendance.read",
			"finance.petty_cash.create",
			"finance.payment_requests.create",
			"reports.operational.read",
			"core.approvals.read",
		]);

		expect(keys).toContain("operators");
		expect(keys).toContain("production_orders");
		expect(keys).not.toContain("tenants");
		expect(keys).not.toContain("users");
		expect(keys).not.toContain("journals");
	});

	it("menampilkan menu finance read-only operasional dan accounting", () => {
		const keys = itemKeys([
			"dashboard.finance",
			"sales.orders.read",
			"production.orders.read",
			"production.job_packets.read",
			"inventory.stock.read",
			"inventory.purchases.read",
			"finance.petty_cash.create",
			"finance.payment_requests.pay",
			"accounting.journals.read",
			"reports.finance.read",
			"core.audit.read",
		]);

		expect(keys).toContain("sales_orders");
		expect(keys).toContain("production_orders");
		expect(keys).toContain("journals");
		expect(keys).not.toContain("operators");
	});

	it("membatasi operator internal ke dashboard kerja, paket, dan attendance", () => {
		const keys = itemKeys([
			"dashboard.operator",
			"production.job_packets.assigned.read",
			"production.progress.submit.assigned",
			"labor.attendance.self",
			"labor.cash_advance.self",
			"labor.work_log.self",
			"core.audit.self",
		]);

		expect(keys).toEqual(expect.arrayContaining(["home", "job_packets", "attendance"]));
		expect(keys).not.toEqual(expect.arrayContaining(["sales_orders", "journals"]));
	});

	it("menyembunyikan attendance untuk operator external", () => {
		const keys = itemKeys([
			"dashboard.operator",
			"production.job_packets.assigned.read",
			"production.progress.submit.assigned",
			"labor.work_log.self",
			"core.audit.self",
		]);

		expect(keys).toContain("job_packets");
		expect(keys).not.toContain("attendance");
	});

	it("menampilkan petty cash draft untuk dapur", () => {
		const keys = itemKeys([
			"dashboard.operator",
			"finance.petty_cash.read",
			"finance.petty_cash.dapur_draft",
			"labor.attendance.self",
			"labor.cash_advance.self",
		]);

		expect(keys).toContain("petty_cash");
		expect(keys).toContain("attendance");
		expect(keys).not.toContain("purchases");
	});

	it("menampilkan gudang hanya jika capability stok diberikan", () => {
		const keys = itemKeys([
			"dashboard.operator",
			"production.job_packets.assigned.read",
			"inventory.stock.read",
			"labor.attendance.self",
		]);

		expect(keys).toEqual(expect.arrayContaining(["home", "job_packets", "stock"]));
		expect(keys).not.toContain("purchases");
	});
});
