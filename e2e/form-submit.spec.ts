import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
const jpegPath = path.join(fixturesDir, "test-image.jpg");
const jpegPath2 = path.join(fixturesDir, "test-image-2.jpg");

test.describe("フォーム送信", () => {
	test("有効データで送信", async ({ page }) => {
		await page.goto("/");

		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();

		// 「保存中...」に変化し、完了後「保存」に戻る
		await expect(submitButton).toHaveText("保存中...");
		await expect(submitButton).toHaveText("保存", { timeout: 10_000 });
	});

	test("送信中ボタン無効化", async ({ page }) => {
		await page.goto("/");

		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();

		await expect(submitButton).toBeDisabled();
		await expect(submitButton).toHaveText("保存中...");

		// 完了後に有効に戻る
		await expect(submitButton).toBeEnabled({ timeout: 10_000 });
	});

	test("既存画像のみで送信成功", async ({ page }) => {
		await page.goto("/");

		// 既存画像2枚ある状態でそのまま送信
		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();

		// 送信完了を確認
		await expect(submitButton).toHaveText("保存", { timeout: 10_000 });
		await expect(submitButton).toBeEnabled();
	});

	test("新規画像追加時にアップロード処理が実行される", async ({ page }) => {
		await page.goto("/");

		// console.logを監視
		const consoleLogs: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "log") {
				consoleLogs.push(msg.text());
			}
		});

		// 新規画像を追加
		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(jpegPath);
		await expect(page.getByText("新規画像", { exact: true })).toBeVisible();

		// ファイル選択時にアップロードが開始されることを確認（submit前）
		await expect
			.poll(
				() => consoleLogs.some((log) => log.includes("Getting presigned URL")),
				{
					timeout: 10_000,
				},
			)
			.toBe(true);
	});
});

test.describe("送信ペイロード検証", () => {
	test("混在ケース: 既存差替→削除→新規追加→送信で images/deletedIds が正しい", async ({
		page,
	}) => {
		await page.goto("/");

		// console.log で送信ペイロードをキャプチャ
		// API.updateUserProfile は console.log("Updating user profile with data:", payload) を出力する
		// Playwright の ConsoleMessage.args() で JSON シリアライズ可能な引数を取得する
		type SubmitPayload = {
			profileImages: Array<{ id?: string; uploadRef?: string }>;
			deletedImageIds: string[];
		};
		let capturedPayload: SubmitPayload | null = null;
		page.on("console", async (msg) => {
			if (
				msg.type() === "log" &&
				msg.text().includes("Updating user profile with data:")
			) {
				const args = msg.args();
				if (args.length >= 2) {
					capturedPayload = (await args[1].jsonValue()) as SubmitPayload;
				}
			}
		});

		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		const preElement = page.locator("pre");

		const firstItem = imageItems.first();
		const changeInput = firstItem.locator('input[type="file"]');
		await changeInput.setInputFiles(jpegPath);

		await expect(
			firstItem.getByText("新規画像", { exact: true }),
		).toBeVisible();

		await expect
			.poll(
				async () => {
					const text = await preElement.textContent();
					if (!text) return false;
					const arr = JSON.parse(text);
					return arr.some(
						(img: { status: string; uploadRef?: string }) =>
							img.status === "new" && img.uploadRef,
					);
				},
				{ timeout: 15_000 },
			)
			.toBe(true);

		const secondItem = imageItems.nth(1);
		await secondItem.getByRole("button", { name: "削除" }).click();

		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(jpegPath2);
		await expect(page.getByText("新規画像", { exact: true })).toHaveCount(2);

		await expect
			.poll(
				async () => {
					const text = await preElement.textContent();
					if (!text) return false;
					const arr = JSON.parse(text);
					const newWithUrl = arr.filter(
						(img: { status: string; uploadRef?: string }) =>
							img.status === "new" && img.uploadRef,
					);
					return newWithUrl.length >= 2;
				},
				{ timeout: 15_000 },
			)
			.toBe(true);

		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();
		await expect(submitButton).toHaveText("保存中...");
		await expect(submitButton).toHaveText("保存", { timeout: 15_000 });
		await expect(submitButton).toBeEnabled();

		// 送信ペイロードの検証。console イベントの到着はクリックと非同期なので待つ
		await expect.poll(() => capturedPayload).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: capturedPayload is verified non-null above; let captured in async closure prevents TS narrowing
		const payload = capturedPayload!;

		// 表示順の配列。既存 2 件は差し替え・削除で消えたので、新規 2 件だけが残る
		expect(payload.profileImages).toHaveLength(2);
		for (const img of payload.profileImages) {
			expect(typeof img.uploadRef).toBe("string");
			expect(img.id).toBeUndefined();
		}

		// 差し替え元 + 削除した既存
		expect(payload.deletedImageIds).toHaveLength(2);
		for (const id of payload.deletedImageIds) {
			expect(typeof id).toBe("string");
		}
	});
});

