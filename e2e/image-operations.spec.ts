import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
const jpegPath = path.join(fixturesDir, "test-image.jpg");
const jpegPath2 = path.join(fixturesDir, "test-image-2.jpg");
const pngPath = path.join(fixturesDir, "invalid-image.png");

test.describe("画像の追加", () => {
	test("JPEG追加で新規画像表示", async ({ page }) => {
		await page.goto("/");

		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(jpegPath);

		await expect(page.getByText("新規画像", { exact: true })).toBeVisible();
	});

	test("複数JPEG連続追加", async ({ page }) => {
		await page.goto("/");

		const fileInput = page.locator("#imageUpload-profileImages");

		const newImages = page.getByText("新規画像", { exact: true });

		await fileInput.setInputFiles(jpegPath);
		await expect(newImages).toHaveCount(1);
		await fileInput.setInputFiles(jpegPath2);
		await expect(newImages).toHaveCount(2);
		await fileInput.setInputFiles(jpegPath);
		await expect(newImages).toHaveCount(3);
	});

	test("PNG追加でバリデーションエラー", async ({ page }) => {
		await page.goto("/");

		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(pngPath);

		// 新規画像として追加されるがバリデーションエラーが表示される
		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		const lastItem = imageItems.last();
		await expect(lastItem.locator(".text-red-500")).toBeVisible();
	});

	test("空状態から画像追加で空メッセージ消える", async ({ page }) => {
		await page.goto("/");

		// トグルOFFで空状態にする（labelテキストをクリック）
		await page.getByText(/デフォルト画像データ/).click();
		await expect(page.getByText("画像が選択されていません")).toBeVisible();

		// 画像追加
		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(jpegPath);

		await expect(page.getByText("画像が選択されていません")).not.toBeVisible();
	});
});

test.describe("画像の削除", () => {
	test("新規画像を削除", async ({ page }) => {
		await page.goto("/");

		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(jpegPath);
		await expect(page.getByText("新規画像", { exact: true })).toBeVisible();

		// 新規画像の削除ボタンをクリック
		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		// 新規画像は最後に追加される（3番目）
		const newImageItem = imageItems.last();
		await newImageItem.getByRole("button", { name: "削除" }).click();

		await expect(page.getByText("新規画像", { exact: true })).not.toBeVisible();
	});

	test("既存画像を削除", async ({ page }) => {
		await page.goto("/");

		const existingLabels = page.getByText("既存画像", { exact: true });
		await expect(existingLabels).toHaveCount(2);

		// 最初の既存画像を削除
		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		await imageItems.first().getByRole("button", { name: "削除" }).click();

		await expect(page.getByText("既存画像", { exact: true })).toHaveCount(1);
	});

	test("既存画像削除後JSON内にtobedeleted", async ({ page }) => {
		await page.goto("/");

		// 最初の既存画像を削除
		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		await imageItems.first().getByRole("button", { name: "削除" }).click();

		// JSON表示内に tobedeleted が含まれることを確認
		const preElement = page.locator("pre");
		await expect(preElement).toContainText("tobedeleted");
	});

	test("全画像削除で空メッセージ", async ({ page }) => {
		await page.goto("/");

		// 既存画像2枚を順に削除
		const deleteButtons = page.getByRole("button", { name: "削除" });
		await deleteButtons.first().click();
		await deleteButtons.first().click();

		await expect(page.getByText("画像が選択されていません")).toBeVisible();
	});
});

