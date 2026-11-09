import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepoSettings } from "../api";
import { timeAgo } from "../lib/time";
import { SettingsForm } from "./SettingsForm";

const settings: RepoSettings = {
  enabled: true,
  skipDrafts: true,
  minSeverity: "medium",
  categories: { bug: true, security: true, tests: true, performance: false, style: false },
  ignorePaths: ["**/*.lock"],
  instructions: "",
  maxComments: 15,
};

afterEach(cleanup);

describe("SettingsForm", () => {
  it("saves edited settings, turning the ignore list into an array", async () => {
    const onSave = vi.fn(async () => {});
    render(<SettingsForm initial={settings} readOnly={false} onSave={onSave} />);

    fireEvent.click(screen.getByLabelText(/Performance/));
    fireEvent.change(screen.getByDisplayValue("Medium: likely problems"), { target: { value: "high" } });
    fireEvent.change(screen.getByDisplayValue("**/*.lock"), { target: { value: "**/*.lock\n\n  generated/**  \n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(screen.getByText(/Saved/)).toBeTruthy());
    expect(onSave).toHaveBeenCalledWith({
      ...settings,
      minSeverity: "high",
      categories: { ...settings.categories, performance: true },
      ignorePaths: ["**/*.lock", "generated/**"],
    });
  });

  it("shows the server's error message when saving fails", async () => {
    render(<SettingsForm initial={settings} readOnly={false} onSave={async () => Promise.reject(new Error("invalid settings"))} />);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(screen.getByText("invalid settings")).toBeTruthy());
  });

  it("is read-only without write access", () => {
    render(<SettingsForm initial={settings} readOnly onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    // Disabled through the surrounding <fieldset>, so check the computed state rather than the attribute.
    expect(screen.getByRole("switch").matches(":disabled")).toBe(true);
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  it("reads naturally", () => {
    expect(timeAgo("2026-11-09T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-11-09T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-11-08T12:00:00Z", now)).toBe("yesterday");
  });
});
