import { expect, test } from "@playwright/test";

test.describe("初期表示", () => {
	test("ページタイトル・フォームが表示される", async ({ page }) => {
		await page.goto("/");

		await expect(
			page.getByText("Form with Multiple Image Uploads Example"),
		).toBeVisible();
		await expect(page.getByText("プロフィール編集")).toBeVisible();
	});

	test("デフォルト画像あり: 既存画像2枚表示", async ({ page }) => {
		await page.goto("/");

		const existingLabels = page.getByText("既存画像", { exact: true });
		await expect(existingLabels).toHaveCount(2);
	});

	test("名前に初期値「サンプルユーザー」", async ({ page }) => {
		await page.goto("/");

		await expect(page.locator("#name")).toHaveValue("サンプルユーザー");
	});

	test("保存ボタンが有効", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByRole("button", { name: "保存" })).toBeEnabled();
	});
});

test.describe("トグル操作", () => {
	test("トグルOFF: 画像なし状態", async ({ page }) => {
		await page.goto("/");

		// トグルをOFFにする（labelテキストをクリック）
		await page.getByText(/デフォルト画像データ/).click();

		await expect(page.getByText("画像が選択されていません")).toBeVisible();
	});

	test("トグルOFF→ON: 既存画像復元", async ({ page }) => {
		await page.goto("/");

		const toggle = page.getByText(/デフォルト画像データ/);

		// OFF → ON
		await toggle.click();
		await toggle.click();

		const existingLabels = page.getByText("既存画像", { exact: true });
		await expect(existingLabels).toHaveCount(2);
	});
});

test.describe("名前バリデーション", () => {
	test("名前空でエラー表示", async ({ page }) => {
		await page.goto("/");

		await page.locator("#name").clear();
		// onChangeバリデーションのトリガー
		await page.locator("#name").blur();

		await expect(page.getByText("名前は必須です")).toBeVisible();
	});

	test("名前空でsubmitボタン無効", async ({ page }) => {
		await page.goto("/");

		await page.locator("#name").clear();
		await page.locator("#name").blur();

		await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
	});

	test("入力するとエラー消える", async ({ page }) => {
		await page.goto("/");

		// 空にしてエラー表示
		await page.locator("#name").clear();
		await page.locator("#name").blur();
		await expect(page.getByText("名前は必須です")).toBeVisible();

		// 再入力でエラー消去
		await page.locator("#name").fill("テスト");
		await expect(page.getByText("名前は必須です")).not.toBeVisible();
	});
});
