import type {
	Image,
	ImageExisting,
	ImageNew,
	ImageToBeDeleted,
} from "./types/Image";
import { ImageUtils } from "./types/Image";
import { ImageFormStatus } from "./types/ImageStatus";

function findAdjacentVisible(
	images: readonly Image[],
	from: number,
	direction: "up" | "down",
): number {
	const step = direction === "up" ? -1 : 1;
	for (let i = from + step; i >= 0 && i < images.length; i += step) {
		if (images[i].status !== ImageFormStatus.ToBeDeleted) return i;
	}
	return -1;
}

export function addImage(
	images: readonly Image[],
	image: ImageNew,
): { images: Image[]; added: true } {
	return { images: [...images, image], added: true };
}

export function replaceExistingImage(
	images: readonly Image[],
	index: number,
	deleted: ImageToBeDeleted,
	created: ImageNew,
): { images: Image[]; changed: true } {
	const next = [...images];
	next[index] = created;
	next.push(deleted);
	return { images: next, changed: true };
}

export function updateNewFile(
	images: readonly Image[],
	index: number,
	image: ImageNew,
): { images: Image[]; changed: true } {
	const next = [...images];
	next[index] = image;
	return { images: next, changed: true };
}

export function markDeleteImage(
	images: readonly Image[],
	index: number,
	deleted: ImageToBeDeleted,
): { images: Image[]; deleted: true } {
	const next = [...images];
	next[index] = deleted;
	return { images: next, deleted: true };
}

export function removeNewImage(
	images: readonly Image[],
	index: number,
): { images: Image[]; deleted: true } {
	const next = images.filter((_, i) => i !== index);
	return { images: next, deleted: true };
}

export function moveImage(
	images: readonly Image[],
	from: number,
	direction: "up" | "down",
): { images: Image[]; moved: boolean } {
	if (
		from < 0 ||
		from >= images.length ||
		images[from].status === ImageFormStatus.ToBeDeleted
	) {
		return { images: [...images], moved: false };
	}
	const to = findAdjacentVisible(images, from, direction);
	if (to === -1) return { images: [...images], moved: false };
	const next = [...images];
	[next[from], next[to]] = [next[to], next[from]];
	return { images: next, moved: true };
}

