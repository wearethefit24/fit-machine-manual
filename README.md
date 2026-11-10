# FIT MANUAL｜ジムマシン取扱説明書 Webアプリ

スマートフォン向けの取扱説明書アプリです。**視聴者はログイン・会員登録不要**です。`/admin` では管理者パスワードだけで操作できます。画面下部の固定ナビゲーションはありません。

## 実装内容

- **視聴**：`/` で店舗選択 → `/store/:id` でエリア選択 → `/area/:id` でマシン選択 → `/machine/:id` で取扱説明書。
- **QR**：マシンごとの `/machine/:id` を指すQR画像を自動生成。PNG保存、URL共有。
- **取説**：動画（インライン再生）、概要、調整方法、操作手順、ポイント、安全上の注意事項の順。
- **管理**：店舗・エリア・マシンの追加／編集／削除、マシンの上下ボタンによる並び替え。動画の直接アップロード・交換・削除。
- **保存**：Cloudflare D1（文字データ）＋ Workers KV（動画の8MiB分割データ）。ブラウザ・端末を変えても内容が共有されます。
- **保護**：管理APIをパスワード＋HttpOnly署名Cookieで保護。15分間に8回のログイン失敗があると一時制限します。

## 必要なサービス（無料プラン）

1. GitHub：**wearethefit24**
2. Cloudflare：**Wearethefit24@gmail.com**（Pages / D1 / Workers KV）

有料サービスの契約、課金設定、R2の申し込みは不要です。ただし無料枠は無制限ではなく、上限を超えるとエラー・停止となる場合があります。追加料金が発生しないよう **Cloudflare Free** のままお使いください。

2026年11月時点のCloudflare無料枠（公式資料参照）：

- Workers KV：**1GB保存**、1データ**25MiB**、読込**100,000回/日**、書込**1,000回/日**。本アプリでは動画を8MiBに分割し、**1動画80MiBまで**としています。
- D1：**5GB保存（アカウント合計）**、5,000,000行読込/日、100,000行書込/日。
- Workers Free：**100,000リクエスト/日**。この上限に達するとAPI操作が利用できなくなる可能性があります。
- KVは**結果整合性**です。アップロード完了後に、別の地域から動画を読むまで**60秒以上遅れる可能性**があります。更新後ただちに世界中の端末で動画を読み込める保証はありません。

公式：
https://developers.cloudflare.com/kv/platform/limits/
https://developers.cloudflare.com/kv/concepts/how-kv-works/
https://www.cloudflare.com/products/d1/
https://developers.cloudflare.com/workers/platform/limits/

## Cloudflare Pagesへの導入手順

### 1. GitHubにソースコードを登録

`wearethefit24` で GitHub にログインし、新しいリポジトリ（例：`fit-machine-manual`）を作成します。このZIPを展開した中身を**リポジトリのルートに**登録してください。

GitHubとのCloudflare連携も **wearethefit24** に許可してください（別アカウントに接続しないでください）。

### 2. CloudflareでPagesサイトを作成

Cloudflare ダッシュボード → **Workers & Pages → Create → Pages / Connect to Git** で上記リポジトリを選択します。

- Framework preset：`Vite` または `None`
- Build command：`npm run build`
- Build output directory：`dist`
- Root directory：リポジトリルート（通常空欄）
- Node.js：22以上推奨（テストはNode.js 22のSQLite APIを使用します）

**Functionsディレクトリは `dist` 内に移動しないでください。** `functions/api/[[path]].js` はプロジェクトルートに置く必要があります。

### 3. D1（データベース）を追加

Cloudflare → **Storage & databases → D1 SQL Database** で `fit-manual-db` を作成します。データベースの **Console（SQLエディター）** で同梱の `schema.sql` を実行します。

その後、Pagesプロジェクトの Settings → **Bindings** で次を追加します。

- タイプ：D1 database
- Variable name / Binding name：`DB`
- Database：`fit-manual-db`

### 4. Workers KV（動画保存）を追加

