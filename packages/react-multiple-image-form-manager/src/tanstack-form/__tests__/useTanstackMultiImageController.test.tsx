import { useForm } from "@tanstack/react-form";
import type { ReactNode } from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { z } from "zod";
import type {
	Image,
	ImageExisting,
	ImageNew,
	UploadFileFn,
} from "../../core/types/Image";
import type { CoreMessages } from "../../core/types/ImageSchemaTypes";
import { ImageFormStatus } from "../../core/types/ImageStatus";
import type { MultiImageError } from "../../core/types/MultiImageError";
import type { UploadsApi } from "../../core/useMultiImageCore";
import { createImagesSchema } from "../../schemas/zod";
import { TanstackMultiImageController } from "../TanstackMultiImageController";

// --- Test helpers ---
const makeFile = (name = "a.jpg") =>
	new File(["data"], name, { type: "image/jpeg" });

const makeNewImage = (overrides?: Partial<ImageNew>): ImageNew => ({
	tempId: `temp_new-${crypto.randomUUID().slice(0, 8)}`,
	status: ImageFormStatus.New,
	id: undefined,
	file: new File(["data"], "test.jpg", { type: "image/jpeg" }),
	uploadRef: undefined,
	...overrides,
});

const makeExistingImage = (tempId: string, id: string): ImageExisting => ({
	tempId,
	status: ImageFormStatus.Existing,
	id,
	file: undefined,
	previewUrl: "https://s3.example.com/img.jpg",
	uploadedUrl: "https://s3.example.com/img.jpg",
});

type TestForm = { images: Image[] };

type Handle = {
	items: Array<{ image: Image; errors: unknown }>;
	rootErrors: Array<unknown>;
	handleAdd: (file: File) => Promise<boolean>;
	handleFileChange: (tempId: string, file: File) => Promise<boolean>;
	handleDelete: (tempId: string) => Promise<boolean>;
	handleMove: (tempId: string, direction: "up" | "down") => Promise<boolean>;
	raw: { watchedImages: readonly Image[] };
};

function HarnessHost(props: {
	initialImages?: Image[];
	withSchema?: boolean;
	maxImages?: number;
	coreMaxImages?: number;
	onError?: (error: MultiImageError) => void;
	messages?: CoreMessages;
	handleRef: { current: Handle | null };
}): ReactNode {
	const form = useForm({
		defaultValues: {
			images: props.initialImages ?? [],
		} as TestForm,
		validators: props.withSchema
			? {
					onChange: z.object({
						images: createImagesSchema({
							acceptedTypes: ["image/jpeg"],
							maxImages: props.maxImages,
						}),
					}),
				}
			: undefined,
	});

	return (
		<TanstackMultiImageController
			form={form}
			name="images"
			constraints={
				props.coreMaxImages !== undefined
					? { maxImages: props.coreMaxImages }
					: undefined
			}
			onError={props.onError}
			messages={props.messages}
			render={(p) => {
				props.handleRef.current = {
					items: p.items,
					rootErrors: p.rootErrors,
					handleAdd: p.handleAdd,
					handleFileChange: p.handleFileChange,
					handleDelete: p.handleDelete,
					handleMove: p.handleMove,
					raw: p.raw,
				};
				return <div data-testid="harness">items:{p.items.length}</div>;
			}}
		/>
	);
}

