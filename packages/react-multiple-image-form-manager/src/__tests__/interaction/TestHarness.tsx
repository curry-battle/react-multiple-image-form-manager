import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useForm as useTanstackForm } from "@tanstack/react-form";
import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useForm as useRhfForm } from "react-hook-form";
import { z } from "zod";
import type {
	Image,
	ImageExisting,
	ImageNew,
	ProcessFileFn,
	UploadFileFn,
} from "../../core/types/Image";
import type { CoreConstraints } from "../../core/types/ImageSchemaTypes";
import { ImageFormStatus } from "../../core/types/ImageStatus";
import type { MultiImageError } from "../../core/types/MultiImageError";
import type { UploadState } from "../../core/types/UploadState";
import { useImagePreviewUrl } from "../../core/useImagePreviewUrl";
import type {
	ReadyImages,
	UploadsApi,
	UploadWaitResult,
} from "../../core/useMultiImageCore";
import { MultiImageInputController } from "../../react-hook-form/MultiImageInputController";
import { createImagesSchema } from "../../schemas/zod";
import { TanstackMultiImageController } from "../../tanstack-form/TanstackMultiImageController";

// ---------- helpers ----------

export const makeFile = (name = "a.jpg", type = "image/jpeg") =>
	new File(["data"], name, { type });

export const makeExisting = (tempId: string, id: string): ImageExisting => ({
	tempId,
	status: ImageFormStatus.Existing,
	id,
	file: undefined,
	previewUrl: `https://s3.example.com/${id}.jpg`,
	uploadedUrl: `https://s3.example.com/${id}.jpg`,
});

export const makeNew = (tempId: string): ImageNew => ({
	tempId,
	status: ImageFormStatus.New,
	id: undefined,
	file: makeFile(),
	uploadRef: undefined,
});

/** new は uploadRef、既存は uploadedUrl。表示上はどちらも「転送済みの参照」 */
const uploadRefOf = (image: Image): string | undefined =>
	image.status === ImageFormStatus.New ? image.uploadRef : image.uploadedUrl;

// ---------- shared ImageItem component ----------

function ImageItem({
	image,
	index,
	onChangeFile,
	onDelete,
	onMove,
	onRetry,
	isFirst,
	isLast,
	error,
	uploadState,
}: {
	image: Image;
	index: number;
	onChangeFile: (tempId: string, file: File) => void;
	onDelete: (tempId: string) => void;
	onMove: (tempId: string, direction: "up" | "down") => void;
	onRetry: (tempId: string) => void;
	isFirst: boolean;
	isLast: boolean;
	error: string | undefined;
	uploadState: UploadState | undefined;
}) {
	const previewUrl = useImagePreviewUrl(image);

	return (
		<div data-testid={`image-item-${index}`}>
			{previewUrl && (
				<img
					src={previewUrl}
					alt={`image-${index}`}
					data-testid={`preview-${index}`}
				/>
			)}
			<span data-testid={`status-${index}`}>{image.status}</span>
			<span data-testid={`upload-status-${index}`}>
				{uploadState?.status ?? "none"}
			</span>
			<span data-testid={`upload-progress-${index}`}>
				{uploadState?.status === "pending" && uploadState.progress !== undefined
					? uploadState.progress
					: "-"}
			</span>
			<button
				type="button"
				data-testid={`retry-${index}`}
				onClick={() => onRetry(image.tempId)}
			>
				retry
			</button>
			<span data-testid={`name-${index}`}>
				{image.status === ImageFormStatus.New ? image.file.name : image.id}
			</span>
			{uploadRefOf(image) && (
				<span data-testid={`upload-ref-${index}`}>{uploadRefOf(image)}</span>
			)}
			<button
				type="button"
				data-testid={`move-up-${index}`}
				disabled={isFirst}
				onClick={() => onMove(image.tempId, "up")}
			>
				up
			</button>
			<button
				type="button"
				data-testid={`move-down-${index}`}
				disabled={isLast}
				onClick={() => onMove(image.tempId, "down")}
			>
				down
			</button>
			<label data-testid={`change-label-${index}`}>
				change
				<input
					type="file"
					accept="image/*"
					data-testid={`change-input-${index}`}
					onChange={(e: ChangeEvent<HTMLInputElement>) => {
						const f = e.target.files?.[0];
						if (f) onChangeFile(image.tempId, f);
					}}
				/>
			</label>
			<button
				type="button"
				data-testid={`delete-${index}`}
				onClick={() => onDelete(image.tempId)}
			>
				delete
			</button>
			{error && <span data-testid={`error-${index}`}>{error}</span>}
		</div>
	);
}

// ---------- uploads panel ----------

type PanelResult =
	| ({ kind: "wait" } & UploadWaitResult)
	| ({ kind: "ready"; ok: true } & ReadyImages);

function UploadsPanel({ uploads }: { uploads: UploadsApi }) {
	const [result, setResult] = useState<PanelResult | undefined>(undefined);

	return (
		<div>
			<span data-testid="uploads-pending">{uploads.pending.length}</span>
			<span data-testid="uploads-failed">{uploads.failed.join(",")}</span>
			<button
				type="button"
				data-testid="wait"
				onClick={() => {
					uploads.wait().then((r) => setResult({ kind: "wait", ...r }));
				}}
			>
				wait
			</button>
			<button
				type="button"
				data-testid="get-ready"
				onClick={() => {
					setResult({ kind: "ready", ok: true, ...uploads.getReady() });
				}}
			>
				ready
			</button>
			{result && (
				<span data-testid="submit-result">
					{result.ok
						? `ok:${result.images.length}`
						: `ng:${result.failedTempIds.length}`}
				</span>
			)}
			{result?.ok && (
				<>
					<span data-testid="submit-upload-refs">
						{result.images
							.map((img) => ("uploadRef" in img ? img.uploadRef : "-"))
							.join(",")}
					</span>
					<span data-testid="submit-deleted">{result.deletedIds.length}</span>
					{result.kind === "ready" && (
						<span data-testid="submit-excluded">
							{result.excludedTempIds.length}
						</span>
					)}
				</>
			)}
		</div>
	);
}

