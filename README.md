# SnipGate-Solo

[![Version](https://img.shields.io/badge/version-v1.0.5-blue.svg)](package.json)
[![Visual Studio Marketplace](https://vsmarketplacebadges.dev/version/masanori-satake.snipgate-solo.svg?label=Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=masanori-satake.snipgate-solo)
[![Open VSX](https://img.shields.io/open-vsx/v/masanori-satake/snipgate-solo?label=Open%20VSX)](https://open-vsx.org/extension/masanori-satake/snipgate-solo)
[![GitHub release (latest by date)](https://img.shields.io/github/v/release/masanori-satake/SnipGate-Solo)](https://github.com/masanori-satake/SnipGate-Solo/releases)

<p align="center">
  <strong>Language / 言語:</strong> <a href="#english">English</a> | <a href="#japanese">日本語</a>
</p>

---

<a id="english"></a>
## English

**SnipGate-Solo** is a lightweight, 100% local VS Code extension that shows snippets **only where they belong**. You define rules in `settings.json` — regular expressions matched against the workspace-relative file path — and each rule points to a snippet file. Its snippets appear as completion candidates only in files that match the rule.

Standard snippets are scoped by language (and, in recent VS Code versions, by per-snippet glob `include`/`exclude`). SnipGate-Solo instead gates **whole snippet files** with **regular expressions**, from one central setting.

Current version: **v1.0.5**

---

<a id="en-toc"></a>
### 📑 Table of Contents

- [💡 Key Features](#en-key-features)
- [📦 Installation & Updates](#en-installation)
- [🚀 How to Use](#en-how-to-use)
- [⌨️ Commands](#en-commands)
- [🔧 Settings](#en-settings)
- [📋 Requirements](#en-requirements)
- [🔒 Data Storage & Privacy](#en-privacy)
- [🧭 Roadmap](#en-roadmap)
- [🛠️ Developer Documentation](#en-developer-docs)
- [📄 License](#en-license)

---

<a id="en-key-features"></a>
### 💡 Key Features

1. **Regex gates, per file path**
   - A rule's condition is one or more regular expressions tested against the file's path relative to its workspace folder (for example `\.test\.ts$` or `^src/components/`). The rule matches when any one pattern matches (OR).

2. **One rule gates a whole snippet file**
   - The rule points to a `.code-snippets` file by a relative path. Adding snippets never means editing rules per snippet — the file's whole set is gated at once.

3. **Multi-root safe**
   - Rules are resource-scoped and close per workspace folder. A rule whose snippet file does not exist in a given folder is **silently skipped** for that folder — no errors, no popups — and evaluation moves on to the next rule.

4. **Standard snippet format**
   - Snippet files use the usual `.code-snippets` format (`prefix`, `body`, `description`); a snippet's `scope` (language list) is honoured on top of the gate.

5. **Local First / Privacy First**
   - 100% local, no tracking, no network, zero runtime dependencies. Vanilla JS, no build step.

---

<a id="en-installation"></a>
### 📦 Installation & Updates

#### Method 1: Install from Visual Studio Marketplace (Recommended)

##### A. Install via VS Code UI

1. Open the Extensions view (`Ctrl+Shift+X`).
2. Search for **SnipGate-Solo**.
3. Click **Install**.

##### B. Install via Web Browser

Open the [Visual Studio Marketplace page](https://marketplace.visualstudio.com/items?itemName=masanori-satake.snipgate-solo) and click **Install**.

#### Method 2: Install from Open VSX Registry

Open the [Open VSX page](https://open-vsx.org/extension/masanori-satake/snipgate-solo) and follow the instructions there. This is the route for editors that use Open VSX (for example VSCodium).

#### Method 3: Install from VSIX Package File (Offline / Manual)

1. Download the `.vsix` file from [GitHub Releases](https://github.com/masanori-satake/SnipGate-Solo/releases).
2. In the editor, open the Extensions view → **…** menu → **Install from VSIX…** and select the file.

Updates are delivered through the same channel you installed from.

---

<a id="en-how-to-use"></a>
### 🚀 How to Use

#### 1. Place gated snippet files in a subfolder

Files placed **directly** in `.vscode/*.code-snippets` are loaded by VS Code itself as project snippets and appear in **every** file of the workspace — no extension can gate those. Put rule-gated files somewhere VS Code does not auto-load, for example:

```
.vscode/snipgate/test.code-snippets
.vscode/snipgate/components.code-snippets
```

(This was verified on VS Code 1.147: subfolder files are not loaded natively; files directly in `.vscode/` are.)

#### 2. Write rules in settings.json

```json
"snipGate.rules": [
  { "patterns": ["\\.test\\.ts$"], "snippetFile": ".vscode/snipgate/test.code-snippets" },
  { "patterns": ["^src/components/"], "snippetFile": ".vscode/snipgate/components.code-snippets" }
]
```

#### 3. Type a prefix

In a matching file, the gated snippets appear as candidates. In every other file, they do not appear at all.

#### 4. Check the verdicts

Run **SnipGate: Show Matching Rules for Current File** to see, per rule, whether the current file matched, the snippet file was missing, and so on.

#### Trying the sample workspace

The repository's `sample-workspace/` folder is a ready-made fixture: open it, type `testblock` in `src/sample.test.ts`, `comp` in `src/components/Button.tsx`, and either prefix in `src/utils/helper.ts` (neither appears). Type `leakcheck` anywhere — it appears everywhere, because it lives directly in `.vscode/` and the editor loads it natively; that is exactly the behaviour being gated. A step-by-step checklist with expected results (also for Kiro) is in `docs/kiro-test-data.md` (Japanese).

---

<a id="en-commands"></a>
### ⌨️ Commands

| Command | Description |
| --- | --- |
| `SnipGate: Show Matching Rules for Current File` | Evaluates every rule against the active file and reports `ok` / `no-match` / `missing-file` / `parse-error` / `invalid-rule` in the "SnipGate-Solo" output channel. |
| `SnipGate: Reload Snippet Files` | Clears the snippet cache. (Edits are normally picked up automatically via file mtime.) |

---

<a id="en-settings"></a>
### 🔧 Settings

#### `snipGate.rules`

An array of rules. Each rule has:

- `patterns`: array of regular-expression strings, tested against the workspace-relative file path with `/` separators (the same form on every OS). The rule matches when **any** pattern matches.
- `snippetFile`: path of a `.code-snippets` file, relative to the workspace folder. Paths such as `../shared/common.code-snippets` are allowed; when a rule resolves outside the workspace folder, a warning is written to the SnipGate-Solo output channel.

The setting is resource-scoped: in a multi-root workspace, each folder's own `.vscode/settings.json` can carry its own rules, and each folder's rules are evaluated against that folder only.

---

<a id="en-requirements"></a>
### 📋 Requirements

- **VS Code**: `v1.90.0` or later; **Kiro**: verified working (2026-11-19, checklist steps 1–6 below in the Roadmap)
- **OS**: Windows, macOS, Linux
- No accounts, no API keys, no network access required.

---

<a id="en-privacy"></a>
### 🔒 Data Storage & Privacy

Everything happens locally. The extension reads only your `snipGate.rules` setting and the snippet files those rules point to. There is no telemetry, no cloud service, and no AI feature; file paths and snippet contents are **never** transmitted over any network. The extension stores nothing of its own. Snippet bodies use the full VS Code snippet syntax (tabstops and variables such as `$TM_FILENAME`), exactly like native project snippets — accepting a completion inserts the body with those substitutions applied.

---

<a id="en-roadmap"></a>
### 🧭 Roadmap

- Kiro verification (done 2026-11-19): the same checklist passed in Kiro — gated snippets appear only in matching files, the silent skip works, files placed directly in `.vscode/` are auto-loaded by Kiro just like VS Code (so the subfolder placement matters there too), and the native glob `include` behaves the same. Only the optional multi-root step is still unconfirmed in Kiro.
- If the core proves good in everyday use, editing aids for rules may follow. The first release deliberately targets users who write regular expressions; there is no rule editor.

---

<a id="en-developer-docs"></a>
### 🛠️ Developer Documentation

- Development and release rules for contributors and AI agents: [AGENTS.md](AGENTS.md)
- Build & test:

```bash
npm run check        # syntax check for all JS
npm test             # unit + mock-API integration tests (node --test)
npm run test:real    # real-host tests in headless VS Code (@vscode/test-cli)
npm run package      # build the VSIX (runs the version check first)
```

---

<a id="en-license"></a>
### 📄 License

[MIT License](LICENSE)

---

<a id="japanese"></a>
## Japanese (日本語)

**SnipGate-Solo** は、スニペットを **出すべき場所でだけ** 出す、軽量で 100% ローカルの VS Code 拡張です。`settings.json` にルールを書きます。各ルールは「ワークスペース相対パスに当てる正規表現」と「対応するスニペットファイルへの相対パス」の組で、合致したファイルでだけ、そのスニペットが補完候補に出ます。

標準のスニペットは言語で出し分けるもので、最近の VS Code ではスニペットごとに glob の `include`/`exclude` も書けます。SnipGate-Solo はそれとは別形状で、**正規表現**で **スニペットファイル丸ごと** を、1か所の設定から出し分けます。

現在のバージョン: **v1.0.5**

---

<a id="ja-toc"></a>
### 📑 目次

- [💡 主な機能](#ja-key-features)
- [📦 インストール/アップデート方法](#ja-installation)
- [🚀 使い方](#ja-how-to-use)
- [⌨️ コマンド](#ja-commands)
- [🔧 設定](#ja-settings)
- [📋 動作要件](#ja-requirements)
- [🔒 データの保存とプライバシー](#ja-privacy)
- [🧭 ロードマップ](#ja-roadmap)
- [🛠️ 開発者向けドキュメント](#ja-developer-docs)
- [📄 ライセンス](#ja-license)

---

<a id="ja-key-features"></a>
### 💡 主な機能

1. **正規表現でファイルパスを判定**
   - ルールの条件は、ワークスペースフォルダからの相対パスに当てる正規表現（複数可）です（例：`\.test\.ts$`、`^src/components/`）。いずれか1つが合致すればルールが適用されます（OR）。

2. **ルール1つでスニペットファイル丸ごとを出し分け**
   - ルールは `.code-snippets` ファイルを相対パスで指します。スニペットが増えても、スニペットごとに設定を書く必要はありません。

3. **マルチルートでも安全**
   - ルールはフォルダ単位で閉じます。そのフォルダにスニペットファイルが存在しないルールは、エラーもポップアップもなく **黙ってスキップ** され、次のルールの判定に進みます。

4. **標準のスニペット形式**
   - スニペットファイルは通常の `.code-snippets` 形式（`prefix`、`body`、`description`）です。スニペット側の `scope`（言語リスト）も、ゲートの上で尊重されます。

5. **ローカルファースト / プライバシーファースト**
   - 100% ローカル、トラッキングなし、ネットワークなし、実行時依存ゼロ。バニラ JS でビルド工程もありません。

---

<a id="ja-installation"></a>
### 📦 インストール/アップデート方法

#### 方法 1: Visual Studio Marketplace からのインストール（推奨）

##### A. VS Code UI からインストール

1. 拡張機能ビューを開く（`Ctrl+Shift+X`）。
2. **SnipGate-Solo** を検索する。
3. **インストール** をクリックする。

##### B. VS Code Marketplace Web ページからインストール

[Visual Studio Marketplace のページ](https://marketplace.visualstudio.com/items?itemName=masanori-satake.snipgate-solo)を開いて **Install** をクリックします。

#### 方法 2: Open VSX Registry からのインストール

[Open VSX のページ](https://open-vsx.org/extension/masanori-satake/snipgate-solo)を開いて、案内に従ってください。Open VSX を使うエディタ（VSCodium など）向けの経路です。

#### 方法 3: VSIX パッケージファイルからのインストール（オフライン環境等）

1. [GitHub Releases](https://github.com/masanori-satake/SnipGate-Solo/releases) から `.vsix` ファイルをダウンロードする。
2. エディタの拡張機能ビュー →「…」メニュー →「VSIX からインストール…」でファイルを選ぶ。

アップデートは、インストールしたのと同じ経路で配信されます。

---

<a id="ja-how-to-use"></a>
### 🚀 使い方

#### 1. ゲートしたいスニペットファイルはサブフォルダに置く

`.vscode/*.code-snippets` の **直下** に置いたファイルは、VS Code 自身がプロジェクトスニペットとして読み込み、ワークスペースの **全ファイル** に出ます。拡張からは止められません。ルールで出し分けたいファイルは、VS Code が自動で読み込まない場所、例えばサブフォルダに置いてください。

```
.vscode/snipgate/test.code-snippets
.vscode/snipgate/components.code-snippets
```

（VS Code 1.147 で実機確認済み：サブフォルダのファイルは自動読み込みされず、直下のファイルは読み込まれます）

#### 2. settings.json にルールを書く

```json
"snipGate.rules": [
  { "patterns": ["\\.test\\.ts$"], "snippetFile": ".vscode/snipgate/test.code-snippets" },
  { "patterns": ["^src/components/"], "snippetFile": ".vscode/snipgate/components.code-snippets" }
]
```

#### 3. prefix を打つ

合致したファイルではゲートされたスニペットが候補に出ます。それ以外のファイルでは、まったく出ません。

#### 4. 判定を確認する

**「SnipGate: 現在のファイルに合致するルールを表示」** を実行すると、ルールごとに、合致したか、スニペットファイルが無かったかなどが分かります。

#### サンプルワークスペースで試す

リポジトリの `sample-workspace/` フォルダがそのまま確認用です。フォルダを開いて、`src/sample.test.ts` で `testblock`、`src/components/Button.tsx` で `comp`、`src/utils/helper.ts` でその両方（どちらも出ません）を打ってみてください。`leakcheck` はどのファイルでも出ます。`.vscode/` 直下にあるためエディタ自身が読み込むもので、これがゲートしたい挙動そのものです。手順と期待結果の一覧（Kiro 向けも含む）は `docs/kiro-test-data.md` にあります。

---

<a id="ja-commands"></a>
### ⌨️ コマンド

| コマンド | 説明 |
| --- | --- |
| `SnipGate: 現在のファイルに合致するルールを表示` | 現在のファイルに対して全ルールを判定し、`ok` / `no-match` / `missing-file` / `parse-error` / `invalid-rule` を「SnipGate-Solo」出力チャネルに表示します。 |
| `SnipGate: スニペットファイルを再読み込み` | スニペットのキャッシュを消去します（通常、編集はファイルの更新時刻で自動的に拾われます）。 |

---

<a id="ja-settings"></a>
### 🔧 設定

#### `snipGate.rules`

ルールの配列です。各ルールは次の2つを持ちます。

- `patterns`: 正規表現文字列の配列。ワークスペース相対パス（区切りは全 OS で `/`）に当てます。いずれか1つが合致すれば適用されます。
- `snippetFile`: `.code-snippets` ファイルへのパス。ワークスペースフォルダからの相対パスで書きます。`../shared/common.code-snippets` のような書き方もできます。フォルダの外へ解決されるルールについては、SnipGate-Solo の出力チャネルに警告が出ます。

この設定はリソーススコープです。マルチルートではフォルダごとの `.vscode/settings.json` にそのフォルダのルールを書けます。各フォルダのルールは、そのフォルダの中でだけ判定されます。

---

<a id="ja-requirements"></a>
### 📋 動作要件

- **VS Code**: `v1.90.0` 以降、**Kiro**: 動作確認済み（2026-11-19、ロードマップの手順1〜6）
- **OS**: Windows、macOS、Linux
- アカウント、API キー、ネットワーク接続は不要です。

---

<a id="ja-privacy"></a>
### 🔒 データの保存とプライバシー

すべてローカルで処理します。この拡張が読むのは `snipGate.rules` 設定と、そのルールが指すスニペットファイルだけです。テレメトリ、クラウドサービス、AI 機能はなく、ファイルパスやスニペットの内容がネットワークに送信されることは **決してありません**。拡張自身が保存するデータもありません。スニペットの本文は VS Code 標準のスニペット構文そのまま（タブストップや `$TM_FILENAME` などの変数を含む）で、標準のプロジェクトスニペットとまったく同じです。候補を受け入れると、それらの置換が適用された本文が挿入されます。

---

<a id="ja-roadmap"></a>
### 🧭 ロードマップ

- Kiro での検証（2026-11-19 完了）：同じチェックリストが Kiro でも通りました。ゲートされたスニペットは合致したファイルでだけ出て、ファイル無しルールの黙ってスキップも動作。`.vscode/` 直下置きは Kiro でも VS Code と同様に自動読み込みされる（＝サブフォルダ置きが Kiro でも必要）ことと、標準の glob `include` も同じ効き方をすることが分かりました。未確認は任意のマルチルート手順だけです。
- 中核が日常の利用で良いと確かめられたら、ルール編集の補助を検討します。初版は正規表現を書ける利用者を対象とし、ルールエディタは意図的に入れていません。

---

<a id="ja-developer-docs"></a>
### 🛠️ 開発者向けドキュメント

- 開発とリリースのルール（貢献者と AI エージェント向け）: [AGENTS.md](AGENTS.md)
- ビルドとテスト:

```bash
npm run check        # 全 JS の構文チェック
npm test             # 単体 + モック API 統合テスト (node --test)
npm run test:real    # ヘッドレス VS Code での実機テスト (@vscode/test-cli)
npm run package      # VSIX の作成（版チェックを先に実行）
```

---

<a id="ja-license"></a>
### 📄 ライセンス

[MIT License](LICENSE)
