export type RepoCheckState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; name: string }
  | { state: "error"; code: string; message: string };

/** 確実に使えないと分かる失敗。これ以外(GitHub の混雑や通信失敗など)は、確認できなかっただけなので送信を止めない。 */
const DEFINITE_FAILURES = new Set(["invalid_url", "not_found", "private"]);

export function checkFailure(code: string, message: string): RepoCheckState {
  return DEFINITE_FAILURES.has(code) ? { state: "error", code, message } : { state: "idle" };
}

/**
 * 非公開リポジトリが読めなかったときに出す案内。
 * - relogin: GitHub のトークンが無い(リロードすると消える)。ログインし直せば読めるかもしれない
 * - install: トークンはあるのに見つからない。GitHub App は、インストールされたリポジトリしか読めないため、
 *   そのリポジトリに EVC を入れる(読む許可を出す)必要がある
 */
export type RepoHint = "relogin" | "install" | null;

export function repoHint(
  check: RepoCheckState,
  opts: { loginEnabled: boolean; hasGithubToken: boolean; canInstall: boolean },
): RepoHint {
  if (!opts.loginEnabled || check.state !== "error") return null;
  if (check.code !== "not_found" && check.code !== "private") return null;
  if (!opts.hasGithubToken) return "relogin";
  return opts.canInstall ? "install" : null;
}

/** 打ち込み途中に問い合わせないよう待つ時間。貼り付けのときは待たない。 */
export function checkDelay(pasted: boolean): number {
  return pasted ? 0 : 500;
}
