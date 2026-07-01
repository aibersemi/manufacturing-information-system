import assert from "node:assert/strict";

Object.defineProperty(globalThis, "location", {
	value: new URL("https://app.example.test"),
	configurable: true,
});

const {
	deLocalizeHref,
	deLocalizeUrl,
	localizeHref,
	localizeUrl,
	overwriteGetUrlOrigin,
} = await import("../frontend/src/paraglide/runtime.js");

overwriteGetUrlOrigin(() => "https://app.example.test");

assert.equal(
	localizeUrl("https://app.example.test/dashboard?tab=ops#today", { locale: "id" }).href,
	"https://app.example.test/dashboard?tab=ops#today",
);
assert.equal(localizeUrl("/dashboard", { locale: "id" }).href, "https://app.example.test/dashboard");
assert.equal(localizeHref("/dashboard", { locale: "id" }), "/dashboard");
assert.equal(deLocalizeUrl("https://app.example.test/dashboard").href, "https://app.example.test/dashboard");
assert.equal(deLocalizeHref("/dashboard"), "/dashboard");

for (const unsafeHref of ["https://evil.example/login", "//evil.example/login", "javascript:alert(1)"]) {
	assert.throws(() => localizeUrl(unsafeHref, { locale: "id" }), /origin tidak tepercaya/);
	assert.throws(() => localizeHref(unsafeHref, { locale: "id" }), /origin tidak tepercaya/);
	assert.throws(() => deLocalizeUrl(unsafeHref), /origin tidak tepercaya/);
	assert.throws(() => deLocalizeHref(unsafeHref), /origin tidak tepercaya/);
}

console.log("Validasi keamanan runtime Paraglide berhasil.");
