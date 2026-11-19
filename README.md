# SnipGate-Solo

Show snippets **only where they belong**.

Standard VS Code snippets are scoped by language (and, in recent VS Code
versions, by per-snippet glob `include`/`exclude`). SnipGate-Solo takes a
different shape:

- Rules are defined centrally in `settings.json`, in one field.
- A rule's condition is one or more **regular expressions** tested against
  the file's path **relative to its workspace folder**.
- When a rule matches, the snippets in the rule's snippet file — referenced
  by a path **relative to the same workspace folder** — are offered.
- A rule whose snippet file does not exist in a given root is **silently
  skipped** for that root (multi-root workspaces), and evaluation moves on
  to the next rule.
- Snippet files use the standard `.code-snippets` format (`prefix`, `body`,
  `description`, optional `scope`).

Vanilla JS, no build step, zero runtime dependencies, 100% local, no tracking.

## Settings

```json
"snipGate.rules": [
  {
    "patterns": ["\\.test\\.ts$", "\\.spec\\.ts$"],
    "snippetFile": ".vscode/snipgate/test.code-snippets"
  },
  {
    "patterns": ["^src/components/"],
    "snippetFile": ".vscode/snipgate/components.code-snippets"
  }
]
```

- `patterns`: array of regex strings. The rule matches when **any** pattern
  matches (OR). The target string is the workspace-relative path with `/`
  separators (for example `src/components/Button.tsx`), on every OS.
- `snippetFile`: a `.code-snippets` file, relative to the workspace folder.
  `../shared/common.code-snippets` style paths are allowed.
- The setting is resource-scoped: in a multi-root workspace, each folder's
  own `.vscode/settings.json` can carry its own rules.

## Important: where to put gated snippet files

Files placed **directly** in `.vscode/*.code-snippets` are loaded by VS Code
itself as project snippets and appear in **every** file of the workspace —
no extension can gate those. Put rule-gated files somewhere VS Code does
not auto-load, for example a subfolder: `.vscode/snipgate/*.code-snippets`.
(This was verified on VS Code 1.147: subfolder files are not loaded
natively, files directly in `.vscode/` are.)

## Commands

- **SnipGate: Show Matching Rules for Current File** — evaluates every
  rule against the active file and reports `ok` / `no-match` /
  `missing-file` / `parse-error` / `invalid-rule` in the
  "SnipGate-Solo" output channel.
- **SnipGate: Reload Snippet Files** — clears the snippet cache
  (edits are normally picked up automatically via mtime).

## Trying the sample workspace

1. Install the VSIX (or run this extension with F5) in VS Code or Kiro.
2. Open the `sample-workspace/` folder in that window.
3. Open `src/sample.test.ts` and type `testblock` — the gated test snippets
   appear. Type `comp` — it does not appear here.
4. Open `src/components/Button.tsx` and type `comp` — it appears. Type
   `testblock` — it does not appear here.
5. Open `src/utils/helper.ts` — neither gated snippet appears. (The third
   sample rule matches every `.ts` file but its snippet file does not
   exist, so it is silently skipped.)
6. In any file, type `leakcheck` — it appears everywhere, because it lives
   directly in `.vscode/` and VS Code loads it natively. This is the
   behaviour being gated.
7. Run **SnipGate: Show Matching Rules for Current File** in each file to
   see the per-rule verdicts.

A step-by-step checklist for Kiro, with the expected result for every
step, is in `docs/kiro-test-data.md` (Japanese).

## Development

- Tests (no VS Code needed): `npm test`
- Real-host tests (VS Code 1.147, multi-root fixture): `npm run test:real`
  — in some environments the VS Code unzip needs
  `TAR_OPTIONS=--no-same-owner`.
- Package: `npx @vscode/vsce package`

## 日本語まとめ

スニペットを、出すべき場所でだけ出すための拡張です。

- ルールは `settings.json` の `snipGate.rules` に書きます。各ルールは
  「ワークスペース相対パスに当てる正規表現（複数可、OR）」と
  「対応する `.code-snippets` ファイルへの相対パス」の組です。
- 合致したファイルでだけ、そのファイルのスニペットが補完候補に出ます。
- マルチルートではルールがフォルダ単位で閉じ、スニペットファイルが
  無いフォルダではそのルールは黙ってスキップされます。
- ゲートしたいスニペットファイルは `.vscode` 直下ではなく
  `.vscode/snipgate/` のようなサブフォルダに置いてください。直下に
  置くと VS Code 自身が読み込んで全ファイルに出てしまいます
  （VS Code 1.147 で実機確認済み）。
- 確認は同梱の `sample-workspace/` でできます。Kiro での確認手順と
  期待結果の一覧は `docs/kiro-test-data.md` にあります。
