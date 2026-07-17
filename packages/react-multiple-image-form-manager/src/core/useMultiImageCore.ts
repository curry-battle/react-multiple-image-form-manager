import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ImageFieldAdapter } from "./ImageFieldAdapter";
import * as ops from "./imageListOps";
import type { Image, ProcessFileFn, UploadFileFn } from "./types/Image";
import { generateTempId, ImageUtils } from "./types/Image";
import type {
	CoreConstraints,
	CoreMessages,
	ImageFieldError,
	ImageWithErrors,
} from "./types/ImageSchemaTypes";
import { defaultCoreMessages } from "./types/ImageSchemaTypes";
import { ImageFormStatus } from "./types/ImageStatus";
import type {
	MultiImageError,
	MultiImageErrorType,
} from "./types/MultiImageError";

export type UseMultiImageCoreParams = {
	adapter: ImageFieldAdapter;
	processFile?: ProcessFileFn;
	uploadFile?: UploadFileFn;
	onError?: (error: MultiImageError) => void;
	constraints?: CoreConstraints;
	messages?: CoreMessages;
};

export type UseMultiImageCoreReturn = {
	itemsWithErrors: ImageWithErrors[];
	rootErrors: ImageFieldError[];
	handlers: {
		handleAdd: (file: File) => Promise<boolean>;
		handleFileChange: (tempId: string, file: File) => Promise<boolean>;
		handleDelete: (tempId: string) => Promise<boolean>;
		handleMove: (tempId: string, direction: "up" | "down") => Promise<boolean>;
	};
	raw: { watchedImages: readonly Image[] };
};

