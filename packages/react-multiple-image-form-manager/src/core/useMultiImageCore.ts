import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageFieldAdapter } from "./ImageFieldAdapter";
import * as ops from "./imageListOps";
import type {
	Image,
	ImageNew,
	ProcessFileFn,
	SubmitImage,
	UploadedSubmitImage,
	UploadFileFn,
} from "./types/Image";
import { generateTempId, ImageUtils } from "./types/Image";
import type {
	CoreConstraints,
	CoreMessages,
	ImageFieldError,
	ImageItem,
} from "./types/ImageSchemaTypes";
import { defaultCoreMessages } from "./types/ImageSchemaTypes";
import { ImageFormStatus } from "./types/ImageStatus";
import type {
	MultiImageError,
	MultiImageErrorType,
} from "./types/MultiImageError";
import type { UploadState } from "./types/UploadState";

export type UseMultiImageCoreParams = {
	adapter: ImageFieldAdapter;
	processFile?: ProcessFileFn;
	uploadFile?: UploadFileFn;
	onError?: (error: MultiImageError) => void;
	constraints?: CoreConstraints;
	messages?: CoreMessages;
};

/**
 * 走行中の転送を待ち合わせた結果。
 *
 * `images` は可視順の送信素材（SubmitImage の doc を参照）。`deletedIds` は
 * 削除対象の既存 id で、「配列に無いものは削除」と宣言する API では使わない。
 */
export type UploadWaitResult =
	| { ok: true; images: SubmitImage[]; deletedIds: string[] }
	| { ok: false; failedTempIds: string[] };

/** uploadFile を設定した場合。new 項目が uploadRef を持つ形に確定する */
export type UploadWaitUploadedResult =
	| { ok: true; images: UploadedSubmitImage[]; deletedIds: string[] }
	| { ok: false; failedTempIds: string[] };

/**
 * 転送の完了を待たずに集めた送信素材。
 *
 * 未完了の項目は `images` に入らず `excludedTempIds` で返る。返さないと
 * 消費側が「この画像は含まれませんでした」と提示できない。
 */
export type ReadyImages = {
	images: SubmitImage[];
	deletedIds: string[];
	excludedTempIds: string[];
};

/** uploadFile を設定した場合。new 項目が uploadRef を持つ形に確定する */
export type ReadyUploadedImages = {
	images: UploadedSubmitImage[];
	deletedIds: string[];
	excludedTempIds: string[];
};

export type UploadsApi = {
	/** 転送中の tempId。件数は length */
	pending: string[];
	/** 転送に失敗した tempId */
	failed: string[];
	/** failed の項目のみ受け付ける。それ以外は false */
	retry: (tempId: string) => Promise<boolean>;
	/**
	 * 走行中の追加・差し替えと転送の完了を待ってから送信素材を返す。
	 *
	 * 待つのは handleAdd / handleFileChange の走行中の呼び出しと、それが始めた
	 * 転送。これらは選択をフォームへ反映する前に await を挟むため、呼び出しが
	 * 終わるまではその選択が adapter.images に現れない。待たずに組むと選んだ画像が
	 * 黙って落ちる。processFile を設定していれば変換の分だけ長くなるが、待ちは
	 * その有無によらず、await していない呼び出しすべてに掛かる。
	 * uploadFile 未設定でも handler の完了は待つ。
	 *
	 * 素材は解決した時点のフォーム値から組む。submit が検証した値と一致するとは
	 * 限らないので、厳密に揃えるなら wait() のあとに再検証するか、submit 中の
	 * 選択を止めること
	 */
	wait: () => Promise<UploadWaitResult>;
	/**
	 * 待たずに、いま送れるものだけで送信素材を作る。
	 *
	 * 除外した項目は excludedTempIds で返る。項目自体はフォームに残るので、
	 * 消費側は「今回は含まれなかった」と提示すること。
	 *
	 * 除外した項目が既存画像の差し替えだった場合は、元画像を同じ位置へ戻す。
	 * 差し替え後だけを抜くと元画像の削除だけが送信され、元が消えて差し替え後も
	 * 入らない状態になるため。
	 *
	 * 走行中の追加・差し替えは待たない。フォームへ反映される前の選択は素材に
	 * 入らない（追加なら項目自体が無く、差し替えなら反映前の内容が入る）。
	 * excludedTempIds にも uploads.pending にも現れないので、getReady を使う構成では
	 * 反映の完了は利用側が握って保存を止めること
	 */
	getReady: () => ReadyImages;
};

/** uploadFile を設定した場合の uploads。送信素材の型だけが異なる */
export type UploadsUploadedApi = Omit<UploadsApi, "wait" | "getReady"> & {
	wait: () => Promise<UploadWaitUploadedResult>;
	getReady: () => ReadyUploadedImages;
};

type CoreBase = {
	items: ImageItem[];
	rootErrors: ImageFieldError[];
	handlers: {
		handleAdd: (file: File) => Promise<boolean>;
		handleFileChange: (tempId: string, file: File) => Promise<boolean>;
		handleDelete: (tempId: string) => Promise<boolean>;
		handleMove: (tempId: string, direction: "up" | "down") => Promise<boolean>;
	};
	raw: { watchedImages: readonly Image[] };
};