describe("TanstackMultiImageController (integration)", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("handleAdd: adds a new image", async () => {
		const handleRef: { current: Handle | null } = { current: null };

		await render(<HarnessHost handleRef={handleRef} />);

		expect(handleRef.current?.items).toHaveLength(0);

		await act(async () => {
			await handleRef.current?.handleAdd(makeFile("a.jpg"));
		});

		expect(handleRef.current?.items).toHaveLength(1);
		expect(handleRef.current?.items[0]?.image.status).toBe(ImageFormStatus.New);
	});

	it("handleDelete: marks an existing image as ToBeDeleted", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(
			<HarnessHost
				initialImages={[
					makeExistingImage("temp_a", "id-a"),
					makeExistingImage("temp_b", "id-b"),
				]}
				handleRef={handleRef}
			/>,
		);
		expect(handleRef.current?.items).toHaveLength(2);
		await act(async () => {
			await handleRef.current?.handleDelete("temp_a");
		});
		// items filters out ToBeDeleted, so only 1 visible
		expect(handleRef.current?.items).toHaveLength(1);
		// raw still has both (existing + tobedeleted)
		const raw = handleRef.current?.raw.watchedImages ?? [];
		expect(raw).toHaveLength(2);
		const statuses = raw.map((i) => i.status);
		expect(statuses).toContain(ImageFormStatus.ToBeDeleted);
	});

	it("handleDelete: removes a new image from array entirely", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		const newImg = makeNewImage({ tempId: "temp_n" });
		await render(
			<HarnessHost initialImages={[newImg]} handleRef={handleRef} />,
		);
		expect(handleRef.current?.items).toHaveLength(1);
		await act(async () => {
			await handleRef.current?.handleDelete("temp_n");
		});
		expect(handleRef.current?.items).toHaveLength(0);
		expect(handleRef.current?.raw.watchedImages).toHaveLength(0);
	});

	it("handleMove: swaps adjacent items (down)", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(<HarnessHost handleRef={handleRef} />);
		await act(async () => {
			await handleRef.current?.handleAdd(makeFile("a.jpg"));
			await handleRef.current?.handleAdd(makeFile("b.jpg"));
		});
		const firstTempId = handleRef.current?.raw.watchedImages[0]?.tempId ?? "";
		await act(async () => {
			await handleRef.current?.handleMove(firstTempId, "down");
		});
		expect(handleRef.current?.raw.watchedImages[1]?.tempId).toBe(firstTempId);
	});

	it("handleMove: swaps adjacent items (up)", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(<HarnessHost handleRef={handleRef} />);
		await act(async () => {
			await handleRef.current?.handleAdd(makeFile("a.jpg"));
			await handleRef.current?.handleAdd(makeFile("b.jpg"));
		});
		const secondTempId = handleRef.current?.raw.watchedImages[1]?.tempId ?? "";
		await act(async () => {
			await handleRef.current?.handleMove(secondTempId, "up");
		});
		expect(handleRef.current?.raw.watchedImages[0]?.tempId).toBe(secondTempId);
	});

	it("handleFileChange: replaces existing image file (creates New + ToBeDeleted pair)", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(
			<HarnessHost
				initialImages={[makeExistingImage("temp_a", "id-a")]}
				handleRef={handleRef}
			/>,
		);
		await act(async () => {
			await handleRef.current?.handleFileChange("temp_a", makeFile("new.jpg"));
		});
		const imgs = handleRef.current?.raw.watchedImages ?? [];
		expect(imgs.map((i) => i.status)).toEqual([
			ImageFormStatus.New,
			ImageFormStatus.ToBeDeleted,
		]);
		// The ToBeDeleted one keeps the original tempId
		expect(imgs[1].tempId).toBe("temp_a");
	});

	it("handleFileChange: replaces a new image file in-place", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(<HarnessHost handleRef={handleRef} />);
		await act(async () => {
			await handleRef.current?.handleAdd(makeFile("a.jpg"));
		});
		const tempId = handleRef.current?.raw.watchedImages[0]?.tempId ?? "";
		await act(async () => {
			await handleRef.current?.handleFileChange(tempId, makeFile("b.jpg"));
		});
		const imgs = handleRef.current?.raw.watchedImages ?? [];
		expect(imgs).toHaveLength(1);
		expect(imgs[0].status).toBe(ImageFormStatus.New);
		expect(imgs[0].tempId).toBe(tempId);
	});

	it("constraints.maxImages: rejects add when limit reached", async () => {
		const onError = vi.fn();
		const handleRef: { current: Handle | null } = { current: null };
		await render(
			<HarnessHost
				coreMaxImages={1}
				initialImages={[makeNewImage()]}
				onError={onError}
				handleRef={handleRef}
			/>,
		);
		let ok = true;
		await act(async () => {
			ok = (await handleRef.current?.handleAdd(makeFile("b.jpg"))) ?? true;
		});
		expect(ok).toBe(false);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ type: "max_images" }),
		);
	});

	it("messages.maxImages custom message propagates through onError", async () => {
		const onError = vi.fn();
		const handleRef: { current: Handle | null } = { current: null };

		await render(
			<HarnessHost
				coreMaxImages={1}
				initialImages={[makeNewImage()]}
				onError={onError}
				messages={{
					maxImages: (max: number) => `Up to ${max} images allowed (custom)`,
				}}
				handleRef={handleRef}
			/>,
		);

		await act(async () => {
			await handleRef.current?.handleAdd(makeFile("b.jpg"));
		});

		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "max_images",
				message: "Up to 1 images allowed (custom)",
			}),
		);
	});

	it("Standard Schema: invalid file type triggers per-item errors reactively", async () => {
		const handleRef: { current: Handle | null } = { current: null };

		await render(<HarnessHost withSchema handleRef={handleRef} />);

		await act(async () => {
			// image/png is not in acceptedTypes → schema rejects
			await handleRef.current?.handleAdd(
				new File(["v"], "bad.png", { type: "image/png" }),
			);
		});

		const item = handleRef.current?.items[0];
		expect(item).toBeDefined();
		expect(item?.errors).toBeDefined();
		expect(
			(item?.errors as Record<string, unknown> | undefined)?.file,
		).toBeDefined();
	});

	it("Standard Schema: maxImages exceeded → rootErrors populated", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(
			<HarnessHost
				withSchema
				maxImages={1}
				initialImages={[makeNewImage()]}
				handleRef={handleRef}
			/>,
		);
		let ok = false;
		await act(async () => {
			ok =
				(await handleRef.current?.handleAdd(makeFile("second.jpg"))) ?? false;
		});
		expect(ok).toBe(true);
		const rootErrors = handleRef.current?.rootErrors ?? [];
		expect(rootErrors.length).toBeGreaterThan(0);
		const messages = rootErrors.map((e) => (e as { message?: string }).message);
		expect(messages.some((m) => typeof m === "string" && m.length > 0)).toBe(
			true,
		);
	});
});