export function useMultiImageCore(
	params: UseMultiImageCoreParams,
): UseMultiImageCoreReturn {
	const { adapter, processFile, uploadFile, onError, constraints, messages } =
		params;
	const maxImages = constraints?.maxImages;

	const msg = useMemo(
		() => ({
			maxImages: messages?.maxImages ?? defaultCoreMessages.maxImages,
			processFile: messages?.processFile ?? defaultCoreMessages.processFile,
			uploadFile: messages?.uploadFile ?? defaultCoreMessages.uploadFile,
		}),
		[messages?.maxImages, messages?.processFile, messages?.uploadFile],
	);

	const adapterRef = useRef<ImageFieldAdapter>(adapter);
	useEffect(() => {
		adapterRef.current = adapter;
	}, [adapter]);

	const safeValidate = useCallback(async () => {
		try {
			await adapterRef.current.validate();
		} catch (err) {
			onError?.({
				type: "unknown",
				message: "validation failed",
				cause: err,
			});
		}
	}, [onError]);

	const executeProcessFile = useCallback(
		async (
			file: File,
			errorType: MultiImageErrorType,
			errorMessage: () => string,
		): Promise<File | null> => {
			if (!processFile) return file;
			try {
				return await processFile(file);
			} catch (err) {
				onError?.({ type: errorType, message: errorMessage(), cause: err });
				return null;
			}
		},
		[onError, processFile],
	);

	const executeUploadFile = useCallback(
		async (
			file: File,
			errorMessage: () => string,
		): Promise<{ uploadedUrl: string } | "skip" | "error"> => {
			if (!uploadFile) return "skip";
			try {
				const result = await uploadFile(file);
				return { uploadedUrl: result.uploadedUrl };
			} catch (err) {
				onError?.({ type: "upload_file", message: errorMessage(), cause: err });
				return "error";
			}
		},
		[onError, uploadFile],
	);

	const getVisibleCount = useCallback(() => {
		return adapterRef.current.images.filter(
			(img) => img.status !== ImageFormStatus.ToBeDeleted,
		).length;
	}, []);

	const getImageIndexByTempId = useCallback(
		(tempId: string): number | undefined => {
			const index = adapterRef.current.images.findIndex(
				(img) => img.tempId === tempId,
			);
			if (index === -1) return undefined;
			return index;
		},
		[],
	);

	const checkMaxImages = useCallback((): boolean => {
		if (maxImages !== undefined && getVisibleCount() >= maxImages) {
			onError?.({
				type: "max_images",
				message: msg.maxImages(maxImages),
			});
			return false;
		}
		return true;
	}, [getVisibleCount, maxImages, msg, onError]);

	const handleAdd = useCallback(
		async (file: File): Promise<boolean> => {
			if (!checkMaxImages()) return false;

			const processedFile = await executeProcessFile(
				file,
				"process_file",
				msg.processFile,
			);
			if (!processedFile) return false;

			const uploadResult = await executeUploadFile(
				processedFile,
				msg.uploadFile,
			);
			if (uploadResult === "error") return false;

			// 非同期 await 中に並行 handleAdd が挿入を終えている
			// 可能性があるため、挿入直前の状態で上限を再チェックする
			if (!checkMaxImages()) return false;

			const newTempId = generateTempId();
			const uploadedUrl =
				typeof uploadResult === "object" ? uploadResult.uploadedUrl : undefined;
			const newImage = ImageUtils.createNew(
				newTempId,
				processedFile,
				uploadedUrl,
			);

			const ad = adapterRef.current;
			const result = ops.addImage(ad.images, newImage);
			ad.setImages(result.images);

			await safeValidate();
			return true;
		},
		[checkMaxImages, executeProcessFile, executeUploadFile, msg, safeValidate],
	);

	const handleFileChange = useCallback(
		async (tempId: string, file: File): Promise<boolean> => {
			const preIndex = getImageIndexByTempId(tempId);
			if (preIndex === undefined) return false;

			// unsupported status は呼び出し時点で確定するエラーなので、
			// processFile を走らせる前に onError で通知して打ち切る
			const preStatus = adapterRef.current.images[preIndex].status;
			if (
				preStatus !== ImageFormStatus.Existing &&
				preStatus !== ImageFormStatus.New
			) {
				onError?.({
					type: "unknown",
					message: "unsupported status for file change",
					cause: { reason: "unsupported_status", status: preStatus },
				});
				return false;
			}

			const processedFile = await executeProcessFile(
				file,
				"process_file",
				msg.processFile,
			);
			if (!processedFile) return false;

			const uploadResult = await executeUploadFile(
				processedFile,
				msg.uploadFile,
			);
			if (uploadResult === "error") return false;

			// 非同期 await 中に並行操作で削除・移動されている可能性が
			// あるため、await 前の index は使わず tempId から再解決する
			const index = getImageIndexByTempId(tempId);
			if (index === undefined) return false;

			const ad = adapterRef.current;
			const targetImage = ad.images[index];
			const uploadedUrl =
				typeof uploadResult === "object" ? uploadResult.uploadedUrl : undefined;

			if (targetImage.status === ImageFormStatus.Existing) {
				const deletedImage = ImageUtils.markDelete(targetImage);
				const newImage = ImageUtils.createNew(
					generateTempId(),
					processedFile,
					uploadedUrl,
				);
				const result = ops.replaceExistingImage(
					ad.images,
					index,
					deletedImage,
					newImage,
				);
				ad.setImages(result.images);
			} else if (targetImage.status === ImageFormStatus.New) {
				const newImage = ImageUtils.createNew(
					targetImage.tempId,
					processedFile,
					uploadedUrl,
				);
				const result = ops.updateNewFile(ad.images, index, newImage);
				ad.setImages(result.images);
			} else {
				// await 中の handleDelete / replaceExisting で ToBeDeleted 化されたケース。
				// markDelete は tempId を保持するため index 再解決では検出できずここに到達する。
				// ユーザー操作の自然な競合であり handleDelete の no-op 方針と同様に
				// エラー通知せず打ち切る（呼び出し時点で不正な status は
				// handleFileChange 冒頭の preStatus チェックが onError 通知済み）
				return false;
			}

			await safeValidate();
			return true;
		},
		[
			executeProcessFile,
			executeUploadFile,
			getImageIndexByTempId,
			msg,
			onError,
			safeValidate,
		],
	);

	const handleDelete = useCallback(
		async (tempId: string): Promise<boolean> => {
			const index = getImageIndexByTempId(tempId);
			if (index === undefined) return false;

			const ad = adapterRef.current;
			const image = ad.images[index];

			if (image.status === ImageFormStatus.Existing) {
				const deleteImage = ImageUtils.markDelete(image);
				const result = ops.markDeleteImage(ad.images, index, deleteImage);
				ad.setImages(result.images);
			} else if (image.status === ImageFormStatus.New) {
				const result = ops.removeNewImage(ad.images, index);
				ad.setImages(result.images);
			} else {
				// ToBeDeleted の再削除は no-op。削除済み項目への削除は UI 上の
				// 二重クリック等で自然に起こりうる操作であり、エラー通知はノイズになるため
				// onError を発火しない
				return false;
			}

			await safeValidate();
			return true;
		},
		[getImageIndexByTempId, safeValidate],
	);

	const handleMove = useCallback(
		async (tempId: string, direction: "up" | "down"): Promise<boolean> => {
			const index = getImageIndexByTempId(tempId);
			if (index === undefined) return false;

			const ad = adapterRef.current;
			const result = ops.moveImage(ad.images, index, direction);
			if (!result.moved) return false;

			ad.setImages(result.images);
			await safeValidate();
			return true;
		},
		[getImageIndexByTempId, safeValidate],
	);

	const handlers = useMemo(
		() => ({ handleAdd, handleFileChange, handleDelete, handleMove }),
		[handleAdd, handleFileChange, handleDelete, handleMove],
	);

	const itemsWithErrors = useMemo<ImageWithErrors[]>(() => {
		return adapter.images
			.map((image, originalIndex) => ({
				image,
				errors: adapter.errors.items[originalIndex],
			}))
			.filter((item) => item.image.status !== ImageFormStatus.ToBeDeleted);
	}, [adapter.images, adapter.errors]);

	const raw = useMemo(
		() => ({ watchedImages: adapter.images }),
		[adapter.images],
	);

	return {
		itemsWithErrors,
		rootErrors: adapter.errors.root,
		handlers,
		raw,
	};
}