export type UseMultiImageCoreReturn = CoreBase & {
	uploads: UploadsApi;
};

export type UseMultiImageCoreUploadedReturn = CoreBase & {
	uploads: UploadsUploadedApi;
};

/**
 * 転送の台帳。フォーム state には持たない（UploadState の doc を参照）。
 *
 * setImages の結果がフォーム state へ反映されるのはレンダーを跨いだあとになる
 * （ImageFieldAdapter の doc を参照）。解決済み参照の判定をフォーム state と本台帳の
 * マージで行うのはそのため。file を持つのは「その uploadRef がどの File のものか」を
 * 後から検証するため。
 */
type UploadRecord =
	| {
			status: "pending";
			file: File;
			controller: AbortController;
			/** 転送が settle したら解決する。uploads.wait の待機対象 */
			settled: Promise<void>;
	  }
	| { status: "done"; file: File; uploadRef: string }
	| { status: "failed"; file: File; error: unknown };

/**
 * 同一 tempId で書き戻しが連続して自己破棄された回数の上限。
 *
 * 1 回は消費側が handlers を介さず setImages でファイルを差し替えた場合に
 * 正常に起こる。2 回連続は adapter が File の参照を保持していない疑いが濃く、
 * 放置すると再発行が永久に回るため失敗へ倒す（ImageFieldAdapter の doc を参照）
 */
const SELF_DISCARD_LIMIT = 2;

/**
 * uploads.wait の収束ループで、進捗の無い周回を何回続けたら打ち切るか。
 *
 * 1 回で打ち切ると、待機中のファイル選び直し（元の転送が中断され、新しい転送が
 * まだ結果を出していない周回）を誤って失敗と判定する。
 *
 * 既知の違反モード（File の参照を保持しない adapter）では SELF_DISCARD_LIMIT が
 * 先に発火するため、この打ち切りに到達する経路は今のところ見つかっていない。
 * それでも残すのは、収束ループの停止性を reconciliation 側の実装に依存させない
 * ため。自己破棄として数えられない破棄経路が将来生まれても、ここで止まる
 */
const STALLED_ROUND_LIMIT = 2;

const noop = (): void => {};

/**
 * 選択の競合単位。同じ値どうしだけが競合し、後着が現行になる。
 *
 * 差し替えは同じ項目への選び直しと競合するので tempId から、追加は競合相手が
 * いないので 1 件ごとに別の値を作る。接頭辞で分けるのは、追加が採番する tempId と
 * 衝突させないため
 */
type SelectionKey = string;

const fileChangeKey = (tempId: string): SelectionKey => `change:${tempId}`;

/**
 * 反映が終わっていない選択。handleAdd / handleFileChange の 1 回の呼び出しに対応し、
 * この値の参照そのものが「現行は自分だ」という印になる。
 *
 * `settled` は反映の完了か `displace()` の早いほうで解決する。現行を降りた選択の
 * 結果は捨てられるので、待ち続けると後着が終わっているのに保存が返らない
 */
type CurrentSelection = {
	settled: Promise<void>;
	/** 現行を降りたことを待ち側へ伝える。解決済みの選択に呼んでも無害 */
	displace: () => void;
};

