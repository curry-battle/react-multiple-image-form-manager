import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeExisting, makeFile } from "./TestHarness";

describe.each(harnesses)("Edge Cases (%s)", (_label, Harness) => {
	it("削除ボタン連打 → ToBeDeleted の再削除は no-op で壊れない", async () => {
		const onError = vi.fn();
		await render(
			<Harness
				initialImages={[
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				]}
				onError={onError}
			/>,
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");

		await page.getByTestId("delete-0").click();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("id-b");

		// 再度削除（id-b を削除）
		await page.getByTestId("delete-0").click();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		await expect.element(page.getByTestId("empty-message")).toBeVisible();

		expect(onError).not.toHaveBeenCalled();
	});

	it("同一ファイルを連続で追加できる (add-input の value がリセットされる)", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");

		await userEvent.upload(input.element(), makeFile("same.jpg"));
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		// value がリセットされているため同じファイルを再選択可能
		await userEvent.upload(input.element(), makeFile("same.jpg"));
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");
	});
});
