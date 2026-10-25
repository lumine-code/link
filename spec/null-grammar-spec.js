const path = require("node:path");

describe("link with no grammar", () => {
  let editor, main;
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    editor = await lumine.workspace.open();
    editor.setText("https://example.test/");
  });
  afterEach(() => editor?.destroy());

  it("skips syntax requests and retires an existing link action until resume", async () => {
    const grammar = lumine.grammars.grammarForScopeName("text.plain");
    editor.setGrammar(grammar);
    const request = main.captureRequest(editor);
    expect(request.isCurrent()).toBe(true);
    editor.setGrammar(lumine.grammars.nullGrammar);
    expect(request.isCurrent()).toBe(false);
    spyOn(main, "targetAtPosition").and.resolveTo();
    await main.openLink({ target: editor.getElement() });
    await main.provideHyperclick().getSuggestionForWord(editor, "https", { start: [0, 0] });
    expect(main.targetAtPosition).not.toHaveBeenCalled();
    editor.setGrammar(grammar);
    await main.openLink({ target: editor.getElement() });
    expect(main.targetAtPosition).toHaveBeenCalled();
  });
});
