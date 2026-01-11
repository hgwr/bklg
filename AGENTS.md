# AGENTS.md

このリポジトリは Backlog API v2 を薄くラップする CLI「bklg」を開発します。
ここでは、AIエージェント（Copilot Chat / Codex / ChatGPT 等）や人間のコントリビュータが迷わないための **開発ルール** をまとめます。

## 目的

- `bklg` を npm パッケージとして配布し、Backlog の課題（チケット）をCLIで扱えるようにする。
- Backlog API を「薄く」ラップし、なるべく API の概念とエンドポイントに対応するコマンドを用意する。
- VS Code 上の AI が参照しやすい出力（Markdown/JSON）を提供する。

## リポジトリ構成

- `src/`
  - `cli/` コマンド定義（例：commander / yargs 等）
  - `api/` Backlog API クライアント（薄いラッパー）
  - `auth/` 設定読込、環境変数、保存処理
  - `format/` md/json/text の整形
  - `utils/`
- `docs/spec.md` コマンド仕様とI/O
- `README.md` 利用者向け説明
- `AGENTS.md` 開発者向けルール（このファイル）

## 実装ポリシー

### 1) “薄いラッパー” 原則

- できるだけ Backlog API のリソース名・概念を保ちます（issue/comment/wiki 等）。
- 余計な抽象化は避ける。
- 出力整形（Markdown, JSON）は追加価値なので手厚くする。

### 2) 認証

- APIキーのみ対応
- 認証情報の取得優先順位：
  1. 引数（`--space`, `--api-key`）
  2. env（`BACKLOG_SPACE`, `BACKLOG_API_KEY`）
  3. config（`~/.config/bklg/config.json`）

### 3) エラー処理

- APIエラーは JSON で情報を保持しつつ、人間には読みやすいエラーメッセージを出す。
- 401/403 は認証情報が無いや権限が無い、を明確に出す。
- 404 は「対象が存在しない（課題キー間違いなど）」を明確に出す。

### 4) 出力フォーマット

- `--format` は `md | json | text` をサポート。
- `json` は API の返却を極力そのまま（必要最小限の整形のみ）返す。
- `md` は AI が読み取りやすいように、見出し・箇条書きを安定した順序で出す。

### 5) ログとデバッグ

- 通常は静かに動作（必要最低限の出力）。
- `--debug` で HTTP の URL / ステータス / 主要ヘッダ程度を出す（APIキーは絶対出さない）。

## コーディング規約

- TypeScript: strict
- 例外より `Result` 的な戻り値
- Lint/format は `eslint` + `prettier`

## テスト

- `api/` はモック（nock 等）で HTTP をテスト
- `format/` はスナップショットテスト
- `cli/` は最低限のE2E（help, auth status, issue view など）

## Issue-Driven Workflow

Always start work from open GitHub issues and keep them updated.

Commands:

- List open issues:
  - gh issue list -R hgwr/bklg
- View an issue:
  - gh issue view <id> -R hgwr/bklg
- Comment and close when done:
  - gh issue comment <id> -b "summary..."
  - gh issue close <id> -R hgwr/bklg

## GitHub CLI Text Formatting

Avoid literal "\n" showing up in issue/PR bodies. Bash does not expand "\n" inside
double quotes. Prefer body files or $'..' strings.

Examples:

- Issue/PR bodies via heredoc:
  - 
    ```
    cat <<'EOF' | gh issue create -R hgwr/bklg --title "..." --body-file -
    line 1

    line 2
    EOF
    ```
  - 
    ```
    cat <<'EOF' | gh pr create -R hgwr/bklg --title "..." --body-file -
    line 1

    line 2
    EOF
    ```
- Short bodies with escaped newlines:
  - gh issue comment <id> -R hgwr/bklg -b $'line 1\n\nline 2'
  - gh pr comment <id> -R hgwr/bklg -b $'line 1\n\nline 2'

## Branching and Review

When resolving GitHub issues, create a working branch from `main` and open a pull request for review before merging.

After a pull request is reviewed and the issue acceptance criteria are met,
merge the pull request, link it to the issue, then close the issue.

## CI (GitHub Actions)

Keep a workflow that runs on `pull_request` and `push` to build/test so errors
surface early.

## リリース

- semver
- `npm publish`
- GitHub Actions で lint/test/build を必須にする

## 追加の注意（AIエージェント向け）

- 認証情報（APIキー）をログに出さないでください。
- Backlog API の仕様に沿って実装し、推測でパラメータ名を作らないでください。
- `docs/spec.md` を更新することを忘れないでください（コマンド追加時）。
