# Changelog

## [1.0.0] - 2026-11-19

- First public release (Visual Studio Marketplace, Open VSX, GitHub Release). Rule-gated snippets: define `snipGate.rules` in settings.json — each rule tests one or more regular expressions against the workspace-relative file path and points to a `.code-snippets` file by a relative path; only matching files offer that file's snippets. Resource-scoped rules close per workspace folder in multi-root workspaces, and a rule whose snippet file does not exist in a folder is silently skipped for that folder. Commands report the per-rule verdict for the current file and reload snippet files; snippet `scope` is honoured. Full English/Japanese UI. 100% local, no tracking, zero runtime dependencies.

---

- 初回公開リリース（Visual Studio Marketplace、Open VSX、GitHub Release）。ルール連動スニペット：settings.json の `snipGate.rules` に、ワークスペース相対パスへ当てる正規表現（複数可）と、対応する `.code-snippets` ファイルへの相対パスを書くと、合致したファイルでだけそのスニペットが候補に出ます。ルールはフォルダ単位で閉じるためマルチルートでも混ざらず、スニペットファイルが無いフォルダではそのルールは黙ってスキップされます。現在のファイルに対するルール別判定の表示と、スニペットファイルの再読み込みコマンド付き。スニペットの `scope` も尊重します。英語／日本語の完全対応。100% ローカル、トラッキングなし、実行時依存ゼロ。
