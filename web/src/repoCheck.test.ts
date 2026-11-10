import { describe, expect, it } from "vitest";
import { accessFrom, checkDelay, checkFailure, repoHint, type RepoAccess } from "./repoCheck";

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
    expect(repoHint(checkFailure("not_found", "理由", { kind: "install" }), signedIn)).toBe("install");
  });

  it("sends people who already installed EVC to its settings, because the install page no longer lists them", () => {
    const configure: RepoAccess = { kind: "configure", url: "https://github.com/settings/installations/1" };
    expect(repoHint(checkFailure("not_found", "理由", configure), signedIn)).toBe("configure");
    expect(repoHint(checkFailure("not_found", "理由", configure), { ...signedIn, canInstall: false })).toBe("configure");
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

describe("accessFrom", () => {
  it("reads the GitHub page from the API's error", () => {
    expect(accessFrom({ error: "not_found", access: { kind: "install" } })).toEqual({ kind: "install" });
    expect(accessFrom({ access: { kind: "configure", url: "https://github.com/settings/installations/1" } })).toEqual({
      kind: "configure",
      url: "https://github.com/settings/installations/1",
    });
  });

  it("ignores anything else, and never links outside github.com", () => {
    expect(accessFrom(null)).toBeUndefined();
    expect(accessFrom({ error: "not_found" })).toBeUndefined();
    expect(accessFrom({ access: { kind: "configure", url: "https://example.com/phish" } })).toBeUndefined();
    expect(accessFrom({ access: { kind: "configure" } })).toBeUndefined();
  });
});

describe("checkDelay", () => {
  it("checks a pasted URL right away and waits while typing", () => {
    expect(checkDelay(true)).toBe(0);
    expect(checkDelay(false)).toBeGreaterThan(0);
  });
});
