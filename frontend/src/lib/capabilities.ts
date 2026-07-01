import type { CapabilityResponse } from "@/api/generated/models";

export type Capability = string;
export type CapabilitySession = CapabilityResponse;

export function can(capabilities: readonly Capability[] | undefined, capability: Capability) {
	return capabilities?.includes(capability) ?? false;
}

export function canAny(
	capabilities: readonly Capability[] | undefined,
	required: readonly Capability[],
) {
	return required.some((capability) => can(capabilities, capability));
}

export function canAll(
	capabilities: readonly Capability[] | undefined,
	required: readonly Capability[],
) {
	return required.every((capability) => can(capabilities, capability));
}

export function isCapabilityResponse(data: unknown): data is CapabilityResponse {
	return Boolean(
		data &&
			typeof data === "object" &&
			"capabilities" in data &&
			Array.isArray((data as { capabilities?: unknown }).capabilities),
	);
}
