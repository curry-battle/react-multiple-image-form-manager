import { describe, expect, it } from "vitest";
import { normalizeTanstackErrors } from "../normalizeTanstackErrors";

describe("normalizeTanstackErrors", () => {
	it("empty input → { items: [], root: [] }", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [],
			fieldName: "images",
		});
		expect(r).toEqual({ items: [], root: [] });
	});

	it("metaErrors with string values → go to root", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: ["max 5 images", "another error"],
			fieldName: "images",
		});
		expect(r.root).toHaveLength(2);
		expect(r.root[0]?.message).toBe("max 5 images");
		expect(r.root[1]?.message).toBe("another error");
	});

	it("metaErrors with object values (message+type) → normalized to root", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [
				{ message: "too many", type: "max" },
				{ message: "invalid format" },
			],
			fieldName: "images",
		});
		expect(r.root).toHaveLength(2);
		expect(r.root[0]?.message).toBe("too many");
		expect(r.root[0]?.type).toBe("max");
		expect(r.root[1]?.message).toBe("invalid format");
	});

	it("errorMap with per-item field errors (images[0].file) → items[0].file populated", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"images[0].file": [{ message: "invalid type" }],
				},
			},
			metaErrors: [],
			fieldName: "images",
			length: 1,
		});
		expect(r.items[0]?.file?.message).toBe("invalid type");
	});

	it("errorMap with multiple per-item field errors across indices", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"images[0].file": [{ message: "bad file" }],
					"images[1].id": [{ message: "bad id" }],
					"images[2].previewUrl": [{ message: "bad url" }],
				},
			},
			metaErrors: [],
			fieldName: "images",
			length: 3,
		});
		expect(r.items).toHaveLength(3);
		expect(r.items[0]?.file?.message).toBe("bad file");
		expect(r.items[1]?.id?.message).toBe("bad id");
		expect(r.items[2]?.previewUrl?.message).toBe("bad url");
	});

	it("errorMap with uploadRef error → items[0].uploadRef populated", () => {
		// 未知キーは root へ回る実装なので、uploadRef が漏れると項目単位の
		// エラーとして表示できなくなる
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"images[0].uploadRef": [{ message: "empty ref" }],
				},
			},
			metaErrors: [],
			fieldName: "images",
			length: 1,
		});
		expect(r.items[0]?.uploadRef?.message).toBe("empty ref");
		expect(r.root).toHaveLength(0);
	});

	it("errorMap with unknown field keys → ignored (not placed in items)", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"images[0].unknownField": [{ message: "x" }],
				},
			},
			metaErrors: [],
			fieldName: "images",
			length: 1,
		});
		expect(r.items[0]).toBeUndefined();
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("x");
		expect(r.root[0]?.source).toMatchObject({
			path: "images[0].unknownField",
		});
	});

	it("errorMap with root-level error (key matching fieldName) → goes to root", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onSubmit: { images: "general failure" },
			},
			metaErrors: [],
			fieldName: "images",
		});
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("general failure");
	});

	it("errorMap with root-level error as array", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					images: [{ message: "too many images" }],
				},
			},
			metaErrors: [],
			fieldName: "images",
		});
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("too many images");
	});

	it("mixed: both metaErrors and errorMap have errors → all collected", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"images[0].file": [{ message: "bad file" }],
					images: [{ message: "root from errorMap" }],
				},
			},
			metaErrors: ["root from meta"],
			fieldName: "images",
			length: 1,
		});
		expect(r.items[0]?.file?.message).toBe("bad file");
		expect(r.root.length).toBeGreaterThanOrEqual(2);
		const rootMessages = r.root.map((e) => e.message);
		expect(rootMessages).toContain("root from meta");
		expect(rootMessages).toContain("root from errorMap");
	});

	it("deduplication: same error in both sources → not duplicated", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					images: [{ message: "max 3 images" }],
				},
			},
			metaErrors: [{ message: "max 3 images" }],
			fieldName: "images",
			length: 1,
		});
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("max 3 images");
	});

	it("deduplication: different messages are not deduped", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					images: [{ message: "error A" }],
				},
			},
			metaErrors: [{ message: "error B" }],
			fieldName: "images",
		});
		expect(r.root).toHaveLength(2);
	});

	it("raw string value in errorMap bucket", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"images[1].file": "raw string error",
				},
			},
			metaErrors: [],
			fieldName: "images",
			length: 2,
		});
		expect(r.items[1]?.file?.message).toBe("raw string error");
	});

	it("length hint pre-sizes the items array", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [],
			fieldName: "images",
			length: 3,
		});
		expect(r.items).toHaveLength(3);
		expect(r.items.every((x) => x === undefined)).toBe(true);
	});

	it("errors beyond length hint are still captured", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"images[5].file": [{ message: "out of range" }],
				},
			},
			metaErrors: [],
			fieldName: "images",
			length: 3,
		});
		expect(r.items[5]?.file?.message).toBe("out of range");
	});

	it("element-level error images[i] (no field) goes to root with source", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"images[0]": [{ message: "element error" }],
				},
			},
			metaErrors: [],
			fieldName: "images",
			length: 2,
		});
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("element error");
		expect(r.root[0]?.source).toMatchObject({ path: "images[0]" });
	});

	it("empty message in errorMap is not propagated as message", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"images[0].file": [{ message: "" }],
				},
			},
			metaErrors: [],
			fieldName: "images",
			length: 1,
		});
		expect(r.items[0]?.file?.message).toBeUndefined();
	});

	it("dot-notation key does not match bracket pattern → goes to root with source", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"images.0.file": [{ message: "dot style" }],
				},
			},
			metaErrors: [],
			fieldName: "images",
			length: 1,
		});
		expect(r.items[0]).toBeUndefined();
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("dot style");
		expect(r.root[0]?.source).toMatchObject({ path: "images.0.file" });
	});

	it("sibling field keys (e.g. imagesCount) are not picked up", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					imagesCount: [{ message: "sibling" }],
					"images[0].file": [{ message: "mine" }],
				},
			},
			metaErrors: [],
			fieldName: "images",
			length: 1,
		});
		expect(r.items[0]?.file?.message).toBe("mine");
		expect(r.root).toHaveLength(0);
	});

	it("multiple issues on one key: last-wins for items", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"images[0].file": [{ message: "first" }, { message: "second" }],
				},
			},
			metaErrors: [],
			fieldName: "images",
			length: 1,
		});
		expect(r.items[0]?.file?.message).toBe("second");
	});

	it("null/undefined metaErrors entries are skipped", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [null, undefined, "valid"],
			fieldName: "images",
		});
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("valid");
	});

	it("multiple buckets (onChange + onBlur) are all processed", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"images[0].file": [{ message: "change err" }],
				},
				onBlur: {
					"images[1].status": [{ message: "blur err" }],
				},
			},
			metaErrors: [],
			fieldName: "images",
			length: 2,
		});
		expect(r.items[0]?.file?.message).toBe("change err");
		expect(r.items[1]?.status?.message).toBe("blur err");
	});

	it("metaErrors with path: [index, fieldKey] → items[index] に振り分ける", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [
				{ message: "invalid file type", path: [0, "file"] },
				{ message: "missing id", path: [1, "id"] },
			],
			fieldName: "images",
			length: 2,
		});
		expect(r.items[0]?.file?.message).toBe("invalid file type");
		expect(r.items[1]?.id?.message).toBe("missing id");
		expect(r.root).toHaveLength(0);
	});

	it("metaErrors with path but unknown field key → root に落ちる", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [{ message: "unknown field", path: [0, "unknownField"] }],
			fieldName: "images",
			length: 1,
		});
		expect(r.items[0]).toBeUndefined();
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("unknown field");
	});

	it("metaErrors with path length < 2 → root に落ちる", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [{ message: "short path", path: [0] }],
			fieldName: "images",
			length: 1,
		});
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("short path");
	});

	it("metaErrors with non-number index in path → root に落ちる", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [{ message: "bad index", path: ["zero", "file"] }],
			fieldName: "images",
			length: 1,
		});
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("bad index");
	});

	it("metaErrors with negative or fractional index in path → root に落ちる", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [
				{ message: "negative", path: [-1, "file"] },
				{ message: "fractional", path: [1.5, "file"] },
			],
			fieldName: "images",
			length: 2,
		});
		expect(r.items.every((x) => x === undefined)).toBe(true);
		expect(r.root).toHaveLength(2);
		expect(r.root[0]?.message).toBe("negative");
		expect(r.root[1]?.message).toBe("fractional");
	});

	it("dedupe: message も type もない root error は全て保持される", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					images: [{ source: { code: "a" } }, { source: { code: "b" } }],
				},
			},
			metaErrors: [],
			fieldName: "images",
		});
		expect(r.root).toHaveLength(2);
	});
});