describe("TanstackMultiImageController (external reset parity)", () => {
	it("form.reset() propagates and subsequent operations work on reset values", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		// biome-ignore lint/suspicious/noExplicitAny: accessing form internals for reset
		const formRef: { current: any } = { current: null };

		function ResetHarness() {
			const form = useForm({
				defaultValues: { images: [] } as TestForm,
			});
			formRef.current = form;

			return (
				<TanstackMultiImageController
					form={form}
					name="images"
					render={(p) => {
						handleRef.current = {
							items: p.items,
							rootErrors: p.rootErrors,
							handleAdd: p.handleAdd,
							handleFileChange: p.handleFileChange,
							handleDelete: p.handleDelete,
							handleMove: p.handleMove,
							raw: p.raw,
						};
						return <div data-testid="harness">items:{p.items.length}</div>;
					}}
				/>
			);
		}

		await render(<ResetHarness />);

		await act(async () => {
			await handleRef.current?.handleAdd(makeFile("a.jpg"));
		});
		expect(handleRef.current?.raw.watchedImages).toHaveLength(1);

		await act(async () => {
			formRef.current.reset({
				images: [
					makeExistingImage("temp_reset_a", "id-reset-a"),
					makeExistingImage("temp_reset_b", "id-reset-b"),
				],
			});
		});

		expect(handleRef.current?.raw.watchedImages).toHaveLength(2);

		await act(async () => {
			await handleRef.current?.handleDelete("temp_reset_a");
		});

		const imgs = handleRef.current?.raw.watchedImages ?? [];
		expect(imgs).toHaveLength(2);
		expect(imgs.map((i) => i.status)).toEqual([
			ImageFormStatus.ToBeDeleted,
			ImageFormStatus.Existing,
		]);
	});
});

