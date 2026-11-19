# SnipGate-Solo Kiro 確認用テストデータ

Kiro に SnipGate-Solo をインストールして試すための手順と期待結果です。
実行単位は「手順1つ＝確認1つ」です。各手順で、期待結果と違ったら
その手順番号と画面の様子をフィードバックしてください。

## 前提

- SnipGate-Solo の VSIX（snipgate-solo-1.0.0.vsix）を Kiro に
  インストール済みであること
  （拡張ビュー →「…」メニュー →「VSIX からインストール」）。
- このリポジトリの `sample-workspace/` フォルダを Kiro で開くこと。
  中身は VS Code 1.147 で全項目通過済みのものと同じです。

## 確認手順

### 手順1：テストファイルでだけテスト用スニペットが出る

1. `src/sample.test.ts` を開く
2. 空の行で `testblock` と入力する

- 期待結果：候補に `testblock`（説明に [rule-gated] と付いたもの）が出る。
  選ぶと `test('...', () => { ... });` の形に展開する
- ついでに `expecteq` と入力すると、候補に出る
- ついでに `comp` と入力しても、候補に **出ない**

### 手順2：コンポーネント配下でだけコンポーネント用が出る

1. `src/components/Button.tsx` を開く
2. 空の行で `comp` と入力する

- 期待結果：候補に `comp` が出て、選ぶと関数コンポーネントの雛形に展開する
- ついでに `testblock` と入力しても、候補に **出ない**

### 手順3：どちらでもないファイルでは何も出ない

1. `src/utils/helper.ts` を開く
2. `testblock`、`comp` と入力する

- 期待結果：どちらも候補に **出ない**
  （このファイルには、全 `.ts` に当たる3番目のルールもマッチしますが、
  そのスニペットファイルが存在しないため、黙ってスキップされます。
  エラーが出ないことも確認してください）

### 手順4：直下置きは Kiro でも全ファイルに出るか（対比）

1. どのファイルでもよいので `leakcheck` と入力する

- 期待結果（VS Code の場合）：候補に出る
  （`.vscode/` 直下のファイルはエディタ自身が読み込むため）
- Kiro で出る／出ないのどちらでも、その結果を教えてください。
  Kiro の自動読み込み範囲が VS Code と同じかどうかの確認になります

### 手順5：標準の include（glob）は Kiro で効くか（対比）

1. `src/sample.test.ts` で `nativeprobe` と入力する → VS Code では出る
2. `src/utils/helper.ts` で `nativeprobe` と入力する → VS Code では出ない

- 期待結果：Kiro でも同じなら、標準の glob ゲートは Kiro でも有効。
  違えば、その様子を教えてください（SnipGate の存在理由に関わります）

### 手順6：ルール判定コマンドが見える

1. `src/sample.test.ts` を開いた状態で、コマンドパレットから
   「SnipGate: 現在のファイルに合致するルールを表示」を実行する

- 期待結果：出力パネル（SnipGate-Solo）に、ルールごとの判定
  （ok / no-match / missing-file）が表示され、
  1番目のルールが `ok (... snippets)`、3番目が `missing-file` になる

### 手順7：マルチルート（任意・できれば）

1. ワークスペースに `test-real/root-b/` もフォルダとして追加する
   （`.code-workspace` を使う場合は `test-real/multi.code-workspace`）
2. `root-b/src/b.test.ts` を開き、`testblock` と入力する

- 期待結果：候補に **出ない**（root-b にはスニペットファイルが無いため、
  同じルールでも全てスキップされる）。エラーも出ない

## フィードバックの形

手順ごとに「OK」か「NG（＋様子）」だけで十分です。
例：「手順1〜3 OK、手順4は出なかった、手順6は出力先が分からなかった」

## 実施結果（2026-11-19、佐竹が Kiro で実施）

- 手順1〜6：すべて OK。手順6の出力は期待どおり
  （rule 0 = ok・2 snippets、rule 1 = no-match、rule 2 = missing-file）。
- 手順4の結論：Kiro も `.vscode/` 直下の `.code-snippets` を自動読み込みする
  （VS Code と同じ）。サブフォルダ置きのゲートは Kiro でも有効。
- 手順5の結論：標準の glob `include` も Kiro で VS Code と同じ効き方をする。
- 手順7（マルチルート）：未実施（任意）。
