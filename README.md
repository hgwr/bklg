# bklg

Backlog (backlog.jp / backlog.com) API v2 thin wrapper CLI.
It aims to make issues and wiki pages easy to work with from terminals and editors.

- Japanese README: `README-ja.md`

## Features

- View/search issues and post comments from the CLI
- List issue comments completely, even when there are many (auto-pagination)
- Switch output with `--format md|json|text`
- Keep a thin mapping to Backlog API resources
- Store auth locally, override with environment variables

## Installation

Requires Node.js 22.19 or later.

### npm (global)

```bash
npm i -g bklg
```

### npx

```bash
npx bklg --help
```

## Quick Start

### 1) Set space and API key

Generate an API key in Backlog personal settings, then run:

```bash
bklg auth login --space your-space --api-key YOUR_API_KEY
```

Or use environment variables (CI or short-lived usage):

```bash
export BACKLOG_SPACE=your-space
export BACKLOG_API_KEY=YOUR_API_KEY
```

### 2) View an issue

```bash
bklg issue view PROJ-123 --format md
```

### 3) Post a comment

```bash
bklg issue writeComment PROJ-123 -m "Please review the fix."
```

## Practical Examples

- Check auth status
  ```bash
  bklg auth status --format md
  ```
- Search issues (projectId/statusId are numeric)
  ```bash
  bklg issue search --project 123 --status 1 --assignee me --keyword "login" --format text
  ```
- List comments
  ```bash
  bklg issue comments PROJ-123 --format md
  ```
- Post a comment from a file
  ```bash
  bklg issue writeComment PROJ-123 --message-file ./comment.md --notify 1001,1002
  ```
- View a wiki page (project key or id)
  ```bash
  bklg wiki view "Wiki Page" --project PROJ --format md
  ```

## Main Commands

- `bklg auth login` / `bklg auth status` / `bklg auth logout`
- `bklg issue view <issueKeyOrId>`
- `bklg issue search [--project <projectId>] [--assignee me] [--status <statusId>] [--keyword "..."]`
- `bklg issue writeComment <issueKeyOrId> -m "..." [--notify userId,...] [--dry-run]`
- `bklg issue comments <issueKeyOrId>`
- `bklg wiki view <pageName> --project <projectKeyOrId>`

See `docs/spec.md` for the full CLI spec.

## Help Tips

- Use `bklg <command> -h` to see usage with examples.
- Subcommand help also shows global options like `--format`, `--space`, and `--api-key`.
- `bklg auth login -h` explains required inputs (`--space`, `--api-key`) and host examples.

## Configuration

Priority order (highest first):

1. CLI args
2. Env vars (`BACKLOG_SPACE`, `BACKLOG_API_KEY`, `BACKLOG_HOST`)
3. Config file (`~/.config/bklg/config.json`)

`bklg auth login` creates the config file.

## Proxy

If your Backlog space restricts source IP addresses ("Access from your IP Address is forbidden."),
route requests through an allowed proxy. bklg picks a proxy in this order:

1. `NO_PROXY` / `no_proxy` matches the Backlog host: connect directly
2. `HTTPS_PROXY` / `https_proxy`, then `HTTP_PROXY` / `http_proxy`
3. OS proxy settings: macOS network settings and Windows Internet Options, including PAC files
   (Linux: env vars only)

```bash
export HTTPS_PROXY=http://proxy.example.com:8080
# Proxy credentials (also applied to proxies found in OS settings / PAC):
export BKLG_PROXY_USERNAME=your-user
export BKLG_PROXY_PASSWORD=your-password
# Or embed them (percent-encode symbols): http://user:p%40ss@proxy.example.com:8080
```

Run with `--debug` to see which proxy was chosen and why.

## Security Notes

- API keys are sensitive. Do not share them.
- Prefer env vars in CI.
- Proxy credentials are never printed, including with `--debug`.

## Development

### Requirements

- Node.js 22.19 or later
- npm

### Setup

```bash
npm ci
npm run build
npm test
```

### Local run

```bash
npm run build
node dist/cli/index.js issue view PROJ-123 --format md
```

## License

MIT License

## Disclaimer

Unofficial tool. Behavior may change if Backlog API changes.