test.describe("画像エラー時の保存ボタン制御", () => {
	test("PNG追加でエラー表示かつ保存ボタンが無効化される", async ({ page }) => {
		await page.goto("/");

		const submitButton = page.getByRole("button", { name: "保存" });
		await expect(submitButton).toBeEnabled();

		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(pngPath);

		// エラーテキストが表示される
		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		const lastItem = imageItems.last();
		await expect(lastItem.locator(".text-red-500")).toBeVisible();

		// 保存ボタンが無効化される
		await expect(submitButton).toBeDisabled();
	});

	test("不正画像を正しい画像に差し替えるとエラーが消えて保存可能に戻る", async ({
		page,
	}) => {
		await page.goto("/");

		const submitButton = page.getByRole("button", { name: "保存" });

		// PNG追加でエラー状態にする
		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(pngPath);

		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		const lastItem = imageItems.last();
		await expect(lastItem.locator(".text-red-500")).toBeVisible();
		await expect(submitButton).toBeDisabled();

		// 不正画像の「変更」ボタンでJPEGに差し替え
		const changeInput = lastItem.locator('input[type="file"]');
		await changeInput.setInputFiles(jpegPath);

		// エラーが消える
		await expect(lastItem.locator(".text-red-500")).not.toBeVisible({
			timeout: 5_000,
		});

		// 保存ボタンが有効に戻る
		await expect(submitButton).toBeEnabled({ timeout: 10_000 });
	});

	test("エラーメッセージにファイル形式の制約が表示される", async ({ page }) => {
		await page.goto("/");

		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(pngPath);

		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		const lastItem = imageItems.last();
		const errorText = lastItem.locator(".text-red-500");
		await expect(errorText).toBeVisible();

		const message = await errorText.textContent();
		expect(message).toMatch(/jpeg/i);
	});
});

test.describe("画像のファイル差し替え", () => {
	test("新規画像を差し替え", async ({ page }) => {
		await page.goto("/");

		// 新規画像を追加
		const fileInput = page.locator("#imageUpload-profileImages");
		await fileInput.setInputFiles(jpegPath);
		await expect(page.getByText("新規画像", { exact: true })).toBeVisible();

		// 新規画像の「変更」ボタンのfile inputを取得
		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		const newImageItem = imageItems.last();
		const changeInput = newImageItem.locator('input[type="file"]');
		await changeInput.setInputFiles(jpegPath2);

		// 差し替え後も新規画像として表示
		await expect(page.getByText("新規画像", { exact: true })).toBeVisible();
	});

	test("既存画像を差し替え", async ({ page }) => {
		await page.goto("/");

		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		const firstItem = imageItems.first();

		// 既存画像であることを確認
		await expect(
			firstItem.getByText("既存画像", { exact: true }),
		).toBeVisible();

		// 「変更」のfile inputでファイルを差し替え
		const changeInput = firstItem.locator('input[type="file"]');
		await changeInput.setInputFiles(jpegPath);

		// 差し替え後は「新規画像」ラベルに変化
		await expect(
			firstItem.getByText("新規画像", { exact: true }),
		).toBeVisible();
	});
});

test.describe("画像の並び替え", () => {
	test("↑ボタンで順序入替", async ({ page }) => {
		await page.goto("/");

		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");

		// 2番目のアイテムのOrder確認
		const secondItem = imageItems.nth(1);
		await expect(secondItem.getByText("Order: 1")).toBeVisible();

		// 2番目の↑ボタンをクリック
		await secondItem.getByRole("button", { name: "↑" }).click();

		// 元の2番目が先頭（Order: 0）になる
		const firstItem = imageItems.first();
		// 元2番目のtempId（既存画像2）が先頭に来ていることをOrder値で確認
		await expect(firstItem.getByText("Order: 0")).toBeVisible();
	});

	test("↓ボタンで順序入替", async ({ page }) => {
		await page.goto("/");

		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");

		// 1番目のアイテムのOrder確認
		const firstItem = imageItems.first();
		await expect(firstItem.getByText("Order: 0")).toBeVisible();

		// 1番目の↓ボタンをクリック
		await firstItem.getByRole("button", { name: "↓" }).click();

		// 元の1番目が2番目（Order: 1）になる
		const secondItem = imageItems.nth(1);
		await expect(secondItem.getByText("Order: 1")).toBeVisible();
	});

	test("先頭の↑は無効", async ({ page }) => {
		await page.goto("/");

		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		const firstItem = imageItems.first();

		await expect(firstItem.getByRole("button", { name: "↑" })).toBeDisabled();
	});

	test("末尾の↓は無効", async ({ page }) => {
		await page.goto("/");

		const imageItems = page.locator(".flex.items-center.gap-4.p-4.border");
		const lastItem = imageItems.last();

		await expect(lastItem.getByRole("button", { name: "↓" })).toBeDisabled();
	});
});
