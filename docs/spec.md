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

## 2. コマンド仕様

### 2.1 共通オプション

- `--format <md|json|text>`（既定：`json`）
- `--debug`（既定：false）
- `--space <space>`（既定：config/env）
- `--host <backlog.jp|backlog.com|...>`（既定：config/env/`backlog.jp`）
- `--api-key <key>`（既定：config/env）

### 2.2 auth

#### 2.2.1 `bklg auth login`

APIキーを保存します。

Usage: `bklg auth login --space <space> --api-key <key> [--host <host>]`

Behavior

- 設定ファイルを作成/更新
- `--api-key` はそのまま保存

Output

- 成功時：`Logged in as <space>.<host>`
- 失敗時：理由（ファイル権限、入力不足など）

#### 2.2.2 `bklg auth status`

設定されている接続先を表示します（キーはマスク）。

#### 2.2.3 `bklg auth logout`

設定ファイルから apiKey を削除またはファイル削除（実装で決定）。

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

- `bklg issue search --project PROJ --status open --assignee me --keyword "ログイン"`
- `bklg issue search --count 20 --order updated`

*主要オプション（案）**

- `--project <PROJECT_KEY>`（複数指定可にするなら `--project PROJ --project ABC`）
- `--status <open|closed|...>`（Backlog の statusId を内部で解決するか、まずは数値指定）
- `--assignee <me|userId>`
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

- `-m, --message <text>`
- `--message-file <path>`
- `--notify <userIdCSV>`（Backlog API の `notifiedUserId[]` に対応）
- `--dry-run`（送信せず表示のみ）

Output

- `text`: `Comment posted: <commentId>`
- `json`: 作成されたコメントのレスポンス

#### 2.3.4 コメント一覧取得 `bklg issue comments <issueKeyOrId>`

課題のコメント一覧を取得します。

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

## 3. エラー仕様

- 401/403: 認証（APIキー・権限）問題として明示
- 404: 対象が存在しない（issueKeyの誤りなど）
- 429: レート制限（再試行を促す）
- ネットワークエラー: 接続先 host/space の誤りを疑う文言

`--format json` の場合は、エラーも JSON で出す（例）

```json
{
  "error": true,
  "status": 404,
  "message": "Issue not found",
  "details": { "...": "..." }
}
```

## 4. セキュリティ

- APIキーはログ出力しない
- 設定ファイルのパーミッションに注意（可能なら 600 を推奨）
- `--debug` でもキーを出さない（URLに含めない／含む場合はマスク）

## 5. 実装メモ（TypeScript）

- CLI: commander
- HTTP: fetch
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
