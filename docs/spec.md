# bklg CLI Spec

このドキュメントは `bklg` のコマンド仕様（I/O、設定、実装方針）をまとめます。
目標は「Backlog API v2 の薄い wrapper CLI」です。

## 0. 用語

- Space: `your-space`（`https://your-space.backlog.jp` / `.backlog.com` のホスト部分）
- Issue: Backlog の課題（チケット）
- IssueKey: `PROJ-123` 形式
- APIキー: Backlog 個人設定で発行する `apiKey`

## 1. 認証（APIキー方式）

### 1.1 優先順位

1. 引数（`--space`, `--api-key`）
2. 環境変数（`BACKLOG_SPACE`, `BACKLOG_API_KEY`, `BACKLOG_HOST`）
3. 設定ファイル（`~/.config/bklg/config.json`）

### 1.2 設定ファイル

- パス：`~/.config/bklg/config.json`
- 形式（例）：

```json
{
  "space": "your-space",
  "host": "backlog.jp",
  "apiKey": "********"
}
````

#### host の扱い

- 省略時は `backlog.jp` を既定とする。
- `--host backlog.com` のように指定可能にする。
- `BACKLOG_HOST` があればそれを優先する。

### 1.3 Base URL

- `https://{space}.{host}` を base とする
- API base: `https://{space}.{host}/api/v2`

例: `https://example.backlog.jp/api/v2/...`

### 1.4 プロキシ

Backlog スペースに接続元 IP アドレス制限がある場合などに備え、HTTP プロキシ経由で API にアクセスできる。
Backlog への通信は常に `https://` なので、プロキシには `CONNECT` でトンネルを張る。

#### 優先順位

1. `NO_PROXY` / `no_proxy` が接続先ホストに一致したら直接接続
2. 環境変数 `HTTPS_PROXY` / `https_proxy`、無ければ `HTTP_PROXY` / `http_proxy`
3. OS のプロキシ設定
   - macOS: `scutil --proxy`（自動プロキシ構成 PAC → 保護された Web プロキシ（HTTPS）の順）
   - Windows: `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`（`AutoConfigURL` の PAC → `ProxyEnable`/`ProxyServer` の順）
   - その他の OS は環境変数のみ
4. 直接接続

#### 環境変数

- `HTTPS_PROXY` / `HTTP_PROXY`: `http://host:port`、`https://host:port`、`host:port`。`http://user:pass@host:port` で認証情報も指定できる（記号はパーセントエンコード）。SOCKS は未対応（エラー）。
- `NO_PROXY`: カンマ/空白区切り。`example.com`（サブドメインも一致）、`.example.com`、`*.example.com`、`host:port`、`*`（全ホスト）。OS 設定由来のプロキシにも適用する。
- `BKLG_PROXY_USERNAME` / `BKLG_PROXY_PASSWORD`: URL に認証情報を含まないプロキシ（PAC や OS 設定由来を含む）に Basic 認証で送る。

#### PAC

- PAC ファイルはプロキシを通さず直接取得する（`http(s)://` / `file://`、タイムアウト 10 秒）。
- `FindProxyForURL()` は QuickJS（WebAssembly）のサンドボックスで、ワーカースレッド上で実行する。
  - 渡す URL は `https://{space}.{host}/` のみ（ブラウザが https の URL に対して行うのと同様に、パスとクエリ＝`apiKey` を渡さない）。
  - 評価のタイムアウトは 5 秒。超えたらワーカーを終了し、評価失敗として扱う（無限ループや応答しない DNS 参照でも止まる）。
  - PAC の `alert()` は標準出力に出さず、`--debug` 時のみ stderr に `PAC alert: ...` として出す。
- 判定はオリジン（scheme/host/port）単位なので、プロセス内ではオリジンごとに 1 回だけ解決する。
- 結果の先頭から `PROXY` / `HTTPS` / `DIRECT` のうち最初のものを使う。`SOCKS` などは読み飛ばす。
- PAC の取得・評価に失敗した場合は、OS の HTTPS プロキシ設定、無ければ直接接続にフォールバックする。
- OS のバイパスリスト（macOS `ExceptionsList`、Windows `ProxyOverride`）は手動設定のプロキシにのみ適用する（PAC は PAC 自身が判断する）。

