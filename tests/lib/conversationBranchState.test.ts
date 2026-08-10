import { describe, expect, it } from "vitest";
import { branchTitle } from "../../apps/web/src/lib/conversationBranchState";

describe("branch titles", () => {
  it("uses the selected passage before an optional follow-up prompt", () => {
    expect(
      branchTitle({
        selectedText: "selected source passage",
        displayText: "Selected source passage",
        prompt: "Explain this differently",
      }),
    ).toBe("Selected source passage");
  });

  it("uses the follow-up prompt when there is no selected passage", () => {
    expect(branchTitle({ prompt: "Compare the available approaches" })).toBe(
      "Compare the available approaches",
    );
  });
});
