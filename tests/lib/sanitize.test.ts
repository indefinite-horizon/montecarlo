/** Unit tests for analytics property sanitization. */

import { describe, expect, it } from "vitest";
import { sanitizeProperties } from "../../lib/analytics/sanitize";

describe("sanitizeProperties", () => {
  it("keeps flat primitive analytics properties", () => {
    expect(
      sanitizeProperties({
        user_id: "users_1",
        count: 2,
        enabled: true,
        tags: ["core", "template"],
        empty: null,
        result: "success",
      }),
    ).toEqual({
      user_id: "users_1",
      count: 2,
      enabled: true,
      tags: ["core", "template"],
      empty: null,
      result: "success",
    });
  });

  it("drops undefined values", () => {
    expect(sanitizeProperties({ user_id: "users_1", skipped: undefined })).toEqual({
      user_id: "users_1",
    });
  });

  it("allows product labels that are not sensitive by key alone", () => {
    expect(
      sanitizeProperties({
        agent_handle: "triage",
        agent_name: "Triage",
        display_name: "Project workspace",
        handle: "triage",
        workspace_name: "Prague",
        workspace_slug: "prague-v1",
      }),
    ).toEqual({
      agent_handle: "triage",
      agent_name: "Triage",
      display_name: "Project workspace",
      handle: "triage",
      workspace_name: "Prague",
      workspace_slug: "prague-v1",
    });
  });

  it("rejects sensitive keys", () => {
    expect(() => sanitizeProperties({ email: "test@test.local" })).toThrow(/forbidden/);
    expect(() => sanitizeProperties({ member_email: "test@test.local" })).toThrow(/forbidden/);
    expect(() => sanitizeProperties({ phone_number: "555-0100" })).toThrow(/forbidden/);
    expect(() => sanitizeProperties({ api_key: "secret" })).toThrow(/forbidden/);
    expect(() => sanitizeProperties({ message_content: "raw text" })).toThrow(/forbidden/);
    expect(() => sanitizeProperties({ callback_url: "https://example.test" })).toThrow(/forbidden/);
  });

  it("rejects nested objects", () => {
    expect(() => sanitizeProperties({ nested: { value: true } })).toThrow(/unsupported/);
  });
});
