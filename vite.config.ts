import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import biomePlugin from "vite-plugin-biome";
import { patchParaglideSecurity } from "./scripts/patch_paraglide_security.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const paraglideOutputDirectory = resolve(__dirname, "./frontend/src/paraglide");
const paraglideOutputPrefix = `${paraglideOutputDirectory}/`;

function isGeneratedParaglideModule(id: string) {
	const modulePath = id.split("?")[0];

	return modulePath === paraglideOutputDirectory || modulePath.startsWith(paraglideOutputPrefix);
}

function paraglideSecurityPatchPlugin() {
	return {
		name: "mis-paraglide-security-patch",
		enforce: "post" as const,
		buildStart() {
			patchParaglideSecurity();
		},
		load(id: string) {
			if (isGeneratedParaglideModule(id)) {
				patchParaglideSecurity();
			}

			return null;
		},
		watchChange() {
			patchParaglideSecurity();
		},
	};
}

export default defineConfig({
	root: "frontend",
	envDir: __dirname,
	plugins: [
		biomePlugin({
			mode: "check",
			files: ".",
			failOnError: true,
		}),
		react(),
		tailwindcss(),
		paraglideVitePlugin({
			project: resolve(__dirname, "./frontend/project.inlang"),
			outdir: resolve(__dirname, "./frontend/src/paraglide"),
			emitTsDeclarations: true,
			// SPA MIS tidak menggunakan middleware SSR yang menyisipkan pesan ke inline script.
			experimentalMiddlewareLocaleSplitting: false,
		}),
		paraglideSecurityPatchPlugin(),
	],
	resolve: {
		alias: {
			"@": resolve(__dirname, "./frontend/src"),
		},
	},
	build: {
		outDir: resolve(__dirname, "frontend/dist"),
		emptyOutDir: true,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("/node_modules/@tanstack/")) return "tanstack";
					if (id.includes("/node_modules/recharts/")) return "visualization";
					if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) {
						return "react";
					}
				},
			},
		},
	},
	server: {
		port: 8015,
		proxy: {
			"/api": {
				target: "http://localhost:8016",
				changeOrigin: true,
			},
		},
	},
});
