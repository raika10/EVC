# デプロイ手順

構成: Firebase Hosting(`web/dist`)が `/api/**` を Cloud Run の `evc-api` に転送します。同一オリジンなので CORS 設定は不要です。

## 事前準備

- GCP プロジェクトを作り、Firebase を有効にする(Blaze プランが必要)。
- `gcloud` と `firebase-tools` をインストールし、ログインする。
- `.firebaserc.example` を `.firebaserc` にコピーして、プロジェクト ID を書く(`.firebaserc` は git に入れない運用でも可)。
- API を有効にする。

```sh
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com
```

## 1. シークレット

`.env` ではなく Secret Manager に入れます。

```sh
printf '%s' "<Gemini API キー>" | gcloud secrets create gemini-api-key --data-file=-
printf '%s' "<GitHub トークン(public_repo 読み取りのみ)>" | gcloud secrets create github-token --data-file=-
```

Cloud Run のサービスアカウントに `Secret Manager Secret Accessor` ロールを付けます。

## 2. Firestore

Firestore(Native モード)を `asia-northeast1` に作成し、次を設定します。

```sh
gcloud firestore databases create --location=asia-northeast1
# 7 日で自動削除(sessions の expireAt)
gcloud firestore fields ttls update expireAt --collection-group=sessions --enable-ttl
# Cloud Run のサービスアカウントに読み書き権限
gcloud projects add-iam-policy-binding <project>   --member=serviceAccount:<service-account> --role=roles/datastore.user
```

## 3. ログイン(GitHub App + Firebase Auth)

API は、GitHub でログインして、許可リストに入っている人だけを受け付けます(`/api/health` を除く)。リポジトリは、ログインした本人の GitHub トークン(user-to-server トークン)で、本人が読めるものだけを読みます。クライアントから installation ID は受け取りません(他人の非公開リポジトリを読めてしまうため)。

1. Firebase コンソールの「プロジェクトの設定」→「全般」→「マイアプリ」で Web アプリを追加し、表示される `firebaseConfig` の `apiKey`、`authDomain`、`projectId`、`appId` を控える。Web のビルドで使う(画面の JS に入る公開の値で、秘密ではない)。
2. GitHub の Settings → Developer settings → GitHub Apps → New GitHub App で、GitHub App を作る。作ったら Client ID を控え、「Generate a new client secret」で Client secret を作って控える(secret は一度しか表示されない)。

| 項目 | 値 |
|---|---|
| Homepage URL | `https://<project>.web.app` |
| Callback URL(Redirect URI と表示されることもある) | `https://<project>.firebaseapp.com/__/auth/handler`(手順 3 で Firebase の画面に出る URL と同じにする) |
| Expire user authorization tokens | 付けたまま(トークンは 8 時間で切れ、切れたらログインし直す) |
| Request user authorization (OAuth) during installation | 付けない(付けると、インストールのあとに GitHub が Callback URL へ直接戻すので、Firebase の画面に「Unable to process request due to missing initial state」と出る) |
| Setup URL | 空のまま |
| Webhook | Active を外す(使わない) |
| Repository permissions | `Contents: Read-only` と `Metadata: Read-only` だけ |
| Account permissions | すべて No access |
| Where can this GitHub App be installed? | Any account(利用者が、自分の非公開リポジトリに入れられるように) |

3. Firebase コンソールの Authentication →「Sign-in method」で GitHub を有効にし、手順 2 の Client ID と Client secret を入れる。ほかのログイン方法は有効にしない(API は GitHub でのログインだけを受け付ける)。「Settings」→「承認済みドメイン」に、画面を配るドメイン(`<project>.web.app` など)があるかも確かめる。
4. 使ってよい人の、GitHub の数字の ID を集める(許可リスト)。ユーザー名は変えられ、空いた名前を別の人が取れるため、ID で指定する。

```sh
gh api users/<ユーザー名> --jq .id
```

5. 非公開リポジトリを読ませたい利用者は、GitHub App をそのリポジトリにインストールする(`https://github.com/apps/<App の名前>` の Install)。ログインだけでは読めない(GitHub App は、インストールされたリポジトリしか読めない)。「All repositories」を選べば、自分のリポジトリは、あとから作るものも含めてすべて読める。組織のリポジトリは、組織のオーナーの承認が要る。画面は、ログインしているのにリポジトリが見つからないときに、案内を出す。持ち主のアカウントにまだ EVC が入っていなければインストールの画面(`VITE_GITHUB_APP_SLUG` を設定したとき)、すでに入っていれば、そのインストールの設定の画面(リポジトリを足す画面)。インストールの画面には、すでに入れたアカウントが出てこないため。どちらかは、API がログインした人の GitHub トークンで `GET /user/installations` を呼んで調べる。

