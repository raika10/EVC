import { describe, expect, it } from "vitest";
import { checkDelay, checkFailure, repoHint } from "./repoCheck";

describe("checkFailure", () => {
  it.each(["invalid_url", "not_found", "private"])("shows %s as an error", (code) => {
    expect(checkFailure(code, "理由")).toEqual({ state: "error", code, message: "理由" });
  });

  it.each(["rate_limited", "upstream", "network", "unreachable"])("does not block on %s", (code) => {
    expect(checkFailure(code, "理由")).toEqual({ state: "idle" });
  });
});

describe("repoHint", () => {
  const signedIn = { loginEnabled: true, hasGithubToken: true, canInstall: true };

  it.each(["not_found", "private"])("suggests logging in again when %s and the GitHub token is gone", (code) => {
    expect(repoHint(checkFailure(code, "理由"), { ...signedIn, hasGithubToken: false })).toBe("relogin");
  });

  it("suggests letting EVC read the repository when the token is held but the repository is not found", () => {
    expect(repoHint(checkFailure("not_found", "理由"), signedIn)).toBe("install");
  });

  it("stays quiet when the install page is not configured", () => {
    expect(repoHint(checkFailure("not_found", "理由"), { ...signedIn, canInstall: false })).toBeNull();
  });

  it("stays quiet without GitHub login (development mode)", () => {
    expect(repoHint(checkFailure("not_found", "理由"), { ...signedIn, loginEnabled: false })).toBeNull();
  });

  it("stays quiet for other results", () => {
    expect(repoHint(checkFailure("invalid_url", "理由"), signedIn)).toBeNull();
    expect(repoHint({ state: "ok", name: "o/r" }, signedIn)).toBeNull();
    expect(repoHint({ state: "checking" }, signedIn)).toBeNull();
  });
});

describe("checkDelay", () => {
  it("checks a pasted URL right away and waits while typing", () => {
    expect(checkDelay(true)).toBe(0);
    expect(checkDelay(false)).toBeGreaterThan(0);
  });
});