test.describe("アップロード完了後の送信", () => {
	test("新規画像のアップロード完了後に正常送信できる", async ({ page }) => {
		await page.goto("/");

		const preElement = page.locator("pre");

		// デフォルト既存画像がある状態で新規画像を追加
		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(jpegPath);
		await expect(page.getByText("新規画像", { exact: true })).toBeVisible();

		// upload-on-select でアップロード完了を待つ
		await expect
			.poll(
				async () => {
					const text = await preElement.textContent();
					if (!text) return false;
					const arr = JSON.parse(text);
					return arr.some(
						(img: { status: string; uploadRef?: string }) =>
							img.status === "new" && img.uploadRef,
					);
				},
				{ timeout: 15_000 },
			)
			.toBe(true);

		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();
		await expect(submitButton).toHaveText("保存中...");
		await expect(submitButton).toHaveText("保存", { timeout: 15_000 });
		await expect(submitButton).toBeEnabled();
	});
});

test.describe("統合シナリオ", () => {
	test("画像追加→並び替え→送信", async ({ page }) => {
		await page.goto("/");

		// 新規画像追加
		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(jpegPath);

		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		await expect(imageItems).toHaveCount(3);

		// 新規画像（3番目）を↑で移動
		const thirdItem = imageItems.nth(2);
		await thirdItem.getByRole("button", { name: "↑" }).click();

		// 名前変更
		await page.locator("#name").clear();
		await page.locator("#name").fill("変更後ユーザー");

		// 送信
		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();
		await expect(submitButton).toHaveText("保存", { timeout: 15_000 });
		await expect(submitButton).toBeEnabled();
	});

	test("既存差し替え→削除→新規追加→送信", async ({ page }) => {
		await page.goto("/");

		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");

		// 1枚目の既存画像を差し替え
		const firstItem = imageItems.first();
		const changeInput = firstItem.locator('input[type="file"]');
		await changeInput.setInputFiles(jpegPath);

		// 2枚目の既存画像を削除
		const secondItem = imageItems.nth(1);
		await secondItem.getByRole("button", { name: "削除" }).click();

		// 新規画像を追加
		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(jpegPath2);

		// 送信
		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();
		await expect(submitButton).toHaveText("保存", { timeout: 15_000 });
		await expect(submitButton).toBeEnabled();
	});

	test("空状態から画像追加→選択時にアップロード→送信", async ({ page }) => {
		await page.goto("/");

		// console.log監視
		const consoleLogs: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "log") {
				consoleLogs.push(msg.text());
			}
		});

		// トグルOFFで空状態にする（labelテキストをクリック）
		await page.getByText(/デフォルト画像データ/).click();
		await expect(page.getByText("画像が選択されていません")).toBeVisible();

		// 画像追加
		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(jpegPath);
		await expect(page.getByText("新規画像", { exact: true })).toBeVisible();

		// ファイル選択時にアップロードが開始されることを確認
		await expect
			.poll(
				() => consoleLogs.some((log) => log.includes("Getting presigned URL")),
				{
					timeout: 10_000,
				},
			)
			.toBe(true);

		// 送信
		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();
		await expect(submitButton).toHaveText("保存", { timeout: 15_000 });
	});
});