describe("TanstackMultiImageController (stale snapshot race parity)", () => {
	function createDeferredProcessFile() {
		const resolvers: Array<() => void> = [];
		const processFile = vi.fn(
			(file: File) =>
				new Promise<File>((resolve) => {
					resolvers.push(() => resolve(file));
				}),
		);
		const resolveAll = () => {
			for (const resolve of resolvers) resolve();
			resolvers.length = 0;
		};
		return { processFile, resolveAll };
	}

	function RaceHarness(props: {
		initialImages?: Image[];
		coreMaxImages?: number;
		processFile?: (file: File) => Promise<File>;
		onError?: (error: MultiImageError) => void;
		handleRef: { current: Handle | null };
	}) {
		const form = useForm({
			defaultValues: { images: props.initialImages ?? [] } as TestForm,
		});

		return (
			<TanstackMultiImageController
				form={form}
				name="images"
				constraints={
					props.coreMaxImages !== undefined
						? { maxImages: props.coreMaxImages }
						: undefined
				}
				processFile={props.processFile}
				onError={props.onError}
				render={(p) => {
					props.handleRef.current = {
						items: p.items,
						rootErrors: p.rootErrors,
						handleAdd: p.handleAdd,
						handleFileChange: p.handleFileChange,
						handleDelete: p.handleDelete,
						handleMove: p.handleMove,
						raw: p.raw,
					};
					return <div>items:{p.items.length}</div>;
				}}
			/>
		);
	}

	it("handleAdd: processFile 中の並行 add で maxImages を突破しない", async () => {
		const onError = vi.fn();
		const { processFile, resolveAll } = createDeferredProcessFile();
		const handleRef: { current: Handle | null } = { current: null };

		await render(
			<RaceHarness
				coreMaxImages={1}
				processFile={processFile}
				onError={onError}
				handleRef={handleRef}
			/>,
		);

		let first!: Promise<boolean>;
		let second!: Promise<boolean>;
		await act(async () => {
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			first = handleRef.current!.handleAdd(makeFile("a.jpg"));
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			second = handleRef.current!.handleAdd(makeFile("b.jpg"));
			resolveAll();
		});

		expect(await first).toBe(true);
		expect(await second).toBe(false);
		expect(handleRef.current?.raw.watchedImages).toHaveLength(1);
	});

	it("handleAdd: processFile を保留させた並行 add で 2 件とも残る", async () => {
		const { processFile, resolveAll } = createDeferredProcessFile();
		const handleRef: { current: Handle | null } = { current: null };

		await render(
			<RaceHarness processFile={processFile} handleRef={handleRef} />,
		);

		let first!: Promise<boolean>;
		let second!: Promise<boolean>;
		await act(async () => {
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			first = handleRef.current!.handleAdd(makeFile("a.jpg"));
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			second = handleRef.current!.handleAdd(makeFile("b.jpg"));
			resolveAll();
		});

		expect(await first).toBe(true);
		expect(await second).toBe(true);
		const images = handleRef.current?.raw.watchedImages ?? [];
		expect(images).toHaveLength(2);
		expect(images.map((i) => i.file?.name)).toEqual(["a.jpg", "b.jpg"]);
	});

	it("handleFileChange: processFile 中に別項目を削除しても対象を tempId で再解決する", async () => {
		const { processFile, resolveAll } = createDeferredProcessFile();
		const handleRef: { current: Handle | null } = { current: null };

		await render(
			<RaceHarness processFile={processFile} handleRef={handleRef} />,
		);

		await act(async () => {
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			const add1 = handleRef.current!.handleAdd(makeFile("a.jpg"));
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			const add2 = handleRef.current!.handleAdd(makeFile("b.jpg"));
			resolveAll();
			await Promise.all([add1, add2]);
		});

		const [a, b] = (handleRef.current?.raw.watchedImages ?? []).map(
			(i) => i.tempId,
		);

		let changeResult!: Promise<boolean>;
		await act(async () => {
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			changeResult = handleRef.current!.handleFileChange(
				b,
				makeFile("replaced.jpg"),
			);
			await handleRef.current?.handleDelete(a);
			resolveAll();
		});

		expect(await changeResult).toBe(true);
		const imgs = handleRef.current?.raw.watchedImages ?? [];
		expect(imgs).toHaveLength(1);
		expect(imgs[0].tempId).toBe(b);
	});

	it("handleFileChange: 続けて選び直したら後着のファイルが残る", async () => {
		const { processFile, resolveAll } = createDeferredProcessFile();
		const handleRef: { current: Handle | null } = { current: null };

		await render(
			<RaceHarness processFile={processFile} handleRef={handleRef} />,
		);

		await act(async () => {
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			const add = handleRef.current!.handleAdd(makeFile("a.jpg"));
			resolveAll();
			await add;
		});
		const a = handleRef.current?.raw.watchedImages[0].tempId ?? "";

		let first!: Promise<boolean>;
		let second!: Promise<boolean>;
		await act(async () => {
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			first = handleRef.current!.handleFileChange(a, makeFile("file1.jpg"));
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			second = handleRef.current!.handleFileChange(a, makeFile("file2.jpg"));
			// resolveAll は登録順に解決するので、先着が先に解決する
			resolveAll();
		});

		expect(await first).toBe(false);
		expect(await second).toBe(true);
		const imgs = handleRef.current?.raw.watchedImages ?? [];
		expect(imgs).toHaveLength(1);
		expect(imgs[0].file?.name).toBe("file2.jpg");
	});

	it("handleFileChange: processFile 中に New の対象自身を削除したら復活しない", async () => {
		const { processFile, resolveAll } = createDeferredProcessFile();
		const handleRef: { current: Handle | null } = { current: null };

		await render(
			<RaceHarness processFile={processFile} handleRef={handleRef} />,
		);

		await act(async () => {
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			const add = handleRef.current!.handleAdd(makeFile("a.jpg"));
			resolveAll();
			await add;
		});
		const a = handleRef.current?.raw.watchedImages[0].tempId ?? "";

		let changeResult!: Promise<boolean>;
		await act(async () => {
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			changeResult = handleRef.current!.handleFileChange(
				a,
				makeFile("replaced.jpg"),
			);
			await handleRef.current?.handleDelete(a);
			resolveAll();
		});

		expect(await changeResult).toBe(false);
		expect(handleRef.current?.raw.watchedImages).toHaveLength(0);
	});

	it("handleFileChange: processFile 中に Existing の対象自身を削除したら onError なしで ToBeDeleted のまま", async () => {
		const onError = vi.fn();
		const { processFile, resolveAll } = createDeferredProcessFile();
		const handleRef: { current: Handle | null } = { current: null };

		await render(
			<RaceHarness
				initialImages={[makeExistingImage("temp_a", "id-a")]}
				processFile={processFile}
				onError={onError}
				handleRef={handleRef}
			/>,
		);

		let changeResult!: Promise<boolean>;
		await act(async () => {
			// biome-ignore lint/style/noNonNullAssertion: render completed above; handleRef.current is guaranteed non-null
			changeResult = handleRef.current!.handleFileChange(
				"temp_a",
				makeFile("replaced.jpg"),
			);
			await handleRef.current?.handleDelete("temp_a");
			resolveAll();
		});

		expect(await changeResult).toBe(false);
		const imgs = handleRef.current?.raw.watchedImages ?? [];
		expect(imgs).toHaveLength(1);
		expect(imgs[0]).toMatchObject({
			tempId: "temp_a",
			status: ImageFormStatus.ToBeDeleted,
		});
		expect(onError).not.toHaveBeenCalled();
	});
});

