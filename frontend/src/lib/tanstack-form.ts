function normalizeFormErrors(errors: unknown[]): Array<{ message?: string }> {
	return errors.flatMap((error) => {
		if (typeof error === "string") return [{ message: error }];
		if (error && typeof error === "object" && "message" in error) {
			return [{ message: String(error.message) }];
		}
		return [];
	});
}

export { normalizeFormErrors };
