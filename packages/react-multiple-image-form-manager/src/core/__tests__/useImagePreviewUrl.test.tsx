import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { setupBrowserMocks } from "../../__testutils__/browserMocks";
import type { Image, ImageExisting, ImageNew } from "../types/Image";
import { ImageFormStatus } from "../types/ImageStatus";
import { useImagePreviewUrl } from "../useImagePreviewUrl";

const makeNew = (name = "a.jpg"): ImageNew => ({
	tempId: `temp_${name}`,
	status: ImageFormStatus.New,
	id: undefined,
	file: new File(["data"], name, { type: "image/jpeg" }),
	uploadRef: undefined,
});

const makeExisting = (): ImageExisting => ({
	tempId: "temp_existing",
	status: ImageFormStatus.Existing,
	id: "id-1",
	file: undefined,
	previewUrl: "https://s3.example.com/img.jpg",
	uploadedUrl: "https://s3.example.com/img.jpg",
});

describe("useImagePreviewUrl", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("New: file から object URL を生成して返す", async () => {
		const { createObjectURL } = setupBrowserMocks();
		const image = makeNew();
		const { result } = await renderHook(() => useImagePreviewUrl(image));

		expect(result.current).toBe("blob:http://localhost/fake-0");
		expect(createObjectURL).toHaveBeenCalledWith(image.file);
	});

	it("Existing: state の previewUrl をそのまま返し、object URL は生成しない", async () => {
		const { createObjectURL } = setupBrowserMocks();
		const { result } = await renderHook(() =>
			useImagePreviewUrl(makeExisting()),
		);

		expect(result.current).toBe("https://s3.example.com/img.jpg");
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it("file が差し替わったら旧 URL を revoke して新 URL を生成する", async () => {
		const { revokeObjectURL } = setupBrowserMocks();
		const { result, rerender } = await renderHook(
			(props?: { image: Image }) => useImagePreviewUrl(props?.image as Image),
			{ initialProps: { image: makeNew("a.jpg") as Image } },
		);
		expect(result.current).toBe("blob:http://localhost/fake-0");

		await rerender({ image: makeNew("b.jpg") });

		expect(revokeObjectURL).toHaveBeenCalledWith(
			"blob:http://localhost/fake-0",
		);
		expect(result.current).toBe("blob:http://localhost/fake-1");
	});

	it("unmount で URL を revoke する", async () => {
		const { revokeObjectURL } = setupBrowserMocks();
		const image = makeNew();
		const { unmount } = await renderHook(() => useImagePreviewUrl(image));

		unmount();

		expect(revokeObjectURL).toHaveBeenCalledWith(
			"blob:http://localhost/fake-0",
		);
	});

	it("同一 file の再レンダーでは URL を再生成しない", async () => {
		const { createObjectURL } = setupBrowserMocks();
		const image = makeNew();
		const { result, rerender } = await renderHook(() =>
			useImagePreviewUrl(image),
		);

		await act(() => rerender());

		expect(createObjectURL).toHaveBeenCalledTimes(1);
		expect(result.current).toBe("blob:http://localhost/fake-0");
	});

	it("New → Existing に切り替わったら blob URL を revoke してサーバURLを返す", async () => {
		const { revokeObjectURL } = setupBrowserMocks();
		const { result, rerender } = await renderHook(
			(props?: { image: Image }) => useImagePreviewUrl(props?.image as Image),
			{ initialProps: { image: makeNew() as Image } },
		);
		expect(result.current).toBe("blob:http://localhost/fake-0");

		await rerender({ image: makeExisting() });

		expect(revokeObjectURL).toHaveBeenCalledWith(
			"blob:http://localhost/fake-0",
		);
		expect(result.current).toBe("https://s3.example.com/img.jpg");
	});
});
