import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeExisting, makeFile } from "./TestHarness";

describe.each(harnesses)("Delete (%s)", (_label, Harness) => {
	it("New 画像の削除 → DOM から除去される", async () => {
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("a.jpg"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await page.getByTestId("delete-0").click();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		await expect.element(page.getByTestId("empty-message")).toBeVisible();
	});

	it("Existing 画像の削除 → 非表示化され残りの画像が正しく表示される", async () => {
		await render(
			<Harness
				initialImages={[
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				]}
			/>,
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("id-a");
		await expect.element(page.getByTestId("name-1")).toHaveTextContent("id-b");

		await page.getByTestId("delete-0").click();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("id-b");
		await expect
			.element(page.getByTestId("status-0"))
			.toHaveTextContent("existing");
	});

	it("New 画像の削除後に maxImages 制約が解放されて追加可能になる", async () => {
		const onError = vi.fn();
		await render(<Harness constraints={{ maxImages: 1 }} onError={onError} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("a.jpg"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("b.jpg"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await page.getByTestId("delete-0").click();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");

		onError.mockClear();
		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("c.jpg"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		expect(onError).not.toHaveBeenCalled();
	});

	it("Existing 画像の削除 (ToBeDeleted) 後に枠が解放されて追加可能になる", async () => {
		const onError = vi.fn();
		await render(
			<Harness
				constraints={{ maxImages: 1 }}
				initialImages={[makeExisting("temp_a", "id-a")]}
				onError={onError}
			/>,
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("b.jpg"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ type: "max_images" }),
		);

		await page.getByTestId("delete-0").click();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");

		onError.mockClear();
		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("c.jpg"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		expect(onError).not.toHaveBeenCalled();
	});
});
