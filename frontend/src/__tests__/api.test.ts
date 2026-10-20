import { describe, expect, it } from "vitest";
import { ApiError, asRuleError } from "../lib/api";

describe("contract refusals reach the interface", () => {
  it("keeps the structured body, including the remedy", () => {
    // This is the regression that mattered: the body was being passed to
    // Error(message), which stringified it, so the user saw "[object Object]"
    // and the offer to demote never appeared.
    const detail = {
      message: "this day already holds 4 primary tasks",
      code: "primary_cap_reached",
      remedy: "demote an existing primary, or add this one as non-primary",
    };
    const rule = asRuleError(new ApiError(409, detail.message, detail));

    expect(rule).not.toBeNull();
    expect(rule!.code).toBe("primary_cap_reached");
    expect(rule!.remedy).toContain("demote");
  });

  it("never surfaces a stringified object", () => {
    const error = new ApiError(409, "a real message", {
      message: "a real message",
      code: "completed_immutable",
      remedy: null,
    });
    expect(error.message).not.toContain("[object Object]");
    expect(asRuleError(error)!.message).not.toContain("[object Object]");
  });

  it("degrades to the plain message for unstructured errors", () => {
    const rule = asRuleError(new ApiError(500, "Internal Server Error"));
    expect(rule).toEqual({
      message: "Internal Server Error",
      code: "unknown",
      remedy: null,
    });
  });

  it("returns null for anything that is not an ApiError", () => {
    expect(asRuleError(new Error("network down"))).toBeNull();
    expect(asRuleError("nope")).toBeNull();
  });
});
