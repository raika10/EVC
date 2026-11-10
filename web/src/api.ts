import { authHeaders } from "./firebase";
import type { Answers, GradeResult, QuizSession, RepoAuthor } from "./types";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    /** API が返したエラーの本文(error と message のほかに、案内などが入ることがある)。 */
    public data?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(await authHeaders()) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ApiError("network", "サーバーに接続できませんでした");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // API は失敗時も必ず JSON を返す。JSON でなければ API に届いていない(開発中は API の未起動が多い)
    if (data === null && res.status >= 500) {
      throw new ApiError("unreachable", "API サーバーに接続できません。API が起動しているか確認してください");
    }
    throw new ApiError(data?.error ?? "unknown", data?.message ?? `エラーが発生しました (${res.status})`, data);
  }
  return data as T;
}

/** ログインしている人が、使ってよい人かどうか。許可リストに無ければ not_allowed で失敗する。 */
export const getMe = () => request<{ githubId: string }>("/api/me");

export const checkRepo = (url: string, signal?: AbortSignal) =>
  request<{ owner: string; repo: string; description: string | null }>("/api/repo/check", { url }, signal);

export const listAuthors = (url: string, signal?: AbortSignal) =>
  request<{ authors: RepoAuthor[] }>("/api/repo/authors", { url }, signal);

/** author を指定すると、その人が書いたコードから出題する。 */
export const createQuiz = (url: string, author?: string) => request<QuizSession>("/api/quiz", { url, author });

export const retryQuiz = (sessionId: string) => request<QuizSession>(`/api/quiz/${sessionId}/retry`, {});

export const getQuiz = (sessionId: string) => request<QuizSession>(`/api/quiz/${sessionId}`);

export const gradeQuiz = (sessionId: string, answers: Answers) =>
  request<GradeResult>(`/api/quiz/${sessionId}/grade`, { answers });

