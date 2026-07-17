import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeExisting, makeFile } from "./TestHarness";

describe.each(harnesses)("Move (%s)", (_label, Harness) => {
	it("下ボタンクリック → 画像の順序が入れ替わる", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.jpg"));
		await userEvent.upload(input.element(), makeFile("b.jpg"));
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("a.jpg");
		await expect.element(page.getByTestId("name-1")).toHaveTextContent("b.jpg");

		await page.getByTestId("move-down-0").click();

		await expect.element(page.getByTestId("name-0")).toHaveTextContent("b.jpg");
		await expect.element(page.getByTestId("name-1")).toHaveTextContent("a.jpg");
	});

	it("上ボタンクリック → 画像の順序が入れ替わる", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.jpg"));
		await userEvent.upload(input.element(), makeFile("b.jpg"));

		await page.getByTestId("move-up-1").click();

		await expect.element(page.getByTestId("name-0")).toHaveTextContent("b.jpg");
		await expect.element(page.getByTestId("name-1")).toHaveTextContent("a.jpg");
	});

	it("先頭の上ボタンは disabled", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.jpg"));
		await userEvent.upload(input.element(), makeFile("b.jpg"));

		await expect.element(page.getByTestId("move-up-0")).toBeDisabled();
	});

	it("末尾の下ボタンは disabled", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.jpg"));
		await userEvent.upload(input.element(), makeFile("b.jpg"));

		await expect.element(page.getByTestId("move-down-1")).toBeDisabled();
	});

	it("先頭の下ボタンは有効、末尾の上ボタンは有効", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.jpg"));
		await userEvent.upload(input.element(), makeFile("b.jpg"));

		await expect.element(page.getByTestId("move-down-0")).not.toBeDisabled();
		await expect.element(page.getByTestId("move-up-1")).not.toBeDisabled();
	});

	it("Existing 削除後 (ToBeDeleted 混在) でも残った可視アイテム間で move が動作する", async () => {
		await render(
			<Harness
				initialImages={[
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
					makeExisting("temp_c", "id-c"),
				]}
			/>,
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("3");

		// 中間の id-b を削除 → ToBeDeleted 化
		await page.getByTestId("delete-1").click();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("id-a");
		await expect.element(page.getByTestId("name-1")).toHaveTextContent("id-c");

		// id-a を下に移動 → id-c と交換 (ToBeDeleted をスキップ)
		await page.getByTestId("move-down-0").click();
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("id-c");
		await expect.element(page.getByTestId("name-1")).toHaveTextContent("id-a");
	});
});
