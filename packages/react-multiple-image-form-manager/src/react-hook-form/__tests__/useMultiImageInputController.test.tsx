import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { act } from "react";
import type { Resolver } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { z } from "zod";
import type { Image } from "../../core/types/Image";
import { ImageFormStatus } from "../../core/types/ImageStatus";
import { createImagesSchema } from "../../schemas/zod";
import { makeExisting, makeFile, useHarness } from "./harness";

describe("useMultiImageInputController (constraints)", () => {
	it("constraints.maxImages=1 → 2nd add is rejected with onError(max_images)", async () => {
		const onError = vi.fn();
		const { result } = await renderHook(() =>
			useHarness({
				constraints: { acceptedTypes: ["image/jpeg"], maxImages: 1 },
				onError,
			}),
		);
		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("a.jpg"));
		});
		expect(result.current.controller.raw.watchedImages).toHaveLength(1);

		let addResult: boolean | undefined;
		await act(async () => {
			addResult = await result.current.controller.handlers.handleAdd(
				makeFile("b.jpg"),
			);
		});
		expect(addResult).toBe(false);
		expect(result.current.controller.raw.watchedImages).toHaveLength(1);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ type: "max_images" }),
		);
	});
});

describe("useMultiImageInputController (async race)", () => {
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

	it("handleAdd: processFile 中の並行 add で maxImages を突破しない", async () => {
		const onError = vi.fn();
		const { processFile, resolveAll } = createDeferredProcessFile();
		const { result } = await renderHook(() =>
			useHarness({
				constraints: { acceptedTypes: ["image/jpeg"], maxImages: 1 },
				onError,
				processFile,
			}),
		);

		let first!: Promise<boolean>;
		let second!: Promise<boolean>;
		await act(async () => {
			first = result.current.controller.handlers.handleAdd(makeFile("a.jpg"));
			second = result.current.controller.handlers.handleAdd(makeFile("b.jpg"));
			resolveAll();
		});

		expect(await first).toBe(true);
		expect(await second).toBe(false);
		expect(result.current.controller.raw.watchedImages).toHaveLength(1);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ type: "max_images" }),
		);
	});

	it("handleFileChange: processFile 中に別項目が削除されても対象を tempId で再解決する", async () => {
		const { processFile, resolveAll } = createDeferredProcessFile();
		const { result } = await renderHook(() => useHarness({ processFile }));

		await act(async () => {
			const add1 = result.current.controller.handlers.handleAdd(
				makeFile("a.jpg"),
			);
			const add2 = result.current.controller.handlers.handleAdd(
				makeFile("b.jpg"),
			);
			resolveAll();
			await Promise.all([add1, add2]);
		});
		const [a, b] = result.current.controller.raw.watchedImages.map(
			(i) => i.tempId,
		);

		let changeResult!: Promise<boolean>;
		await act(async () => {
			changeResult = result.current.controller.handlers.handleFileChange(
				b,
				makeFile("replaced.jpg"),
			);
			await result.current.controller.handlers.handleDelete(a);
			resolveAll();
		});

		expect(await changeResult).toBe(true);
		const imgs = result.current.controller.raw.watchedImages;
		expect(imgs).toHaveLength(1);
		expect(imgs[0].tempId).toBe(b);
		expect(imgs[0].file?.name).toBe("replaced.jpg");
	});

	it("handleFileChange: processFile 中に対象自身が削除されたら false を返し何もしない", async () => {
		const { processFile, resolveAll } = createDeferredProcessFile();
		const { result } = await renderHook(() => useHarness({ processFile }));

		await act(async () => {
			const add = result.current.controller.handlers.handleAdd(
				makeFile("a.jpg"),
			);
			resolveAll();
			await add;
		});
		const a = result.current.controller.raw.watchedImages[0].tempId;

		let changeResult!: Promise<boolean>;
		await act(async () => {
			changeResult = result.current.controller.handlers.handleFileChange(
				a,
				makeFile("replaced.jpg"),
			);
			await result.current.controller.handlers.handleDelete(a);
			resolveAll();
		});

		expect(await changeResult).toBe(false);
		expect(result.current.controller.raw.watchedImages).toHaveLength(0);
	});

	it("handleFileChange: processFile 中に対象の Existing が削除されたら onError なしで false を返す", async () => {
		const onError = vi.fn();
		const { processFile, resolveAll } = createDeferredProcessFile();
		const { result } = await renderHook(() =>
			useHarness({
				onError,
				processFile,
				defaultImages: [makeExisting("temp_a", "id-a")],
			}),
		);

		let changeResult!: Promise<boolean>;
		await act(async () => {
			changeResult = result.current.controller.handlers.handleFileChange(
				"temp_a",
				makeFile("replaced.jpg"),
			);
			await result.current.controller.handlers.handleDelete("temp_a");
			resolveAll();
		});

		expect(await changeResult).toBe(false);
		expect(onError).not.toHaveBeenCalled();
		const imgs = result.current.controller.raw.watchedImages;
		expect(imgs.map((i) => i.status)).toEqual(["tobedeleted"]);
	});
});