// ---------- types for harness props ----------

export type HarnessProps = {
	initialImages?: Image[];
	constraints?: CoreConstraints;
	maxImages?: number;
	processFile?: ProcessFileFn;
	uploadFile?: UploadFileFn;
	onError?: (error: MultiImageError) => void;
	onReset?: (resetFn: () => void) => void;
};

// ---------- RHF Harness ----------

export function RhfHarness({
	initialImages,
	constraints,
	maxImages,
	processFile,
	uploadFile,
	onError,
	onReset,
}: HarnessProps): ReactNode {
	const resolver = maxImages
		? standardSchemaResolver(
				z.object({
					images: createImagesSchema({
						acceptedTypes: ["image/jpeg", "image/png"],
						maxImages,
					}),
				}),
			)
		: undefined;

	const form = useRhfForm<{ images: Image[] }>({
		defaultValues: { images: initialImages ?? [] },
		resolver,
		mode: "onChange",
	});

	const resetRef = useRef(() => form.reset({ images: initialImages ?? [] }));
	resetRef.current = () => form.reset({ images: initialImages ?? [] });
	useEffect(() => {
		if (onReset) onReset((...args) => resetRef.current(...args));
	}, [onReset]);

	return (
		<MultiImageInputController
			form={form}
			name="images"
			constraints={constraints}
			processFile={processFile}
			uploadFile={uploadFile}
			onError={onError}
			render={({
				items,
				rootErrors,
				handleAdd,
				handleFileChange,
				handleDelete,
				handleMove,
				uploads,
			}) => (
				<div>
					<div data-testid="item-count">{items.length}</div>
					{rootErrors.length > 0 && (
						<div data-testid="root-error">{rootErrors[0]?.message}</div>
					)}
					{items.map(({ image, errors, uploadState }, index) => (
						<ImageItem
							key={image.tempId}
							image={image}
							index={index}
							onChangeFile={(tempId, file) => handleFileChange(tempId, file)}
							onDelete={handleDelete}
							onMove={handleMove}
							onRetry={(tempId) => {
								uploads.retry(tempId);
							}}
							isFirst={index === 0}
							isLast={index === items.length - 1}
							error={errors?.file?.message}
							uploadState={uploadState}
						/>
					))}
					{items.length === 0 && (
						<div data-testid="empty-message">No images</div>
					)}
					<UploadsPanel uploads={uploads} />
					<input
						type="file"
						accept="image/*"
						data-testid="add-input"
						onChange={(e: ChangeEvent<HTMLInputElement>) => {
							const files = e.target.files;
							if (!files) return;
							for (const f of Array.from(files)) {
								handleAdd(f);
							}
							e.target.value = "";
						}}
						multiple
					/>
				</div>
			)}
		/>
	);
}

// ---------- TanStack Harness ----------

export function TanstackHarness({
	initialImages,
	constraints,
	maxImages,
	processFile,
	uploadFile,
	onError,
	onReset,
}: HarnessProps): ReactNode {
	const form = useTanstackForm({
		defaultValues: {
			images: initialImages ?? [],
		} as { images: Image[] },
		validators: maxImages
			? {
					onChange: z.object({
						images: createImagesSchema({
							acceptedTypes: ["image/jpeg", "image/png"],
							maxImages,
						}),
					}),
				}
			: undefined,
	});

	const resetRef = useRef(() => form.reset({ images: initialImages ?? [] }));
	resetRef.current = () => form.reset({ images: initialImages ?? [] });
	useEffect(() => {
		if (onReset) onReset((...args) => resetRef.current(...args));
	}, [onReset]);

	return (
		<TanstackMultiImageController
			form={form}
			name="images"
			constraints={constraints}
			processFile={processFile}
			uploadFile={uploadFile}
			onError={onError}
			render={({
				items,
				rootErrors,
				handleAdd,
				handleFileChange,
				handleDelete,
				handleMove,
				uploads,
			}) => (
				<div>
					<div data-testid="item-count">{items.length}</div>
					{rootErrors.length > 0 && (
						<div data-testid="root-error">
							{(rootErrors[0] as { message?: string })?.message}
						</div>
					)}
					{items.map(({ image, errors, uploadState }, index) => (
						<ImageItem
							key={image.tempId}
							image={image}
							index={index}
							onChangeFile={(tempId, file) => handleFileChange(tempId, file)}
							onDelete={handleDelete}
							onMove={handleMove}
							onRetry={(tempId) => {
								uploads.retry(tempId);
							}}
							isFirst={index === 0}
							isLast={index === items.length - 1}
							error={errors?.file?.message}
							uploadState={uploadState}
						/>
					))}
					{items.length === 0 && (
						<div data-testid="empty-message">No images</div>
					)}
					<UploadsPanel uploads={uploads} />
					<input
						type="file"
						accept="image/*"
						data-testid="add-input"
						onChange={(e: ChangeEvent<HTMLInputElement>) => {
							const files = e.target.files;
							if (!files) return;
							for (const f of Array.from(files)) {
								handleAdd(f);
							}
							e.target.value = "";
						}}
						multiple
					/>
				</div>
			)}
		/>
	);
}

// ---------- dual runner ----------

export type HarnessComponent = (props: HarnessProps) => ReactNode;

export const harnesses: [string, HarnessComponent][] = [
	["RHF", RhfHarness],
	["TanStack", TanstackHarness],
];