describe("TanstackMultiImageController (unsupported status parity)", () => {
	it("handleFileChange on ToBeDeleted status: notifies via onError", async () => {
		const onError = vi.fn();
		const handleRef: { current: Handle | null } = { current: null };
		await render(
			<HarnessHost
				onError={onError}
				initialImages={[makeExistingImage("temp_a", "id-a")]}
				handleRef={handleRef}
			/>,
		);

		await act(async () => {
			await handleRef.current?.handleDelete("temp_a");
		});
		await act(async () => {
			await handleRef.current?.handleFileChange("temp_a", makeFile("x.jpg"));
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

describe("TanstackMultiImageController (uploads.wait と走行中の handler 操作)", () => {
	type WaitHandle = {
		handleAdd: (file: File) => Promise<boolean>;
		uploads: UploadsApi;
	};

	function WaitHarness(props: {
		processFile: (file: File) => Promise<File>;
		uploadFile?: UploadFileFn;
		handleRef: { current: WaitHandle | null };
	}) {
		const form = useForm({ defaultValues: { images: [] } as TestForm });

		return (
			<TanstackMultiImageController
				form={form}
				name="images"
				processFile={props.processFile}
				uploadFile={props.uploadFile}
				render={(p) => {
					props.handleRef.current = {
						handleAdd: p.handleAdd,
						uploads: p.uploads,
					};
					return <div>items:{p.items.length}</div>;
				}}
			/>
		);
	}

	function createDeferred<T>() {
		let resolve!: (value: T) => void;
		const promise = new Promise<T>((r) => {
			resolve = r;
		});
		return { promise, resolve };
	}
	/** 保留中の promise がまだ settle していないことを見るための待ち */
	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
	const webp = () => new File(["a"], "a.webp", { type: "image/webp" });
	const uploadRef = "https://s3.example.com/a.webp";

	const readHandle = (ref: { current: WaitHandle | null }): WaitHandle => {
		if (ref.current === null) throw new Error("harness is not rendered");
		return ref.current;
	};

	it("変換の解決前に settle せず、解決後に当該画像を含む ok を返すこと", async () => {
		const converted = createDeferred<File>();
		const handleRef: { current: WaitHandle | null } = { current: null };

		await render(
			<WaitHarness
				processFile={() => converted.promise}
				uploadFile={async () => ({ uploadRef })}
				handleRef={handleRef}
			/>,
		);

		let waitResult: unknown = null;
		await act(async () => {
			// 変換中に保存を押す状況。handleAdd は await しない
			void readHandle(handleRef).handleAdd(makeFile("a.jpg"));
			const waiting = readHandle(handleRef)
				.uploads.wait()
				.then((r) => {
					waitResult = r;
				});
			await flush();
			expect(waitResult).toBeNull();

			converted.resolve(webp());
			await waiting;
		});

		expect(waitResult).toMatchObject({ ok: true, images: [{ uploadRef }] });
	});

	it("uploadFile 未設定の構成でも変換を待つこと", async () => {
		const converted = createDeferred<File>();
		const handleRef: { current: WaitHandle | null } = { current: null };

		await render(
			<WaitHarness
				processFile={() => converted.promise}
				handleRef={handleRef}
			/>,
		);

		let waitResult: unknown = null;
		await act(async () => {
			void readHandle(handleRef).handleAdd(makeFile("a.jpg"));
			const waiting = readHandle(handleRef)
				.uploads.wait()
				.then((r) => {
					waitResult = r;
				});
			await flush();
			expect(waitResult).toBeNull();

			converted.resolve(webp());
			await waiting;
		});

		expect(waitResult).toMatchObject({
			ok: true,
			images: [{ file: expect.any(File) }],
		});
	});
});