describe("useMultiImageInputController (characterization)", () => {
	it("handleAdd: New が末尾に追加される", async () => {
		const { result } = await renderHook(() => useHarness());
		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile());
		});
		const imgs = result.current.controller.raw.watchedImages;
		expect(imgs.map((i) => i.status)).toEqual(["new"]);
	});

	it("handleAdd: ToBeDeleted があっても末尾に追加される", async () => {
		const { result } = await renderHook(() =>
			useHarness({ defaultImages: [makeExisting("temp_a", "id-a")] }),
		);
		await act(async () => {
			await result.current.controller.handlers.handleDelete("temp_a");
		});
		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("b.jpg"));
		});
		const statuses = result.current.controller.raw.watchedImages.map(
			(i) => i.status,
		);
		expect(statuses).toEqual(["tobedeleted", "new"]);
	});

	it("handleFileChange(Existing): 元位置に New を挿入し、旧項目を末尾に追加", async () => {
		const { result } = await renderHook(() =>
			useHarness({ defaultImages: [makeExisting("temp_a", "id-a")] }),
		);
		await act(async () => {
			await result.current.controller.handlers.handleFileChange(
				"temp_a",
				makeFile("new.jpg"),
			);
		});
		const imgs = result.current.controller.raw.watchedImages;
		expect(imgs.map((i) => i.status)).toEqual(["new", "tobedeleted"]);
		expect(imgs[1].tempId).toBe("temp_a");
	});

	it("handleFileChange(Existing): 複数要素の中間位置で replace が正しく動作する", async () => {
		const { result } = await renderHook(() =>
			useHarness({
				defaultImages: [
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
					makeExisting("temp_c", "id-c"),
				],
			}),
		);
		await act(async () => {
			await result.current.controller.handlers.handleFileChange(
				"temp_b",
				makeFile("replaced.jpg"),
			);
		});
		const imgs = result.current.controller.raw.watchedImages;
		expect(imgs.map((i) => i.status)).toEqual([
			"existing",
			"new",
			"existing",
			"tobedeleted",
		]);
		expect(imgs[3].tempId).toBe("temp_b");
		expect(imgs[3].id).toBe("id-b");
	});

	it("handleFileChange(New): file を差し替え、配列長は不変", async () => {
		const { result } = await renderHook(() => useHarness());
		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("a.jpg"));
		});
		const tempId = result.current.controller.raw.watchedImages[0].tempId;
		await act(async () => {
			await result.current.controller.handlers.handleFileChange(
				tempId,
				makeFile("b.jpg"),
			);
		});
		const imgs = result.current.controller.raw.watchedImages;
		expect(imgs).toHaveLength(1);
		expect(imgs[0].status).toBe("new");
		expect(imgs[0].tempId).toBe(tempId);
	});

	it("handleDelete(Existing): in-place で ToBeDeleted 化する", async () => {
		const { result } = await renderHook(() =>
			useHarness({
				defaultImages: [
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				],
			}),
		);
		await act(async () => {
			await result.current.controller.handlers.handleDelete("temp_a");
		});
		const imgs = result.current.controller.raw.watchedImages;
		expect(imgs.map((i) => i.status)).toEqual(["tobedeleted", "existing"]);
		expect(result.current.controller.itemsWithErrors).toHaveLength(1);
	});

	it("handleMove(tempId, 'down'): 対象を可視順で1つ後ろへ", async () => {
		const { result } = await renderHook(() => useHarness());
		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("a.jpg"));
			await result.current.controller.handlers.handleAdd(makeFile("b.jpg"));
		});
		const a = result.current.controller.raw.watchedImages[0].tempId;
		await act(async () => {
			await result.current.controller.handlers.handleMove(a, "down");
		});
		expect(result.current.controller.raw.watchedImages[1].tempId).toBe(a);
	});

	it("handleMove(tempId, 'up'): 対象を可視順で1つ前へ", async () => {
		const { result } = await renderHook(() => useHarness());
		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("a.jpg"));
			await result.current.controller.handlers.handleAdd(makeFile("b.jpg"));
		});
		const b = result.current.controller.raw.watchedImages[1].tempId;
		await act(async () => {
			await result.current.controller.handlers.handleMove(b, "up");
		});
		expect(result.current.controller.raw.watchedImages[0].tempId).toBe(b);
	});

	it("handleMove: 先頭の up は何もしない", async () => {
		const { result } = await renderHook(() => useHarness());
		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("a.jpg"));
			await result.current.controller.handlers.handleAdd(makeFile("b.jpg"));
		});
		const a = result.current.controller.raw.watchedImages[0].tempId;
		await act(async () => {
			await result.current.controller.handlers.handleMove(a, "up");
		});
		expect(result.current.controller.raw.watchedImages[0].tempId).toBe(a);
	});

	it("handleMove: 末尾可視の down は何もしない", async () => {
		const { result } = await renderHook(() => useHarness());
		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("a.jpg"));
			await result.current.controller.handlers.handleAdd(makeFile("b.jpg"));
		});
		const b = result.current.controller.raw.watchedImages[1].tempId;
		await act(async () => {
			await result.current.controller.handlers.handleMove(b, "down");
		});
		expect(result.current.controller.raw.watchedImages[1].tempId).toBe(b);
	});

	it("handleMove: ToBeDeleted をスキップして可視アイテム間でのみ動く", async () => {
		const { result } = await renderHook(() =>
			useHarness({
				defaultImages: [
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				],
			}),
		);
		await act(async () => {
			await result.current.controller.handlers.handleDelete("temp_b");
		});
		await act(async () => {
			await result.current.controller.handlers.handleMove("temp_a", "down");
		});
		const statuses = result.current.controller.raw.watchedImages.map(
			(i) => i.status,
		);
		expect(statuses).toEqual(["existing", "tobedeleted"]);
	});

	it("handleMove: ToBeDeleted 項目自体の移動は no-op", async () => {
		const { result } = await renderHook(() =>
			useHarness({
				defaultImages: [
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				],
			}),
		);
		await act(async () => {
			await result.current.controller.handlers.handleDelete("temp_b");
		});
		await act(async () => {
			await result.current.controller.handlers.handleMove("temp_b", "up");
		});
		const statuses = result.current.controller.raw.watchedImages.map(
			(i) => i.status,
		);
		expect(statuses).toEqual(["existing", "tobedeleted"]);
	});
});

