/**
 * EVC(GitHub App)にリポジトリを読ませるために開く GitHub の画面(API が調べて返す)。
 * - install: 持ち主のアカウントに、まだ EVC が入っていない
 * - configure: すでに入っているが、このリポジトリが選ばれていない。インストールの画面には、
 *   すでに入れたアカウントが出てこないので、そのインストールの設定の画面(url)で足す
 */
export type RepoAccess = { kind: "install" } | { kind: "configure"; url: string };

export type RepoCheckState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; name: string }
  | { state: "error"; code: string; message: string; access?: RepoAccess };

/** 確実に使えないと分かる失敗。これ以外(GitHub の混雑や通信失敗など)は、確認できなかっただけなので送信を止めない。 */
const DEFINITE_FAILURES = new Set(["invalid_url", "not_found", "private"]);

export function checkFailure(code: string, message: string, access?: RepoAccess): RepoCheckState {
  if (!DEFINITE_FAILURES.has(code)) return { state: "idle" };
  return access ? { state: "error", code, message, access } : { state: "error", code, message };
}

/** API のエラーの本文から、GitHub の画面の案内を取り出す。形が違えば使わない(リンクは github.com だけ)。 */
export function accessFrom(data: unknown): RepoAccess | undefined {
  const access = (data as { access?: { kind?: unknown; url?: unknown } } | null)?.access;
  if (access?.kind === "install") return { kind: "install" };
  if (access?.kind === "configure" && typeof access.url === "string" && access.url.startsWith("https://github.com/")) {
    return { kind: "configure", url: access.url };
  }
  return undefined;
}

/**
 * 非公開リポジトリが読めなかったときに出す案内。
 * - relogin: GitHub のトークンが無い(リロードすると消える)。ログインし直せば読めるかもしれない
 * - configure: EVC はもう入っているが、このリポジトリが選ばれていない。設定の画面でリポジトリを足す
 * - install: まだ EVC が入っていない。GitHub App は、インストールされたリポジトリしか読めないため、
 *   そのリポジトリに EVC を入れる(読む許可を出す)必要がある
 */
export type RepoHint = "relogin" | "configure" | "install" | null;

export function repoHint(
  check: RepoCheckState,
  opts: { loginEnabled: boolean; hasGithubToken: boolean; canInstall: boolean },
): RepoHint {
  if (!opts.loginEnabled || check.state !== "error") return null;
  if (check.code !== "not_found" && check.code !== "private") return null;
  if (!opts.hasGithubToken) return "relogin";
  if (check.access?.kind === "configure") return "configure";
  return opts.canInstall ? "install" : null;
}

/** 打ち込み途中に問い合わせないよう待つ時間。貼り付けのときは待たない。 */
export function checkDelay(pasted: boolean): number {
  return pasted ? 0 : 500;
}
