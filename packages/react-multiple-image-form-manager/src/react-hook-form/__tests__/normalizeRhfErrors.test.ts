import { describe, expect, it } from "vitest";
import { normalizeRhfErrors } from "../normalizeRhfErrors";

describe("normalizeRhfErrors", () => {
	it("undefined input -> { items: [], root: [] }", () => {
		expect(normalizeRhfErrors(undefined)).toEqual({ items: [], root: [] });
	});

	it("null input -> { items: [], root: [] }", () => {
		expect(normalizeRhfErrors(null as never)).toEqual({
			items: [],
			root: [],
		});
	});

	it("array of per-item errors -> items populated, root empty", () => {
		const input = [
			{ file: { message: "too large", type: "maxSize" } },
			{ id: { message: "invalid id", type: "custom" } },
		];
		const result = normalizeRhfErrors(input);

		expect(result.items).toHaveLength(2);
		expect(result.items[0]?.file).toEqual({
			message: "too large",
			type: "maxSize",
			source: input[0].file,
		});
		expect(result.items[1]?.id).toEqual({
			message: "invalid id",
			type: "custom",
			source: input[1].id,
		});
		expect(result.root).toEqual([]);
	});

	it("array with undefined/null gaps -> items has undefined entries", () => {
		const input = [undefined, { file: { message: "err" } }, undefined] as never;
		const result = normalizeRhfErrors(input);

		expect(result.items).toHaveLength(3);
		expect(result.items[0]).toBeUndefined();
		expect(result.items[1]?.file).toBeDefined();
		expect(result.items[2]).toBeUndefined();
	});

	it("array item with file error -> items[0].file has message", () => {
		const input = [{ file: { message: "required", type: "required" } }];
		const result = normalizeRhfErrors(input);

		expect(result.items[0]?.file?.message).toBe("required");
	});

	it("array item with multiple field errors (file + id) -> both populated", () => {
		const input = [
			{
				file: { message: "bad file", type: "invalid" },
				id: { message: "bad id", type: "custom" },
			},
		];
		const result = normalizeRhfErrors(input);

		expect(result.items[0]?.file?.message).toBe("bad file");
		expect(result.items[0]?.id?.message).toBe("bad id");
	});

	it("array item with unknown field key -> ignored (only known keys extracted)", () => {
		const input = [
			{
				file: { message: "ok" },
				unknownField: { message: "should be ignored" },
			},
		] as never;
		const result = normalizeRhfErrors(input);

		expect(result.items[0]?.file?.message).toBe("ok");
		expect(result.items[0]).not.toHaveProperty("unknownField");
	});

	it("plain object (top-level FieldError for maxImages) -> goes to root", () => {
		const input = { message: "Max 5 images", type: "too_big" };
		const result = normalizeRhfErrors(input);

		expect(result.items).toEqual([]);
		expect(result.root).toHaveLength(1);
		expect(result.root[0].message).toBe("Max 5 images");
		expect(result.root[0].type).toBe("too_big");
	});

	it("plain object with empty message -> still goes to root", () => {
		const input = { message: "", type: "custom" };
		const result = normalizeRhfErrors(input);

		expect(result.items).toEqual([]);
		expect(result.root).toHaveLength(1);
		// Empty message is stripped by normalizeErrorLeaf
		expect(result.root[0]).not.toHaveProperty("message");
		expect(result.root[0].type).toBe("custom");
	});

	it("array with .root property -> root populated from .root", () => {
		const input = Object.assign([] as never[], {
			root: { message: "too many", type: "too_big" },
		});
		const result = normalizeRhfErrors(input);

		expect(result.root).toHaveLength(1);
		expect(result.root[0].message).toBe("too many");
		expect(result.root[0].type).toBe("too_big");
	});

	it("array with both per-item errors and .root -> both items and root populated", () => {
		const input = Object.assign(
			[{ file: { message: "bad file", type: "invalid" } }],
			{ root: { message: "too many images", type: "too_big" } },
		);
		const result = normalizeRhfErrors(input);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.file?.message).toBe("bad file");
		expect(result.root).toHaveLength(1);
		expect(result.root[0].message).toBe("too many images");
	});
});