describe("useMultiImageInputController (onError / i18n)", () => {
	it("processFile failure: onError has type=process_file with message", async () => {
		const onError = vi.fn();
		const processFile = vi.fn(async () => {
			throw new Error("boom");
		});
		const { result } = await renderHook(() =>
			useHarness({ onError, processFile }),
		);
		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile());
		});
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "process_file",
				message: expect.any(String),
			}),
		);
	});

	it("maxImages exceeded: onError has type=max_images with message", async () => {
		const onError = vi.fn();
		const { result } = await renderHook(() =>
			useHarness({
				onError,
				constraints: { acceptedTypes: ["image/jpeg"], maxImages: 0 },
			}),
		);
		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile());
		});
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "max_images",
				message: expect.any(String),
			}),
		);
	});

	it("handleFileChange on unsupported status: notifies via onError instead of console.warn", async () => {
		const warn = vi.spyOn(console, "warn");
		const onError = vi.fn();
		const { result } = await renderHook(() =>
			useHarness({
				onError,
				defaultImages: [makeExisting("temp_a", "id-a")],
			}),
		);
		await act(async () => {
			await result.current.controller.handlers.handleDelete("temp_a");
		});
		await act(async () => {
			await result.current.controller.handlers.handleFileChange(
				"temp_a",
				makeFile("x.jpg"),
			);
		});
		expect(warn).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "unknown",
				cause: {
					reason: "unsupported_status",
					status: ImageFormStatus.ToBeDeleted,
				},
			}),
		);
		warn.mockRestore();
	});
});

function createCapturingResolver() {
	const captured: Image[][] = [];
	const resolver: Resolver<{ images: Image[] }> = async (values) => {
		captured.push([...values.images]);
		return { values, errors: {} };
	};
	return { resolver, captured };
}

