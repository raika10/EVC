import { githubClient } from "./snapshot.js";
import { parseRepoUrl } from "./url.js";

/**
 * EVC(GitHub App)にリポジトリを読ませるために、利用者が開く GitHub の画面。
 * GitHub App は、インストールされたリポジトリしか読めない。ログインしただけでは読めない。
 * - install: リポジトリの持ち主のアカウントに、まだ EVC が入っていない。インストールの画面で入れる
 * - configure: すでに入っているが、このリポジトリが選ばれていない。そのインストールの設定の画面で足す
 *   (インストールの画面には、すでに入れたアカウントが出てこないため、こちらへ案内する)
 */
export type RepoAccess = { kind: "install" } | { kind: "configure"; url: string };

type Installation = { account: { login: string } | null; html_url: string };

/**
 * ログインした人の GitHub トークン(GitHub App のユーザー用トークン)で、
 * リポジトリの持ち主のアカウントに EVC が入っているかを調べる。
 */
export async function findRepoAccess(urlInput: string, token: string, fetchImpl?: typeof fetch): Promise<RepoAccess> {
  const { owner } = parseRepoUrl(urlInput);
  const { installations = [] } = await githubClient({ token, fetchImpl }).getJson<{ installations?: Installation[] }>(
    "/user/installations?per_page=100",
  );
  const found = installations.find((i) => i.account?.login.toLowerCase() === owner.toLowerCase());
  // 画面にそのままリンクとして出すので、GitHub の画面以外は使わない
  return found && found.html_url.startsWith("https://github.com/") ? { kind: "configure", url: found.html_url } : { kind: "install" };
}
