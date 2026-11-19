'use strict';

// Real-VS Code integration tests for the SnipGate prototype.
// Run inside a real Extension Host via @vscode/test-cli (see
// .vscode-test.mjs). Verifies behaviour that a mocked `vscode` module
// cannot: whether VS Code natively loads .code-snippets files from a
// SUBFOLDER of .vscode (gate leak check), the native include/exclude
// behaviour, and our provider's end-to-end effect on the real
// completion list (vscode.executeCompletionItemProvider).

const assert = require('node:assert/strict');
const vscode = require('vscode');
const path = require('path');

function rootA() {
  return vscode.workspace.workspaceFolders.find((f) => f.name === 'sample-workspace');
}
function rootB() {
  return vscode.workspace.workspaceFolders.find((f) => f.name === 'root-b');
}

async function openDoc(folder, rel) {
  const uri = vscode.Uri.joinPath(folder.uri, rel);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
  return doc;
}

async function completionLabels(doc, typedText) {
  const editor = vscode.window.activeTextEditor;
  const pos = editor.selection.active;
  await editor.edit((b) => b.insert(pos, typedText));
  const newPos = editor.selection.active;
  const list = await vscode.commands.executeCommand(
    'vscode.executeCompletionItemProvider',
    doc.uri,
    newPos,
  );
  return (list ? list.items : []).map((i) =>
    typeof i.label === 'string' ? i.label : i.label.label,
  );
}

describe('SnipGate prototype — real VS Code', function () {
  this.timeout(30000);

  it('workspace is the multi-root fixture', () => {
    assert.ok(rootA(), 'sample-workspace folder present');
    assert.ok(rootB(), 'root-b folder present');
  });

  it('LEAK CHECK: subfolder snippets are NOT loaded natively (gate holds)', async () => {
    // In helper.ts no rule of ours supplies testblock. If VS Code loaded
    // .vscode/snipgate/*.code-snippets natively, "testblock" would
    // still appear here. (leakcheck, which lives directly in .vscode/,
    // is the positive control and MUST appear.)
    const doc = await openDoc(rootA(), 'src/utils/helper.ts');
    const labels = await completionLabels(doc, 'testblock leakcheck ');
    assert.ok(labels.includes('leakcheck'), 'control: leakcheck (directly in .vscode) is loaded natively');
    assert.ok(!labels.includes('testblock'), 'testblock must NOT leak into helper.ts');
  });

  it('test file: gated test snippets appear, component snippet does not', async () => {
    const doc = await openDoc(rootA(), 'src/sample.test.ts');
    const labels = await completionLabels(doc, 'testblock expecteq comp ');
    assert.ok(labels.includes('testblock'));
    assert.ok(labels.includes('expecteq'));
    assert.ok(!labels.includes('comp'));
  });

  it('component file: gated component snippet appears, test snippets do not', async () => {
    const doc = await openDoc(rootA(), 'src/components/Button.tsx');
    const labels = await completionLabels(doc, 'comp testblock ');
    assert.ok(labels.includes('comp'));
    assert.ok(!labels.includes('testblock'));
  });

  it('multi-root root B: snippet files missing there -> nothing gated appears', async () => {
    const doc = await openDoc(rootB(), 'src/b.test.ts');
    const labels = await completionLabels(doc, 'testblock expecteq ');
    assert.ok(!labels.includes('testblock'));
    assert.ok(!labels.includes('expecteq'));
  });

  it('accepting a gated snippet expands its body with tabstops', async () => {
    const doc = await openDoc(rootA(), 'src/accept.test.ts');
    const editor = vscode.window.activeTextEditor;
    await editor.edit((b) => b.insert(editor.selection.active, 'testblock'));
    const pos = editor.selection.active;
    const list = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      pos,
    );
    const item = list.items.find(
      (i) => (typeof i.label === 'string' ? i.label : i.label.label) === 'testblock',
    );
    assert.ok(item, 'testblock offered');
    assert.ok(item.insertText instanceof vscode.SnippetString);
    // Deterministic acceptance: run the same command VS Code runs when a
    // completion item is accepted (insert the item's SnippetString at the
    // typed range). Driving the suggest widget's selection state from a
    // test is timing-dependent, so we do not rely on it here.
    await vscode.commands.executeCommand('editor.action.insertSnippet', {
      snippet: item.insertText.value,
    });
    const text = doc.getText();
    assert.ok(text.includes("test('"), `body expanded, got: ${text}`);
  });

  it('native include/exclude probe: glob-gated native snippet behaviour', async () => {
    // nativeprobe is a NATIVE snippet (directly in .vscode/) carrying
    // include: ["**/*.test.ts"]. If this VS Code build honours the
    // file-pattern scope, it appears in *.test.ts but not in helper.ts.
    const helper = await openDoc(rootA(), 'src/utils/helper.ts');
    const inHelper = await completionLabels(helper, 'nativeprobe ');
    console.log(`NATIVE_PROBE_IN_HELPER=${inHelper.includes('nativeprobe')}`);
    const testDoc = await openDoc(rootA(), 'src/sample.test.ts');
    const inTest = await completionLabels(testDoc, 'nativeprobe ');
    console.log(`NATIVE_PROBE_IN_TEST=${inTest.includes('nativeprobe')}`);
    assert.equal(
      inHelper.includes('nativeprobe'),
      false,
      'native include should keep nativeprobe out of helper.ts',
    );
    assert.equal(
      inTest.includes('nativeprobe'),
      true,
      'native include should let nativeprobe into *.test.ts',
    );
  });
});