#### デバッグ

`--debug` で使用するプロキシと決定元を stderr に出す（認証情報は出さない）。

```
[bklg] proxy http://proxy.example.com:8080 (with credentials) (source: macOS PAC https://pac.example.com/proxy.pac)
```

## 2. コマンド仕様

### 2.1 共通オプション

- `--format <md|json|text>`（既定：`json`）
- `--debug`（既定：false）
- `--space <space>`（既定：config/env）
- `--host <backlog.jp|backlog.com|...>`（既定：config/env/`backlog.jp`）
- `--api-key <key>`（既定：config/env）

`-h` / `--help` は各サブコマンドでも利用でき、次を表示すること:

- そのコマンドの `Usage`
- 親コマンドの共通オプション（Global Options）
- 実行例（Examples）と注意事項（必要な入力、排他オプションなど）

### 2.2 auth

#### 2.2.1 `bklg auth login`

APIキーを保存します。

Usage: `bklg auth login --space <space> --api-key <key> [--host <host>]`

Behavior

- 設定ファイルを作成/更新
- `--api-key` はそのまま保存

Output

- `text`: `Logged in as <space>.<host>`
- `md`: 見出し + Space/Host を表示
- `json`: `{ "space": "...", "host": "..." }`

#### 2.2.2 `bklg auth status`

設定されている接続先を表示します（キーはマスク）。

Output

- `text`: `Space/Host/API Key` を表示（未設定なら `Not logged in.`）
- `md`: 見出し + Space/Host/API Key を表示
- `json`: `{ "space": "...", "host": "...", "apiKeyMasked": "..." }`

#### 2.2.3 `bklg auth logout`

設定ファイルから apiKey を削除またはファイル削除（実装で決定）。

Output

- `text`: `Logged out.` / `Already logged out.`
- `md`: 見出し + メッセージ
- `json`: `{ "status": "cleared|deleted|missing" }`

### 2.3 issue

#### 2.3.1 `bklg issue view <issueKeyOrId>`

課題を取得して表示します。

- API: `GET /api/v2/issues/:issueIdOrKey`
- Query: `apiKey=...`

Usage:

- `bklg issue view PROJ-123 --format md`
- `bklg issue view 12345 --format json`

Output

- `json`: APIレスポンスを原則そのまま
- `text`: 1行要約 + 本文（必要最低限）
- `md`: AI/エディタ向けに構造化

Markdown 出力案（例）

```md
# PROJ-123 タイトル

- Status: Open
- Priority: High
- Assignee: foo
- Due: 2026-01-31

## Description
...

## Acceptance Criteria
（本文から見出し抽出できればここに。できなければ Description のみ）
```

#### 2.3.2 `bklg issue search`

課題を検索します。

- API: `GET /api/v2/issues`

Usage（例）

- `bklg issue search --project 123 --status 1 --assignee me --keyword "ログイン"`
- `bklg issue search --count 20 --order desc`

*主要オプション（案）**

- `--project <projectId>`（複数指定可: `--project 1 --project 2`）
- `--status <statusId>`（数値）
- `--assignee <me|userId>`（userId は数値）
- `--keyword <text>`
- `--count <n>`（既定：20、最大はAPIに合わせる）
- `--offset <n>`
- `--sort <created|updated|dueDate>`（APIパラメータへマップ）
- `--order <asc|desc>`

Output

- `text`: 1行1件 `PROJ-123 title (status)`
- `md`: 箇条書き（リンクは可能なら）
- `json`: 配列

#### 2.3.3 `bklg issue writeComment <issueKeyOrId>`

課題へコメントを追加します。

- API: `POST /api/v2/issues/:issueIdOrKey/comments`
- body: `content=<text>`（必須）

Usage

