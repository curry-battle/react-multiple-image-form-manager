import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeExisting, makeFile } from "./TestHarness";

describe.each(harnesses)("Reset (%s)", (_label, Harness) => {
	it("reset → UI が初期状態に戻る", async () => {
		let doReset: (() => void) | undefined;

		await render(
			<Harness
				initialImages={[makeExisting("temp_a", "id-a")]}
				onReset={(fn) => {
					doReset = fn;
				}}
			/>,
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("extra.jpg"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");

		// biome-ignore lint/style/noNonNullAssertion: doReset is assigned in onReset callback above
		doReset!();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("status-0"))
			.toHaveTextContent("existing");
	});

	it("Existing 削除後に reset → 削除した画像が復活する", async () => {
		let doReset: (() => void) | undefined;

		await render(
			<Harness
				initialImages={[
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				]}
				onReset={(fn) => {
					doReset = fn;
				}}
			/>,
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");

		await page.getByTestId("delete-0").click();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		// biome-ignore lint/style/noNonNullAssertion: doReset is assigned in onReset callback above
		doReset!();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("id-a");
		await expect.element(page.getByTestId("name-1")).toHaveTextContent("id-b");
	});

	it("バリデーションエラー表示中に reset → エラーが消える", async () => {
		let doReset: (() => void) | undefined;

		await render(
			<Harness
				maxImages={3}
				onReset={(fn) => {
					doReset = fn;
				}}
			/>,
		);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("bad.gif", "image/gif"),
		);
		await expect.element(page.getByTestId("error-0")).toBeVisible();

		// biome-ignore lint/style/noNonNullAssertion: doReset is assigned in onReset callback above
		doReset!();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		await expect.element(page.getByTestId("empty-message")).toBeVisible();
	});
});
