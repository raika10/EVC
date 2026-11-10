import { FirebaseError } from "firebase/app";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, checkRepo, listAuthors } from "../api";
import { useAuth } from "../auth";
import { loginErrorMessage } from "../authStatus";
import { githubAppInstallUrl } from "../githubApp";
import { checkDelay, checkFailure, repoHint, type RepoCheckState } from "../repoCheck";
import type { RepoAuthor } from "../types";
import { Wordmark } from "./Wordmark";

type Props = { onSubmit: (url: string, author?: string) => void; error?: string | null };

export function RepoForm({ onSubmit, error }: Props) {
  const [url, setUrl] = useState("");
  const [check, setCheck] = useState<RepoCheckState>({ state: "idle" });
  const [authors, setAuthors] = useState<RepoAuthor[]>([]);
  const [author, setAuthor] = useState("");
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  // 増やすと、同じ URL をもう一度確かめる
  const [recheck, setRecheck] = useState(0);
  const pasted = useRef(false);
  const { enabled, hasGithubToken, reconnectGithub } = useAuth();

  useEffect(() => {
    const value = url.trim();
    setCheck({ state: "idle" });
    if (!value) return;

    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setCheck({ state: "checking" });
      try {
        const repo = await checkRepo(value, abort.signal);
        if (!abort.signal.aborted) setCheck({ state: "ok", name: `${repo.owner}/${repo.repo}` });
      } catch (e) {
        if (abort.signal.aborted) return;
        setCheck(e instanceof ApiError ? checkFailure(e.code, e.message) : { state: "idle" });
      }
    }, checkDelay(pasted.current));
    pasted.current = false;

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
    // GitHub でログインし直したときや、GitHub で許可して戻ってきたときも、同じ URL をもう一度確かめる
  }, [url, hasGithubToken, recheck]);

  const hint = repoHint(check, { loginEnabled: enabled, hasGithubToken, canInstall: githubAppInstallUrl !== undefined });

  // GitHub の画面で EVC に許可を出して、この画面に戻ってきたら確かめ直す
  useEffect(() => {
    if (hint !== "install") return;
    let last = 0;
    const again = () => {
      // 戻ったときは focus と visibilitychange の両方が来ることがあるので、1 回にまとめる
      if (document.visibilityState !== "visible" || Date.now() - last < 1000) return;
      last = Date.now();
      pasted.current = true;
      setRecheck((n) => n + 1);
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [hint]);

  const reconnect = async () => {
    setReconnectError(null);
    try {
      pasted.current = true; // 取り直したらすぐに確かめ直す
      await reconnectGithub();
    } catch (e) {
      pasted.current = false;
      setReconnectError(loginErrorMessage(e instanceof FirebaseError ? e.code : undefined));
    }
  };

  // 読めるリポジトリなら、コミットした人を選べるようにする。取得に失敗しても全体のクイズは作れる
  useEffect(() => {
    setAuthors([]);
    setAuthor("");
    if (check.state !== "ok") return;
    const abort = new AbortController();
    listAuthors(url.trim(), abort.signal)
      .then((r) => {
        if (!abort.signal.aborted) setAuthors(r.authors);
      })
      .catch(() => {});
    return () => abort.abort();
    // url の変化では check が先に idle に戻るので、check だけを追えばよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check]);

  const blocked = check.state === "error";

  const handle = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !blocked) onSubmit(url.trim(), author || undefined);
  };

  return (
    <form className="hero" onSubmit={handle}>
      <h1>
        <Wordmark large />
      </h1>
      <p className="hero-tag">そのコード、説明できますか?</p>
      <div className={blocked ? "search invalid" : "search"}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
        <input
          type="text"
          aria-label="リポジトリ URL"
          aria-invalid={blocked}
          placeholder="GitHub のリポジトリ URL を入力"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPaste={() => {
            pasted.current = true;
          }}
          autoFocus
        />
      </div>
      <p className={`url-status${blocked ? " error" : check.state === "ok" ? " ok" : ""}`} role="status">
        {check.state === "checking" && "確認しています…"}
        {check.state === "ok" && `✓ ${check.name}`}
        {check.state === "error" && check.message}
      </p>
      {hint === "relogin" && (
        <p className="reconnect">
          非公開リポジトリなら、GitHub でログインし直すと読めます。
          <button type="button" className="link" onClick={reconnect}>
            ログインし直す
          </button>
        </p>
      )}
      {hint === "install" && (
        <div className="reconnect">
          <p>
            非公開リポジトリなら、GitHub で EVC に読む許可を出すと読めます。
            <a href={githubAppInstallUrl} target="_blank" rel="noreferrer">
              GitHub で許可する
            </a>
          </p>
          <p className="reconnect-note">
            開いた画面で読ませるリポジトリを選び、Install を押してから、この画面に戻ってください。自動で確かめ直します。
          </p>
        </div>
      )}
      {reconnectError && <p className="error">{reconnectError}</p>}
      {authors.length > 0 && (
        <div className="scope">
          <label htmlFor="scope-author">出題の範囲</label>
          <select id="scope-author" value={author} onChange={(e) => setAuthor(e.target.value)}>
            <option value="">リポジトリ全体</option>
            {authors.map((a) => (
              <option key={a.login} value={a.login}>
                {a.login} が書いたコード({a.commits} コミット)
              </option>
            ))}
          </select>
        </div>
      )}
      <button type="submit" disabled={!url.trim() || blocked}>
        クイズを作る
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted hero-help">AI がコードを読んで、理解度をチェックするクイズを作ります。</p>
    </form>
  );
}
