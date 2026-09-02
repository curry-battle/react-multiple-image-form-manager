import type React from "react";
import { act, StrictMode, useRef, useState } from "react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import type { ImageFieldAdapter } from "../ImageFieldAdapter";
import type {
	Image,
	ImageExisting,
	ImageNew,
	SubmitImage,
	UploadedSubmitImage,
	UploadFileFn,
	UploadFileResult,
} from "../types/Image";
import { ImageUtils } from "../types/Image";
import type {
	CoreMessages,
	ImageFieldError,
	ImagesError,
} from "../types/ImageSchemaTypes";
import { ImageFormStatus } from "../types/ImageStatus";
import type {
	UseMultiImageCoreReturn,
	UseMultiImageCoreUploadedReturn,
} from "../useMultiImageCore";
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
	uploadRef: undefined,
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
function useFakeAdapter(
	initial: Image[],
	errors?: ImagesError,
	/** read のたびに File を作り直す契約違反の adapter を模倣する */
	cloneOnRead = false,
	/** setImages が同期 throw する adapter を模倣する */
	throwOnSetImages = false,
) {
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
			if (!cloneOnRead) return imagesRef.current;
			return imagesRef.current.map((img) =>
				img.status === ImageFormStatus.New
					? {
							...img,
							file: new File([img.file], img.file.name, {
								type: img.file.type,
							}),
						}
					: img,
			);
		},
		setImages(next) {
			if (throwOnSetImages) throw new Error("setImages failed");
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
		uploadFile?: UploadFileFn;
		onError?: (error: unknown) => void;
		messages?: CoreMessages;
		wrapper?: React.JSXElementConstructor<{ children: React.ReactNode }>;
		cloneOnRead?: boolean;
		throwOnSetImages?: boolean;
	} = {},
) {
	const ref: {
		adapter?: ImageFieldAdapter;
		validate?: ReturnType<typeof vi.fn>;
	} = {};
	let renderCount = 0;
	const { result, unmount, rerender } = await renderHook(
		() => {
			renderCount++;
			const { adapter, validate } = useFakeAdapter(
				initial,
				options.errors,
				options.cloneOnRead,
				options.throwOnSetImages,
			);
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
		},
		options.wrapper ? { wrapper: options.wrapper } : undefined,
	);
	// options は参照で閉じ込めてあるので、書き換えてから rerender すれば
	// パラメータ変更を再現できる
	return { result, ref, unmount, rerender, getRenderCount: () => renderCount };
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

	describe("items / rootErrors 公開経路", () => {
		it("adapter.errors.items[index] を per-item に乗せる", async () => {
			const a = makeNewImage({ tempId: "a" });
			const b = makeNewImage({ tempId: "b" });
			const errors: ImagesError = {
				items: [{ file: { message: "err-a" } }, { file: { message: "err-b" } }],
				root: [{ message: "root!" }],
			};
			const { result } = await renderCore([a, b], { errors });
			expect(result.current.items).toHaveLength(2);
			expect(result.current.items[0].errors?.file?.message).toBe("err-a");
			expect(result.current.items[1].errors?.file?.message).toBe("err-b");
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

		it("[stale] handleAdd を解決前に2回発火しても2件とも残る", async () => {
			const d1 = createDeferred<File>();
			const d2 = createDeferred<File>();
			const deferreds = [d1, d2];
			let call = 0;
			const processFile = vi.fn(async (_f: File) => deferreds[call++].promise);

			const { result } = await renderCore([], { processFile });

			const fileA = new File(["a"], "a.jpg", { type: "image/jpeg" });
			const fileB = new File(["b"], "b.jpg", { type: "image/jpeg" });

			let ok1 = false;
			let ok2 = false;
			await act(async () => {
				const p1 = result.current.handlers.handleAdd(fileA);
				const p2 = result.current.handlers.handleAdd(fileB);
				d1.resolve(fileA);
				d2.resolve(fileB);
				[ok1, ok2] = await Promise.all([p1, p2]);
			});

			expect([ok1, ok2]).toEqual([true, true]);
			expect(result.current.raw.watchedImages.map((i) => i.file?.name)).toEqual(
				["a.jpg", "b.jpg"],
			);
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

	describe("handleFileChange の選び直し競合", () => {
		const jpeg = (name: string) =>
			new File([name], name, { type: "image/jpeg" });
		const webp = (name: string) =>
			new File([name], name, { type: "image/webp" });
		/** 解決の順序を分けるための待ち。同一 microtask にまとめない */
		const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

		/**
		 * フォーム state をフックの外に置き、mount を跨いで共有するハーネス。
		 *
		 * adapter.images は同梱アダプタと同じく最後のレンダー値で凍結される一方、
		 * setImages は生きたストアへ届く。この非対称が unmount 後の書き戻しで項目が
		 * 巻き戻る原因になる。変換を保留するのは最初の 1 件だけで、再 mount 側の
		 * 操作は止めない
		 */
		function sharedStoreHarness(store: { images: Image[] }) {
			const converted = createDeferred<File>();
			let call = 0;
			const processFile = (file: File) =>
				call++ === 0 ? converted.promise : Promise.resolve(file);

			const mount = () =>
				renderHook(() => {
					const [, force] = useState(0);
					const imagesRef = useRef(store.images);
					imagesRef.current = store.images;
					const adapter: ImageFieldAdapter = {
						get images() {
							return imagesRef.current;
						},
						setImages(next) {
							store.images = next;
							imagesRef.current = next;
							force((n) => n + 1);
						},
						validate: async () => {},
						errors: { items: [], root: [] },
					};
					return useMultiImageCore({ adapter, processFile });
				});

			return { mount, resolveFirstConversion: converted.resolve };
		}

		/**
		 * 同じ項目へ 2 回続けて選び、指定した順に変換を解決する。
		 *
		 * order は解決させる変換の添字。file1 が先着、file2 が後着
		 */
		async function rePick(
			initial: Image[],
			tempId: string,
			order: [0 | 1, 0 | 1],
		) {
			const conversions = [createDeferred<File>(), createDeferred<File>()];
			const converted = [webp("file1.webp"), webp("file2.webp")];
			let call = 0;
			const processFile = vi.fn(() => conversions[call++].promise);
			const { result } = await renderCore(initial, { processFile });

			const results: boolean[] = [];
			await act(async () => {
				const first = result.current.handlers.handleFileChange(
					tempId,
					jpeg("file1.jpg"),
				);
				const second = result.current.handlers.handleFileChange(
					tempId,
					jpeg("file2.jpg"),
				);
				conversions[order[0]].resolve(converted[order[0]]);
				await flush();
				conversions[order[1]].resolve(converted[order[1]]);
				results.push(...(await Promise.all([first, second])));
			});
			return { result, first: results[0], second: results[1] };
		}

		it("New: 先着の変換が先に解決しても後着のファイルが残ること", async () => {
			const target = makeNewImage({ tempId: "temp_new" });
			const { result, first, second } = await rePick(
				[target],
				"temp_new",
				[0, 1],
			);

			const images = result.current.raw.watchedImages;
			expect(images).toHaveLength(1);
			expect(images[0].tempId).toBe("temp_new");
			expect(images[0].file?.name).toBe("file2.webp");
			expect(first).toBe(false);
			expect(second).toBe(true);
		});

		it("New: 後着の変換が先に解決しても後着のファイルが残ること", async () => {
			const target = makeNewImage({ tempId: "temp_new" });
			const { result, first, second } = await rePick(
				[target],
				"temp_new",
				[1, 0],
			);

			const images = result.current.raw.watchedImages;
			expect(images).toHaveLength(1);
			expect(images[0].file?.name).toBe("file2.webp");
			expect(first).toBe(false);
			expect(second).toBe(true);
		});

		it("Existing: 先着の変換が先に解決しても後着のファイルが残ること", async () => {
			const target = makeExistingImage({ tempId: "temp_existing" });
			const { result, first, second } = await rePick(
				[target],
				"temp_existing",
				[0, 1],
			);

			const images = result.current.raw.watchedImages;
			// 差し替えは 1 回だけ成立する。元画像は末尾で ToBeDeleted
			expect(images).toHaveLength(2);
			const created = images.filter((i) => i.status === ImageFormStatus.New);
			expect(created).toHaveLength(1);
			expect(created[0].file?.name).toBe("file2.webp");
			expect(images[1]).toMatchObject({
				tempId: "temp_existing",
				status: ImageFormStatus.ToBeDeleted,
			});
			expect(first).toBe(false);
			expect(second).toBe(true);
		});

		it("Existing: 後着の変換が先に解決しても後着のファイルが残ること", async () => {
			const target = makeExistingImage({ tempId: "temp_existing" });
			const { result, first, second } = await rePick(
				[target],
				"temp_existing",
				[1, 0],
			);

			const images = result.current.raw.watchedImages;
			expect(images).toHaveLength(2);
			const created = images.filter((i) => i.status === ImageFormStatus.New);
			expect(created).toHaveLength(1);
			expect(created[0].file?.name).toBe("file2.webp");
			expect(images[1]).toMatchObject({
				tempId: "temp_existing",
				status: ImageFormStatus.ToBeDeleted,
			});
			expect(first).toBe(false);
			expect(second).toBe(true);
		});

		it("捨てた先着のファイルは転送されないこと", async () => {
			const uploaded: string[] = [];
			const uploadFile = vi.fn(async (file: File) => {
				uploaded.push(file.name);
				return { uploadRef: `https://s3.example.com/${file.name}` };
			});
			const conversions = [createDeferred<File>(), createDeferred<File>()];
			let call = 0;
			const processFile = vi.fn(() => conversions[call++].promise);
			const { result } = await renderCore([], { processFile, uploadFile });

			await act(async () => {
				const adding = result.current.handlers.handleAdd(jpeg("origin.jpg"));
				conversions[0].resolve(webp("origin.webp"));
				await adding;
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			conversions.push(createDeferred<File>(), createDeferred<File>());
			await act(async () => {
				const first = result.current.handlers.handleFileChange(
					tempId,
					jpeg("file1.jpg"),
				);
				const second = result.current.handlers.handleFileChange(
					tempId,
					jpeg("file2.jpg"),
				);
				conversions[1].resolve(webp("file1.webp"));
				await flush();
				conversions[2].resolve(webp("file2.webp"));
				await Promise.all([first, second]);
			});

			// 捨てた先着が転送を始めると、結果が使われない転送が 1 本増える
			expect(uploaded).not.toContain("file1.webp");
			expect(uploaded).toContain("file2.webp");
		});

		it("後着の変換が失敗したら先着も復活せず選び直す前のファイルが残ること", async () => {
			let rejectSecond!: (reason: unknown) => void;
			const failed = new Promise<File>((_, reject) => {
				rejectSecond = reject;
			});
			const succeeded = createDeferred<File>();
			const conversions = [succeeded.promise, failed];
			let call = 0;
			const processFile = vi.fn(() => conversions[call++]);
			const onError = vi.fn();
			const { result } = await renderCore(
				[makeNewImage({ tempId: "temp_new" })],
				{ processFile, onError },
			);

			const results: boolean[] = [];
			await act(async () => {
				const first = result.current.handlers.handleFileChange(
					"temp_new",
					jpeg("file1.jpg"),
				);
				const second = result.current.handlers.handleFileChange(
					"temp_new",
					jpeg("file2.jpg"),
				);
				rejectSecond(new Error("convert failed"));
				await flush();
				succeeded.resolve(webp("file1.webp"));
				results.push(...(await Promise.all([first, second])));
			});

			expect(results).toEqual([false, false]);
			// 後着が失敗しても、ユーザーが捨てた先着に戻したりはしない
			expect(result.current.raw.watchedImages[0].file?.name).toBe("test.jpg");
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "process_file" }),
			);
		});

		it("捨てた先着でも、その変換が失敗すれば onError が飛ぶこと", async () => {
			let rejectFirst!: (reason: unknown) => void;
			const failed = new Promise<File>((_, reject) => {
				rejectFirst = reject;
			});
			const succeeded = createDeferred<File>();
			const conversions = [failed, succeeded.promise];
			let call = 0;
			const processFile = vi.fn(() => conversions[call++]);
			const onError = vi.fn();
			const { result } = await renderCore(
				[makeNewImage({ tempId: "temp_new" })],
				{ processFile, onError },
			);

			const results: boolean[] = [];
			await act(async () => {
				const first = result.current.handlers.handleFileChange(
					"temp_new",
					jpeg("file1.jpg"),
				);
				const second = result.current.handlers.handleFileChange(
					"temp_new",
					jpeg("file2.jpg"),
				);
				succeeded.resolve(webp("file2.webp"));
				await flush();
				rejectFirst(new Error("convert failed"));
				results.push(...(await Promise.all([first, second])));
			});

			// この onError は項目の状態ではない。項目は後着のファイルを表示している
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "process_file" }),
			);
			expect(results).toEqual([false, true]);
			expect(result.current.raw.watchedImages[0].file?.name).toBe("file2.webp");
		});

		it("unmount 後に解決した差し替えは書き戻されないこと", async () => {
			const converted = createDeferred<File>();
			const { result, ref, unmount } = await renderCore(
				[makeNewImage({ tempId: "temp_new" })],
				{ processFile: () => converted.promise },
			);

			let changing!: Promise<boolean>;
			await act(async () => {
				changing = result.current.handlers.handleFileChange(
					"temp_new",
					jpeg("file1.jpg"),
				);
			});

			await unmount();

			let changed = true;
			await act(async () => {
				converted.resolve(webp("file1.webp"));
				changed = await changing;
			});

			expect(changed).toBe(false);
			expect(ref.adapter?.images[0].file?.name).toBe("test.jpg");
		});

		it("再 mount 後に解決した差し替えが、あとから追加された項目を巻き戻さないこと", async () => {
			const store = {
				images: [makeNewImage({ tempId: "temp_new" })] as Image[],
			};
			const { mount, resolveFirstConversion } = sharedStoreHarness(store);

			const first = await mount();
			let changing!: Promise<boolean>;
			await act(async () => {
				changing = first.result.current.handlers.handleFileChange(
					"temp_new",
					jpeg("file1.jpg"),
				);
			});
			await first.unmount();

			const second = await mount();
			await act(async () => {
				await second.result.current.handlers.handleAdd(jpeg("added.jpg"));
			});

			await act(async () => {
				resolveFirstConversion(webp("file1.webp"));
				await changing;
			});

			expect(store.images).toHaveLength(2);
			expect(store.images[0].file?.name).toBe("test.jpg");
			await second.unmount();
		});

		it("再 mount 後に解決した追加が、あとから追加された項目を巻き戻さないこと", async () => {
			const store = { images: [] as Image[] };
			const { mount, resolveFirstConversion } = sharedStoreHarness(store);

			const first = await mount();
			let adding!: Promise<boolean>;
			await act(async () => {
				adding = first.result.current.handlers.handleAdd(jpeg("file1.jpg"));
			});
			await first.unmount();

			const second = await mount();
			await act(async () => {
				await second.result.current.handlers.handleAdd(jpeg("added.jpg"));
			});

			await act(async () => {
				resolveFirstConversion(webp("file1.webp"));
				await adding;
			});

			expect(store.images).toHaveLength(1);
			expect(store.images[0].file?.name).toBe("added.jpg");
			await second.unmount();
		});

		it("unmount で走行中の wait が解放されること", async () => {
			// 変換が返らないまま画面を離れるケース。待ち続けると保存が永久に返らない
			const { result, unmount } = await renderCore([], {
				processFile: () => new Promise<File>(() => {}),
			});

			let waitResult: unknown = null;
			await act(async () => {
				void result.current.handlers.handleAdd(jpeg("a.jpg"));
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});
				await unmount();
				await waiting;
			});

			expect(waitResult).toMatchObject({ ok: true });
		});

		it("New: 変換中に削除したら解決しても項目が復活しないこと", async () => {
			const converted = createDeferred<File>();
			const { result } = await renderCore(
				[makeNewImage({ tempId: "temp_new" })],
				{ processFile: () => converted.promise },
			);

			let changed = true;
			await act(async () => {
				const changing = result.current.handlers.handleFileChange(
					"temp_new",
					jpeg("file1.jpg"),
				);
				await result.current.handlers.handleDelete("temp_new");
				converted.resolve(webp("file1.webp"));
				changed = await changing;
			});

			expect(changed).toBe(false);
			expect(result.current.raw.watchedImages).toHaveLength(0);
		});

		it("Existing: 変換中に削除したら解決しても ToBeDeleted のままであること", async () => {
			const converted = createDeferred<File>();
			const { result } = await renderCore(
				[makeExistingImage({ tempId: "temp_existing" })],
				{ processFile: () => converted.promise },
			);

			let changed = true;
			await act(async () => {
				const changing = result.current.handlers.handleFileChange(
					"temp_existing",
					jpeg("file1.jpg"),
				);
				await result.current.handlers.handleDelete("temp_existing");
				converted.resolve(webp("file1.webp"));
				changed = await changing;
			});

			expect(changed).toBe(false);
			const images = result.current.raw.watchedImages;
			expect(images).toHaveLength(1);
			expect(images[0]).toMatchObject({
				tempId: "temp_existing",
				status: ImageFormStatus.ToBeDeleted,
			});
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

		it("uploadFile が失敗しても差し替えは成立し onError(upload_file) が届く", async () => {
			const onError = vi.fn();
			const uploadFile = vi.fn(async () => {
				throw new Error("upload boom");
			});
			const ex = makeExistingImage({ tempId: "temp_ex" });
			const { result } = await renderCore([ex], { uploadFile, onError });

			let ok = false;
			await act(async () => {
				ok = await result.current.handlers.handleFileChange(
					"temp_ex",
					new File(["d"], "x.jpg", { type: "image/jpeg" }),
				);
			});

			// 転送の成否は差し替えの成否と切り離される
			expect(ok).toBe(true);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "upload_file" }),
			);
			const images = result.current.raw.watchedImages;
			expect(images).toHaveLength(2);
			expect(images[0].status).toBe(ImageFormStatus.New);
			expect(images[1].status).toBe(ImageFormStatus.ToBeDeleted);
			expect(result.current.uploads.failed).toEqual([images[0].tempId]);
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

		it("New 画像の差し替えで uploadFile が失敗しても差し替えたファイルは残る", async () => {
			const onError = vi.fn();
			const nv = makeNewImage({ tempId: "temp_n" });
			const uploadFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result } = await renderCore([nv], { uploadFile, onError });

			let ok = false;
			await act(async () => {
				ok = await result.current.handlers.handleFileChange(
					"temp_n",
					new File(["d"], "x.jpg", { type: "image/jpeg" }),
				);
			});

			expect(ok).toBe(true);
			expect(result.current.raw.watchedImages).toHaveLength(1);
			expect(result.current.raw.watchedImages[0].tempId).toBe("temp_n");
			expect((result.current.raw.watchedImages[0] as ImageNew).file.name).toBe(
				"x.jpg",
			);
			expect(result.current.uploads.failed).toEqual(["temp_n"]);
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
			let ok = false;
			await act(async () => {
				ok = await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(true);
			expect(result.current.uploads.failed).toHaveLength(1);
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
		it("uploadFile が成功すると ImageNew.uploadRef が設定されること", async () => {
			const uploadFile = vi.fn(async () => ({
				uploadRef: "https://s3.example.com/uploaded.jpg",
			}));
			const { result } = await renderCore([], { uploadFile });
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			expect(uploadFile).toHaveBeenCalled();
			const img = result.current.raw.watchedImages[0] as ImageNew;
			expect(img.uploadRef).toBe("https://s3.example.com/uploaded.jpg");
		});

		it("uploadFile 未指定時は uploadRef が undefined のままであること", async () => {
			const { result } = await renderCore([]);
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const img = result.current.raw.watchedImages[0] as ImageNew;
			expect(img.uploadRef).toBeUndefined();
		});

		it("uploadFile が失敗しても項目は残り onError(upload_file) が届くこと", async () => {
			const onError = vi.fn();
			const uploadFile = vi.fn(async () => {
				throw new Error("upload failed");
			});
			const { result } = await renderCore([], { uploadFile, onError });
			let ok = false;
			await act(async () => {
				ok = await result.current.handlers.handleAdd(
					new File(["d"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			// 転送に失敗してもユーザーの選択は捨てない（リトライ導線を残す）
			expect(ok).toBe(true);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "upload_file" }),
			);
			expect(result.current.raw.watchedImages).toHaveLength(1);
			expect(result.current.items[0].uploadState?.status).toBe("failed");
		});

		it("processFile → uploadFile の順で実行されること", async () => {
			const callOrder: string[] = [];
			const processFile = vi.fn(async (f: File) => {
				callOrder.push("processFile");
				return f;
			});
			const uploadFile = vi.fn(async () => {
				callOrder.push("uploadFile");
				return { uploadRef: "https://s3.example.com/uploaded.jpg" };
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
				uploadRef: "https://s3.example.com/changed.jpg",
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
			expect(newImg.uploadRef).toBe("https://s3.example.com/changed.jpg");
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

	describe("ノンブロッキング転送", () => {
		const url = (name: string) => `https://s3.example.com/${name}`;

		/** 呼び出し順に deferred を配る uploadFile */
		function queuedUpload(count: number) {
			const deferreds = Array.from({ length: count }, () =>
				createDeferred<UploadFileResult>(),
			);
			let call = 0;
			const uploadFile = vi.fn(
				async (): Promise<UploadFileResult> => deferreds[call++].promise,
			);
			return { uploadFile, deferreds };
		}

		it("転送の完了を待たずに項目が追加され、pending が公開されること", async () => {
			const { uploadFile } = queuedUpload(1);
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			expect(result.current.raw.watchedImages).toHaveLength(1);
			expect(result.current.uploads.pending).toHaveLength(1);
			expect(result.current.items[0].uploadState?.status).toBe("pending");
		});

		it("転送中にファイルを差し替えると古い転送結果は反映されないこと", async () => {
			const { uploadFile, deferreds } = queuedUpload(2);
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			await act(async () => {
				await result.current.handlers.handleFileChange(
					tempId,
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
			});

			// 差し替え前の転送を後から解決させる
			await act(async () => {
				deferreds[0].resolve({ uploadRef: url("stale.jpg") });
				await deferreds[0].promise;
			});
			await act(async () => {
				deferreds[1].resolve({ uploadRef: url("fresh.jpg") });
				await deferreds[1].promise;
			});

			const image = result.current.raw.watchedImages[0] as ImageNew;
			expect(image.file.name).toBe("b.jpg");
			expect(image.uploadRef).toBe(url("fresh.jpg"));
		});

		it("転送中に項目を削除すると結果は反映されず onError も呼ばれないこと", async () => {
			const onError = vi.fn();
			const { uploadFile, deferreds } = queuedUpload(1);
			const { result } = await renderCore([], { uploadFile, onError });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			await act(async () => {
				await result.current.handlers.handleDelete(tempId);
			});
			await act(async () => {
				deferreds[0].resolve({ uploadRef: url("orphan.jpg") });
				await deferreds[0].promise;
			});

			expect(result.current.raw.watchedImages).toHaveLength(0);
			expect(result.current.uploads.failed).toHaveLength(0);
			expect(onError).not.toHaveBeenCalled();
		});

		it("複数項目の並行転送がそれぞれ正しい項目へ書き戻されること", async () => {
			const { uploadFile, deferreds } = queuedUpload(2);
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
				await result.current.handlers.handleAdd(
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
			});

			// 解決順を逆にしても対応関係は崩れない
			await act(async () => {
				deferreds[1].resolve({ uploadRef: url("b.jpg") });
				deferreds[0].resolve({ uploadRef: url("a.jpg") });
				await Promise.all([deferreds[0].promise, deferreds[1].promise]);
			});

			const images = result.current.raw.watchedImages as ImageNew[];
			expect(images[0].file.name).toBe("a.jpg");
			expect(images[0].uploadRef).toBe(url("a.jpg"));
			expect(images[1].file.name).toBe("b.jpg");
			expect(images[1].uploadRef).toBe(url("b.jpg"));
		});

		it("processFile 設定時も書き戻しが成立すること", async () => {
			// startUpload へ加工前の File を渡すと同一性比較が常に不成立になり、
			// この検証だけが取り違えを検出できる
			const processFile = vi.fn(
				async (file: File) =>
					new File([file], `processed_${file.name}`, { type: file.type }),
			);
			const uploadFile = vi.fn(async () => ({
				uploadRef: url("processed.jpg"),
			}));
			const { result } = await renderCore([], { processFile, uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			const image = result.current.raw.watchedImages[0] as ImageNew;
			expect(image.file.name).toBe("processed_a.jpg");
			expect(image.uploadRef).toBe(url("processed.jpg"));
		});
	});

	describe("uploads API", () => {
		const url = (name: string) => `https://s3.example.com/${name}`;

		it("uploads.wait: uploadFile 未設定なら常に ok を返すこと", async () => {
			const { result } = await renderCore([]);
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			let waitResult: Awaited<
				ReturnType<typeof result.current.uploads.wait>
			> | null = null;
			await act(async () => {
				waitResult = await result.current.uploads.wait();
			});

			expect(waitResult).toMatchObject({ ok: true });
			expect(
				waitResult && (waitResult as { images: unknown[] }).images,
			).toHaveLength(1);
		});

		it("uploads.wait: 転送完了まで待ち、uploadRef 込みの images を返すこと", async () => {
			const deferred = createDeferred<UploadFileResult>();
			const uploadFile = vi.fn(async () => deferred.promise);
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			let waitResult: unknown = null;
			await act(async () => {
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});
				deferred.resolve({ uploadRef: url("a.jpg") });
				await waiting;
			});

			expect(waitResult).toMatchObject({
				ok: true,
				images: [{ uploadRef: url("a.jpg") }],
			});
		});

		it("uploads.wait: 待機中に開始された転送も待つこと（収束ループ）", async () => {
			const deferreds = [
				createDeferred<UploadFileResult>(),
				createDeferred<UploadFileResult>(),
			];
			let call = 0;
			const uploadFile = vi.fn(async () => deferreds[call++].promise);
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			let waitResult: unknown = null;
			await act(async () => {
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});
				// uploads.wait が 1 本目を待っている間に 2 本目を開始する
				await result.current.handlers.handleAdd(
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
				deferreds[0].resolve({ uploadRef: url("a.jpg") });
				deferreds[1].resolve({ uploadRef: url("b.jpg") });
				await waiting;
			});

			expect(waitResult).toMatchObject({
				ok: true,
				images: [{ uploadRef: url("a.jpg") }, { uploadRef: url("b.jpg") }],
			});
		});

		it("uploads.wait: 失敗した項目があると ok:false と failedTempIds を返すこと", async () => {
			const uploadFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = await result.current.uploads.wait();
			});

			expect(waitResult).toEqual({ ok: false, failedTempIds: [tempId] });
		});

		it("uploads.wait: 台帳に無い未転送の new 項目は再発行してから判定すること", async () => {
			// uploadRef を持たない new 項目を初期値として与える（remount 後と同じ状態）
			const uploadFile = vi.fn(async () => ({
				uploadRef: url("healed.jpg"),
			}));
			const orphan = makeNewImage({ tempId: "temp_orphan" });
			const { result } = await renderCore([orphan], { uploadFile });

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = await result.current.uploads.wait();
			});

			expect(uploadFile).toHaveBeenCalled();
			expect(waitResult).toMatchObject({ ok: true });
		});

		it("uploads.wait: 台帳が別の File のものなら未着手として再発行すること", async () => {
			// adapter は公開ポートなので、consumer が handlers を介さず
			// setImages でファイルを差し替えることがありうる
			const uploadFile = vi.fn(async (file: File) => ({
				uploadRef: url(file.name),
			}));
			const { result, ref } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const added = result.current.raw.watchedImages[0] as ImageNew;
			expect(added.uploadRef).toBe(url("a.jpg"));

			await act(async () => {
				ref.adapter?.setImages([
					{
						...added,
						file: new File(["b"], "b.jpg", { type: "image/jpeg" }),
						uploadRef: undefined,
					},
				]);
			});

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = await result.current.uploads.wait();
			});

			expect(waitResult).toMatchObject({
				ok: true,
				images: [{ uploadRef: url("b.jpg") }],
			});
		});

		it("uploads.getReady(): 走行中の項目を待たずに除外すること", async () => {
			const deferred = createDeferred<UploadFileResult>();
			const uploadFile = vi.fn(async () => deferred.promise);
			const existing = makeExistingImage();
			const { result } = await renderCore([existing], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[1].tempId;

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = result.current.uploads.getReady();
			});

			// 除外しても existing は残る。除外したものは tempId で伝える
			expect(waitResult).toEqual({
				images: [{ id: existing.id }],
				deletedIds: [],
				excludedTempIds: [tempId],
			});
			// 項目自体はフォームに残り、転送も走り続ける
			expect(result.current.raw.watchedImages).toHaveLength(2);
			expect(result.current.uploads.pending).toEqual([tempId]);

			await act(async () => {
				deferred.resolve({ uploadRef: url("a.jpg") });
				await deferred.promise;
			});

			// 解決後は除外されない
			await act(async () => {
				waitResult = result.current.uploads.getReady();
			});
			expect(waitResult).toEqual({
				images: [{ id: existing.id }, { uploadRef: url("a.jpg") }],
				deletedIds: [],
				excludedTempIds: [],
			});
		});

		it("uploads.getReady(): 失敗した項目も除外すること", async () => {
			const uploadFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = result.current.uploads.getReady();
			});

			// 失敗しようがないので ok の判定を持たない
			expect(waitResult).toEqual({
				images: [],
				deletedIds: [],
				excludedTempIds: [tempId],
			});
			expect(result.current.uploads.failed).toEqual([tempId]);
		});

		it("uploads.getReady(): 差し替え中は元画像がその位置に残ること", async () => {
			// 対の ToBeDeleted をそのまま deletedIds に載せると元画像が消える。
			// replacesTempId をたどって元画像を戻すことを確かめる
			const deferred = createDeferred<UploadFileResult>();
			const uploadFile = vi.fn(async () => deferred.promise);
			const existing = makeExistingImage({ tempId: "temp_ex" });
			const { result } = await renderCore([existing], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleFileChange(
					"temp_ex",
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			const replacementTempId = result.current.raw.watchedImages[0].tempId;

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = result.current.uploads.getReady();
			});

			// 差し替え後の new は除外されるが、元画像は削除されず同じ位置に戻る。
			// 削除だけを送ると「元が消えて差し替え後も入らない」状態になる
			expect(waitResult).toEqual({
				images: [{ id: existing.id }],
				deletedIds: [],
				excludedTempIds: [replacementTempId],
			});

			await act(async () => {
				deferred.resolve({ uploadRef: url("b.jpg") });
				await deferred.promise;
			});
		});

		it("uploads.getReady(): 差し替えが解決していれば元画像は削除されること", async () => {
			const deferred = createDeferred<UploadFileResult>();
			const uploadFile = vi.fn(async () => deferred.promise);
			const existing = makeExistingImage({ tempId: "temp_ex" });
			const { result } = await renderCore([existing], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleFileChange(
					"temp_ex",
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			await act(async () => {
				deferred.resolve({ uploadRef: url("b.jpg") });
				await deferred.promise;
			});

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = result.current.uploads.getReady();
			});

			expect(waitResult).toEqual({
				images: [{ uploadRef: url("b.jpg") }],
				deletedIds: [existing.id],
				excludedTempIds: [],
			});
		});

		it("uploads.getReady(): 差し替え後にさらに選び直しても元画像との対応が残ること", async () => {
			const deferreds = [
				createDeferred<UploadFileResult>(),
				createDeferred<UploadFileResult>(),
			];
			let call = 0;
			const uploadFile = vi.fn(async () => deferreds[call++].promise);
			const existing = makeExistingImage({ tempId: "temp_ex" });
			const { result } = await renderCore([existing], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleFileChange(
					"temp_ex",
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			const newTempId = result.current.raw.watchedImages[0].tempId;
			await act(async () => {
				await result.current.handlers.handleFileChange(
					newTempId,
					new File(["c"], "c.jpg", { type: "image/jpeg" }),
				);
			});

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = result.current.uploads.getReady();
			});

			expect(waitResult).toMatchObject({
				images: [{ id: existing.id }],
				deletedIds: [],
			});
		});

		it("uploads.getReady(): 差し替えが複数あっても解決済みと未解決を取り違えないこと", async () => {
			const deferreds = [
				createDeferred<UploadFileResult>(),
				createDeferred<UploadFileResult>(),
			];
			let call = 0;
			const uploadFile = vi.fn(async () => deferreds[call++].promise);
			const first = makeExistingImage({ tempId: "temp_ex1", id: "id-1" });
			const second = makeExistingImage({ tempId: "temp_ex2", id: "id-2" });
			const { result } = await renderCore([first, second], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleFileChange(
					"temp_ex1",
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			await act(async () => {
				await result.current.handlers.handleFileChange(
					"temp_ex2",
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			const pendingTempId = result.current.raw.watchedImages[1].tempId;

			// 1 本目だけ解決させる
			await act(async () => {
				deferreds[0].resolve({ uploadRef: url("a.jpg") });
				await deferreds[0].promise;
			});

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = result.current.uploads.getReady();
			});

			// 解決済みは差し替え後が入り元は削除、未解決は元が残る
			expect(waitResult).toEqual({
				images: [{ uploadRef: url("a.jpg") }, { id: "id-2" }],
				deletedIds: ["id-1"],
				excludedTempIds: [pendingTempId],
			});

			await act(async () => {
				deferreds[1].resolve({ uploadRef: url("b.jpg") });
				await deferreds[1].promise;
			});
		});

		it("uploads.getReady(): 差し替え後を削除したら元画像は削除されること", async () => {
			const deferred = createDeferred<UploadFileResult>();
			const uploadFile = vi.fn(async () => deferred.promise);
			const existing = makeExistingImage({ tempId: "temp_ex", id: "id-ex" });
			const { result } = await renderCore([existing], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleFileChange(
					"temp_ex",
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			const replacementTempId = result.current.raw.watchedImages[0].tempId;
			await act(async () => {
				await result.current.handlers.handleDelete(replacementTempId);
			});

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = result.current.uploads.getReady();
			});

			// 差し替えをやめて削除しただけなので、元画像は消える
			expect(waitResult).toEqual({
				images: [],
				deletedIds: ["id-ex"],
				excludedTempIds: [],
			});
		});

		it("uploads.getReady(): replacesTempId の指す項目が無くても元画像を捏造しないこと", async () => {
			const deferred = createDeferred<UploadFileResult>();
			const uploadFile = vi.fn(async () => deferred.promise);
			const orphanLink: ImageNew = {
				...makeNewImage({ tempId: "temp_new" }),
				replacesTempId: "temp_missing",
			};
			const { result } = await renderCore([orphanLink], { uploadFile });

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = result.current.uploads.getReady();
			});

			expect(waitResult).toEqual({
				images: [],
				deletedIds: [],
				excludedTempIds: ["temp_new"],
			});

			await act(async () => {
				deferred.resolve({ uploadRef: url("b.jpg") });
				await deferred.promise;
			});
		});

		it("uploads.getReady(): 転送に失敗した差し替えでも元画像が戻ること", async () => {
			// failed も listUnresolved に含まれるので除外対象になる。ここで元画像を
			// 戻さないと、失敗したときだけ「元が消えて差し替え後も入らない」が残る
			const uploadFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const existing = makeExistingImage({ tempId: "temp_ex", id: "id-ex" });
			const { result } = await renderCore([existing], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleFileChange(
					"temp_ex",
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			const replacementTempId = result.current.raw.watchedImages[0].tempId;
			expect(result.current.uploads.failed).toEqual([replacementTempId]);

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = result.current.uploads.getReady();
			});

			expect(waitResult).toEqual({
				images: [{ id: "id-ex" }],
				deletedIds: [],
				excludedTempIds: [replacementTempId],
			});
		});

		it("uploads.getReady(): remount 後も差し替えの対応が効くこと", async () => {
			// 対応をフック内に持つと remount で失われ、削除だけが送られる状態に戻る
			const deferred = createDeferred<UploadFileResult>();
			const uploadFile = vi.fn(async () => deferred.promise);
			const deleted = ImageUtils.markDelete(
				makeExistingImage({ tempId: "temp_ex", id: "id-ex" }),
			);
			const replacement: ImageNew = {
				...makeNewImage({ tempId: "temp_new" }),
				replacesTempId: "temp_ex",
			};
			const { result } = await renderCore([replacement, deleted], {
				uploadFile,
			});

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = result.current.uploads.getReady();
			});

			expect(waitResult).toMatchObject({
				images: [{ id: "id-ex" }],
				deletedIds: [],
			});

			await act(async () => {
				deferred.resolve({ uploadRef: url("b.jpg") });
				await deferred.promise;
			});
		});

		it("uploads.getReady(): uploadFile 未設定なら何も除外しないこと", async () => {
			const { result } = await renderCore([]);

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = result.current.uploads.getReady();
			});

			// 転送しない構成では uploadRef が無いのが正常。除外すると全部消える。
			// 新規項目は転送を消費側に委ねるので File のまま渡し、失敗した項目を
			// 指し示せるよう tempId を添える
			expect(waitResult).toMatchObject({ excludedTempIds: [] });
			const images = (waitResult as { images: SubmitImage[] }).images;
			expect(images).toHaveLength(1);
			expect(images[0]).toEqual({
				file: expect.any(File),
				tempId: result.current.raw.watchedImages[0].tempId,
			});
		});

		it("retry: pending 中は受け付けず false を返すこと", async () => {
			const deferred = createDeferred<UploadFileResult>();
			const uploadFile = vi.fn(async () => deferred.promise);
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			let retried = true;
			await act(async () => {
				retried = await result.current.uploads.retry(tempId);
			});

			expect(retried).toBe(false);
			expect(uploadFile).toHaveBeenCalledOnce();

			await act(async () => {
				deferred.resolve({ uploadRef: url("a.jpg") });
				await deferred.promise;
			});
		});

		it("retry: 失敗した項目を再転送して回復できること", async () => {
			let shouldFail = true;
			const uploadFile = vi.fn(async () => {
				if (shouldFail) throw new Error("boom");
				return { uploadRef: url("recovered.jpg") };
			});
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;
			expect(result.current.uploads.failed).toEqual([tempId]);

			shouldFail = false;
			let retried = false;
			await act(async () => {
				retried = await result.current.uploads.retry(tempId);
			});

			expect(retried).toBe(true);
			expect(result.current.uploads.failed).toHaveLength(0);
			expect((result.current.raw.watchedImages[0] as ImageNew).uploadRef).toBe(
				url("recovered.jpg"),
			);
		});

		it("wait() の待機中に retry で始まった転送も待つこと", async () => {
			// retry は started.settled を await する独自経路を持つ。走行中の別の転送が
			// 待機を維持している間に retry が始まると、収束ループがそれを拾えるか
			const slow = createDeferred<UploadFileResult>();
			const recovered = createDeferred<UploadFileResult>();
			let failNext = false;
			const uploadFile = vi.fn(async () => {
				if (failNext) throw new Error("boom");
				return slow.promise;
			});
			const { result } = await renderCore([], { uploadFile });

			// 1 本目: 待機を維持する役
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			// 2 本目: 失敗させる
			failNext = true;
			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
			});
			const failedTempId = result.current.raw.watchedImages[1].tempId;
			expect(result.current.uploads.failed).toEqual([failedTempId]);

			let waitResult: unknown = null;
			await act(async () => {
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});

				// 待機中に retry を始める
				failNext = false;
				uploadFile.mockImplementationOnce(async () => recovered.promise);
				const retried = result.current.uploads.retry(failedTempId);

				slow.resolve({ uploadRef: url("slow.jpg") });
				recovered.resolve({ uploadRef: url("recovered.jpg") });
				await retried;
				await waiting;
			});

			// retry で始まった転送も待ってから ok を返す
			expect(waitResult).toEqual({
				ok: true,
				images: [
					{ uploadRef: url("slow.jpg") },
					{ uploadRef: url("recovered.jpg") },
				],
				deletedIds: [],
			});
		});

		it("retry: 再試行しても失敗したら false を返すこと", async () => {
			const uploadFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			let retried = true;
			await act(async () => {
				retried = await result.current.uploads.retry(tempId);
			});

			expect(retried).toBe(false);
			expect(result.current.uploads.failed).toEqual([tempId]);
		});

		it("retry: 不明な tempId では false を返すこと", async () => {
			const uploadFile = vi.fn(async () => ({ uploadRef: url("a.jpg") }));
			const { result } = await renderCore([], { uploadFile });

			let retried = true;
			await act(async () => {
				retried = await result.current.uploads.retry("temp_unknown");
			});

			expect(retried).toBe(false);
			expect(uploadFile).not.toHaveBeenCalled();
		});

		it("失敗した項目のファイル差し替えで failed が pending に置き換わること", async () => {
			const deferred = createDeferred<UploadFileResult>();
			let shouldFail = true;
			const uploadFile = vi.fn(async () => {
				if (shouldFail) throw new Error("boom");
				return deferred.promise;
			});
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;
			expect(result.current.uploads.failed).toEqual([tempId]);

			shouldFail = false;
			await act(async () => {
				await result.current.handlers.handleFileChange(
					tempId,
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
			});

			expect(result.current.uploads.failed).toHaveLength(0);
			expect(result.current.uploads.pending).toHaveLength(1);

			await act(async () => {
				deferred.resolve({ uploadRef: url("b.jpg") });
				await deferred.promise;
			});
		});

		it("失敗した項目を削除すると failed から除去されること", async () => {
			const uploadFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;
			expect(result.current.uploads.failed).toEqual([tempId]);

			await act(async () => {
				await result.current.handlers.handleDelete(tempId);
			});

			expect(result.current.uploads.failed).toHaveLength(0);

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = await result.current.uploads.wait();
			});
			expect(waitResult).toMatchObject({ ok: true });
		});
	});

	describe("転送の中断 (AbortSignal)", () => {
		/** uploadFile が受け取った signal を順に記録する */
		function signalCapturingUpload(count: number) {
			const signals: (AbortSignal | undefined)[] = [];
			const deferreds = Array.from({ length: count }, () =>
				createDeferred<UploadFileResult>(),
			);
			let call = 0;
			const uploadFile: UploadFileFn = async (_file, ctx) => {
				signals.push(ctx?.signal);
				return deferreds[call++].promise;
			};
			return { uploadFile: vi.fn(uploadFile), signals, deferreds };
		}

		it("ファイル差し替えで旧転送が中断され、新転送は生きていること", async () => {
			const { uploadFile, signals } = signalCapturingUpload(2);
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			await act(async () => {
				await result.current.handlers.handleFileChange(
					tempId,
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
			});

			expect(signals[0]?.aborted).toBe(true);
			expect(signals[1]?.aborted).toBe(false);
		});

		it("項目の削除で転送が中断されること", async () => {
			const { uploadFile, signals } = signalCapturingUpload(1);
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			await act(async () => {
				await result.current.handlers.handleDelete(tempId);
			});

			expect(signals[0]?.aborted).toBe(true);
		});

		it("unmount で中断され、その後 resolve しても書き戻されないこと", async () => {
			// unmount 後の書き戻しを許すと、フォームを共有する remount 後の
			// インスタンスへ古い URL が紛れ込む
			const { uploadFile, signals, deferreds } = signalCapturingUpload(1);
			const { result, ref, unmount } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			await unmount();
			expect(signals[0]?.aborted).toBe(true);

			await act(async () => {
				deferreds[0].resolve({
					uploadRef: "https://s3.example.com/late.jpg",
				});
				await deferreds[0].promise;
			});

			const images = ref.adapter?.images ?? [];
			expect((images[0] as ImageNew).uploadRef).toBeUndefined();
		});
	});

	describe("uploadRef を伴わない resolve", () => {
		it("失敗として扱い、転送を撃ち続けないこと", async () => {
			// 成功扱いすると done なのに未解決の項目が残り、reissueUnresolved が
			// 毎周 startUpload を呼んで uploads.wait が返らなくなる
			const uploadFile = vi.fn(async () => ({}) as unknown as UploadFileResult);
			const onError = vi.fn();
			const { result } = await renderCore([], { uploadFile, onError });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			const tempId = result.current.raw.watchedImages[0].tempId;
			expect(result.current.uploads.failed).toEqual([tempId]);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "upload_file" }),
			);

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = await result.current.uploads.wait();
			});

			expect(waitResult).toEqual({ ok: false, failedTempIds: [tempId] });
			expect(uploadFile).toHaveBeenCalledOnce();
		});

		it("空文字の uploadRef も失敗として扱うこと", async () => {
			const uploadFile = vi.fn(async () => ({ uploadRef: "" }));
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			expect(result.current.uploads.failed).toHaveLength(1);
		});
	});

	describe("進捗（ctx.onProgress）", () => {
		const url = (name: string) => `https://s3.example.com/${name}`;

		/** onProgress を掴んで任意のタイミングで叩けるようにする */
		function progressCapturingUpload() {
			const deferred = createDeferred<UploadFileResult>();
			const captured: { onProgress?: (fraction: number) => void } = {};
			const uploadFile: UploadFileFn = vi.fn((_file, ctx) => {
				captured.onProgress = ctx.onProgress;
				return deferred.promise;
			});
			return { uploadFile, captured, deferred };
		}

		it("報告した値が uploadState に出ること", async () => {
			const { uploadFile, captured, deferred } = progressCapturingUpload();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			await act(async () => {
				captured.onProgress?.(0.375);
			});

			expect(result.current.items[0].uploadState).toEqual({
				status: "pending",
				progress: 0.375,
			});

			await act(async () => {
				deferred.resolve({ uploadRef: url("a.jpg") });
				await deferred.promise;
			});
		});

		it("整数パーセントが変わらない報告では再レンダーしないこと", async () => {
			// チャンクごとに台帳へ書くと転送 1 本で数百回の再レンダーになる
			const { uploadFile, captured, deferred } = progressCapturingUpload();
			const { result, getRenderCount } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			await act(async () => {
				captured.onProgress?.(0.5);
			});
			const afterFirst = getRenderCount();

			await act(async () => {
				// 0.50x は同じ 50%。表示は変わらないので書き込まない
				captured.onProgress?.(0.501);
				captured.onProgress?.(0.5099);
			});
			expect(getRenderCount()).toBe(afterFirst);

			await act(async () => {
				captured.onProgress?.(0.51);
			});
			expect(getRenderCount()).toBeGreaterThan(afterFirst);

			await act(async () => {
				deferred.resolve({ uploadRef: url("a.jpg") });
				await deferred.promise;
			});
		});

		it("非有限の報告は弾き、範囲外はクランプすること", async () => {
			const { uploadFile, captured, deferred } = progressCapturingUpload();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			await act(async () => {
				captured.onProgress?.(Number.NaN);
			});
			expect(result.current.items[0].uploadState).toEqual({
				status: "pending",
				progress: undefined,
			});

			await act(async () => {
				captured.onProgress?.(3);
			});
			expect(result.current.items[0].uploadState).toEqual({
				status: "pending",
				progress: 1,
			});

			await act(async () => {
				deferred.resolve({ uploadRef: url("a.jpg") });
				await deferred.promise;
			});
		});

		it("転送が終わると進捗も消えること", async () => {
			const { uploadFile, captured, deferred } = progressCapturingUpload();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			await act(async () => {
				captured.onProgress?.(0.5);
			});

			await act(async () => {
				deferred.resolve({ uploadRef: url("a.jpg") });
				await deferred.promise;
			});

			expect(result.current.items[0].uploadState).toBeUndefined();
		});
	});

	describe("台帳による反映遅延の吸収", () => {
		const url = (name: string) => `https://s3.example.com/${name}`;

		it("フォーム state から uploadRef が欠けても台帳が補うこと", async () => {
			// ImageFieldAdapter は setImages の同期反映を契約していないため、
			// 書き戻し直後のフォーム state に uploadRef が乗っていない実装がありうる
			const uploadFile = vi.fn(async () => ({ uploadRef: url("late.jpg") }));
			const { result, ref } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const stored = result.current.raw.watchedImages[0] as ImageNew;
			expect(stored.uploadRef).toBe(url("late.jpg"));

			// 同じ File のまま uploadRef だけが反映されていない状態を作る
			await act(async () => {
				ref.adapter?.setImages([{ ...stored, uploadRef: undefined }]);
			});

			// 表示側は台帳で補われる
			expect((result.current.items[0].image as ImageNew).uploadRef).toBe(
				url("late.jpg"),
			);

			// 判定と素材も同じ供給源を通るので食い違わない
			let waitResult: unknown = null;
			await act(async () => {
				waitResult = await result.current.uploads.wait();
			});
			expect(waitResult).toMatchObject({
				ok: true,
				images: [{ uploadRef: url("late.jpg") }],
			});
			expect(uploadFile).toHaveBeenCalledOnce();
		});
	});

	describe("契約違反の adapter に対する tripwire", () => {
		const url = (name: string) => `https://s3.example.com/${name}`;

		it("File の参照を保持しない adapter でも転送が無限に走らないこと", async () => {
			// read のたびに File を作り直すと書き戻しが常に破棄され、
			// 再発行が永久に回る（ImageFieldAdapter の不変条件違反）
			const uploadFile = vi.fn(async () => ({
				uploadRef: "https://s3.example.com/never-lands.jpg",
			}));
			// 並べ替えで実際に setImages を起こすため 2 件で始める。単一項目への
			// handleMove は moved: false で setImages に到達せず、再レンダーが起きない
			const { result } = await renderCore(
				[
					makeNewImage({ tempId: "temp_clone" }),
					makeExistingImage({ tempId: "temp_keep" }),
				],
				{ uploadFile, cloneOnRead: true },
			);

			await vi.waitFor(() =>
				expect(result.current.uploads.failed).toEqual(["temp_clone"]),
			);
			// 上限で打ち切られ、撃ち続けない
			expect(uploadFile).toHaveBeenCalledTimes(2);

			// 打ち切り後、再レンダーが起きても再発行されないこと
			const callsAtTripwire = uploadFile.mock.calls.length;
			const orderBefore = result.current.raw.watchedImages.map((i) => i.tempId);
			await act(async () => {
				await result.current.handlers.handleMove("temp_keep", "up");
			});
			expect(result.current.raw.watchedImages.map((i) => i.tempId)).not.toEqual(
				orderBefore,
			);
			expect(uploadFile).toHaveBeenCalledTimes(callsAtTripwire);
		});

		it("待機中のファイル差し替えを失敗と誤検知しないこと", async () => {
			// 進捗なし検出を 1 周で打ち切ると、差し替え直後の周回（旧転送は中断され、
			// 新転送はまだ結果を出していない）を失敗と判定してしまう
			const deferreds = [
				createDeferred<UploadFileResult>(),
				createDeferred<UploadFileResult>(),
			];
			let call = 0;
			const uploadFile = vi.fn(async () => deferreds[call++].promise);
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			let waitResult: unknown = null;
			await act(async () => {
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});
				// 保存を押した直後に写真を選び直す
				await result.current.handlers.handleFileChange(
					tempId,
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
				// 中断された旧転送だけを先に settle させ、uploads.wait に
				// 「進捗の無い周回」を 1 回経験させる
				deferreds[0].resolve({ uploadRef: url("stale.jpg") });
				await new Promise((resolve) => setTimeout(resolve, 0));

				deferreds[1].resolve({ uploadRef: url("fresh.jpg") });
				await waiting;
			});

			expect(waitResult).toMatchObject({
				ok: true,
				images: [{ uploadRef: url("fresh.jpg") }],
			});
		});

		it("uploads.wait がハングせず失敗を返すこと", async () => {
			const uploadFile = vi.fn(async () => ({
				uploadRef: "https://s3.example.com/never-lands.jpg",
			}));
			const { result } = await renderCore(
				[makeNewImage({ tempId: "temp_clone" })],
				{ uploadFile, cloneOnRead: true },
			);

			let waitResult: unknown = null;
			await act(async () => {
				waitResult = await result.current.uploads.wait();
			});

			expect(waitResult).toEqual({
				ok: false,
				failedTempIds: ["temp_clone"],
			});
			// 台帳にも残す。これが無いと消費側が該当項目を提示も retry もできない
			expect(result.current.uploads.failed).toEqual(["temp_clone"]);
			expect(result.current.items[0].uploadState).toMatchObject({
				status: "failed",
			});
		});
	});

	describe("uploads.wait と走行中の handler 操作", () => {
		const url = (name: string) => `https://s3.example.com/${name}`;
		const jpeg = (name: string) =>
			new File([name], name, { type: "image/jpeg" });
		const webp = (name: string) =>
			new File([name], name, { type: "image/webp" });
		/** 保留中の promise がまだ settle していないことを見るための待ち */
		const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

		it("processFile 無しでも、項目になるまで待つこと", async () => {
			const uploadFile = vi.fn(async () => ({ uploadRef: url("a.jpg") }));
			const { result } = await renderCore([], { uploadFile });

			let waitResult: unknown = null;
			await act(async () => {
				// 待つのは変換ではなく handler の呼び出し。processFile を設定して
				// いなくても、項目を作る前に await を挟むので同じ窓ができる
				void result.current.handlers.handleAdd(jpeg("a.jpg"));
				waitResult = await result.current.uploads.wait();
			});

			expect(waitResult).toMatchObject({
				ok: true,
				images: [{ uploadRef: url("a.jpg") }],
			});
		});

		it("変換の解決前に settle せず、解決後に当該画像を含む ok を返すこと", async () => {
			const converted = createDeferred<File>();
			const uploadFile = vi.fn(async () => ({ uploadRef: url("a.webp") }));
			const { result } = await renderCore([], {
				processFile: () => converted.promise,
				uploadFile,
			});

			let waitResult: unknown = null;
			await act(async () => {
				// 変換中に保存を押す状況。handleAdd は await しない
				void result.current.handlers.handleAdd(jpeg("a.jpg"));
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});
				await flush();
				expect(waitResult).toBeNull();

				converted.resolve(webp("a.webp"));
				await waiting;
			});

			expect(waitResult).toMatchObject({
				ok: true,
				images: [{ uploadRef: url("a.webp") }],
			});
		});

		it("変換が解決しても転送の完了まで待つこと", async () => {
			const converted = createDeferred<File>();
			const uploaded = createDeferred<UploadFileResult>();
			const uploadFile = vi.fn(async () => uploaded.promise);
			const { result } = await renderCore([], {
				processFile: () => converted.promise,
				uploadFile,
			});

			let waitResult: unknown = null;
			await act(async () => {
				void result.current.handlers.handleAdd(jpeg("a.jpg"));
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});
				converted.resolve(webp("a.webp"));
				await flush();
				// 変換は解決したが転送はまだ
				expect(waitResult).toBeNull();

				uploaded.resolve({ uploadRef: url("a.webp") });
				await waiting;
			});

			expect(waitResult).toMatchObject({
				ok: true,
				images: [{ uploadRef: url("a.webp") }],
			});
		});

		it("uploadFile 未設定の構成でも変換を待つこと", async () => {
			const converted = createDeferred<File>();
			const { result } = await renderCore([], {
				processFile: () => converted.promise,
			});

			let waitResult: unknown = null;
			await act(async () => {
				void result.current.handlers.handleAdd(jpeg("a.jpg"));
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});
				await flush();
				expect(waitResult).toBeNull();

				converted.resolve(webp("a.webp"));
				await waiting;
			});

			expect(waitResult).toMatchObject({
				ok: true,
				images: [{ file: expect.any(File) }],
			});
		});

		it("待機中に始まった変換も待つこと", async () => {
			const conversions = [createDeferred<File>(), createDeferred<File>()];
			let conversionCall = 0;
			const processFile = vi.fn(() => conversions[conversionCall++].promise);
			const uploaded = [
				createDeferred<UploadFileResult>(),
				createDeferred<UploadFileResult>(),
			];
			let uploadCall = 0;
			const uploadFile = vi.fn(async () => uploaded[uploadCall++].promise);
			const { result } = await renderCore([], { processFile, uploadFile });

			let waitResult: unknown = null;
			await act(async () => {
				void result.current.handlers.handleAdd(jpeg("a.jpg"));
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});

				conversions[0].resolve(webp("a.webp"));
				await flush();
				// 1 件目の転送を待っている間に 2 件目の選択を始める
				void result.current.handlers.handleAdd(jpeg("b.jpg"));
				uploaded[0].resolve({ uploadRef: url("a.webp") });
				await flush();
				expect(waitResult).toBeNull();

				conversions[1].resolve(webp("b.webp"));
				await flush();
				uploaded[1].resolve({ uploadRef: url("b.webp") });
				await waiting;
			});

			expect(waitResult).toMatchObject({
				ok: true,
				images: [{ uploadRef: url("a.webp") }, { uploadRef: url("b.webp") }],
			});
		});

		it("削除した項目の変換は待たないこと", async () => {
			const conversions = [createDeferred<File>(), createDeferred<File>()];
			let call = 0;
			const processFile = vi.fn(() => conversions[call++].promise);
			const { result } = await renderCore([], { processFile });

			await act(async () => {
				const adding = result.current.handlers.handleAdd(jpeg("a.jpg"));
				conversions[0].resolve(webp("a.webp"));
				await adding;
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			let waitResult: unknown = null;
			await act(async () => {
				// 変換を保留したまま削除する。2 本目は解決させない
				void result.current.handlers.handleFileChange(tempId, jpeg("b.jpg"));
				await result.current.handlers.handleDelete(tempId);
				waitResult = await result.current.uploads.wait();
			});

			expect(waitResult).toMatchObject({ ok: true, images: [] });
			expect(result.current.raw.watchedImages).toHaveLength(0);
		});

		it("handler が reject しても wait() は reject しないこと", async () => {
			const converted = createDeferred<File>();
			const { result } = await renderCore([], {
				processFile: () => converted.promise,
				throwOnSetImages: true,
			});

			let waitResult: unknown = null;
			await act(async () => {
				// setImages が同期 throw する adapter では handler の promise が reject する
				void result.current.handlers.handleAdd(jpeg("a.jpg")).catch(() => {});
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});
				converted.resolve(webp("a.webp"));
				await waiting;
			});

			expect(waitResult).toMatchObject({ ok: true, images: [] });
		});

		it("選び直しの先着の変換は待たないこと", async () => {
			const conversions = [
				createDeferred<File>(),
				createDeferred<File>(),
				createDeferred<File>(),
			];
			let call = 0;
			const processFile = vi.fn(() => conversions[call++].promise);
			const { result } = await renderCore([], { processFile });

			await act(async () => {
				const adding = result.current.handlers.handleAdd(jpeg("a.jpg"));
				conversions[0].resolve(webp("a.webp"));
				await adding;
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			let waitResult: unknown = null;
			await act(async () => {
				// 先着 (b) は解決させないまま後着 (c) を選ぶ
				void result.current.handlers.handleFileChange(tempId, jpeg("b.jpg"));
				void result.current.handlers.handleFileChange(tempId, jpeg("c.jpg"));
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});
				conversions[2].resolve(webp("c.webp"));
				await waiting;
			});

			expect(waitResult).toMatchObject({ ok: true });
			expect(result.current.raw.watchedImages).toHaveLength(1);
		});

		it("待機を始めたあとに選び直しても、捨てた先着の変換は待たないこと", async () => {
			const conversions = [
				createDeferred<File>(),
				createDeferred<File>(),
				createDeferred<File>(),
			];
			let call = 0;
			const processFile = vi.fn(() => conversions[call++].promise);
			const { result } = await renderCore([], { processFile });

			await act(async () => {
				const adding = result.current.handlers.handleAdd(jpeg("a.jpg"));
				conversions[0].resolve(webp("a.webp"));
				await adding;
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			let waitResult: unknown = null;
			await act(async () => {
				// 選び直しより先に待機を始めるのがこのテストの要点
				void result.current.handlers.handleFileChange(tempId, jpeg("b.jpg"));
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});
				void result.current.handlers.handleFileChange(tempId, jpeg("c.jpg"));
				conversions[2].resolve(webp("c.webp"));
				await waiting;
			});

			expect(waitResult).toMatchObject({ ok: true });
			expect(result.current.raw.watchedImages[0].file?.name).toBe("c.webp");
		});

		it("待機中に削除したら、その項目の変換を待たないこと", async () => {
			const conversions = [createDeferred<File>(), createDeferred<File>()];
			let call = 0;
			const processFile = vi.fn(() => conversions[call++].promise);
			const { result } = await renderCore([], { processFile });

			await act(async () => {
				const adding = result.current.handlers.handleAdd(jpeg("a.jpg"));
				conversions[0].resolve(webp("a.webp"));
				await adding;
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			let waitResult: unknown = null;
			await act(async () => {
				void result.current.handlers.handleFileChange(tempId, jpeg("b.jpg"));
				const waiting = result.current.uploads.wait().then((r) => {
					waitResult = r;
				});
				// 2 本目は解決させない。削除で待機対象から外れる
				await result.current.handlers.handleDelete(tempId);
				await waiting;
			});

			expect(waitResult).toMatchObject({ ok: true, images: [] });
		});
	});

	describe("StrictMode", () => {
		it("settle しない転送を中断しても再 mount 側で再発行されること", async () => {
			// signal を無視して返らない実装。中断した転送が台帳の枠を占有し続けると、
			// 開発時 StrictMode で転送が二度と始まらない
			const uploadFile = vi.fn(() => new Promise<UploadFileResult>(() => {}));

			await renderCore([makeNewImage({ tempId: "temp_hang" })], {
				uploadFile,
				wrapper: StrictMode,
			});

			await vi.waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
		});

		it("effect の二重実行でも生き残る転送は 1 本で、完了まで到達すること", async () => {
			// cleanup で中断された転送は settle 時に台帳から落ち、再発行される。
			// 中断済みの 1 本が uploadFile に届くのは避けられないが、
			// 並走せず、書き戻しに至るのは 1 本だけであることを保証する
			const signals: (AbortSignal | undefined)[] = [];
			const uploadFile = vi.fn(
				async (_file: File, ctx?: { signal: AbortSignal }) => {
					signals.push(ctx?.signal);
					return { uploadRef: "https://s3.example.com/strict.jpg" };
				},
			);
			const orphan = makeNewImage({ tempId: "temp_strict" });

			const { result } = await renderCore([orphan], {
				uploadFile,
				wrapper: StrictMode,
			});

			await vi.waitFor(() =>
				expect(
					(result.current.raw.watchedImages[0] as ImageNew).uploadRef,
				).toBe("https://s3.example.com/strict.jpg"),
			);
			expect(signals.filter((s) => s?.aborted === false)).toHaveLength(1);
			expect(result.current.uploads.pending).toHaveLength(0);
			expect(result.current.uploads.failed).toHaveLength(0);
		});

		it("cleanup を跨いでも、その後に始めた差し替えは commit されること", async () => {
			// 現行の掃除が effect の cleanup にあるため、範囲を誤ると StrictMode でだけ
			// 差し替えが commit されなくなる
			const converted = createDeferred<File>();
			const { result } = await renderCore(
				[makeNewImage({ tempId: "temp_new" })],
				{ processFile: () => converted.promise, wrapper: StrictMode },
			);

			let changed = false;
			await act(async () => {
				const changing = result.current.handlers.handleFileChange(
					"temp_new",
					new File(["b"], "b.jpg", { type: "image/jpeg" }),
				);
				converted.resolve(new File(["b"], "b.webp", { type: "image/webp" }));
				changed = await changing;
			});

			expect(changed).toBe(true);
			expect(result.current.raw.watchedImages[0].file?.name).toBe("b.webp");
		});
	});

	describe("同期 throw する uploadFile", () => {
		it("failed に遷移し、項目は残ること", async () => {
			// async 関数ではないため catch へ同期到達する
			const uploadFile = vi.fn((): Promise<UploadFileResult> => {
				throw new Error("sync boom");
			});
			const onError = vi.fn();
			const { result } = await renderCore([], { uploadFile, onError });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});

			const tempId = result.current.raw.watchedImages[0].tempId;
			expect(result.current.uploads.failed).toEqual([tempId]);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "upload_file" }),
			);
		});

		it("retry で回復できること", async () => {
			let shouldThrow = true;
			const uploadFile = vi.fn((): Promise<UploadFileResult> => {
				if (shouldThrow) throw new Error("sync boom");
				return Promise.resolve({
					uploadRef: "https://s3.example.com/recovered.jpg",
				});
			});
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.handleAdd(
					new File(["a"], "a.jpg", { type: "image/jpeg" }),
				);
			});
			const tempId = result.current.raw.watchedImages[0].tempId;

			shouldThrow = false;
			let retried = false;
			await act(async () => {
				retried = await result.current.uploads.retry(tempId);
			});

			expect(retried).toBe(true);
			expect((result.current.raw.watchedImages[0] as ImageNew).uploadRef).toBe(
				"https://s3.example.com/recovered.jpg",
			);
		});
	});

	describe("未転送項目の self-heal", () => {
		it("mount 後に現れた uploadRef の無い new 項目も転送されること", async () => {
			// 初期値が非同期に投入される（reset / 下書き復元など）と、mount 時点では
			// 対象が存在しない
			const uploadFile = vi.fn(async () => ({
				uploadRef: "https://s3.example.com/late.jpg",
			}));
			const { result, ref } = await renderCore([], { uploadFile });
			expect(uploadFile).not.toHaveBeenCalled();

			await act(async () => {
				ref.adapter?.setImages([makeNewImage({ tempId: "temp_late" })]);
			});

			await vi.waitFor(() => expect(uploadFile).toHaveBeenCalledOnce());
			await vi.waitFor(() =>
				expect(
					(result.current.raw.watchedImages[0] as ImageNew).uploadRef,
				).toBe("https://s3.example.com/late.jpg"),
			);
		});

		it("失敗済みの項目は再レンダーのたびに自動再試行されないこと", async () => {
			const uploadFile = vi.fn(async () => {
				throw new Error("boom");
			});
			// 並べ替えで実際に setImages を起こすため 2 件で始める。単一項目への
			// handleMove は moved: false で setImages に到達せず、再レンダーが起きない
			const { result } = await renderCore(
				[
					makeNewImage({ tempId: "temp_f" }),
					makeExistingImage({ tempId: "temp_keep" }),
				],
				{ uploadFile },
			);

			await vi.waitFor(() =>
				expect(result.current.uploads.failed).toEqual(["temp_f"]),
			);

			// 無関係な操作で再レンダーさせても再試行しない（retry の責務）
			const orderBefore = result.current.raw.watchedImages.map((i) => i.tempId);
			await act(async () => {
				await result.current.handlers.handleMove("temp_keep", "up");
			});
			expect(result.current.raw.watchedImages.map((i) => i.tempId)).not.toEqual(
				orderBefore,
			);

			expect(uploadFile).toHaveBeenCalledOnce();
		});

		it("uploadRef の無い new 項目の転送が mount 時に再発行されること", async () => {
			const uploadFile = vi.fn(async () => ({
				uploadRef: "https://s3.example.com/healed.jpg",
			}));
			const orphan = makeNewImage({ tempId: "temp_orphan" });

			const { result } = await renderCore([orphan], { uploadFile });

			await vi.waitFor(() => expect(uploadFile).toHaveBeenCalledOnce());
			await vi.waitFor(() =>
				expect(
					(result.current.raw.watchedImages[0] as ImageNew).uploadRef,
				).toBe("https://s3.example.com/healed.jpg"),
			);
		});

		it("uploadFile が後から渡されたら未転送の項目を拾うこと", async () => {
			// undefined の間に追加された項目は startUpload が即 return する。
			// reconciliation の依存に uploadFile の有無を含める根拠
			const uploadFile = vi.fn(async () => ({
				uploadRef: "https://s3.example.com/late-uploadfile.jpg",
			}));
			const orphan = makeNewImage({ tempId: "temp_late" });
			const options: { uploadFile?: UploadFileFn } = {};
			const { result, rerender } = await renderCore([orphan], options);

			expect(uploadFile).not.toHaveBeenCalled();

			options.uploadFile = uploadFile;
			await act(async () => {
				await rerender();
			});

			await vi.waitFor(() => expect(uploadFile).toHaveBeenCalledOnce());
			await vi.waitFor(() =>
				expect(
					(result.current.raw.watchedImages[0] as ImageNew).uploadRef,
				).toBe("https://s3.example.com/late-uploadfile.jpg"),
			);
		});

		it("uploadRef を持つ new 項目は再発行されないこと", async () => {
			const uploadFile = vi.fn(async () => ({
				uploadRef: "https://s3.example.com/never.jpg",
			}));
			const done = makeNewImage({
				tempId: "temp_done",
				uploadRef: "https://s3.example.com/already.jpg",
			});

			await renderCore([done], { uploadFile });

			expect(uploadFile).not.toHaveBeenCalled();
		});
	});
});