- `bklg issue writeComment PROJ-123 -m "確認お願いします"`
- `bklg issue writeComment PROJ-123 --message-file ./comment.md`
- `bklg issue writeComment PROJ-123 -m "..." --notify 123,456`

Options

- `-m, --message <text>`（`--message-file` と排他）
- `--message-file <path>`（`--message` と排他）
- `--notify <userIdCSV>`（Backlog API の `notifiedUserId[]` に対応）
- `--dry-run`（送信せず表示のみ）

Output

- `text`: `Comment posted: <commentId>`
- `json`: 作成されたコメントのレスポンス
- `md`: 作成されたコメントを見出し＋本文で表示

#### 2.3.4 コメント一覧取得 `bklg issue comments <issueKeyOrId>`

課題のコメント一覧を取得します。
コメントが多い場合も API ページングを自動で辿って全件取得します。

- API: `GET /api/v2/issues/:issueIdOrKey/comments`

Usage

- `bklg issue comments PROJ-123`

Output

- `text`: 1行1件 `Comment by <user> at <date>: <first 50 chars>`
- `md`: 各コメントを見出し＋本文で表示
- `json`: 配列

### 2.4 wiki

#### 2.4.1 `bklg wiki view <pageName>`

- API: `GET /api/v2/wikis` + `GET /api/v2/wikis/:wikiId` など

Usage

- `bklg wiki view "Wiki Page" --project PROJ`（project key or id）

Output

- `text`: `Wiki: <name>` + 本文
- `md`: 見出し + メタ情報 + 本文
- `json`: APIレスポンス

## 3. エラー仕様

- 401/403: 認証（APIキー・権限）問題として明示。Backlog のエラーメッセージ（`errors[].message`）があれば併記する
  - 403 で接続元 IP アドレス制限（`Access from your IP Address is forbidden.`）の場合は、プロキシ設定を促す
- 404: 対象が存在しない（issueKeyの誤りなど）
- 429: レート制限（再試行を促す）
- ネットワークエラー: 接続先 host/space の誤りを疑う文言
- プロキシエラー: プロキシ経由で失敗した場合は、使用したプロキシを明示する
  - 407: プロキシ認証が必要（`BKLG_PROXY_USERNAME`/`BKLG_PROXY_PASSWORD` または `HTTPS_PROXY` の認証情報を促す）
  - その他の CONNECT 拒否: プロキシのステータスを表示

`--format json` の場合は、エラーも JSON で出す（例）

```json
{
  "error": {
    "message": "Request failed (404 Not Found)",
    "status": 404,
    "statusText": "Not Found",
    "details": { "...": "..." },
    "url": "..."
  }
}
```

プロキシエラーの JSON 例（`proxy` に使用したプロキシ、`status` にプロキシの応答）

```json
{
  "error": {
    "message": "Proxy refused the connection (407 Proxy Authentication Required)",
    "status": 407,
    "statusText": "Proxy Authentication Required",
    "proxy": "http://proxy.example.com:8080",
    "url": "https://your-space.backlog.jp/api/v2/issues/PROJ-1?apiKey=***"
  }
}
```

## 4. セキュリティ

- APIキーはログ出力しない
- 設定ファイルのパーミッションに注意（可能なら 600 を推奨）
- `--debug` でもキーを出さない（URLに含めない／含む場合はマスク）
- プロキシの認証情報もログ・エラー出力に出さない

## 5. 実装メモ（TypeScript）

- CLI: commander
- HTTP: undici（`request()` + プロキシ時は `ProxyAgent`）
- PAC: pac-resolver + quickjs-wasi
- Form POST: `application/x-www-form-urlencoded`
- 出力: `format/` に寄せて安定させる
- acceptance criteria 抽出は「見出し検出（例：`## 受け入れ条件`）」があれば抽出、無ければ description をそのまま

## 6. ロードマップ

- v0.1
  - auth login/status/logout
  - issue view/search
  - issue writeComment
  - issue comments
  - format md/json/text
  - wiki view
- v1.0
  - 安定化（オプション名・出力フォーマットを確定）
