import "dotenv/config";
import { defineConfig } from "orval";

const schemaTarget = process.env.ORVAL_SCHEMA_TARGET ?? "./frontend/schema.json";
const outputTarget = process.env.ORVAL_OUTPUT_TARGET ?? "frontend/src/api/generated/endpoints.ts";
const outputSchemas = process.env.ORVAL_OUTPUT_SCHEMAS ?? "frontend/src/api/generated/models";
const mutatorPath = process.env.ORVAL_MUTATOR_PATH ?? "frontend/src/lib/request-client.ts";

/**
 * Konfigurasi Orval untuk generate TypeScript client dari OpenAPI Django Ninja.
 *
 * Jalankan: npm run generate:api
 */
export default defineConfig({
	mis: {
		input: {
			target: schemaTarget,
		},
		output: {
			target: outputTarget,
			schemas: outputSchemas,
			client: "react-query",
			mode: "tags-split",
			override: {
				mutator: {
					path: mutatorPath,
					name: "requestClient",
				},
			},
		},
	},
});