Cloudflare → **Storage & databases → KV** で `fit-manual-videos` というNamespaceを作成します。Pagesの Settings → **Bindings** に追加します。

- タイプ：KV namespace
- Variable name / Binding name：`VIDEO_KV`
- Namespace：`fit-manual-videos`

動画保存にCloudflare R2は**使用していません**（R2には別途サブスクリプション設定が必要なため）。

### 5. 管理者パスワードと署名用シークレットを登録

Pagesプロジェクトの Settings → **Environment variables / Secrets** で、**Production用**に以下を設定してください。GitHubのコードに直接記載しないでください。

- `ADMIN_PASSWORD`：**12文字以上**の任意の強い管理者パスワード
- `ADMIN_SESSION_SECRET`：**32文字以上**のランダムな長い文字列。例として、ご自身の端末のターミナルで `openssl rand -hex 32` を実行して生成できます（生成値は公開しないでください）。

`ADMIN_SESSION_SECRET` はパスワードと**別の値**にしてください。**Preview環境も使用する場合はPreview側にD1/KVバインディング・シークレットの設定が必要**です。公開前に本番の設定が正しいことを確認してください。

設定後は **Redeploy** してください。

### 6. 動作確認

Cloudflareから発行された `https://<project>.pages.dev` にアクセスし、以下を確認してください。

1. `/admin` で管理者パスワードを入力。
2. 店舗（江古田店など）を追加。
3. エリア（有酸素など）を追加。
4. マシンを登録し、MP4動画・概要などの説明文を保存。
5. 専用QRコードをPNG保存し、スマホで読み取って取扱説明書が表示されることを確認。
6. 2台の端末で内容が共有されることを確認（動画は反映に時間がかかる場合があります）。

**注意**：動画の新規登録・削除が世界中に反映されるまで遅延が生じる場合があります。動画削除は無料Workersの処理上限を守るため分割実行し、未処理分はD1の削除待ちキューに残して管理画面の操作時に順次整理します。

## 開発環境での確認

インターネットに接続されたPCで以下を実行します。

```bash
npm install
npm run build
npm test
```

`npm run dev` は**見た目の開発プレビュー用**です。APIはCloudflare Functionsなので、このコマンド単体ではバックエンドに接続できません。FunctionsとローカルD1/KVを含む動作確認には、Wrangler設定によるPagesローカルサーバーをお使いください。

## 構成

```
├── index.html
├── src/
│   ├── App.jsx               # 視聴・管理UI / QR / 動画アップロード
│   ├── main.jsx
│   └── style.css             # Tailwind CSS + ダークテーマ
├── functions/api/[[path]].js  # Pages Functions エントリーポイント
├── server/api.js             # D1/KV CRUD / 管理者認証 / Range再生
├── schema.sql                # D1テーブル定義
├── public/_redirects        # SPA用パスルーティング
├── public/_routes.json      # Function呼び出しを/api/*に限定
└── public/_headers          # セキュリティヘッダー
```

## セキュリティと運用上の注意

- 管理ページそのもののHTMLはURLを知っていれば表示できますが、編集APIは認証しないと使用できません。
- 閲覧用の動画・取説は誰でもアクセスできます。スタッフ内部情報や個人情報をアップロードしないでください。
- 動画ファイルはWebブラウザで再生可能な形式にしてからアップロードしてください。MOVはブラウザによって非対応のケースがあるため、互換性重視ならMP4（H.264/AAC）がおすすめです。
- バックアップ／復元機能は未実装です。運用前にCloudflare D1のエクスポート手順、動画の元ファイル保管を決めてください。
- すべてのサービスは**無料枠のみ**で運用する方針です。無料枠以上の保存容量・アクセス数・動画数には対応できません。
## 再デプロイについて

Cloudflare PagesとこのGitHubリポジトリの `main` ブランチが連携され、自動デプロイが有効なら、`main` への変更で新しい本番デプロイが開始されます。D1・KVバインディングやシークレットを変更した後は、Cloudflareのデプロイ履歴で最新のコミットが **Success** と表示されているか確認してください。
