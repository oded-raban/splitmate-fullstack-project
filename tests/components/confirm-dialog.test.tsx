/**
 * ConfirmDialog's typed-phrase gate.
 * =============================================================================
 * This is the one piece of UI in the app whose entire job is to prevent a
 * destructive click, so its gate deserves a dedicated suite rather than being
 * exercised incidentally through whichever page happens to use it.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfirmDialog } from "@/components/common/confirm-dialog";

describe("ConfirmDialog", () => {
  it("confirms immediately when no phrase is required", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <ConfirmDialog
        trigger={<button>Remove</button>}
        title="Remove this?"
        description="This cannot be undone."
        confirmLabel="Remove"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove" }));
    const confirmButton = await screen.findByTestId("confirm-action");
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("keeps the confirm action disabled until the exact phrase is typed", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <ConfirmDialog
        trigger={<button>Delete household</button>}
        title="Delete Dizengoff 42?"
        description="Their expenses stay in the ledger and they lose access."
        confirmLabel="Delete"
        confirmPhrase="Dizengoff 42"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete household" }));
    const confirmButton = await screen.findByTestId("confirm-action");
    const input = screen.getByTestId("confirm-phrase");

    expect(confirmButton).toBeDisabled();

    await user.type(input, "Dizengoff");
    expect(confirmButton).toBeDisabled();

    await user.type(input, " 42");
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("does not unlock on a near-miss phrase, even a case difference", async () => {
    const user = userEvent.setup();

    render(
      <ConfirmDialog
        trigger={<button>Remove Maya</button>}
        title="Remove Maya?"
        description="They lose access to this household."
        confirmLabel="Remove"
        confirmPhrase="Maya"
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove Maya" }));
    const confirmButton = await screen.findByTestId("confirm-action");
    const input = screen.getByTestId("confirm-phrase");

    await user.type(input, "maya");
    expect(confirmButton).toBeDisabled();

    await user.clear(input);
    await user.type(input, "Maya "); // trailing space, trimmed by the component
    expect(confirmButton).toBeEnabled();
  });

  it("resets the typed phrase after cancelling, so re-opening starts locked", async () => {
    const user = userEvent.setup();

    render(
      <ConfirmDialog
        trigger={<button>Delete</button>}
        title="Delete?"
        description="Gone for good."
        confirmLabel="Delete"
        confirmPhrase="CONFIRM"
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.type(await screen.findByTestId("confirm-phrase"), "CONFIRM");
    expect(await screen.findByTestId("confirm-action")).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByTestId("confirm-phrase")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByTestId("confirm-action")).toBeDisabled();
    expect(screen.getByTestId("confirm-phrase")).toHaveValue("");
  });
});
