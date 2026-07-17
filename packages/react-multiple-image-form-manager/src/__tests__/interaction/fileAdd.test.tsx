import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeExisting, makeFile } from "./TestHarness";

describe.each(harnesses)("File Add (%s)", (_label, Harness) => {
	it("file input でファイル選択 → 画像が追加される", async () => {
		await render(<Harness />);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		await expect.element(page.getByTestId("empty-message")).toBeVisible();

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("photo.jpg"));

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("status-0")).toHaveTextContent("new");
	});

	it("複数ファイル一括選択 → 全て追加される", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), [
			makeFile("a.jpg"),
			makeFile("b.jpg"),
			makeFile("c.jpg"),
		]);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("3");
	});

	it("maxImages 制約超過 → onError が呼ばれ画像が追加されない", async () => {
		const onError = vi.fn();
		await render(<Harness constraints={{ maxImages: 1 }} onError={onError} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.jpg"));
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await userEvent.upload(input.element(), makeFile("b.jpg"));
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ type: "max_images" }),
		);
	});

	it("一括選択で maxImages を跨ぐ → 上限まで追加され超過分は onError", async () => {
		const onError = vi.fn();
		await render(<Harness constraints={{ maxImages: 2 }} onError={onError} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), [
			makeFile("a.jpg"),
			makeFile("b.jpg"),
			makeFile("c.jpg"),
		]);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ type: "max_images" }),
		);
	});

	it("既存画像がある状態で新規画像を追加できる", async () => {
		await render(
			<Harness
				initialImages={[
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				]}
			/>,
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("new.jpg"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("3");
		await expect.element(page.getByTestId("status-2")).toHaveTextContent("new");
		await expect
			.element(page.getByTestId("name-2"))
			.toHaveTextContent("new.jpg");
	});
});
