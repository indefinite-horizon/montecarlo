/** Verifies deterministic placeholder selection and bounded generated titles. */

import { describe, expect, it } from "vitest";
import {
  chatTitlePrompt,
  isFoodChatName,
  normalizeGeneratedChatTitle,
  randomFoodChatName,
} from "../../apps/web/src/lib/chatNaming";
import { foodChatNames } from "../../lib/foodChatNames";

describe("chat naming", () => {
  it("keeps exactly 500 unique, recognizable placeholders", () => {
    expect(foodChatNames).toHaveLength(500);
    expect(new Set(foodChatNames).size).toBe(500);
    expect(foodChatNames).toContain("Mac and Cheese");
    expect(foodChatNames).toContain("Pepperoni Pizza");
  });

  it("selects placeholders across the full bounded pool", () => {
    expect(randomFoodChatName(0)).toBe(foodChatNames[0]);
    expect(randomFoodChatName(0.999_999)).toBe(foodChatNames.at(-1));
    expect(isFoodChatName(randomFoodChatName(0.5))).toBe(true);
    expect(isFoodChatName("New conversation")).toBe(false);
  });

  it("asks for intent-only output and bounds model responses to seven words", () => {
    expect(chatTitlePrompt("Compare launch options")).toContain(
      '<user_intent>"Compare launch options"</user_intent>',
    );
    expect(
      normalizeGeneratedChatTitle('Title: "Plan a focused product launch this quarter please"'),
    ).toBe("Plan a focused product launch this quarter");
    expect(normalizeGeneratedChatTitle("```\nRank US schools\n```")).toBe("Rank US schools");
    expect(normalizeGeneratedChatTitle("“Plan a launch”")).toBe("Plan a launch");
    expect(normalizeGeneratedChatTitle("‘Compare providers’")).toBe("Compare providers");
    expect(normalizeGeneratedChatTitle("   ")).toBeUndefined();
  });
});
