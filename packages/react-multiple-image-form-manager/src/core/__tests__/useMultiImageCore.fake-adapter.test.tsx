import { act, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import type { ImageFieldAdapter } from "../ImageFieldAdapter";
import type { Image, ImageExisting, ImageNew } from "../types/Image";
import type {
	CoreMessages,
	ImageFieldError,
	ImagesError,
} from "../types/ImageSchemaTypes";
import { ImageFormStatus } from "../types/ImageStatus";
import { useMultiImageCore } from "../useMultiImageCore";

// --- Helpers ---

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

const makeNewImage = (overrides?: Partial<ImageNew>): ImageNew => ({
	tempId: `temp_new-${crypto.randomUUID().slice(0, 8)}`,
	status: ImageFormStatus.New,
	id: undefined,
	file: new File(["data"], "test.jpg", { type: "image/jpeg" }),
	uploadedUrl: undefined,
	...overrides,
});

const makeExistingImage = (
	overrides?: Partial<ImageExisting>,
): ImageExisting => ({
	tempId: `temp_existing-${crypto.randomUUID().slice(0, 8)}`,
	status: ImageFormStatus.Existing,
	id: `id-${crypto.randomUUID().slice(0, 8)}`,
	uploadedUrl: "https://s3.example.com/image.jpg",
	previewUrl: "https://s3.example.com/image.jpg",
	file: undefined,
	...overrides,
});

/**
 * ref + forceUpdate パターンで「ストアは同期更新・再レンダーは非同期」を模倣する。
 */
function useFakeAdapter(initial: Image[], errors?: ImagesError) {
	const [, force] = useState(0);
	const imagesRef = useRef<Image[]>(initial);
	const [errorsState] = useState<ImagesError>(
		errors ?? { items: [], root: [] },
	);
	const validateRef = useRef<ReturnType<
		typeof vi.fn<() => Promise<void>>
	> | null>(null);
	if (validateRef.current === null) {
		validateRef.current = vi.fn<() => Promise<void>>(async () => {});
	}
	const validate = validateRef.current;

	const adapter: ImageFieldAdapter = {
		get images() {
			return imagesRef.current;
		},
		setImages(next) {
			imagesRef.current = next;
			force((n) => n + 1);
		},
		validate: validate as () => Promise<void>,
		errors: errorsState,
	};
	return {
		adapter,
		validate,
		getImages: () => imagesRef.current,
	};
}

async function renderCore(
	initial: Image[] = [],
	options: {
		errors?: ImagesError;
		maxImages?: number;
		processFile?: (file: File) => Promise<File>;
		uploadFile?: (file: File) => Promise<{ uploadedUrl: string }>;
		onError?: (error: unknown) => void;
		messages?: CoreMessages;
	} = {},
) {
	const ref: {
		adapter?: ImageFieldAdapter;
		validate?: ReturnType<typeof vi.fn>;
	} = {};
	const { result } = await renderHook(() => {
		const { adapter, validate } = useFakeAdapter(initial, options.errors);
		ref.adapter = adapter;
		ref.validate = validate;
		return useMultiImageCore({
			adapter,
			processFile: options.processFile,
			uploadFile: options.uploadFile,
			onError: options.onError,
			constraints: options.maxImages
				? { maxImages: options.maxImages }
				: undefined,
			messages: options.messages,
		});
	});
	return { result, ref };
}

// --- Tests ---

describe("useMultiImageCore (FakeImageFieldAdapter)", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("handleAdd", () => {
		it("空配列に追加できること", async () => {
			const { result } = await renderCore();
			const file = new File(["d"], "a.jpg", { type: "image/jpeg" });
			let ok = false;
			await act(async () => {
				ok = await result.current.handlers.handleAdd(file);
			});
			expect(ok).toBe(true);
			expect(result.current.raw.watchedImages).toHaveLength(1);
			expect(result.current.raw.watchedImages[0].status).toBe(
				ImageFormStatus.New,
			);
		});

		it("maxImages に達すると false を返し onError を呼ぶこと", async () => {
			const onError = vi.fn();
			const { result } = await renderCore([makeNewImage()], {
				maxImages: 1,
				onError,
			});
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleAdd(
					new File(["d"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(false);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "max_images" }),
			);
		});

		it("既存配列の末尾に追加されること", async () => {
			const visible = makeNewImage();
			const { result } = await renderCore([visible]);
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "c.jpg", { type: "image/jpeg" }),
				);
			});
			const images = result.current.raw.watchedImages;
			expect(images).toHaveLength(2);
			expect(images[0]).toBe(visible);
			expect(images[1].status).toBe(ImageFormStatus.New);
		});

		it("processFile が呼ばれること、失敗時は onError + false", async () => {
			const onError = vi.fn();
			const processFile = vi.fn(async (f: File) => f);
			const { result } = await renderCore([], { processFile, onError });
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "p.jpg", { type: "image/jpeg" }),
				);
			});
			expect(processFile).toHaveBeenCalled();

			const failingProcess = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result: r2 } = await renderCore([], {
				processFile: failingProcess,
				onError,
			});
			let ok = true;
			await act(async () => {
				ok = await r2.current.handlers.handleAdd(
					new File(["d"], "p2.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(false);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "process_file" }),
			);
		});

		it("追加後に adapter.validate が呼ばれること", async () => {
			const { result, ref } = await renderCore();
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "x.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ref.validate).toHaveBeenCalled();
		});

		it("maxImages到達 → 削除 → 追加成功（枠解放）", async () => {
			const ex = makeExistingImage({ tempId: "temp_ex" });
			const { result } = await renderCore([ex], { maxImages: 1 });

			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleAdd(
					new File(["d"], "over.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(false);

			await act(async () => {
				await result.current.handlers.handleDelete("temp_ex");
			});

			await act(async () => {
				ok = await result.current.handlers.handleAdd(
					new File(["d"], "new.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(true);
		});
	});

	describe("handleFileChange", () => {
		it("Existing → 元位置に New、末尾に ToBeDeleted", async () => {
			const ex = makeExistingImage({ tempId: "temp_ex" });
			const { result } = await renderCore([ex]);
			await act(async () => {
				await result.current.handlers.handleFileChange(
					"temp_ex",
					new File(["d"], "new.jpg", { type: "image/jpeg" }),
				);
			});
			const images = result.current.raw.watchedImages;
			expect(images).toHaveLength(2);
			expect(images[0].status).toBe(ImageFormStatus.New);
			expect(images[1].status).toBe(ImageFormStatus.ToBeDeleted);
		});

		it("New → file 差し替え、配列長は不変", async () => {
			const nv = makeNewImage({ tempId: "temp_n" });
			const { result } = await renderCore([nv]);
			await act(async () => {
				await result.current.handlers.handleFileChange(
					"temp_n",
					new File(["d"], "n2.jpg", { type: "image/jpeg" }),
				);
			});
			const images = result.current.raw.watchedImages;
			expect(images).toHaveLength(1);
			expect(images[0].status).toBe(ImageFormStatus.New);
			expect((images[0] as ImageNew).file.name).toBe("n2.jpg");
		});
	});

	describe("handleDelete", () => {
		it("Existing → in-place で ToBeDeleted 化", async () => {
			const ex = makeExistingImage({ tempId: "temp_ex" });
			const visible = makeNewImage({ tempId: "temp_n" });
			const { result } = await renderCore([ex, visible]);
			await act(async () => {
				await result.current.handlers.handleDelete("temp_ex");
			});
			const images = result.current.raw.watchedImages;
			expect(images).toHaveLength(2);
			expect(images[0].status).toBe(ImageFormStatus.ToBeDeleted);
			expect(images[1]).toBe(visible);
		});

		it("New → 配列から除去", async () => {
			const nv = makeNewImage({ tempId: "temp_n" });
			const { result } = await renderCore([nv]);
			await act(async () => {
				await result.current.handlers.handleDelete("temp_n");
			});
			expect(result.current.raw.watchedImages).toHaveLength(0);
		});
	});

	describe("handleMove", () => {
		it("先頭から上には移動できない", async () => {
			const a = makeNewImage({ tempId: "a" });
			const b = makeNewImage({ tempId: "b" });
			const { result } = await renderCore([a, b]);
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleMove("a", "up");
			});
			expect(ok).toBe(false);
		});

		it("末尾から下には移動できない", async () => {
			const a = makeNewImage({ tempId: "a" });
			const b = makeNewImage({ tempId: "b" });
			const { result } = await renderCore([a, b]);
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleMove("b", "down");
			});
			expect(ok).toBe(false);
		});

		it("中間要素を移動できる", async () => {
			const a = makeNewImage({ tempId: "a" });
			const b = makeNewImage({ tempId: "b" });
			const { result } = await renderCore([a, b]);
			await act(async () => {
				await result.current.handlers.handleMove("a", "down");
			});
			const images = result.current.raw.watchedImages;
			expect(images[0].tempId).toBe("b");
			expect(images[1].tempId).toBe("a");
		});
	});

	describe("itemsWithErrors / rootErrors 公開経路", () => {
		it("adapter.errors.items[index] を per-item に乗せる", async () => {
			const a = makeNewImage({ tempId: "a" });
			const b = makeNewImage({ tempId: "b" });
			const errors: ImagesError = {
				items: [{ file: { message: "err-a" } }, { file: { message: "err-b" } }],
				root: [{ message: "root!" }],
			};
			const { result } = await renderCore([a, b], { errors });
			expect(result.current.itemsWithErrors).toHaveLength(2);
			expect(result.current.itemsWithErrors[0].errors?.file?.message).toBe(
				"err-a",
			);
			expect(result.current.itemsWithErrors[1].errors?.file?.message).toBe(
				"err-b",
			);
			expect(result.current.rootErrors).toEqual<ImageFieldError[]>([
				{ message: "root!" },
			]);
		});
	});

	describe("stale スナップショット競合", () => {
		it("[stale] maxImages:1 で handleAdd を解決前に2回発火しても1件に収まる", async () => {
			const d1 = createDeferred<File>();
			const d2 = createDeferred<File>();
			const deferreds = [d1, d2];
			let call = 0;
			const processFile = vi.fn(async (_f: File) => deferreds[call++].promise);

			const { result } = await renderCore([], { maxImages: 1, processFile });

			const fileA = new File(["a"], "a.jpg", { type: "image/jpeg" });
			const fileB = new File(["b"], "b.jpg", { type: "image/jpeg" });

			await act(async () => {
				const p1 = result.current.handlers.handleAdd(fileA);
				const p2 = result.current.handlers.handleAdd(fileB);
				d1.resolve(fileA);
				d2.resolve(fileB);
				await Promise.all([p1, p2]);
			});

			expect(result.current.raw.watchedImages).toHaveLength(1);
		});

		it("[stale] handleFileChange の解決前に別項目を削除しても対象画像のみ差し替わる", async () => {
			const d = createDeferred<File>();
			const processFile = vi.fn(async (_f: File) => d.promise);

			const a = makeExistingImage({ tempId: "temp_A" });
			const b = makeExistingImage({ tempId: "temp_B" });
			const { result } = await renderCore([a, b], { processFile });

			const newFile = new File(["x"], "x.jpg", { type: "image/jpeg" });

			await act(async () => {
				const changing = result.current.handlers.handleFileChange(
					"temp_B",
					newFile,
				);
				await result.current.handlers.handleDelete("temp_A");
				d.resolve(newFile);
				await changing;
			});

			const images = result.current.raw.watchedImages;
			expect(images.some((i) => i.status === ImageFormStatus.New)).toBe(true);
		});

		it("[stale] handleAdd の解決前に既存画像が削除されても新規は追加される", async () => {
			const d = createDeferred<File>();
			const processFile = vi.fn(async (_f: File) => d.promise);

			const a = makeExistingImage({ tempId: "temp_A" });
			const { result } = await renderCore([a], { processFile });

			const file = new File(["n"], "n.jpg", { type: "image/jpeg" });

			await act(async () => {
				const adding = result.current.handlers.handleAdd(file);
				await result.current.handlers.handleDelete("temp_A");
				d.resolve(file);
				await adding;
			});

			const images = result.current.raw.watchedImages;
			expect(images.some((i) => i.status === ImageFormStatus.New)).toBe(true);
		});
	});

	describe("メッセージのカスタマイズ", () => {
		it("[messages] maxImages 到達時に messages.maxImages のカスタム文言が onError に載る", async () => {
			const onError = vi.fn();
			const { result } = await renderCore([makeNewImage()], {
				maxImages: 1,
				onError,
				messages: {
					maxImages: (max: number) => `最大${max}枚まで（custom）`,
				},
			});
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "max_images",
					message: "最大1枚まで（custom）",
				}),
			);
		});

		it("[messages] process_file 失敗時に messages.processFile のカスタム文言が onError に載る", async () => {
			const onError = vi.fn();
			const processFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result } = await renderCore([], {
				processFile,
				onError,
				messages: { processFile: () => "処理失敗（custom）" },
			});
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "process_file",
					message: "処理失敗（custom）",
				}),
			);
		});

		it("[messages] 未指定時は既定の日本語文言が onError に載る", async () => {
			const onError = vi.fn();
			const { result } = await renderCore([makeNewImage()], {
				maxImages: 1,
				onError,
			});
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "max_images",
					message: "画像は最大1枚までです。",
				}),
			);
		});

		it("[messages] キーが undefined でも既定文言にフォールバックし throw しない", async () => {
			const onError = vi.fn();
			const { result } = await renderCore([makeNewImage()], {
				maxImages: 1,
				onError,
				messages: { maxImages: undefined },
			});
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "max_images",
					message: "画像は最大1枚までです。",
				}),
			);
		});
	});

	describe("safeValidate catch 分岐", () => {
		it("adapter.validate() が reject すると onError({type:'unknown'}) が呼ばれること", async () => {
			const onError = vi.fn();
			const validationError = new Error("validation boom");
			const { result, ref } = await renderCore([], { onError });
			ref.validate?.mockRejectedValueOnce(validationError);

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "unknown",
					message: "validation failed",
					cause: validationError,
				}),
			);
		});

		it("adapter.validate() が reject しても画像は追加されていること", async () => {
			const onError = vi.fn();
			const { result, ref } = await renderCore([], { onError });
			ref.validate?.mockRejectedValueOnce(new Error("boom"));

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			expect(result.current.raw.watchedImages).toHaveLength(1);
		});
	});

	describe("存在しない tempId・重複操作の防御", () => {
		it("handleDelete: 存在しない tempId で false を返し何もしない", async () => {
			const { result } = await renderCore([makeNewImage({ tempId: "a" })]);
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleDelete("nonexistent");
			});
			expect(ok).toBe(false);
			expect(result.current.raw.watchedImages).toHaveLength(1);
		});

		it("handleMove: 存在しない tempId で false を返す", async () => {
			const { result } = await renderCore([makeNewImage({ tempId: "a" })]);
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleMove("nonexistent", "up");
			});
			expect(ok).toBe(false);
		});

		it("handleFileChange: 存在しない tempId で false を返す", async () => {
			const { result } = await renderCore([makeNewImage({ tempId: "a" })]);
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleFileChange(
					"nonexistent",
					new File(["d"], "x.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(false);
		});

		it("handleDelete: ToBeDeleted の再削除は no-op で false を返し onError を呼ばない", async () => {
			const onError = vi.fn();
			const ex = makeExistingImage({ tempId: "temp_ex" });
			const { result } = await renderCore([ex], { onError });

			await act(async () => {
				await result.current.handlers.handleDelete("temp_ex");
			});
			expect(result.current.raw.watchedImages[0].status).toBe(
				ImageFormStatus.ToBeDeleted,
			);

			onError.mockClear();
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleDelete("temp_ex");
			});
			expect(ok).toBe(false);
			expect(onError).not.toHaveBeenCalled();
		});

		it("handleFileChange: ToBeDeleted に対する変更は unsupported status として onError を呼ぶ", async () => {
			const onError = vi.fn();
			const ex = makeExistingImage({ tempId: "temp_ex" });
			const { result } = await renderCore([ex], { onError });

			await act(async () => {
				await result.current.handlers.handleDelete("temp_ex");
			});

			await act(async () => {
				await result.current.handlers.handleFileChange(
					"temp_ex",
					new File(["d"], "x.jpg", { type: "image/jpeg" }),
				);
			});

			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "unknown",
					cause: {
						reason: "unsupported_status",
						status: ImageFormStatus.ToBeDeleted,
					},
				}),
			);
		});
	});

	describe("handleFileChange 失敗経路", () => {
		it("processFile が失敗すると false を返し onError(process_file) を呼ぶ", async () => {
			const onError = vi.fn();
			const processFile = vi.fn(async () => {
				throw new Error("process boom");
			});
			const ex = makeExistingImage({ tempId: "temp_ex" });
			const { result } = await renderCore([ex], { processFile, onError });

			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleFileChange(
					"temp_ex",
					new File(["d"], "x.jpg", { type: "image/jpeg" }),
				);
			});

			expect(ok).toBe(false);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "process_file" }),
			);
			expect(result.current.raw.watchedImages).toHaveLength(1);
			expect(result.current.raw.watchedImages[0].status).toBe(
				ImageFormStatus.Existing,
			);
		});

		it("uploadFile が失敗すると false を返し onError(upload_file) を呼ぶ", async () => {
			const onError = vi.fn();
			const uploadFile = vi.fn(async () => {
				throw new Error("upload boom");
			});
			const ex = makeExistingImage({ tempId: "temp_ex" });
			const { result } = await renderCore([ex], { uploadFile, onError });

			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleFileChange(
					"temp_ex",
					new File(["d"], "x.jpg", { type: "image/jpeg" }),
				);
			});

			expect(ok).toBe(false);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "upload_file" }),
			);
			expect(result.current.raw.watchedImages).toHaveLength(1);
			expect(result.current.raw.watchedImages[0].status).toBe(
				ImageFormStatus.Existing,
			);
		});

		it("New 画像の差し替えで processFile が失敗しても元画像は変更されない", async () => {
			const onError = vi.fn();
			const nv = makeNewImage({ tempId: "temp_n" });
			const processFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result } = await renderCore([nv], { processFile, onError });

			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleFileChange(
					"temp_n",
					new File(["d"], "x.jpg", { type: "image/jpeg" }),
				);
			});

			expect(ok).toBe(false);
			expect(result.current.raw.watchedImages).toHaveLength(1);
			expect(result.current.raw.watchedImages[0].tempId).toBe("temp_n");
		});

		it("New 画像の差し替えで uploadFile が失敗しても元画像は変更されない", async () => {
			const onError = vi.fn();
			const nv = makeNewImage({ tempId: "temp_n" });
			const uploadFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result } = await renderCore([nv], { uploadFile, onError });

			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleFileChange(
					"temp_n",
					new File(["d"], "x.jpg", { type: "image/jpeg" }),
				);
			});

			expect(ok).toBe(false);
			expect(result.current.raw.watchedImages).toHaveLength(1);
			expect(result.current.raw.watchedImages[0].tempId).toBe("temp_n");
		});
	});

	describe("onError 未指定時の安全性", () => {
		it("maxImages 超過で onError 未指定でもクラッシュしない", async () => {
			const { result } = await renderCore([makeNewImage()], { maxImages: 1 });
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleAdd(
					new File(["d"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(false);
		});

		it("processFile 失敗で onError 未指定でもクラッシュしない", async () => {
			const processFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result } = await renderCore([], { processFile });
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(false);
		});

		it("uploadFile 失敗で onError 未指定でもクラッシュしない", async () => {
			const uploadFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result } = await renderCore([], { uploadFile });
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(false);
		});

		it("validate reject で onError 未指定でもクラッシュしない", async () => {
			const { result, ref } = await renderCore([]);
			ref.validate?.mockRejectedValueOnce(new Error("boom"));
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			expect(result.current.raw.watchedImages).toHaveLength(1);
		});

		it("unsupported status で onError 未指定でもクラッシュしない", async () => {
			const ex = makeExistingImage({ tempId: "temp_ex" });
			const { result } = await renderCore([ex]);

			await act(async () => {
				await result.current.handlers.handleDelete("temp_ex");
			});

			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleFileChange(
					"temp_ex",
					new File(["d"], "x.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(false);
		});
	});

	describe("uploadFile", () => {
		it("uploadFile が成功すると ImageNew.uploadedUrl が設定されること", async () => {
			const uploadFile = vi.fn(async () => ({
				uploadedUrl: "https://s3.example.com/uploaded.jpg",
			}));
			const { result } = await renderCore([], { uploadFile });
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			expect(uploadFile).toHaveBeenCalled();
			const img = result.current.raw.watchedImages[0] as ImageNew;
			expect(img.uploadedUrl).toBe("https://s3.example.com/uploaded.jpg");
		});

		it("uploadFile 未指定時は uploadedUrl が undefined のままであること", async () => {
			const { result } = await renderCore([]);
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const img = result.current.raw.watchedImages[0] as ImageNew;
			expect(img.uploadedUrl).toBeUndefined();
		});

		it("uploadFile が失敗すると onError が upload_file タイプで呼ばれ false を返すこと", async () => {
			const onError = vi.fn();
			const uploadFile = vi.fn(async () => {
				throw new Error("upload failed");
			});
			const { result } = await renderCore([], { uploadFile, onError });
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(false);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "upload_file" }),
			);
			expect(result.current.raw.watchedImages).toHaveLength(0);
		});

		it("processFile → uploadFile の順で実行されること", async () => {
			const callOrder: string[] = [];
			const processFile = vi.fn(async (f: File) => {
				callOrder.push("processFile");
				return f;
			});
			const uploadFile = vi.fn(async () => {
				callOrder.push("uploadFile");
				return { uploadedUrl: "https://s3.example.com/uploaded.jpg" };
			});
			const { result } = await renderCore([], { processFile, uploadFile });
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			expect(callOrder).toEqual(["processFile", "uploadFile"]);
		});

		it("handleFileChange でも uploadFile が実行されること", async () => {
			const uploadFile = vi.fn(async () => ({
				uploadedUrl: "https://s3.example.com/changed.jpg",
			}));
			const existing = makeExistingImage({ tempId: "temp_ex" });
			const { result } = await renderCore([existing], { uploadFile });
			await act(async () => {
				await result.current.handlers.handleFileChange(
					"temp_ex",
					new File(["d"], "new.jpg", { type: "image/jpeg" }),
				);
			});
			expect(uploadFile).toHaveBeenCalled();
			const newImg = result.current.raw.watchedImages.find(
				(i) => i.status === ImageFormStatus.New,
			) as ImageNew;
			expect(newImg.uploadedUrl).toBe("https://s3.example.com/changed.jpg");
		});

		it("[messages] uploadFile 失敗時に messages.uploadFile のカスタム文言が onError に載る", async () => {
			const onError = vi.fn();
			const uploadFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result } = await renderCore([], {
				uploadFile,
				onError,
				messages: { uploadFile: () => "アップロード失敗（custom）" },
			});
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "upload_file",
					message: "アップロード失敗（custom）",
				}),
			);
		});
	});
});
