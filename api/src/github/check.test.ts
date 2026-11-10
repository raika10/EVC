import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { parseAllowlist, type Authenticator } from "../auth.js";
import { findRepoAccess, type RepoAccess } from "./installations.js";
import { checkRepo } from "./snapshot.js";
import { RepoError } from "./url.js";

const fetching = (body: object, status = 200) => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
};

const publicRepo = { default_branch: "main", description: "d", private: false };
const privateRepo = { default_branch: "main", description: null, private: true };

describe("checkRepo", () => {
  it("only reads the repository metadata", async () => {
    const { fetchImpl, calls } = fetching(publicRepo);
    await expect(checkRepo("github.com/o/r", { fetchImpl })).resolves.toEqual({ owner: "o", repo: "r", description: "d" });
    expect(calls).toEqual(["https://api.github.com/repos/o/r"]);
  });

  it("reports a missing repository", async () => {
    await expect(checkRepo("github.com/o/r", fetching({}, 404))).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a private repository unless the user's own token allows it", async () => {
    await expect(checkRepo("github.com/o/r", { ...fetching(privateRepo), token: "server" })).rejects.toMatchObject({ code: "private" });
    await expect(checkRepo("github.com/o/r", { ...fetching(privateRepo), token: "user", allowPrivate: true })).resolves.toMatchObject({ repo: "r" });
  });

  it("does not call GitHub for an invalid URL", async () => {
    const { fetchImpl, calls } = fetching(publicRepo);
    await expect(checkRepo("https://gitlab.com/o/r", { fetchImpl })).rejects.toMatchObject({ code: "invalid_url" });
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/repo/check", () => {
  const post = (app: ReturnType<typeof createApp>, body: unknown) =>
    app.request("/api/repo/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("returns the repository when it can be read", async () => {
    const app = createApp({ checkRepo: async () => ({ owner: "o", repo: "r", description: null }) });
    const res = await post(app, { url: "github.com/o/r" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ owner: "o", repo: "r", description: null });
  });

  it.each([
    ["not_found", 404],
    ["private", 403],
    ["invalid_url", 400],
  ] as const)("maps %s to HTTP %i", async (code, status) => {
    const app = createApp({
      checkRepo: async () => {
        throw new RepoError(code, "message");
      },
    });
    const res = await post(app, { url: "x" });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code, message: "message" });
  });
});

describe("POST /api/repo/check for a repository the signed-in user cannot read", () => {
  const auth: Authenticator = { verify: async (t) => (t === "token-alice" ? { uid: "alice", githubId: "1" } : null) };
  const configure: RepoAccess = { kind: "configure", url: "https://github.com/settings/installations/1" };
  const notFound = async (): Promise<never> => {
    throw new RepoError("not_found", "見つかりません");
  };
  const setup = (findRepoAccess: (url: string, token: string) => Promise<RepoAccess>) =>
    createApp({ auth, allowed: parseAllowlist("*"), checkRepo: notFound, findRepoAccess });
  const post = (app: ReturnType<typeof createApp>, githubToken?: string) =>
    app.request("/api/repo/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token-alice",
        ...(githubToken ? { "x-github-token": githubToken } : {}),
      },
      body: JSON.stringify({ url: "github.com/alice/secret" }),
    });

  it("tells which GitHub page lets EVC read the repository", async () => {
    const seen: [string, string][] = [];
    const app = setup(async (url, token) => {
      seen.push([url, token]);
      return configure;
    });
    const res = await post(app, "ghu_alice");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "見つかりません", access: configure });
    expect(seen).toEqual([["github.com/alice/secret", "ghu_alice"]]);
  });

  it("does not look it up without the user's GitHub token", async () => {
    let called = false;
    const app = setup(async () => {
      called = true;
      return configure;
    });
    const res = await post(app);
    expect(await res.json()).toEqual({ error: "not_found", message: "見つかりません" });
    expect(called).toBe(false);
  });

  it("still reports the missing repository when the lookup fails", async () => {
    const app = setup(async () => {
      throw new Error("GitHub is down");
    });
    const res = await post(app, "ghu_alice");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "見つかりません" });
  });
});

describe("findRepoAccess", () => {
  const installations = (list: { login: string; html_url: string }[]) =>
    fetching({ installations: list.map(({ login, html_url }) => ({ account: { login }, html_url })) });

  it("points to the settings of the owner's existing installation", async () => {
    const { fetchImpl, calls } = installations([
      { login: "someone", html_url: "https://github.com/settings/installations/2" },
      { login: "KtsGsg", html_url: "https://github.com/settings/installations/1" },
    ]);
    await expect(findRepoAccess("https://github.com/ktsgsg/web-class-cli", "ghu_x", fetchImpl)).resolves.toEqual({
      kind: "configure",
      url: "https://github.com/settings/installations/1",
    });
    expect(calls).toEqual(["https://api.github.com/user/installations?per_page=100"]);
  });

  it("asks to install EVC when the owner has no installation", async () => {
    const { fetchImpl } = installations([{ login: "someone", html_url: "https://github.com/settings/installations/2" }]);
    await expect(findRepoAccess("github.com/ktsgsg/web-class-cli", "ghu_x", fetchImpl)).resolves.toEqual({ kind: "install" });
  });

  it("never links outside github.com", async () => {
    const { fetchImpl } = installations([{ login: "ktsgsg", html_url: "https://example.com/phish" }]);
    await expect(findRepoAccess("github.com/ktsgsg/web-class-cli", "ghu_x", fetchImpl)).resolves.toEqual({ kind: "install" });
  });
});
