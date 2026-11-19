# Changelog

## [1.0.3] - 2026-11-19

- Documentation only, no functional change: recorded the Kiro verification results (2026-11-19, performed by the author in Kiro with the prepared checklist — steps 1–6 all OK: gated candidates, silent skip, the show-matches verdicts, Kiro auto-loading files placed directly in `.vscode/` just like VS Code, and the native glob `include` behaving the same; the optional multi-root step is still unconfirmed). The README Roadmap and Requirements now state Kiro as verified, and the full results were appended to `docs/kiro-test-data.md`.

---

- ドキュメントのみの変更で、機能変更はありません：Kiro での検証結果を記録しました（2026-11-19、用意したチェックリストで本人が Kiro で実施 — 手順1〜6すべて OK：ゲートされた候補、黙ってスキップ、判定コマンドの出力、`.vscode/` 直下置きは Kiro でも VS Code と同様に自動読み込みされること、標準の glob `include` も同じ効き方をすること。任意のマルチルート手順だけ未確認）。README のロードマップと動作要件は Kiro を確認済みとし、結果の全文を `docs/kiro-test-data.md` に追記しました。

## [1.0.2] - 2026-11-19

- Documentation only, no functional change: the README was restructured into the Solo series format — badges and a language switcher at the top, then the full English text followed by the full Japanese text with the same section structure in both languages (the 1.0.0 README carried only a short Japanese summary).

---

- ドキュメントのみの変更で、機能変更はありません：README を Solo シリーズの形式に再構成しました。冒頭にバッヂと言語切替を置き、English の全文に続いて Japanese の全文を、両言語で同じ節構成で載せています（1.0.0 の README は日本語が短いまとめだけでした）。

## [1.0.1] - 2026-11-19

- Release infrastructure only, no functional change: added the `scripts/check-version.js` version-consistency check that the shared CI workflow runs (it was missing in 1.0.0, so the Code Quality workflow failed on the version-check step), plus the README version line it requires.

---

- リリース基盤のみの修正で、機能変更はありません：共通 CI ワークフローが実行する版整合性チェック `scripts/check-version.js` を追加しました（1.0.0 では欠けていて、コード品質ワークフローが版チェックのステップで失敗していました）。あわせて、そのチェックが要求する README の版表記も追加しました。

## [1.0.0] - 2026-11-19

- First public release (Visual Studio Marketplace, Open VSX, GitHub Release). Rule-gated snippets: define `snipGate.rules` in settings.json — each rule tests one or more regular expressions against the workspace-relative file path and points to a `.code-snippets` file by a relative path; only matching files offer that file's snippets. Resource-scoped rules close per workspace folder in multi-root workspaces, and a rule whose snippet file does not exist in a folder is silently skipped for that folder. Commands report the per-rule verdict for the current file and reload snippet files; snippet `scope` is honoured. Full English/Japanese UI. 100% local, no tracking, zero runtime dependencies.

---

- 初回公開リリース（Visual Studio Marketplace、Open VSX、GitHub Release）。ルール連動スニペット：settings.json の `snipGate.rules` に、ワークスペース相対パスへ当てる正規表現（複数可）と、対応する `.code-snippets` ファイルへの相対パスを書くと、合致したファイルでだけそのスニペットが候補に出ます。ルールはフォルダ単位で閉じるためマルチルートでも混ざらず、スニペットファイルが無いフォルダではそのルールは黙ってスキップされます。現在のファイルに対するルール別判定の表示と、スニペットファイルの再読み込みコマンド付き。スニペットの `scope` も尊重します。英語／日本語の完全対応。100% ローカル、トラッキングなし、実行時依存ゼロ。