## 4. API を Cloud Run へ

リポジトリのルートで実行します。

```sh
gcloud run deploy evc-api \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --max-instances 3 \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest,GITHUB_TOKEN=github-token:latest \
  --set-env-vars "STORE=firestore,GEMINI_MODEL=gemini-3-flash-preview,RATE_LIMIT_PER_HOUR=10,AUTH=firebase,ALLOWED_GITHUB_IDS=<ID> <ID>"
```

- `--source .` はルートの `Dockerfile` を使います。
- `AUTH=firebase` が無いと、API は起動しません(開発用の認証のまま動いて、誰でも使えてしまうのを防ぐため)。
- `ALLOWED_GITHUB_IDS` はスペースで区切ります(カンマは `--set-env-vars` の区切りと重なるため)。`*` にすると、GitHub でログインした人なら誰でも使えます。空にすると、誰も使えません。

許可リストに人を足すときは、全員分の ID を入れ直します。GitHub Actions でデプロイしている場合は、変数 `ALLOWED_GITHUB_IDS` も同じ値に変えます(変えないと、次のデプロイで元に戻ります)。

```sh
gcloud run services update evc-api --region asia-northeast1 --update-env-vars "ALLOWED_GITHUB_IDS=<ID> <ID> <新しい ID>"
```

## 5. Web を Hosting へ

ビルドのときに `VITE_FIREBASE_*`(`.env.example` 参照)が必要です。無いと、画面に「ログインの設定がありません」と出ます。`VITE_GITHUB_APP_SLUG`(GitHub App の URL の名前。`deploy.yml` では `evc-escape-vibecoder`)も渡すと、非公開リポジトリが読めないときに、GitHub App のインストールの案内を出します。

```sh
npm ci
npm run build -w web
firebase deploy --only hosting
```

## 動作確認

```sh
curl https://<project>.web.app/api/health
```

## 注意

- Hosting が配る画面の HTML/JS は誰でも取得できます(中身はログイン画面とビルド済みのコードのみ)。API は、ログインして許可リストに入っている人にしか応えません。
- `STORE=firestore` を付けないと、セッションと採点結果はインスタンスのメモリに置かれます。Cloud Run が複数インスタンスに分かれると、結果取得が 404 になります。
- 匿名の全体集計は Firestore の `stats/global` に入り、`GET /api/stats` で読めます。
- レート制限もインスタンス単位です。回数はアカウントごとに数えます。厳密な制限が必要なら Cloud Armor などを使ってください。
- `--max-instances` は Gemini の課金を抑えるための上限です。
- GitHub トークンは `X-GitHub-Token` ヘッダーで API に渡り、保存もログ出力もしません。ブラウザ側もメモリ上にしか持たないため、リロードすると消えます。そのあと非公開リポジトリを読むには、URL の入力欄の下に出る「ログインし直す」を押します。
- クイズ(セッション)は、作った本人にしか見えません。ログインを必須にする前に作られた、持ち主のいないセッションは誰にも見えません。
- サーバー側の `GITHUB_TOKEN` は公開リポジトリ用のレート制限対策です。非公開リポジトリには使われません。

## GitHub Actions で自動デプロイ

`main` への push で `.github/workflows/deploy.yml` が走ります(テスト → Cloud Run → Hosting)。認証は鍵ファイルを使わず Workload Identity Federation を使います。初回だけ次を設定します。

```sh
PROJECT=<project-id>
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
REPO=<github-user>/EVC

gcloud iam service-accounts create evc-deployer
SA=evc-deployer@$PROJECT.iam.gserviceaccount.com
for role in run.admin cloudbuild.builds.editor artifactregistry.writer storage.admin iam.serviceAccountUser firebasehosting.admin serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/$role
done

gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
  --attribute-condition="assertion.repository=='$REPO'"
gcloud iam service-accounts add-iam-policy-binding $SA \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
```

GitHub の Settings → Secrets and variables → Actions → Variables に次を登録します。

| 変数 | 値 |
|---|---|
| `GCP_PROJECT_ID` | プロジェクト ID |
| `GCP_SERVICE_ACCOUNT` | `evc-deployer@<project>.iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<number>/locations/global/workloadIdentityPools/github/providers/github` |
| `ALLOWED_GITHUB_IDS` | 使ってよい人の GitHub の数字の ID(スペース区切り)。`*` なら全員 |
| `VITE_FIREBASE_*` | Firebase の Web の設定(必須。無いとデプロイを止める) |
