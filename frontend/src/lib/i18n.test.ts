import { describe, expect, it } from "vitest";
import { optionalDecimalInput } from "@/lib/form-values";
import { formatCurrency, parseDecimalId } from "@/lib/i18n";

describe("formatter dan parser Indonesia", () => {
	it("mengubah angka desimal Indonesia menjadi nilai canonical", () => {
		expect(parseDecimalId("1.250,75")).toBe(1250.75);
		expect(parseDecimalId("1.250")).toBe(1250);
		expect(parseDecimalId("1250,5")).toBe(1250.5);
	});

	it("menjaga nilai kosong optional sebagai undefined", () => {
		expect(optionalDecimalInput("")).toBeUndefined();
		expect(optionalDecimalInput("   ")).toBeUndefined();
	});

	it("memformat rupiah dengan locale Indonesia", () => {
		const formatted = formatCurrency(1250.75);

		expect(formatted).toContain("Rp");
		expect(formatted).toContain("1.250");
		expect(formatted).toContain(",75");
		expect(formatted).not.toContain("1,250.75");
	});
});
