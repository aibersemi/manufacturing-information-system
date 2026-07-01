export interface PatchParaglideSecurityOptions {
	check?: boolean;
}

export interface PatchRuntimeContentResult {
	changed: boolean;
	content: string;
}

export declare function patchRuntimeContent(source: string): PatchRuntimeContentResult;

export declare function patchParaglideSecurity(options?: PatchParaglideSecurityOptions): string[];