if (import.meta.vitest) {
	const { describe, it, expect } = import.meta.vitest;

	const makeNew = (tempId = "temp_new"): ImageNew => ({
		tempId,
		status: ImageFormStatus.New,
		id: undefined,
		file: new File(["data"], "test.jpg", { type: "image/jpeg" }),
		uploadRef: undefined,
	});

	const makeExisting = (tempId = "temp_ex"): ImageExisting => ({
		tempId,
		status: ImageFormStatus.Existing,
		id: `id-${tempId}`,
		file: undefined,
		previewUrl: `https://s3.example.com/${tempId}.jpg`,
		uploadedUrl: `https://s3.example.com/${tempId}.jpg`,
	});

	const makeDeleted = (tempId = "temp_del"): ImageToBeDeleted => ({
		tempId,
		status: ImageFormStatus.ToBeDeleted,
		id: `id-${tempId}`,
		file: undefined,
		previewUrl: `https://s3.example.com/${tempId}.jpg`,
		uploadedUrl: `https://s3.example.com/${tempId}.jpg`,
	});

	describe("imageListOps", () => {
		describe("addImage", () => {
			it("empty → appends", () => {
				const result = addImage([], makeNew());
				expect(result.images).toHaveLength(1);
				expect(result.images[0].status).toBe("new");
				expect(result.added).toBe(true);
			});

			it("appends after ToBeDeleted", () => {
				const result = addImage([makeDeleted()], makeNew());
				expect(result.images).toHaveLength(2);
				expect(result.images[0].status).toBe("tobedeleted");
				expect(result.images[1].status).toBe("new");
			});

			it("appends to end of mixed array", () => {
				const images: Image[] = [makeExisting("temp_a"), makeDeleted("temp_b")];
				const created = makeNew("temp_c");
				const result = addImage(images, created);
				expect(result.images.map((i) => i.tempId)).toEqual([
					"temp_a",
					"temp_b",
					"temp_c",
				]);
			});
		});

		describe("replaceExistingImage", () => {
			it("replaces in-place and appends deleted at end", () => {
				const ex = makeExisting("temp_a");
				const deleted = ImageUtils.markDelete(ex);
				const created = makeNew("temp_new");
				const result = replaceExistingImage([ex], 0, deleted, created);
				expect(result.images.map((i) => i.status)).toEqual([
					"new",
					"tobedeleted",
				]);
				expect(result.changed).toBe(true);
			});

			it("mid-array replacement preserves surrounding items", () => {
				const a = makeExisting("temp_a");
				const b = makeExisting("temp_b");
				const c = makeExisting("temp_c");
				const deleted = ImageUtils.markDelete(b);
				const created = makeNew("temp_new_b");
				const result = replaceExistingImage([a, b, c], 1, deleted, created);
				expect(result.images.map((i) => i.tempId)).toEqual([
					"temp_a",
					"temp_new_b",
					"temp_c",
					"temp_b",
				]);
				expect(result.images.map((i) => i.status)).toEqual([
					"existing",
					"new",
					"existing",
					"tobedeleted",
				]);
			});
		});

		describe("updateNewFile", () => {
			it("replaces in-place", () => {
				const n = makeNew("temp_a");
				const updated = makeNew("temp_a");
				const result = updateNewFile([n], 0, updated);
				expect(result.images).toHaveLength(1);
				expect(result.images[0]).toBe(updated);
				expect(result.changed).toBe(true);
			});
		});

		describe("markDeleteImage", () => {
			it("changes status in-place", () => {
				const a = makeExisting("temp_a");
				const b = makeExisting("temp_b");
				const deleted = ImageUtils.markDelete(a);
				const result = markDeleteImage([a, b], 0, deleted);
				expect(result.images.map((i) => i.status)).toEqual([
					"tobedeleted",
					"existing",
				]);
				expect(result.images[0].tempId).toBe("temp_a");
				expect(result.deleted).toBe(true);
			});
		});

		describe("removeNewImage", () => {
			it("removes the item at index", () => {
				const n = makeNew("temp_a");
				const result = removeNewImage([n], 0);
				expect(result.images).toHaveLength(0);
				expect(result.deleted).toBe(true);
			});
		});

		describe("moveImage", () => {
			it("swaps adjacent visible items", () => {
				const a = makeNew("temp_a");
				const b = makeNew("temp_b");
				const result = moveImage([a, b], 0, "down");
				expect(result.images[0].tempId).toBe("temp_b");
				expect(result.images[1].tempId).toBe("temp_a");
				expect(result.moved).toBe(true);
			});

			it("skips ToBeDeleted when finding adjacent visible", () => {
				const a = makeNew("temp_a");
				const d = makeDeleted("temp_d");
				const b = makeNew("temp_b");
				const result = moveImage([a, d, b], 0, "down");
				expect(result.moved).toBe(true);
				expect(result.images.map((i) => i.tempId)).toEqual([
					"temp_b",
					"temp_d",
					"temp_a",
				]);
			});

			it("no-op when no visible item exists in direction", () => {
				const a = makeNew("temp_a");
				const d = makeDeleted("temp_d");
				const result = moveImage([a, d], 0, "down");
				expect(result.moved).toBe(false);
			});

			it("no-op when ToBeDeleted item is moved", () => {
				const a = makeExisting("temp_a");
				const d = makeDeleted("temp_d");
				const result = moveImage([a, d], 1, "up");
				expect(result.moved).toBe(false);
			});

			it("no-op when already at top and moving up", () => {
				const a = makeNew("temp_a");
				const b = makeNew("temp_b");
				const result = moveImage([a, b], 0, "up");
				expect(result.moved).toBe(false);
			});

			it("no-op when already at bottom and moving down", () => {
				const a = makeNew("temp_a");
				const b = makeNew("temp_b");
				const result = moveImage([a, b], 1, "down");
				expect(result.moved).toBe(false);
			});

			it("no-op when from is out of range", () => {
				const a = makeNew("temp_a");
				const result = moveImage([a], 5, "up");
				expect(result.moved).toBe(false);
			});

			it("handles multiple consecutive ToBeDeleted items", () => {
				const a = makeNew("temp_a");
				const d1 = makeDeleted("temp_d1");
				const d2 = makeDeleted("temp_d2");
				const b = makeNew("temp_b");
				const result = moveImage([a, d1, d2, b], 0, "down");
				expect(result.moved).toBe(true);
				expect(result.images.map((i) => i.tempId)).toEqual([
					"temp_b",
					"temp_d1",
					"temp_d2",
					"temp_a",
				]);
			});
		});
	});
}
