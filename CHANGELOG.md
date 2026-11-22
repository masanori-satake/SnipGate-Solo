# Changelog

## [1.0.6] - 2026-11-22

- Development-configuration alignment (no feature changes): `.markdownlint.json` is now excluded from the version-bump check in `scripts/check-version.js` (the same treatment as `.pre-commit-config.yaml`), and the pre-commit hooks fixed missing final newlines in the sample and test workspace settings files.

---

- 開発用設定の整備です（機能変更はありません）。`scripts/check-version.js` の版バンプ判定で `.markdownlint.json` を対象外にしました（`.pre-commit-config.yaml` と同じ扱い）。あわせて、サンプル／テスト用ワークスペースの設定ファイルに不足していた末尾の改行を、pre-commit フックで直しました。

## [1.0.5] - 2026-11-22

- Security hardening from the 2026-11-22 audit (no feature changes): the ReDoS guard now rejects two more catastrophic-backtracking shapes that the nested-quantifier check missed and that were proven to stall the shared Extension Host for seconds — adjacent quantified atoms that can match overlapping characters (e.g. `a*a*a*a*b`, `[a-z]*[a-z]*[a-z]*$`, `.*.*.*.*b`) and quantified groups whose alternation branches can start with the same character or where one branch is a prefix of another (e.g. `(a|aa)+$`, `(x|x)+$`). Settings size is now capped (64 rules, 16 patterns per rule, 1024 snippets in total; the limits are also declared as `maxItems`/`maxLength` in the settings schema), and compiled patterns are cached per rule so completion requests no longer recompile every rule on every keystroke. A rule whose `snippetFile` resolves outside the workspace folder (still allowed, e.g. `../shared/common.code-snippets`) now writes an explicit warning to the output channel instead of reading the file silently.

---

- 2026-11-22 の監査に基づく堅牢化です（機能変更はありません）。ReDoS 対策を拡張し、入れ子量化子の検査では捉えられず、拡張ホスト全体を数秒止めうることが実証された2つの形も拒否するようにしました。隣り合う量化子が重なる文字にマッチしうるパターン（例：`a*a*a*a*b`、`[a-z]*[a-z]*[a-z]*$`、`.*.*.*.*b`）と、選択肢同士が同じ文字で始まる・接頭辞関係にある量化グループ（例：`(a|aa)+$`、`(x|x)+$`）です。設定の件数にも上限を設けました（ルール64件、1ルール当たりパターン16件、スニペット総数1024件。上限は設定スキーマにも `maxItems`/`maxLength` として宣言）。コンパイル済みパターンはルール内容をキーにキャッシュし、補完リクエストのたびに全ルールを再コンパイルしないようにしました。`snippetFile` がワークスペースフォルダの外へ解決される場合（`../shared/common.code-snippets` のような外向き参照自体は従来どおり許可）、黙って読まずに出力チャネルへ明示的な警告を出すようにしました。

## [1.0.4] - 2026-11-20

- Hardening and correctness fixes from a full re-audit (no feature changes): rule patterns with nested quantifiers (e.g. `([a-z]+)+`) are now rejected with a reported error instead of being able to stall the shared Extension Host through catastrophic backtracking, and patterns are capped at 512 characters. Snippet files are read only when they are regular files of at most 1 MB, and a file version that failed to parse is not re-read on every keystroke. The JSONC parser no longer removes commas inside string literals (snippet bodies containing `",]"` or `",}"` were silently corrupted). Snippet descriptions are shown as plain text instead of Markdown, so a description cannot embed a remote image. Parse-error logs no longer include the start of the file's contents. `Show Matching Rules` no longer fails on a malformed (e.g. `null`) rule entry. Patterns are compiled once per evaluation instead of twice, snippet paths are normalised (`..` resolved) so watcher invalidation and the cache agree, and the extension now explicitly declares that it does not support untrusted or virtual workspaces. The README privacy section also states explicitly that snippet bodies use the full VS Code snippet syntax.

---

- 全体の再点検で見つかった堅牢化と正確性の修正です（機能変更はありません）。入れ子の量指定子を持つルールパターン（例：`([a-z]+)+`）は、壊滅的なバックトラッキングで拡張ホスト全体を止めうるため、エラーとして報告して拒否するようにし、パターンの長さにも上限（512文字）を設けました。スニペットファイルは通常ファイルで1MB以下のときだけ読み、パースに失敗した版はキー入力のたびに読み直さないようにしました。JSONC パーサが文字列リテラル内のカンマを消してしまう問題も直しました（本文に `",]"` や `",}"` を含むスニペットが黙って壊れていました）。スニペットの説明は Markdown ではなくプレーンテキストで表示し、説明文にリモート画像を埋め込めないようにしました。パースエラーのログにファイル内容の冒頭が含まれないようにし、`Show Matching Rules` が壊れたルール項目（`null` など）で失敗しないようにしました。あわせて、パターンのコンパイルを評価ごとに1回にし、スニペットパスの正規化（`..` の解決）でウォッチャー無効化とキャッシュを一致させ、信頼されていないワークスペースと仮想ワークスペースをサポートしないことを明示しました。README のプライバシー節には、スニペット本文が VS Code のスニペット構文そのものであることも明記しました。

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
