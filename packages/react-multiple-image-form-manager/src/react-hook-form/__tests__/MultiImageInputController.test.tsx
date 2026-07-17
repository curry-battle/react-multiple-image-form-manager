import type { ReactNode } from "react";
import { act } from "react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { Image } from "../../core/types/Image";
import { ImageFormStatus } from "../../core/types/ImageStatus";
import type { MultiImageError } from "../../core/types/MultiImageError";
import { MultiImageInputController } from "../MultiImageInputController";

const makeFile = (name = "a.jpg") =>
	new File(["data"], name, { type: "image/jpeg" });

const makeExistingImage = (tempId: string, id: string): Image => ({
	tempId,
	status: ImageFormStatus.Existing,
	id,
	file: undefined,
	previewUrl: "https://s3.example.com/img.jpg",
	uploadedUrl: "https://s3.example.com/img.jpg",
});

type TestForm = { images: Image[] };

type Handle = {
	itemsWithErrors: Array<{ image: Image; errors: unknown }>;
	rootErrors: Array<unknown>;
	handleAdd: (file: File) => Promise<boolean>;
	handleFileChange: (tempId: string, file: File) => Promise<boolean>;
	handleDelete: (tempId: string) => Promise<boolean>;
	handleMove: (tempId: string, direction: "up" | "down") => Promise<boolean>;
	raw: { watchedImages: readonly Image[] };
};

function HarnessHost(props: {
	initialImages?: Image[];
	onError?: (error: MultiImageError) => void;
	handleRef: { current: Handle | null };
}): ReactNode {
	const form = useForm<TestForm>({
		defaultValues: { images: props.initialImages ?? [] },
	});

	return (
		<MultiImageInputController
			form={form}
			name="images"
			onError={props.onError}
			render={(p) => {
				props.handleRef.current = {
					itemsWithErrors: p.itemsWithErrors,
					rootErrors: p.rootErrors,
					handleAdd: p.handleAdd,
					handleFileChange: p.handleFileChange,
					handleDelete: p.handleDelete,
					handleMove: p.handleMove,
					raw: p.raw,
				};
				return (
					<div data-testid="harness">items:{p.itemsWithErrors.length}</div>
				);
			}}
		/>
	);
}

describe("MultiImageInputController (render-props component)", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("renders with empty images", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(<HarnessHost handleRef={handleRef} />);
		expect(handleRef.current).not.toBeNull();
		expect(handleRef.current?.itemsWithErrors).toHaveLength(0);
	});

	it("renders with initial existing images", async () => {
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
		expect(handleRef.current?.itemsWithErrors).toHaveLength(2);
	});

	it("handleAdd adds a new image and re-renders", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(<HarnessHost handleRef={handleRef} />);

		await act(async () => {
			await handleRef.current?.handleAdd(makeFile("a.jpg"));
		});

		expect(handleRef.current?.itemsWithErrors).toHaveLength(1);
		expect(handleRef.current?.itemsWithErrors[0]?.image.status).toBe(
			ImageFormStatus.New,
		);
	});

	it("handleDelete removes a new image", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(<HarnessHost handleRef={handleRef} />);

		await act(async () => {
			await handleRef.current?.handleAdd(makeFile("a.jpg"));
		});
		const tempId = handleRef.current?.raw.watchedImages[0]?.tempId ?? "";

		await act(async () => {
			await handleRef.current?.handleDelete(tempId);
		});

		expect(handleRef.current?.itemsWithErrors).toHaveLength(0);
	});

	it("handleFileChange replaces existing image (New + ToBeDeleted pair)", async () => {
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

		const raw = handleRef.current?.raw.watchedImages ?? [];
		expect(raw.map((i) => i.status)).toEqual([
			ImageFormStatus.New,
			ImageFormStatus.ToBeDeleted,
		]);
		// itemsWithErrors filters out ToBeDeleted
		expect(handleRef.current?.itemsWithErrors).toHaveLength(1);
	});

	it("handleMove swaps items", async () => {
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

	it("render prop receives all expected properties", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(<HarnessHost handleRef={handleRef} />);

		const h = handleRef.current;
		expect(h).not.toBeNull();
		expect(h?.itemsWithErrors).toBeDefined();
		expect(h?.rootErrors).toBeDefined();
		expect(h?.handleAdd).toBeInstanceOf(Function);
		expect(h?.handleFileChange).toBeInstanceOf(Function);
		expect(h?.handleDelete).toBeInstanceOf(Function);
		expect(h?.handleMove).toBeInstanceOf(Function);
		expect(h?.raw).toBeDefined();
	});
});
