import { createRef, useEffect, useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { TextField } from "./TextField";

const ADDRESS = "0xC584D72D380Cb5b1e3aB71383a168C93d08e0Fe2";

function Salt({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <TextField
      label="Salt"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      mono
    />
  );
}

describe("TextField", () => {
  test("its label is its name; typing calls onValueChange", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Salt onChange={onChange} />);
    const input = page.getByRole("textbox", { name: "Salt" });
    await userEvent.tab();
    await expect.element(input).toHaveFocus();
    await userEvent.keyboard("0x01");
    await expect.element(input).toHaveValue("0x01");
    expect(onChange).toHaveBeenLastCalledWith("0x01");
  });

  test("a click on the label focuses the input", async () => {
    await renderWithStudio(<Salt />);
    await page.getByText("Salt", { exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "Salt" })).toHaveFocus();
  });

  test("mono fields use the code face and turn spellcheck off", async () => {
    await renderWithStudio(
      <>
        <Salt />
        <TextField label="Project name" defaultValue="GovernedVault" />
      </>,
    );
    const salt = page.getByRole("textbox", { name: "Salt" }).element() as HTMLInputElement;
    const name = page.getByRole("textbox", { name: "Project name" }).element() as HTMLInputElement;
    expect(salt.spellcheck).toBe(false);
    expect(name.spellcheck).toBe(true);
    expect(getComputedStyle(salt).fontFamily).toContain("JetBrains Mono");
    expect(getComputedStyle(name).fontFamily).toContain("Inter");
  });

  test("a password type masks the value; the default is plain text", async () => {
    await renderWithStudio(
      <>
        <TextField label="API key" type="password" defaultValue="secret" />
        <TextField label="Name" defaultValue="plain" />
      </>,
    );
    await expect.element(page.getByLabelText("API key")).toHaveAttribute("type", "password");
    await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveValue("plain");
  });

  test("description and error are wired; an error sets aria-invalid and shows the error icon", async () => {
    await renderWithStudio(
      <TextField
        label="Salt"
        defaultValue="0x12"
        description="32 bytes, hex."
        error="Enter 32 bytes: 64 hex digits after 0x."
        mono
      />,
    );
    const input = page.getByRole("textbox", { name: "Salt" });
    await expect.element(input).toHaveAttribute("aria-invalid", "true");
    await expect.element(input).toHaveAccessibleDescription("32 bytes, hex. Enter 32 bytes: 64 hex digits after 0x.");
    const message = page.getByText("Enter 32 bytes: 64 hex digits after 0x.");
    await expect.element(message).toBeVisible();
    expect(message.element().parentElement?.querySelector("[data-icon='error']")).not.toBeNull();
  });

  test("valid fields are not marked invalid", async () => {
    await renderWithStudio(<TextField label="Salt" defaultValue="0x12" />);
    await expect.element(page.getByRole("textbox", { name: "Salt" })).not.toHaveAttribute("aria-invalid", "true");
  });

  test("read-only: focusable and selectable, never edited", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<TextField label="Deploying account" value={ADDRESS} onValueChange={onChange} readOnly mono />);
    const input = page.getByRole("textbox", { name: "Deploying account" });
    await userEvent.tab();
    await expect.element(input).toHaveFocus();
    await userEvent.keyboard("abc");
    await expect.element(input).toHaveValue(ADDRESS);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("disabled with a reason: focusable, says why, never changes", async () => {
    const onChange = vi.fn();
    await renderWithStudio(
      <TextField
        label="Deploying account"
        defaultValue=""
        description="The account that sends the deploy."
        disabledReason="Connect a wallet first"
        onValueChange={onChange}
        mono
      />,
    );
    const input = page.getByRole("textbox", { name: "Deploying account" });
    await expect.element(input).toHaveAttribute("aria-disabled", "true");
    await expect
      .element(input)
      .toHaveAccessibleDescription("The account that sends the deploy. Connect a wallet first");
    await userEvent.tab();
    await expect.element(input).toHaveFocus();
    await userEvent.keyboard("0xabc");
    await input.click({ force: true });
    await expect.element(input).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
    await expect.element(page.getByText("Connect a wallet first", { exact: true }).last()).toBeVisible();
  });

  test("a reason coming or going keeps the input and its focus (no remount)", async () => {
    const control = { set: (_reason: string | undefined) => {} };
    function Toggled() {
      const [reason, setReason] = useState<string | undefined>(undefined);
      useEffect(() => {
        control.set = setReason;
      }, []);
      return <TextField label="Deploying account" defaultValue="" disabledReason={reason} mono />;
    }
    await renderWithStudio(<Toggled />);
    const input = page.getByRole("textbox", { name: "Deploying account" });
    await userEvent.tab();
    await expect.element(input).toHaveFocus();
    const before = input.element();
    control.set("Connect a wallet first");
    await expect.element(input).toHaveAttribute("aria-disabled", "true");
    expect(input.element()).toBe(before);
    await expect.element(input).toHaveFocus();
    control.set(undefined);
    await expect.element(input).not.toHaveAttribute("aria-disabled", "true");
    expect(input.element()).toBe(before);
    await expect.element(input).toHaveFocus();
  });

  test("inputRef gives the input; id sets its id and the label still names it", async () => {
    const ref = createRef<HTMLInputElement>();
    await renderWithStudio(<TextField label="Salt" defaultValue="0x12" inputRef={ref} id="salt-input" />);
    const input = page.getByRole("textbox", { name: "Salt" }).element();
    expect(ref.current).toBe(input);
    expect(input.id).toBe("salt-input");
  });

  test("onBlur fires when focus leaves the input", async () => {
    const onBlur = vi.fn();
    await renderWithStudio(
      <>
        <TextField label="Salt" defaultValue="" onBlur={onBlur} />
        <button type="button">After</button>
      </>,
    );
    await userEvent.tab();
    await expect.element(page.getByRole("textbox", { name: "Salt" })).toHaveFocus();
    expect(onBlur).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("autoFocus focuses the input on mount", async () => {
    // oxlint-disable-next-line jsx-a11y/no-autofocus -- the prop under test (an inline rename that just opened)
    await renderWithStudio(<TextField label="Facet name" defaultValue="ERC20Facet" autoFocus />);
    await expect.element(page.getByRole("textbox", { name: "Facet name" })).toHaveFocus();
  });

  test("a long value scrolls inside the input; a long error wraps", async () => {
    await renderWithStudio(
      <div style={{ inlineSize: "200px" }}>
        <TextField label="Deploying account" defaultValue={ADDRESS} error={`${ADDRESS} is not a contract on Sepolia.`} mono />
      </div>,
    );
    const input = page.getByRole("textbox", { name: "Deploying account" }).element();
    expect(input.getBoundingClientRect().width).toBeLessThanOrEqual(200);
    expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    const error = page.getByText(`${ADDRESS} is not a contract on Sepolia.`).element();
    expect(error.getBoundingClientRect().width).toBeLessThanOrEqual(200);
  });
});
