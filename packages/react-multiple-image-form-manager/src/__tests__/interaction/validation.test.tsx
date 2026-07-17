import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeFile } from "./TestHarness";

describe.each(harnesses)("Validation (%s)", (_label, Harness) => {
	it("不正ファイル追加 → エラーメッセージが DOM に表示される", async () => {
		await render(<Harness maxImages={3} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("bad.gif", "image/gif"));

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("error-0")).toBeVisible();
	});

	it("不正ファイルのエラーメッセージに acceptedTypes の情報が含まれる", async () => {
		await render(<Harness maxImages={3} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("bad.gif", "image/gif"));

		await expect.element(page.getByTestId("error-0")).toBeVisible();
		const errorText = page.getByTestId("error-0").element().textContent ?? "";
		expect(errorText).toMatch(/image\/jpeg|image\/png/);
	});

	it("maxImages 超過 → ルートエラーに枚数制限メッセージが表示される", async () => {
		await render(<Harness maxImages={1} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.jpg"));
		await userEvent.upload(input.element(), makeFile("b.jpg"));

		await expect.element(page.getByTestId("root-error")).toBeVisible();
		const rootText = page.getByTestId("root-error").element().textContent ?? "";
		expect(rootText).toMatch(/1/);
	});

	it("不正ファイルを削除 → エラー表示が消える", async () => {
		await render(<Harness maxImages={3} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("bad.gif", "image/gif"));
		await expect.element(page.getByTestId("error-0")).toBeVisible();

		await page.getByTestId("delete-0").click();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
	});

	it("不正ファイルを正しいファイルに差し替え → エラーが消える", async () => {
		await render(<Harness maxImages={3} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("bad.gif", "image/gif"));
		await expect.element(page.getByTestId("error-0")).toBeVisible();

		const changeInput = page.getByTestId("change-input-0");
		await userEvent.upload(changeInput.element(), makeFile("good.jpg"));

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("name-0"))
			.toHaveTextContent("good.jpg");
		await expect.element(page.getByTestId("error-0")).not.toBeInTheDocument();
	});

	it("maxImages 超過分を削除 → ルートエラーが消える", async () => {
		await render(<Harness maxImages={1} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.jpg"));
		await userEvent.upload(input.element(), makeFile("b.jpg"));
		await expect.element(page.getByTestId("root-error")).toBeVisible();

		await page.getByTestId("delete-1").click();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("root-error"))
			.not.toBeInTheDocument();
	});
});
