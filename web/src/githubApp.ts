/** EVC の GitHub App の URL の名前(例: evc-escape-vibecoder)。未設定ならインストールの案内を出さない。 */
const slug = import.meta.env.VITE_GITHUB_APP_SLUG as string | undefined;

/**
 * GitHub App のインストールの画面。GitHub App は、インストールされたリポジトリしか読めないので、
 * 非公開リポジトリを読ませるには、利用者がここでリポジトリを選ぶ必要がある。
 */
export const githubAppInstallUrl: string | undefined = slug
  ? `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`
  : undefined;
