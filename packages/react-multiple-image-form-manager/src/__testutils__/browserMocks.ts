import { vi } from "vitest";

export const setupBrowserMocks = (urlPrefix = "fake") => {
	let counter = 0;
	const createObjectURL = vi.fn(
		() => `blob:http://localhost/${urlPrefix}-${counter++}`,
	);
	const revokeObjectURL = vi.fn();
	const OriginalURL = globalThis.URL;
	const MockURL = class extends OriginalURL {
		static override createObjectURL = createObjectURL;
		static override revokeObjectURL = revokeObjectURL;
	};
	vi.stubGlobal("URL", MockURL);
	return { createObjectURL, revokeObjectURL };
};
