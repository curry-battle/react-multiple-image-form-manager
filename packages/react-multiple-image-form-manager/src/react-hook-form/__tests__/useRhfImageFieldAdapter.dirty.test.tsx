import type { ReactNode } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { renderHook } from "vitest-browser-react";
import type { Image, ImageExisting } from "../../core/types/Image";
import { ImageFormStatus } from "../../core/types/ImageStatus";
import { useMultiImageInputController } from "../useMultiImageInputController";

type TestForm = { images: Image[] };

const makeExisting = (tempId: string, id: string): ImageExisting => ({
	tempId,
	status: ImageFormStatus.Existing,
	id,
	uploadedUrl: "https://s3.example.com/image.jpg",
	previewUrl: "https://s3.example.com/image.jpg",
	file: undefined,
});

async function renderDirtyHarness(defaultImages: Image[] = []) {
	const formRef: { current: UseFormReturn<TestForm> | null } = {
		current: null,
	};
	let isDirty = false;

	const wrapper = ({ children }: { children: ReactNode }) => {
		const form = useForm<TestForm>({
			defaultValues: { images: defaultImages },
		});
		formRef.current = form;
		isDirty = form.formState.isDirty;
		return <>{children}</>;
	};

	const { result, act } = await renderHook(
		() => {
			const form = formRef.current;
			if (!form) throw new Error("form not initialized");
			return useMultiImageInputController<"images", TestForm>({
				form,
				name: "images",
			});
		},
		{ wrapper },
	);

	return { result, act, getIsDirty: () => isDirty };
}

describe("useRhfImageFieldAdapter dirty 伝播", () => {
	it("handleDelete（既存画像削除）で isDirty が true になる", async () => {
		const { result, act, getIsDirty } = await renderDirtyHarness([
			makeExisting("temp_ex", "id-existing"),
		]);
		expect(getIsDirty()).toBe(false);

		await act(async () => {
			await result.current.handlers.handleDelete("temp_ex");
		});

		expect(getIsDirty()).toBe(true);
	});

	it("handleAdd で isDirty が true になる", async () => {
		const { result, act, getIsDirty } = await renderDirtyHarness();
		expect(getIsDirty()).toBe(false);

		await act(async () => {
			await result.current.handlers.handleAdd(
				new File(["data"], "test.jpg", { type: "image/jpeg" }),
			);
		});

		expect(getIsDirty()).toBe(true);
	});

	it("handleFileChange（既存画像のファイル差し替え）で isDirty が true になる", async () => {
		const { result, act, getIsDirty } = await renderDirtyHarness([
			makeExisting("temp_ex", "id-existing"),
		]);
		expect(getIsDirty()).toBe(false);

		await act(async () => {
			await result.current.handlers.handleFileChange(
				"temp_ex",
				new File(["new"], "replaced.jpg", { type: "image/jpeg" }),
			);
		});

		expect(getIsDirty()).toBe(true);
	});

	it("handleMove で isDirty が true になる", async () => {
		const { result, act, getIsDirty } = await renderDirtyHarness([
			makeExisting("temp_a", "id-a"),
			makeExisting("temp_b", "id-b"),
		]);
		expect(getIsDirty()).toBe(false);

		await act(async () => {
			await result.current.handlers.handleMove("temp_a", "down");
		});

		expect(getIsDirty()).toBe(true);
	});
});
