import {
	type Image,
	ImageFormStatus,
	type UploadState,
	useImagePreviewUrl,
} from "@curry-battle/react-multiple-image-form-manager";

interface Props {
	image: Image;
	index: number;
	onChangeFile: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
	onDelete: (tempId: string) => void;
	onMove: (tempId: string, direction: "up" | "down") => void;
	isFirst: boolean;
	isLast: boolean;
	error: string | undefined;
	/** 転送中・失敗のときだけ値を持つ。完了は image.uploadRef の有無から導出する */
	uploadState: UploadState | undefined;
	onRetry: (tempId: string) => void;
}

export function FormMultiImageItem({
	image,
	index,
	onChangeFile,
	onDelete,
	onMove,
	isFirst,
	isLast,
	error,
	uploadState,
	onRetry,
}: Props) {
	const previewUrl = useImagePreviewUrl(image);

	return (
		<div className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg bg-white">
			{/* サムネイル */}
			<div className="w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
				<img
					src={previewUrl}
					alt={`Profile ${index + 1}`}
					className="w-full h-full object-cover"
				/>
			</div>

			{/* 情報 */}
			<div className="flex-1">
				<p className="text-sm text-gray-600">
					{image.status === ImageFormStatus.New ? "新規画像" : "既存画像"}
				</p>
				<p className="text-xs text-gray-400">Order: {index}</p>
				{uploadState?.status === "pending" && (
					<p className="text-xs text-blue-600 mt-1">
						アップロード中
						{uploadState.progress !== undefined &&
							` ${Math.floor(uploadState.progress * 100)}%`}
					</p>
				)}
				{uploadState?.status === "failed" && (
					<p className="text-xs text-red-500 mt-1">
						アップロードに失敗しました
						<button
							type="button"
							onClick={() => onRetry(image.tempId)}
							className="ml-2 underline"
						>
							再試行
						</button>
					</p>
				)}
				{error && <p className="text-xs text-red-500 mt-1">{error}</p>}
			</div>

			{/* 並び替え */}
			<div className="flex flex-col gap-2">
				<button
					type="button"
					onClick={() => onMove(image.tempId, "up")}
					disabled={isFirst}
					className="px-2 py-1 text-xs bg-blue-600 text-white rounded disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed hover:bg-blue-700"
				>
					↑
				</button>
				<button
					type="button"
					onClick={() => onMove(image.tempId, "down")}
					disabled={isLast}
					className="px-2 py-1 text-xs bg-blue-600 text-white rounded disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed hover:bg-blue-700"
				>
					↓
				</button>
			</div>

			{/* 変更/削除 */}
			<div className="flex flex-col gap-2">
				<button
					type="button"
					className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
				>
					<label className="cursor-pointer">
						変更
						<input
							type="file"
							accept="image/*"
							className="hidden"
							onChange={(e) => onChangeFile(e)}
							data-temp-id={image.tempId}
						/>
					</label>
				</button>
				<button
					type="button"
					onClick={() => onDelete(image.tempId)}
					className="px-3 py-1 text-sm bg-red-400 text-white rounded hover:bg-red-500"
				>
					削除
				</button>
			</div>
		</div>
	);
}