// --- 型レベルの検証（tsc が担保。test runner では no-op） ---

describe("戻り型の分岐（tsc が検証）", () => {
	const withUpload = (adapter: ImageFieldAdapter, uploadFile: UploadFileFn) =>
		useMultiImageCore({ adapter, uploadFile });
	const withoutUpload = (adapter: ImageFieldAdapter) =>
		useMultiImageCore({ adapter });
	const maybeUpload = (
		adapter: ImageFieldAdapter,
		uploadFile: UploadFileFn | undefined,
	) => useMultiImageCore({ adapter, uploadFile });
	const explicitUndefined = (adapter: ImageFieldAdapter) =>
		useMultiImageCore({ adapter, uploadFile: undefined });

	it("uploadFile 設定時は uploadRef が確定した型を返すこと", () => {
		expectTypeOf<
			ReturnType<typeof withUpload>
		>().toEqualTypeOf<UseMultiImageCoreUploadedReturn>();
	});

	it("uploadFile 未設定時は緩い型を返すこと", () => {
		expectTypeOf<
			ReturnType<typeof withoutUpload>
		>().toEqualTypeOf<UseMultiImageCoreReturn>();
	});

	it("uploadFile が undefined を含みうる場合は緩い型を返すこと", () => {
		expectTypeOf<
			ReturnType<typeof maybeUpload>
		>().toEqualTypeOf<UseMultiImageCoreReturn>();
		expectTypeOf<
			ReturnType<typeof explicitUndefined>
		>().toEqualTypeOf<UseMultiImageCoreReturn>();
	});

	// wait が返すのは送信素材そのもの。uploadFile を設定した経路では
	// 新規項目が uploadRef を持つ形に確定し、確定しない経路では File を渡す形も混ざる
	type SettleOk<
		T extends UseMultiImageCoreReturn | UseMultiImageCoreUploadedReturn,
	> = Extract<Awaited<ReturnType<T["uploads"]["wait"]>>, { ok: true }>;

	it("uploadFile 設定時は id か uploadRef の 2 択になること", () => {
		expectTypeOf<
			SettleOk<UseMultiImageCoreUploadedReturn>["images"][number]
		>().toEqualTypeOf<UploadedSubmitImage>();
	});

	it("uploadFile が確定しない経路では File を渡す形も含むこと", () => {
		expectTypeOf<
			SettleOk<UseMultiImageCoreReturn>["images"][number]
		>().toEqualTypeOf<SubmitImage>();
	});

	it("削除対象は配列から外れ deletedIds に出ること", () => {
		expectTypeOf<
			SettleOk<UseMultiImageCoreUploadedReturn>["deletedIds"]
		>().toEqualTypeOf<string[]>();
	});
});
