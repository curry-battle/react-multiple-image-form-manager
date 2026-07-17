import { FieldApi, FormApi } from "@tanstack/form-core";
import { describe, expect, it } from "vitest";
import z from "zod";
import { createImagesSchema } from "../../schemas/zod";
import { normalizeTanstackErrors } from "../normalizeTanstackErrors";

/**
 * Contract test: TanStack Form の実 validate → errorMap → normalizeTanstackErrors → ImagesError
 * を通しで検証し、TanStack 側の形式変更を CI で検知する。
 */

const imagesSchema = createImagesSchema({
	acceptedTypes: ["image/jpeg"],
	maxImages: 2,
});

const formSchema = z.object({
	images: imagesSchema,
});

async function validateAndNormalize(images: unknown[]) {
	// biome-ignore lint/suspicious/noExplicitAny: FormApi has 12 generic slots; widening for test
	const form: any = new FormApi({
		defaultValues: { images },
		validators: { onChange: formSchema },
		// biome-ignore lint/suspicious/noExplicitAny: FormApi constructor options have deep generics
	} as any);
	form.mount();

	// biome-ignore lint/suspicious/noExplicitAny: FieldApi has 23 generic slots; widening for test
	const field: any = new FieldApi({
		form,
		name: "images",
		// biome-ignore lint/suspicious/noExplicitAny: FieldApi constructor options have deep generics
	} as any);
	field.mount();

	await form.validate("change");

	const metaErrors = field.state.meta.errors ?? [];
	const errorMap = form.state.errorMap;

	return {
		result: normalizeTanstackErrors({
			errorMap,
			metaErrors,
			fieldName: "images",
			length: images.length,
		}),
		form,
		errorMap,
	};
}

describe("normalizeTanstackErrors contract test", () => {
	it("valid な入力ではエラーなし", async () => {
		const images = [
			{
				tempId: "t1",
				status: "new",
				id: undefined,
				file: new File(["x"], "img.jpg", { type: "image/jpeg" }),
				previewUrl: undefined,
				uploadedUrl: undefined,
			},
		];
		const { result: r } = await validateAndNormalize(images);
		expect(r.items.every((x) => x === undefined)).toBe(true);
		expect(r.root).toHaveLength(0);
	});

	it("per-item file エラーが items[0].file に配置される（root には落ちない）", async () => {
		const images = [
			{
				tempId: "t1",
				status: "new",
				id: undefined,
				file: new File(["x"], "img.txt", { type: "text/plain" }),
				previewUrl: undefined,
				uploadedUrl: undefined,
			},
		];
		const { result: r } = await validateAndNormalize(images);

		expect(r.items[0]?.file?.message).toBeDefined();
		expect(r.root).toHaveLength(0);
	});

	it("maxImages 超過エラーが root に現れ items は空", async () => {
		const makeImage = (i: number) => ({
			tempId: `t${i}`,
			status: "new" as const,
			id: undefined,
			file: new File(["x"], `img${i}.jpg`, { type: "image/jpeg" }),
			previewUrl: undefined,
			uploadedUrl: undefined,
		});
		const images = [makeImage(1), makeImage(2), makeImage(3)];
		const { result: r } = await validateAndNormalize(images);

		expect(r.root.length).toBeGreaterThan(0);
		expect(r.items.every((x) => x === undefined)).toBe(true);
	});

	it("union 不一致は要素レベルエラーとして root に来る", async () => {
		const images = [
			{
				tempId: "t1",
				status: "new",
				id: undefined,
				file: "not-a-file",
				previewUrl: undefined,
				uploadedUrl: undefined,
			},
		];
		const { result: r } = await validateAndNormalize(images);

		expect(r.root.length).toBeGreaterThan(0);
		expect(r.root.some((e) => e.source !== undefined)).toBe(true);
	});

	it("errorMap の field キーが bracket 記法であること（最低1キー存在を保証）", async () => {
		const images = [
			{
				tempId: "t1",
				status: "new",
				id: undefined,
				file: new File(["x"], "img.txt", { type: "text/plain" }),
				previewUrl: undefined,
				uploadedUrl: undefined,
			},
		];
		const { errorMap } = await validateAndNormalize(images);

		const onChange = (errorMap as Record<string, unknown>).onChange;
		expect(onChange).toBeDefined();

		const fieldKeys = Object.keys(onChange as Record<string, unknown>);
		const imageKeys = fieldKeys.filter(
			(k: string) => k.startsWith("images") && k !== "images",
		);

		expect(imageKeys.length).toBeGreaterThan(0);

		for (const key of imageKeys) {
			expect(key).not.toMatch(/^images\.\d+/);
			expect(key).toMatch(/^images\[\d+\]/);
		}
	});

	it("metaErrors と errorMap に同一 maxImages エラーが重複する場合 dedup される", async () => {
		const makeImage = (i: number) => ({
			tempId: `t${i}`,
			status: "new" as const,
			id: undefined,
			file: new File(["x"], `img${i}.jpg`, { type: "image/jpeg" }),
			previewUrl: undefined,
			uploadedUrl: undefined,
		});

		const { result: r } = await validateAndNormalize([
			makeImage(1),
			makeImage(2),
			makeImage(3),
		]);

		const maxImgMessages = r.root.filter(
			(e) => e.message === "画像は最大2枚までです。",
		);
		expect(maxImgMessages).toHaveLength(1);
	});
});