describe("useMultiImageInputController (trigger validates current state)", () => {
	it("handleAdd: resolver receives the array WITH the new image", async () => {
		const { resolver, captured } = createCapturingResolver();
		const { result } = await renderHook(() => useHarness({ resolver }));

		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("a.jpg"));
		});

		const lastResolved = captured[captured.length - 1];
		expect(lastResolved).toHaveLength(1);
		expect(lastResolved[0].status).toBe("new");
	});

	it("handleDelete: resolver receives the array WITH the deletion applied", async () => {
		const { resolver, captured } = createCapturingResolver();
		const { result } = await renderHook(() =>
			useHarness({
				resolver,
				defaultImages: [
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				],
			}),
		);

		await act(async () => {
			await result.current.controller.handlers.handleDelete("temp_a");
		});

		const lastResolved = captured[captured.length - 1];
		expect(lastResolved).toHaveLength(2);
		expect(lastResolved.map((i) => i.status)).toEqual([
			"tobedeleted",
			"existing",
		]);
	});

	it("handleMove: resolver receives the array WITH the move applied", async () => {
		const { resolver, captured } = createCapturingResolver();
		const { result } = await renderHook(() =>
			useHarness({
				resolver,
				defaultImages: [
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				],
			}),
		);

		await act(async () => {
			await result.current.controller.handlers.handleMove("temp_a", "down");
		});

		const lastResolved = captured[captured.length - 1];
		expect(lastResolved.map((i) => i.tempId)).toEqual(["temp_b", "temp_a"]);
	});
});

describe("useMultiImageInputController (external reset)", () => {
	it("form.reset() propagates to hook and subsequent operations work on reset values", async () => {
		const { result } = await renderHook(() => useHarness());

		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("a.jpg"));
		});
		expect(result.current.controller.raw.watchedImages).toHaveLength(1);

		await act(async () => {
			result.current.form.reset({
				images: [
					makeExisting("temp_reset_a", "id-reset-a"),
					makeExisting("temp_reset_b", "id-reset-b"),
				],
			});
		});

		expect(result.current.controller.raw.watchedImages).toHaveLength(2);
		expect(
			result.current.controller.raw.watchedImages.map((i) => i.tempId),
		).toEqual(["temp_reset_a", "temp_reset_b"]);

		await act(async () => {
			await result.current.controller.handlers.handleDelete("temp_reset_a");
		});

		const imgs = result.current.controller.raw.watchedImages;
		expect(imgs).toHaveLength(2);
		expect(imgs.map((i) => i.status)).toEqual(["tobedeleted", "existing"]);
		expect(imgs[0].tempId).toBe("temp_reset_a");
		expect(imgs[1].tempId).toBe("temp_reset_b");
	});
});

function createZodResolver() {
	const imagesSchema = createImagesSchema({
		acceptedTypes: ["image/jpeg"],
		maxImages: 2,
	});
	const schema = z.object({ images: imagesSchema });
	return standardSchemaResolver(schema);
}

describe("useMultiImageInputController (real schema errors via zod)", () => {
	it("invalid file type → per-item file error in itemsWithErrors", async () => {
		const resolver = createZodResolver();
		const { result } = await renderHook(() => useHarness({ resolver }));

		await act(async () => {
			await result.current.controller.handlers.handleAdd(
				new File(["v"], "bad.png", { type: "image/png" }),
			);
		});

		const item = result.current.controller.itemsWithErrors[0];
		expect(item).toBeDefined();
		expect(item.errors?.file).toBeDefined();
		expect(item.errors?.file?.message).toEqual(expect.any(String));
	});

	it("maxImages exceeded → rootErrors populated", async () => {
		const resolver = createZodResolver();
		const { result } = await renderHook(() => useHarness({ resolver }));

		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("a.jpg"));
		});
		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("b.jpg"));
		});
		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("c.jpg"));
		});

		const rootErrors = result.current.controller.rootErrors;
		expect(rootErrors.length).toBeGreaterThan(0);
		expect(rootErrors[0].message).toEqual(expect.any(String));
	});

	it("valid images → no errors", async () => {
		const resolver = createZodResolver();
		const { result } = await renderHook(() => useHarness({ resolver }));

		await act(async () => {
			await result.current.controller.handlers.handleAdd(makeFile("a.jpg"));
		});

		const item = result.current.controller.itemsWithErrors[0];
		expect(item.errors).toBeUndefined();
		expect(result.current.controller.rootErrors).toHaveLength(0);
	});
});
