import { describe, expect, it } from "vitest";
import { isPlainObject, normalizeErrorLeaf } from "../normalizeErrorLeaf";

describe("normalizeErrorLeaf", () => {
	it("non-empty string -> { message, source }", () => {
		const result = normalizeErrorLeaf("required");
		expect(result).toEqual({ message: "required", source: "required" });
	});

	it("empty string -> { source } with no message", () => {
		const result = normalizeErrorLeaf("");
		expect(result).toEqual({ source: "" });
		expect(result).not.toHaveProperty("message");
	});

	it("plain object with message + type -> extracts both, keeps source", () => {
		const raw = { message: "too large", type: "maxSize" };
		const result = normalizeErrorLeaf(raw);
		expect(result).toEqual({
			message: "too large",
			type: "maxSize",
			source: raw,
		});
	});

	it("plain object with only message -> extracts message, no type", () => {
		const raw = { message: "invalid" };
		const result = normalizeErrorLeaf(raw);
		expect(result).toEqual({ message: "invalid", source: raw });
		expect(result).not.toHaveProperty("type");
	});

	it("plain object with empty message string -> no message field", () => {
		const raw = { message: "" };
		const result = normalizeErrorLeaf(raw);
		expect(result).toEqual({ source: raw });
		expect(result).not.toHaveProperty("message");
	});

	it("plain object with no message/type -> { source: raw }", () => {
		const raw = { foo: "bar" };
		const result = normalizeErrorLeaf(raw);
		expect(result).toEqual({ source: raw });
		expect(result).not.toHaveProperty("message");
		expect(result).not.toHaveProperty("type");
	});

	it("undefined -> { source: undefined }", () => {
		const result = normalizeErrorLeaf(undefined);
		expect(result).toEqual({ source: undefined });
	});

	it("null -> { source: null }", () => {
		const result = normalizeErrorLeaf(null);
		expect(result).toEqual({ source: null });
	});

	it("number -> { message: '42', source: 42 }", () => {
		const result = normalizeErrorLeaf(42);
		expect(result).toEqual({ message: "42", source: 42 });
	});

	it("boolean -> { message: 'true', source: true }", () => {
		const result = normalizeErrorLeaf(true);
		expect(result).toEqual({ message: "true", source: true });
	});
});

describe("isPlainObject", () => {
	it("returns true for {}", () => {
		expect(isPlainObject({})).toBe(true);
	});

	it("returns false for []", () => {
		expect(isPlainObject([])).toBe(false);
	});

	it("returns false for null", () => {
		expect(isPlainObject(null)).toBe(false);
	});

	it("returns false for string", () => {
		expect(isPlainObject("hello")).toBe(false);
	});

	it("returns true for new Date() (no prototype check)", () => {
		expect(isPlainObject(new Date())).toBe(true);
	});
});
