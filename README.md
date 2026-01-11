# bklg

Backlog（backlog.jp / backlog.com）の **API v2 を薄くラップするCLI** です。
GitHub CLI の `gh` のように、ターミナルや VS Code から Backlog の課題（チケット）を扱いやすくすることを目的にしています。

本プロジェクトは **APIキー認証** を採用します。

## 特徴

- 課題（issue）の閲覧・検索・コメント投稿をCLIで実行できる
- 出力を `--format md|json|text` で切り替えできます（AI/エディタで扱いやすい）
- Backlog API をなるべくそのまま反映した「薄いラッパー」を目指す
- 設定はローカルに保存し、`BACKLOG_API_KEY` など環境変数でも上書きできる

## インストール

### npm（グローバル）

```bash
npm i -g bklg
````

### npx

```bash
npx bklg --help
```

## クイックスタート

### 1) 接続先とAPIキーを設定

Backlog の APIキーを用意してから（個人設定で発行）、以下を実行します。

```bash
bklg auth login --space your-space --api-key YOUR_API_KEY
```

または環境変数で渡します（CIや一時利用向け）

```bash
export BACKLOG_SPACE=your-space
export BACKLOG_API_KEY=YOUR_API_KEY
```

### 2) 課題を見る

```bash
bklg issue view PROJ-123 --format md
```

### 3) コメントを書く

```bash
bklg issue comment PROJ-123 -m "受け入れ条件を満たす修正を入れました。確認お願いします。"
```

## 主なコマンド（予定）

- `bklg auth login` / `bklg auth status` / `bklg auth logout`
- `bklg issue view <issueKeyOrId>`
- `bklg issue search [--project PROJ] [--assignee me] [--status open] [--keyword "..."]`
- `bklg issue comment <issueKeyOrId> -m "..." [--notify userId,...]`
- `bklg wiki view <pageName>`（将来）

詳細は `docs/spec.md` を参照してください。

## 設定

優先順位（高い順）

1. コマンド引数
2. 環境変数（例：`BACKLOG_SPACE`, `BACKLOG_API_KEY`）
3. 設定ファイル（例：`~/.config/bklg/config.json`）

設定ファイルは `bklg auth login` が作成します。

## セキュリティ注意

- APIキーはユーザー権限で Backlog へアクセスできる秘密情報なので共有しないでください。
- CIでは環境変数による注入を推奨

## 開発

### 必要要件

- Node.js（LTS推奨）
- npm

### セットアップ

```bash
npm ci
npm run build
npm test
```

### ローカル実行

```bash
npm run dev -- issue view PROJ-123 --format md
```

## ライセンス

MIT License

## 免責

このツールは非公式です。Backlog の仕様変更により動作変更の可能性があります。