export function useMultiImageCore(
	params: UseMultiImageCoreParams & { uploadFile: UploadFileFn },
): UseMultiImageCoreUploadedReturn;
export function useMultiImageCore(
	params: UseMultiImageCoreParams,
): UseMultiImageCoreReturn;
// 実装は緩い側で組む。厳しい側の保証（new 項目の uploadRef 確定）は
// uploadFile 設定時の ok 条件から導かれるもので、実装内部で表現できる事実ではない
export function useMultiImageCore(
	params: UseMultiImageCoreParams,
): UseMultiImageCoreReturn {
	const { adapter, processFile, uploadFile, onError, constraints, messages } =
		params;
	const maxImages = constraints?.maxImages;
	// 参照ではなく有無だけを見る。毎レンダー新しい関数を渡す consumer で
	// reconciliation を無駄に発火させない
	const hasUploadFile = uploadFile !== undefined;

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

	// startUpload は effect からも呼ぶため参照を安定させたい。
	// 発火時点の最新値が要るものは ref 経由で読む
	const uploadFileRef = useRef<UploadFileFn | undefined>(uploadFile);
	const onErrorRef = useRef(onError);
	const msgRef = useRef(msg);
	useEffect(() => {
		uploadFileRef.current = uploadFile;
		onErrorRef.current = onError;
		msgRef.current = msg;
	}, [uploadFile, onError, msg]);

	const recordsRef = useRef<ReadonlyMap<string, UploadRecord>>(new Map());
	const [records, setRecordsState] = useState<
		ReadonlyMap<string, UploadRecord>
	>(recordsRef.current);
	const selfDiscardsRef = useRef(new Map<string, number>());

	/** mutate は変更があったかを返す。false なら再レンダーを起こさない */
	const writeRecords = useCallback(
		(mutate: (draft: Map<string, UploadRecord>) => boolean) => {
			const draft = new Map(recordsRef.current);
			if (!mutate(draft)) return;
			recordsRef.current = draft;
			setRecordsState(draft);
		},
		[],
	);

	// 進捗は台帳と別に持つ。UploadRecord を差し替えて表現すると、書き戻しの
	// 可否を判定している「自分がまだ現行レコードか」の参照比較（startUpload の
	// isCurrent）が進捗報告のたびに崩れる
	const progressRef = useRef<ReadonlyMap<string, number>>(new Map());
	const [progress, setProgressState] = useState<ReadonlyMap<string, number>>(
		progressRef.current,
	);

	const writeProgress = useCallback(
		(tempId: string, fraction: number | undefined) => {
			const draft = new Map(progressRef.current);
			if (fraction === undefined) {
				if (!draft.delete(tempId)) return;
			} else {
				draft.set(tempId, fraction);
			}
			progressRef.current = draft;
			setProgressState(draft);
		},
		[],
	);

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

	/**
	 * 転送を開始する。完了を待たず即座に戻る。
	 *
	 * file には「state に格納したのと同一の File オブジェクト」を渡すこと。
	 * processFile を設定した consumer で加工前の File を渡すと、書き戻し時の
	 * 同一性比較が常に不成立となり結果が一度も反映されない。
	 */
	const startUpload = useCallback(
		(tempId: string, file: File): void => {
			const upload = uploadFileRef.current;
			if (!upload) return;

			const current = recordsRef.current.get(tempId);
			// 同一 File の転送が走行中なら二重発行しない。abort 済みでも settle 前は
			// 走行中として扱う。中断要求から settle までの間に再発行すると、
			// 中断待ちの転送と新しい転送が並走する
			if (current?.status === "pending" && current.file === file) return;
			// 同一項目で別 File の転送が走っている場合、その結果は書き戻し時に破棄されるが、
			// 転送を続ける理由も無いので中断する
			if (current?.status === "pending") current.controller.abort();

			const controller = new AbortController();
			let settle!: () => void;
			const settled = new Promise<void>((resolve) => {
				settle = resolve;
			});
			// 以降の書き込みは「台帳のエントリがまだ自分のものか」で判定する。
			// 差し替え・削除で置き換わっていれば書き込まない
			const record: UploadRecord = {
				status: "pending",
				file,
				controller,
				settled,
			};
			const isCurrent = () => recordsRef.current.get(tempId) === record;

			const fail = (error: unknown) => {
				writeRecords((draft) => {
					if (draft.get(tempId) !== record) return false;
					draft.set(tempId, { status: "failed", file, error });
					return true;
				});
				onErrorRef.current?.({
					type: "upload_file",
					message: msgRef.current.uploadFile(),
					cause: error,
				});
			};

			// 進捗イベントはチャンクごとに飛びうる。台帳へそのまま書くと 1 チャンク
			// ごとに再レンダーが走るため、表示が変わらない報告は捨てる。
			// 丸めるのは書き込みの判定だけで、保持する値は報告されたまま
			let lastPercent = -1;
			const onProgress = (fraction: number): void => {
				if (!Number.isFinite(fraction) || !isCurrent()) return;
				const clamped = Math.min(1, Math.max(0, fraction));
				const percent = Math.floor(clamped * 100);
				if (percent === lastPercent) return;
				lastPercent = percent;
				writeProgress(tempId, clamped);
			};

			const run = async (): Promise<void> => {
				try {
					const result = await upload(file, {
						signal: controller.signal,
						onProgress,
					});
					if (controller.signal.aborted || !isCurrent()) return;
					// resolve したのに参照が無い実装（API レスポンスの欠損など）を
					// 成功として扱うと、done なのに未解決の項目が残り再発行が走り続ける。
					// 契約違反は失敗に倒して retry へ回す
					if (
						typeof result?.uploadRef !== "string" ||
						result.uploadRef === ""
					) {
						throw new Error("uploadFile resolved without uploadRef");
					}

					const ad = adapterRef.current;
					const index = ad.images.findIndex((img) => img.tempId === tempId);
					if (index === -1) return;
					const item = ad.images[index];
					// updateNewImageFile は tempId を保持するため、index 再解決だけでは
					// ファイル差し替えを検出できない。転送した File との同一性で判定する
					if (item.status !== ImageFormStatus.New || item.file !== file) {
						// 自分がまだ現行レコードなのに対象が入れ替わっている（＝自己破棄）。
						// 誰も引き継いでいないため、繰り返すなら adapter が File の参照を
						// 保持していない疑いが濃い
						const count = (selfDiscardsRef.current.get(tempId) ?? 0) + 1;
						selfDiscardsRef.current.set(tempId, count);
						if (count >= SELF_DISCARD_LIMIT) {
							fail(
								new Error(
									"upload result was discarded repeatedly; the adapter may not preserve File references",
								),
							);
						}
						return;
					}

					const next = [...ad.images];
					next[index] = { ...item, uploadRef: result.uploadRef };
					ad.setImages(next);
					selfDiscardsRef.current.delete(tempId);

					writeRecords((draft) => {
						if (draft.get(tempId) !== record) return false;
						draft.set(tempId, {
							status: "done",
							file,
							uploadRef: result.uploadRef,
						});
						return true;
					});
				} catch (err) {
					if (controller.signal.aborted) return;
					fail(err);
				} finally {
					// 中断・破棄で早期 return した場合は pending のまま残る。
					// 台帳から落として待機対象から外す（再発行は reconciliation が担う）
					writeRecords((draft) =>
						draft.get(tempId) === record ? draft.delete(tempId) : false,
					);
					// 進捗は転送 1 本の寿命に閉じる。ただし別の転送に引き継がれていたら
					// 消さない。消すと後発の転送が報告済みの進捗が巻き戻る
					const current = recordsRef.current.get(tempId);
					if (!(current?.status === "pending" && current !== record)) {
						writeProgress(tempId, undefined);
					}
					settle();
				}
			};

			// run() は同期 throw する uploadFile 実装で catch まで同期到達しうるため、
			// 台帳へ載せてから起動する
			writeRecords((draft) => {
				draft.set(tempId, record);
				return true;
			});
			writeProgress(tempId, undefined);
			void run();
		},
		[writeProgress, writeRecords],
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

	/**
	 * 競合単位ごとの現行の選択。uploads.wait はこれを待ってから送信素材を組む。
	 *
	 * handleAdd / handleFileChange は選択をフォームへ反映する前に await を挟む
	 * （processFile を設定していれば変換の分だけ長い）。その間の選択は adapter.images
	 * にも転送台帳にも現れないので、待たずに組むと選んだ画像が黙って落ちる。
	 *
	 * 追跡の要否は handler の種類ではなく、フォームへの書き込みが await の後に来るかで
	 * 決まる。handleDelete / handleMove は await の前に書き終える
	 */
	const currentSelectionsRef = useRef(
		new Map<SelectionKey, CurrentSelection>(),
	);
	const addKeySeqRef = useRef(0);
	const nextAddKey = useCallback(
		(): SelectionKey => `add:${addKeySeqRef.current++}`,
		[],
	);

	/**
	 * その競合単位の現行の選択として `run` を走らせる（競合単位は SelectionKey を参照）。
	 *
	 * `run` に渡す `isCurrent` は「自分がまだ現行か」を返す。await を挟む handler は
	 * フォームへ書く前にこれを確かめ、false なら結果を捨てる。false になるのは
	 * 後着への交代・handleDelete・unmount のいずれか。
	 *
	 * 登録は `run` の呼び出しより前。逆順だと、その隙に呼ばれた uploads.wait が
	 * 選択を待ち漏らす。`run` は必ず promise を返すこと。同期 throw されると
	 * settle しない現行が残り、uploads.wait が返らなくなる
	 */
	const runAsCurrent = useCallback(
		(
			key: SelectionKey,
			run: (isCurrent: () => boolean) => Promise<boolean>,
		): Promise<boolean> => {
			const selections = currentSelectionsRef.current;
			// wait は現行のスナップショットを await するため、交代は明示的に伝える
			selections.get(key)?.displace();

			let displace = noop;
			const settled = new Promise<void>((resolve) => {
				displace = resolve;
			});
			const current: CurrentSelection = { settled, displace };
			selections.set(key, current);

			const applying = run(() => selections.get(key) === current);
			// reject は待ち側へ伝播させない。adapter.setImages が同期 throw する実装では
			// handler の promise が reject しうるが、待ち側の関心は終わったかどうかだけ
			void applying.then(noop, noop).then(() => {
				displace();
				// 既に後着へ交代していたら消さない
				if (selections.get(key) === current) selections.delete(key);
			});
			return applying;
		},
		[],
	);

	const runAdd = useCallback(
		async (file: File, isCurrent: () => boolean): Promise<boolean> => {
			if (!checkMaxImages()) return false;

			const processedFile = await executeProcessFile(
				file,
				"process_file",
				msg.processFile,
			);
			if (!processedFile) return false;

			// 追加が現行を降りるのは unmount のときだけ。凍結された adapter.images から
			// 次の値を組んで書くと、再 mount 後に追加された項目を巻き戻す
			if (!isCurrent()) return false;

			// 非同期 await 中に並行 handleAdd が挿入を終えている
			// 可能性があるため、挿入直前の状態で上限を再チェックする
			if (!checkMaxImages()) return false;

			const newTempId = generateTempId();
			const newImage = ImageUtils.createNew(newTempId, processedFile);

			const ad = adapterRef.current;
			const result = ops.addImage(ad.images, newImage);
			ad.setImages(result.images);

			startUpload(newTempId, processedFile);

			await safeValidate();
			return true;
		},
		[checkMaxImages, executeProcessFile, msg, safeValidate, startUpload],
	);

	const handleAdd = useCallback(
		(file: File): Promise<boolean> =>
			// 追加は誰とも競合しないので、現行を降りるのは unmount のときだけになる
			runAsCurrent(nextAddKey(), (isCurrent) => runAdd(file, isCurrent)),
		[nextAddKey, runAdd, runAsCurrent],
	);

	const runFileChange = useCallback(
		async (
			tempId: string,
			file: File,
			isCurrent: () => boolean,
		): Promise<boolean> => {
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

			// 解決した順ではなく選んだ順で勝敗を決める（startUpload が転送側に持つのと
			// 同じ規則）。handleDelete と unmount も現行を降ろすのでここで打ち切られる。
			// 変換に失敗した選択はここへ来ない。捨てた選択でも onError は飛ぶ
			if (!isCurrent()) return false;

			// 非同期 await 中に並行操作で削除・移動されている可能性が
			// あるため、await 前の index は使わず tempId から再解決する
			const index = getImageIndexByTempId(tempId);
			if (index === undefined) return false;

			const ad = adapterRef.current;
			const targetImage = ad.images[index];

			if (targetImage.status === ImageFormStatus.Existing) {
				const { deletedImage, newImage } = ImageUtils.replaceExisting(
					targetImage,
					processedFile,
				);
				const result = ops.replaceExistingImage(
					ad.images,
					index,
					deletedImage,
					newImage,
				);
				ad.setImages(result.images);
				startUpload(newImage.tempId, processedFile);
			} else if (targetImage.status === ImageFormStatus.New) {
				const newImage = ImageUtils.updateNewImageFile(
					targetImage,
					processedFile,
				);
				const result = ops.updateNewFile(ad.images, index, newImage);
				ad.setImages(result.images);
				// 明示的な差し替えは仕切り直し。tripwire のカウントも解除する
				selfDiscardsRef.current.delete(targetImage.tempId);
				startUpload(targetImage.tempId, processedFile);
			} else {
				// handlers を介さない書き込み（form.reset や adapter.setImages への直接
				// 書き込み）で await 中に ToBeDeleted 化されたケース。markDelete は tempId を
				// 保持するため index 再解決では検出できずここに到達する。
				// 差し替え先を失っただけなので、handleDelete が ToBeDeleted の再削除を
				// no-op にするのと同じ方針でエラー通知せず打ち切る（呼び出し時点で不正な
				// status は handleFileChange 冒頭の preStatus チェックが onError 通知済み）
				return false;
			}

			await safeValidate();
			return true;
		},
		[
			executeProcessFile,
			getImageIndexByTempId,
			msg,
			onError,
			safeValidate,
			startUpload,
		],
	);

	const handleFileChange = useCallback(
		(tempId: string, file: File): Promise<boolean> =>
			runAsCurrent(fileChangeKey(tempId), (isCurrent) =>
				runFileChange(tempId, file, isCurrent),
			),
		[runFileChange, runAsCurrent],
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
				// 項目が消える唯一の経路。台帳を残すと失敗済み項目を削除しても
				// uploads.wait が失敗を報告し続ける
				const rec = recordsRef.current.get(tempId);
				if (rec?.status === "pending") rec.controller.abort();
				selfDiscardsRef.current.delete(tempId);
				writeRecords((draft) => draft.delete(tempId));
			} else {
				// ToBeDeleted の再削除は no-op。削除済み項目への削除は UI 上の
				// 二重クリック等で自然に起こりうる操作であり、エラー通知はノイズになるため
				// onError を発火しない
				return false;
			}

			// 削除が勝つ。現行を降ろせば、走行中の差し替えは解決時に自分が現行でないと
			// 分かって項目を復活させない。uploads.wait も無関係な選択を待たなくなる
			const changeKey = fileChangeKey(tempId);
			currentSelectionsRef.current.get(changeKey)?.displace();
			currentSelectionsRef.current.delete(changeKey);

			await safeValidate();
			return true;
		},
		[getImageIndexByTempId, safeValidate, writeRecords],
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

	/**
	 * 転送済みの参照を返す。フォーム state を優先し、無ければ台帳で補う。
	 *
	 * 書き戻しがフォーム state へ伝播する前のレンダーでは、adapter.images がまだ
	 * uploadRef を持たない（ImageFieldAdapter の doc を参照）。台帳で埋めるのはその隙間。
	 * 台帳が消える remount 後はフォーム state だけが判定材料になり、判定が縮退しても
	 * 嘘をつかない。
	 *
	 * items の表示用マージも uploads.wait の判定もこの 1 つの関数を通す。
	 * 供給源が分かれると「items 上は見えるのに wait は失敗する」が起こる
	 */
	const resolveUploadRef = useCallback(
		(image: ImageNew): string | undefined => {
			if (image.uploadRef !== undefined) return image.uploadRef;
			const rec = recordsRef.current.get(image.tempId);
			if (rec?.status === "done" && rec.file === image.file) {
				return rec.uploadRef;
			}
			return undefined;
		},
		[],
	);

	/** 解決済みの uploadRef を載せた表示・送信用の画像を返す */
	const withResolvedRef = useCallback(
		(image: Image): Image => {
			if (image.status !== ImageFormStatus.New) return image;
			const uploadRef = resolveUploadRef(image);
			return uploadRef === undefined ? image : { ...image, uploadRef };
		},
		[resolveUploadRef],
	);

	const listUnresolved = useCallback((): ImageNew[] => {
		return adapterRef.current.images.filter(
			(img): img is ImageNew =>
				img.status === ImageFormStatus.New &&
				resolveUploadRef(img) === undefined,
		);
	}, [resolveUploadRef]);

	/** 未転送の new 項目へ転送を発行する */
	const reissueUnresolved = useCallback(() => {
		for (const img of listUnresolved()) {
			// tripwire が落ちた項目は自動再発行しない。retry かファイル差し替えで解除する
			if (
				(selfDiscardsRef.current.get(img.tempId) ?? 0) >= SELF_DISCARD_LIMIT
			) {
				continue;
			}
			const rec = recordsRef.current.get(img.tempId);
			// 走行中なら File が違っても発行しない。1 項目に生きた転送は 1 本という
			// 制約を保つため。走行中の転送が対象を失っていれば、settle 時に自己破棄と
			// 判定されて台帳から落ち、次の照合で現在の File に対して発行される
			if (rec?.status === "pending") continue;
			// 失敗済みは自動再試行せず retry に委ねる。ただし現在の File 基準で判定する。
			// 台帳が別の File のものならこの項目にとっては未着手であり、
			// 発行しないと永久に未転送のまま残る
			if (rec?.status === "failed" && rec.file === img.file) continue;
			startUpload(img.tempId, img.file);
		}
	}, [listUnresolved, startUpload]);

	/**
	 * 送信素材を組む。表示順は配列の順序で表すので order は付けず、削除対象は
	 * 配列から外して deletedIds へ分ける。転送済みの参照は台帳で補うため、
	 * フォーム state への反映を待たずに確定できる。
	 *
	 * 差し替えで生まれた項目を除外するときは、元画像を除外された項目の位置へ戻す。
	 * 削除を取り消すだけでは足りない。「配列に無いものは削除」と解釈する API では、
	 * images にも deletedIds にも居ない画像はやはり削除されるため
	 */
	const buildPayload = useCallback(
		(
			excluded?: ReadonlySet<string>,
		): { images: SubmitImage[]; deletedIds: string[] } => {
			const source = adapterRef.current.images;
			const byTempId = new Map(source.map((img) => [img.tempId, img]));
			const originalOf = (image: ImageNew) =>
				image.replacesTempId === undefined
					? undefined
					: byTempId.get(image.replacesTempId);

			// 元画像を戻す判定を先に済ませる。ToBeDeleted は差し替え後の項目より
			// 後ろに置かれるが、配列の並びに依存させない
			const restoredTempIds = new Set<string>();
			if (excluded !== undefined) {
				for (const img of source) {
					if (img.status !== ImageFormStatus.New) continue;
					if (!excluded.has(img.tempId)) continue;
					const original = originalOf(img);
					if (original?.status === ImageFormStatus.ToBeDeleted) {
						restoredTempIds.add(original.tempId);
					}
				}
			}

			const images: SubmitImage[] = [];
			const deletedIds: string[] = [];
			for (const img of source) {
				if (img.status === ImageFormStatus.ToBeDeleted) {
					if (restoredTempIds.has(img.tempId)) continue;
					deletedIds.push(img.id);
					continue;
				}
				if (img.status === ImageFormStatus.Existing) {
					images.push({ id: img.id });
					continue;
				}
				if (excluded?.has(img.tempId)) {
					const original = originalOf(img);
					if (original?.status === ImageFormStatus.ToBeDeleted) {
						images.push({ id: original.id });
					}
					continue;
				}
				const uploadRef = resolveUploadRef(img);
				// uploadFile を設定しない consumer では転送が起きないので、
				// 転送そのものを消費側に委ねる形（File を渡す）になる
				images.push(
					uploadRef === undefined
						? { file: img.file, tempId: img.tempId }
						: { uploadRef },
				);
			}
			return { images, deletedIds };
		},
		[resolveUploadRef],
	);

	const getReady = useCallback((): ReadyImages => {
		if (!uploadFileRef.current) {
			// 転送しない構成では uploadRef が無いのが正常。除外対象として扱うと
			// new 項目が全部消える
			return { ...buildPayload(), excludedTempIds: [] };
		}
		// 未完了の項目を送信素材から抜く。項目自体はフォームに残る。
		// 走行中のものは転送が続き、未着手のものは reconciliation effect が
		// 発行するので次回の保存に入るが、失敗済みのものは自動再試行しない
		// ため uploads.retry を呼ぶまで除外され続ける
		const excludedTempIds = listUnresolved().map((img) => img.tempId);
		return {
			...buildPayload(new Set(excludedTempIds)),
			excludedTempIds,
		};
	}, [buildPayload, listUnresolved]);

	const wait = useCallback(async (): Promise<UploadWaitResult> => {
		/**
		 * 走行中の選択を待つ。待ったら true を返す。
		 *
		 * 待ち終えた選択は現行から降りているので、残っていれば待機中に始まった
		 * 選択。呼び出し側は true の間もう一度呼んでそれも待つ。
		 *
		 * 周回数に上限は置かない。周回が続くのは新しい選択が始まったときだけで、
		 * それは待つべき選択が増えたということ。上限で打ち切ると、まだ項目になって
		 * いない選択を送信素材から落とすことになり、この待ち合わせの目的が消える。
		 * 停止性は handler が返す promise が settle することに依存する。
		 * processFile や adapter.validate が settle しない実装ではここで止まる
		 * （ProcessFileFn / UploadFileFn の doc が課しているのと同じ要求）
		 */
		const settleOperations = async (): Promise<boolean> => {
			const inflight = [...currentSelectionsRef.current.values()];
			if (inflight.length === 0) return false;
			await Promise.all(inflight.map((op) => op.settled));
			return true;
		};

		if (!uploadFileRef.current) {
			// 転送は起きないが handler は走る。待たずに返すと項目になる前の選択が落ちる
			while (await settleOperations()) {}
			// 未設定の consumer では uploadRef が無いのが正常。失敗扱いすると
			// 一度も転送を試みていない項目が failedTempIds に並ぶ
			return { ok: true, ...buildPayload() };
		}

		// 収束ループ。待機開始時点のスナップショットだけを await すると、
		// 待機中に retry や reconciliation が始めた転送が待ち対象から漏れる
		const snapshot = () =>
			`${listUnresolved()
				.map((i) => i.tempId)
				.join(",")}|${[...recordsRef.current]
				.filter(([, rec]) => rec.status === "failed")
				.map(([tempId]) => tempId)
				.join(",")}`;

		// 進捗の無い周回が 2 回続いたら打ち切る。1 回で打ち切ると、待機中に
		// ユーザーがファイルを選び直したケースを誤検知する。差し替えの周回は
		// 「元の転送が中断され、新しい転送はまだ結果を出していない」ため進捗なしに
		// 見えるが、次の周回では新しい転送が解決して進捗が出る
		let stalledRounds = 0;

		for (;;) {
			// 選択 → 転送の順に待つ。選択が startUpload を終える前に収束ループへ入ると、
			// まだ始まっていない転送を待ち漏らす
			if (await settleOperations()) continue;

			const before = snapshot();
			reissueUnresolved();

			// 待つのはフォームに残っている項目の転送だけ。handlers を介さない
			// 差し替え（form.reset や adapter.setImages への直接書き込み）で項目が
			// 消えると、その転送の結果は書き戻し時に捨てられる。ok 判定と素材が
			// adapter.images から出ているので、待機集合も同じ供給源に揃える
			const alive = new Set(adapterRef.current.images.map((img) => img.tempId));
			const inflight: Promise<void>[] = [];
			for (const [tempId, rec] of recordsRef.current) {
				if (rec.status === "pending" && alive.has(tempId)) {
					inflight.push(rec.settled);
				}
			}
			if (inflight.length > 0) {
				await Promise.allSettled(inflight);
				stalledRounds = snapshot() === before ? stalledRounds + 1 : 0;
				// 転送は走ったのに未解決も失敗も動かない状態が続くなら、
				// これ以上回しても変わらない。契約違反の adapter による
				// ライブロックを可視の失敗へ変換する
				if (stalledRounds >= STALLED_ROUND_LIMIT) {
					// await 中に reconciliation が再発行していることがある。走行中の
					// 転送を failed で塗ると、その結果が破棄されて無駄撃ちになる
					const stuck = listUnresolved().filter(
						(img) => recordsRef.current.get(img.tempId)?.status !== "pending",
					);
					if (stuck.length === 0) {
						stalledRounds = 0;
						continue;
					}
					// 台帳にも失敗として残す。ここで返るだけだと uploads.failed が空のまま
					// になり、消費側が該当項目を提示することも retry することもできない
					writeRecords((draft) => {
						let changed = false;
						for (const img of stuck) {
							// 既に失敗している項目の error は原因を持っているので温存する。
							// ライブロックの説明で塗ると消費側に無関係な理由を見せることになる
							if (draft.get(img.tempId)?.status === "failed") continue;
							draft.set(img.tempId, {
								status: "failed",
								file: img.file,
								error: new Error(
									"upload made no progress; the adapter may not preserve File references",
								),
							});
							changed = true;
						}
						return changed;
					});
					return {
						ok: false,
						failedTempIds: stuck.map((img) => img.tempId),
					};
				}
				continue;
			}

			const failedTempIds = listUnresolved().map((img) => img.tempId);
			if (failedTempIds.length > 0) return { ok: false, failedTempIds };
			return { ok: true, ...buildPayload() };
		}
	}, [buildPayload, listUnresolved, reissueUnresolved, writeRecords]);

	const retry = useCallback(
		async (tempId: string): Promise<boolean> => {
			// pending 中の再実行を許すと同一 File の転送が 2 本 in-flight になり、
			// File 同一性比較では区別できず両方が書き戻しに成功してしまう
			if (recordsRef.current.get(tempId)?.status !== "failed") return false;

			const image = adapterRef.current.images.find(
				(img) => img.tempId === tempId,
			);
			if (image === undefined || image.status !== ImageFormStatus.New) {
				return false;
			}

			// 明示的なリトライは仕切り直し。tripwire のカウントも解除する
			selfDiscardsRef.current.delete(tempId);
			startUpload(tempId, image.file);
			const started = recordsRef.current.get(tempId);
			if (started?.status === "pending") await started.settled;
			return recordsRef.current.get(tempId)?.status === "done";
		},
		[startUpload],
	);

	// フォーム state から消えた項目の台帳を落とす。handlers を介さない差し替え
	// （form.reset や adapter.setImages への直接書き込み）で項目が消えると、
	// その項目の failed が uploads.failed に残り続け、消費側は items で引けず
	// retry でも消せない状態になる。
	//
	// 「一度フォーム state で見た tempId」だけを対象にする。setImages の結果が
	// フォーム state へ反映されるのはレンダーを跨いだあとなので（ImageFieldAdapter の
	// doc を参照）、単に「今の images に無い」で判定すると、追加直後の転送を
	// 反映待ちの間に中断してしまう
	const seenTempIdsRef = useRef(new Set<string>());
	const pruneOrphans = useCallback(() => {
		const alive = new Set(adapterRef.current.images.map((img) => img.tempId));
		const seen = seenTempIdsRef.current;
		for (const tempId of alive) seen.add(tempId);

		writeRecords((draft) => {
			let changed = false;
			for (const [tempId, rec] of draft) {
				if (alive.has(tempId) || !seen.has(tempId)) continue;
				if (rec.status === "pending") rec.controller.abort();
				draft.delete(tempId);
				selfDiscardsRef.current.delete(tempId);
				seen.delete(tempId);
				changed = true;
			}
			return changed;
		});
	}, [writeRecords]);

	// uploadRef の無い new 項目が現れたら転送を発行する。unmount で in-flight と
	// 台帳は失われるがフォーム state には項目が残るため、remount や初期値の後差し込みでも
	// 「転送されないまま uploads.wait が ok を返す」状態にならない。
	//
	// records も依存に含める。中断された転送は settle 時に台帳から落ちるため、
	// これが無いと StrictMode の cleanup で中断された転送が開発時だけ再開されない。
	// hasUploadFile も含める。undefined の間に追加された項目は startUpload が
	// 即 return するため、後から uploadFile が渡されたときに拾い直す必要がある
	// biome-ignore lint/correctness/useExhaustiveDependencies: pruneOrphans / reissueUnresolved は adapterRef / recordsRef 経由で読むため依存に現れないが、発火させたいのは画像と台帳と uploadFile の有無が変わったとき
	useEffect(() => {
		pruneOrphans();
		reissueUnresolved();
	}, [adapter.images, records, hasUploadFile, pruneOrphans, reissueUnresolved]);

	// unmount 時のみ中断する。結果は破棄され、再発行は reissueUnresolved を呼ぶ
	// reconciliation effect と uploads.wait が担う。
	//
	// 中断した転送は settle を待たずに台帳から落とす。abort した時点でその転送に
	// 用は無いのに枠を占有させると、signal を無視する実装（settle が遅い・返らない）で
	// StrictMode の再 mount 後に転送が再開されなくなる
	useEffect(() => {
		return () => {
			// 現行のまま残すと、再 mount 後の uploads.wait が前の mount の選択を待ち、
			// 解決した選択が commit まで通る。adapter.images は unmount 時点で凍結される
			// 一方 setImages は生きたフォームへ書くので、それは項目を巻き戻す
			for (const op of currentSelectionsRef.current.values()) op.displace();
			currentSelectionsRef.current.clear();
			writeRecords((draft) => {
				let changed = false;
				for (const [tempId, rec] of draft) {
					if (rec.status !== "pending") continue;
					rec.controller.abort();
					draft.delete(tempId);
					changed = true;
				}
				return changed;
			});
		};
	}, [writeRecords]);

	const uploads = useMemo<UploadsApi>(() => {
		const pending: string[] = [];
		const failed: string[] = [];
		for (const [tempId, rec] of records) {
			if (rec.status === "pending") pending.push(tempId);
			if (rec.status === "failed") failed.push(tempId);
		}
		return { pending, failed, retry, wait, getReady };
	}, [records, retry, wait, getReady]);

	const items = useMemo<ImageItem[]>(() => {
		return adapter.images
			.map((image, originalIndex) => {
				const rec = records.get(image.tempId);
				return {
					image: withResolvedRef(image),
					errors: adapter.errors.items[originalIndex],
					uploadState:
						rec?.status === "pending"
							? ({
									status: "pending",
									progress: progress.get(image.tempId),
								} satisfies UploadState)
							: rec?.status === "failed"
								? ({ status: "failed", error: rec.error } satisfies UploadState)
								: undefined,
				};
			})
			.filter((item) => item.image.status !== ImageFormStatus.ToBeDeleted);
	}, [adapter.images, adapter.errors, records, progress, withResolvedRef]);

	const raw = useMemo(
		() => ({ watchedImages: adapter.images }),
		[adapter.images],
	);

	return {
		items,
		rootErrors: adapter.errors.root,
		handlers,
		uploads,
		raw,
	};
}
