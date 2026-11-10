/**
 * Gemini / GitHub を使わずに UI を確認するための開発用サーバー。
 *
 *   npm run dev:mock -w api
 *
 * ログインは本物の API と同じく環境変数 AUTH で決める(未指定なら開発用のユーザーとして扱う)。
 */
import { serve } from "@hono/node-server";
import { createApp } from "../src/app.js";
import { authFromEnv } from "../src/auth.js";
import type { RepoSnapshot } from "../src/github/snapshot.js";
import { RepoError } from "../src/github/url.js";
import type { LlmClient } from "../src/llm/client.js";
import { CATEGORIES, type GeneratedQuestion } from "../src/quiz/types.js";

const code = `export function add(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new Error("invalid input");
  }
  return a + b;
}
`;

const snapshot: RepoSnapshot = {
  owner: "mock",
  repo: "calculator",
  branch: "main",
  description: "モックデータのリポジトリ",
  files: [{ path: "src/add.ts", content: code }],
  skipped: 0,
  // モックでは標準の 12 問で画面を確認する
  size: { files: 20, bytes: 100_000 },
};

const question = (i: number, type: "choice" | "free"): GeneratedQuestion => ({
  type,
  category: CATEGORIES[i % 5],
  difficulty: ((i % 3) + 1) as 1 | 2 | 3,
  // 同じ問題文だと「過去に出した問題と同じ」として作り直しになるので、番号を付けて毎回変える
  question:
    type === "choice" ? `add 関数について正しい説明はどれ?(${i + 1})` : `add 関数が例外を投げる理由と条件を説明してください。(${i + 1})`,
  codeRef: { path: "src/add.ts", startLine: 1, endLine: 6 },
  choices: type === "choice" ? ["2つの数を足す", "2つの数を掛ける", "文字列を連結する", "配列を並べ替える"] : [],
  answerIndex: type === "choice" ? 0 : 0,
  rubric: type === "free" ? "- 入力が有限数でない場合に例外\n- 不正な計算結果(NaN など)を防ぐため" : "",
  hint: "関数名と return 文を見てみましょう",
  explanation: "return a + b; で 2 つの引数を足しています。",
});

let counter = 0;

const llm: LlmClient = {
  async generateJson(req) {
    await new Promise((r) => setTimeout(r, 800));
    if (req.system.includes("このリクエストで作る問題")) {
      // 出題は 3 分割で呼ばれる。プロンプトが指定した数だけ返す
      const m = req.system.match(/選択式を (\d+) 問、記述式を (\d+) 問だけ/);
      const [choice, free] = [Number(m?.[1] ?? 15), Number(m?.[2] ?? 3)];
      return {
        questions: [
          ...Array.from({ length: choice }, () => question(counter++, "choice")),
          ...Array.from({ length: free }, () => question(counter++, "free")),
        ],
      };
    }
    // 採点と総評は 1 回の呼び出しで返す
    return {
      grades: [...req.user.matchAll(/<item id="(q\d+)">/g)].map((m, i) => ({
        id: m[1],
        score: [1, 0.5, 0][i % 3],
        feedback: "要点の一部を説明できています。",
      })),
      summary: "これはモックの総評です。コード読解は良好ですが、エラー処理の説明が弱めでした。",
    };
  },
};

const app = createApp({
  llm,
  auth: authFromEnv(),
  fetchSnapshot: async () => snapshot,
  listAuthors: async () => [
    { login: "mock-user", commits: 12 },
    { login: "another-user", commits: 3 },
  ],
  fetchAuthoredSnapshot: async () => ({ ...snapshot, authored: { "src/add.ts": [{ start: 1, end: 6 }] } }),
  // URL に configured を含めると、すでに EVC を入れたアカウントの案内(設定の画面)を試せる
  findRepoAccess: async (url) =>
    url.includes("configured") ? { kind: "configure", url: "https://github.com/settings/installations" } : { kind: "install" },
  // URL に missing や secret を含めると、入力欄のエラー表示を試せる
  checkRepo: async (url) => {
    if (url.includes("missing") || url.includes("configured")) throw new RepoError("not_found", "リポジトリが見つかりません(非公開の可能性もあります)");
    if (url.includes("secret")) throw new RepoError("private", "非公開リポジトリです。GitHub でログインし直すと読めます");
    return { owner: "mock", repo: "calculator", description: null };
  },
});
const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, () => console.log(`mock api listening on :${port}`));
