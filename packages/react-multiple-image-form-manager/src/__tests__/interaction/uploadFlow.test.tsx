import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeFile } from "./TestHarness";

describe.each(harnesses)("Upload Flow (%s)", (_label, Harness) => {
	it("uploadFile 成功 → uploadRef が画像に反映される", async () => {
		const uploadFile = vi.fn(async () => ({
			uploadRef: "https://s3.example.com/uploaded.jpg",
		}));

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("photo.jpg"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("status-0")).toHaveTextContent("new");
		await expect
			.element(page.getByTestId("upload-ref-0"))
			.toHaveTextContent("https://s3.example.com/uploaded.jpg");
		expect(uploadFile).toHaveBeenCalledOnce();
	});

	it("uploadFile 失敗 → 画像は残り onError(upload_file) が非同期に届く", async () => {
		const onError = vi.fn();
		const uploadFile = vi.fn(async () => {
			throw new Error("upload failed");
		});

		await render(<Harness uploadFile={uploadFile} onError={onError} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("photo.jpg"),
		);

		// 転送に失敗してもユーザーの選択は捨てない
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("upload-status-0"))
			.toHaveTextContent("failed");
		await vi.waitFor(() =>
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "upload_file" }),
			),
		);
	});

	it("processFile 成功 → 加工後のファイルで画像が追加される", async () => {
		const processFile = vi.fn(async (file: File) => {
			return new File([file], `processed_${file.name}`, { type: file.type });
		});

		await render(<Harness processFile={processFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("photo.jpg"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("name-0"))
			.toHaveTextContent("processed_photo.jpg");
		expect(processFile).toHaveBeenCalledOnce();
	});

	it("processFile 失敗 → onError(process_file) が呼ばれ画像は追加されない", async () => {
		const onError = vi.fn();
		const processFile = vi.fn(async () => {
			throw new Error("process failed");
		});

		await render(<Harness processFile={processFile} onError={onError} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("photo.jpg"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ type: "process_file" }),
		);
	});

	it("processFile + uploadFile 連鎖: processFile の出力が uploadFile に渡され uploadRef が反映される", async () => {
		const processFile = vi.fn(async (file: File) => {
			return new File([file], `resized_${file.name}`, { type: file.type });
		});
		const uploadFile = vi.fn(async (file: File) => {
			expect(file.name).toBe("resized_photo.jpg");
			return { uploadRef: "https://s3.example.com/resized.jpg" };
		});

		await render(<Harness processFile={processFile} uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("photo.jpg"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("upload-ref-0"))
			.toHaveTextContent("https://s3.example.com/resized.jpg");
		expect(processFile).toHaveBeenCalledOnce();
		expect(uploadFile).toHaveBeenCalledOnce();
	});

	it("uploadFile 解決前でも画像は即リストに現れる (pending 状態)", async () => {
		let resolveUpload!: (value: { uploadRef: string }) => void;
		const uploadFile = vi.fn(
			() =>
				new Promise<{ uploadRef: string }>((resolve) => {
					resolveUpload = resolve;
				}),
		);

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("pending.jpg"),
		);

		// 転送の完了を待たずに項目が現れる
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("upload-status-0"))
			.toHaveTextContent("pending");
		await expect
			.element(page.getByTestId("uploads-pending"))
			.toHaveTextContent("1");
		await expect
			.element(page.getByTestId("upload-ref-0"))
			.not.toBeInTheDocument();

		resolveUpload({ uploadRef: "https://s3.example.com/pending.jpg" });

		await expect
			.element(page.getByTestId("upload-status-0"))
			.toHaveTextContent("none"); // 完了は uploadRef の有無で判定する（"done" は公開しない）
		await expect
			.element(page.getByTestId("upload-ref-0"))
			.toHaveTextContent("https://s3.example.com/pending.jpg");
		await expect
			.element(page.getByTestId("uploads-pending"))
			.toHaveTextContent("0");
	});

	it("uploadFile 未設定時は uploadRef なしで画像が即追加される", async () => {
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("immediate.jpg"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("upload-ref-0"))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("upload-status-0"))
			.toHaveTextContent("none");
	});

	it("uploads.wait: 転送中に呼んでも完了まで待ってから ok を返す", async () => {
		let resolveUpload!: (value: { uploadRef: string }) => void;
		const uploadFile = vi.fn(
			() =>
				new Promise<{ uploadRef: string }>((resolve) => {
					resolveUpload = resolve;
				}),
		);

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("slow.jpg"),
		);
		await expect
			.element(page.getByTestId("upload-status-0"))
			.toHaveTextContent("pending");

		await userEvent.click(page.getByTestId("wait").element());

		// 転送が終わるまで結果は出ない
		await expect
			.element(page.getByTestId("submit-result"))
			.not.toBeInTheDocument();

		resolveUpload({ uploadRef: "https://s3.example.com/slow.jpg" });

		await expect
			.element(page.getByTestId("submit-result"))
			.toHaveTextContent("ok:1");
		await expect
			.element(page.getByTestId("submit-upload-refs"))
			.toHaveTextContent("https://s3.example.com/slow.jpg");
	});

	it("uploads.wait: uploadFile 未設定なら常に ok を返す", async () => {
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("no-upload.jpg"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await userEvent.click(page.getByTestId("wait").element());

		await expect
			.element(page.getByTestId("submit-result"))
			.toHaveTextContent("ok:1");
	});

	it("転送失敗 → uploads.wait が失敗を報告し、retry で回復する", async () => {
		let shouldFail = true;
		const uploadFile = vi.fn(async () => {
			if (shouldFail) throw new Error("upload failed");
			return { uploadRef: "https://s3.example.com/recovered.jpg" };
		});

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("retry.jpg"),
		);
		await expect
			.element(page.getByTestId("upload-status-0"))
			.toHaveTextContent("failed");

		await userEvent.click(page.getByTestId("wait").element());
		await expect
			.element(page.getByTestId("submit-result"))
			.toHaveTextContent("ng:1");

		shouldFail = false;
		await userEvent.click(page.getByTestId("retry-0").element());

		await expect
			.element(page.getByTestId("upload-status-0"))
			.toHaveTextContent("none"); // 完了は uploadRef の有無で判定する（"done" は公開しない）
		await expect
			.element(page.getByTestId("upload-ref-0"))
			.toHaveTextContent("https://s3.example.com/recovered.jpg");
	});

	it("転送中に form を reset しても結果が紛れ込まない", async () => {
		// stale 判定は File の参照比較に乗っているため、adapter を通した経路でも
		// 参照が保たれることがこのテストの前提になっている
		let resolveUpload!: (value: { uploadRef: string }) => void;
		const uploadFile = vi.fn(
			() =>
				new Promise<{ uploadRef: string }>((resolve) => {
					resolveUpload = resolve;
				}),
		);
		let reset!: () => void;

		await render(
			<Harness
				uploadFile={uploadFile}
				onReset={(fn) => {
					reset = fn;
				}}
			/>,
		);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("dropped.jpg"),
		);
		await expect
			.element(page.getByTestId("upload-status-0"))
			.toHaveTextContent("pending");

		reset();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");

		resolveUpload({ uploadRef: "https://s3.example.com/dropped.jpg" });

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		await userEvent.click(page.getByTestId("wait").element());
		await expect
			.element(page.getByTestId("submit-result"))
			.toHaveTextContent("ok:0");
	});

	it("ctx.onProgress で報告した進捗が uploadState に出る", async () => {
		let resolveUpload!: (value: { uploadRef: string }) => void;
		const uploadFile = vi.fn(
			(_file: File, ctx: { onProgress: (fraction: number) => void }) =>
				new Promise<{ uploadRef: string }>((resolve) => {
					ctx.onProgress(0.42);
					resolveUpload = resolve;
				}),
		);

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("progress.jpg"),
		);

		await expect
			.element(page.getByTestId("upload-progress-0"))
			.toHaveTextContent("0.42");

		resolveUpload({ uploadRef: "https://s3.example.com/progress.jpg" });

		// 完了後は pending でなくなるので進捗も出なくなる
		await expect
			.element(page.getByTestId("upload-progress-0"))
			.toHaveTextContent("-");
	});

	it("uploads.getReady(): 走行中の項目を除外し、項目自体は残る", async () => {
		let resolveUpload!: (value: { uploadRef: string }) => void;
		const uploadFile = vi.fn(
			() =>
				new Promise<{ uploadRef: string }>((resolve) => {
					resolveUpload = resolve;
				}),
		);

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("slow.jpg"),
		);
		await expect
			.element(page.getByTestId("upload-status-0"))
			.toHaveTextContent("pending");

		await userEvent.click(page.getByTestId("get-ready").element());

		// 待たずに返る。素材からは抜けるが除外したことは伝わる
		await expect
			.element(page.getByTestId("submit-result"))
			.toHaveTextContent("ok:0");
		await expect
			.element(page.getByTestId("submit-excluded"))
			.toHaveTextContent("1");
		// 項目はフォームに残り、転送も続く
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		resolveUpload({ uploadRef: "https://s3.example.com/slow.jpg" });

		// 次の保存では含まれる
		await userEvent.click(page.getByTestId("get-ready").element());
		await expect
			.element(page.getByTestId("submit-result"))
			.toHaveTextContent("ok:1");
		await expect
			.element(page.getByTestId("submit-excluded"))
			.toHaveTextContent("0");
	});

	it("reset で消えた項目の転送が settle しなくても uploads.wait は返る", async () => {
		// 台帳のレコードは handlers を介さない差し替えでは落ちない。待機集合を
		// 絞らないと、結果が捨てられる転送を待って保存が返らなくなる
		const uploadFile = vi.fn(
			() => new Promise<{ uploadRef: string }>(() => {}),
		);
		let reset!: () => void;

		await render(
			<Harness
				uploadFile={uploadFile}
				onReset={(fn) => {
					reset = fn;
				}}
			/>,
		);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("never-settles.jpg"),
		);
		await expect
			.element(page.getByTestId("upload-status-0"))
			.toHaveTextContent("pending");

		reset();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");

		await userEvent.click(page.getByTestId("wait").element());
		await expect
			.element(page.getByTestId("submit-result"))
			.toHaveTextContent("ok:0");
	});

	it("reset で消えた項目は uploads.failed からも落ちる", async () => {
		// 残ると消費側は items で引けず retry でも消せない
		const uploadFile = vi.fn(async () => {
			throw new Error("upload failed");
		});
		let reset!: () => void;

		await render(
			<Harness
				uploadFile={uploadFile}
				onReset={(fn) => {
					reset = fn;
				}}
			/>,
		);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("doomed.jpg"),
		);
		await expect
			.element(page.getByTestId("upload-status-0"))
			.toHaveTextContent("failed");
		await expect
			.element(page.getByTestId("uploads-failed"))
			.not.toHaveTextContent("");

		reset();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		await expect
			.element(page.getByTestId("uploads-failed"))
			.toHaveTextContent("");
	});

	it("失敗済み項目を削除すると failed から除去される", async () => {
		const uploadFile = vi.fn(async () => {
			throw new Error("upload failed");
		});

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("doomed.jpg"),
		);
		await expect
			.element(page.getByTestId("upload-status-0"))
			.toHaveTextContent("failed");
		await expect
			.element(page.getByTestId("uploads-failed"))
			.not.toHaveTextContent("");

		await userEvent.click(page.getByTestId("delete-0").element());

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		await userEvent.click(page.getByTestId("wait").element());
		await expect
			.element(page.getByTestId("submit-result"))
			.toHaveTextContent("ok:0");
	});
});
