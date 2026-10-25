const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Range } = require("lumine");
const filePathForLink = require("../lib/file-link");

describe("Markdown file links", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  const sourcePath = path.join(__dirname, "fixtures", "source.md");
  const targetPath = path.join(__dirname, "fixtures", "text-buffer-tree-sitter.md");
  const encodedPath = path.join(__dirname, "fixtures", "more", "guide (draft)#1.md");
  let main, provider;

  beforeEach(async () => {
    await lumine.packages.activatePackage("language-gfm");
    main = (await lumine.packages.activatePackage("link")).mainModule;
    provider = main.provideHyperclick();
    spyOn(lumine.shell, "openExternal").and.resolveTo();
  });

  async function openEditor(text, filePath = sourcePath) {
    const editor = await lumine.workspace.open(filePath);
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.gfm"));
    const mode = editor.getBuffer().getLanguageMode();
    await mode.ready;
    editor.setText(text);
    await mode.atTransactionEnd();
    return editor;
  }

  function query(editor, text, row = 0) {
    const column = editor.lineTextForBufferRow(row).indexOf(text);
    expect(column).toBeGreaterThanOrEqual(0);
    return provider.getSuggestionForWord(
      editor,
      text,
      new Range([row, column], [row, column + text.length]),
    );
  }

  for (const [name, markup, word, expectedPath] of [
    ["relative", "[integration](text-buffer-tree-sitter.md)", "tree", targetPath],
    ["parent-relative", "[integration](../text-buffer-tree-sitter.md)", "tree", targetPath],
    [
      "encoded filename and fragment",
      "[draft](more/guide%20(draft)%231.md?raw=1#heading)",
      "guide",
      encodedPath,
    ],
    ["angle destination with spaces", "[draft](<more/guide (draft)%231.md>)", "guide", encodedPath],
    [
      "escaped parentheses",
      String.raw`[draft](more/guide%20\(draft\)%231.md)`,
      "guide",
      encodedPath,
    ],
    [
      "named reference",
      '[integration][tree]\n\n[tree]: text-buffer-tree-sitter.md "Integration"',
      "tree",
      targetPath,
    ],
    [
      "absolute",
      // Quote native separators so Markdown does not read \_ as an escape.
      `[integration](<${targetPath.replace(/\\/g, "\\\\")}>)`,
      "tree",
      targetPath,
    ],
    ["file URL", `[draft](${pathToFileURL(encodedPath).href})`, "guide", encodedPath],
    ["file autolink", `<${pathToFileURL(encodedPath).href}>`, "guide", encodedPath],
  ]) {
    it(`opens a ${name} destination in the editor`, async () => {
      const editor = await openEditor(
        markup,
        name === "parent-relative" ? encodedPath : sourcePath,
      );
      const suggestion = await query(editor, word);
      expect(suggestion).toBeDefined();

      await suggestion.callback();

      expect(lumine.workspace.getActiveTextEditor().getPath()).toBe(expectedPath);
      expect(lumine.shell.openExternal).not.toHaveBeenCalled();
    });
  }

  it("uses the source document when another editor and cursor are active", async () => {
    const editor = await openEditor("before\n[integration](text-buffer-tree-sitter.md)");
    editor.setCursorBufferPosition([0, 0]);
    const suggestion = await query(editor, "tree", 1);
    await openEditor("other", encodedPath);

    await suggestion.callback();

    expect(lumine.workspace.getActiveTextEditor().getPath()).toBe(targetPath);
    expect(editor.getCursorBufferPosition()).toEqual([0, 0]);
  });

  it("follows a local link through its editor command", async () => {
    const editor = await openEditor("[integration](text-buffer-tree-sitter.md)");
    editor.setCursorBufferPosition([0, 30]);

    lumine.commands.dispatch(editor.getElement(), "link:open");
    await conditionPromise(() => lumine.workspace.getActiveTextEditor()?.getPath() === targetPath);

    expect(lumine.shell.openExternal).not.toHaveBeenCalled();
  });

  it("declines prose filenames, unresolved references, and unsafe schemes", async () => {
    const editor = await openEditor(
      '"text-buffer-tree-sitter.md"\n[click][missing]\n[click](javascript:alert(1))',
    );

    expect(await query(editor, "tree")).toBeUndefined();
    expect(await query(editor, "missing", 1)).toBeUndefined();
    expect(await query(editor, "javascript", 2)).toBeUndefined();
  });

  it("does not resolve relative paths from an unsaved document", async () => {
    const editor = await openEditor("[integration](text-buffer-tree-sitter.md)", null);

    expect(await query(editor, "tree")).toBeUndefined();
  });

  for (const destination of ["missing.md", "more"]) {
    it(`warns instead of opening a non-file target: ${destination}`, async () => {
      const editor = await openEditor(`[target](${destination})`);
      const suggestion = await query(editor, destination);
      expect(suggestion).toBeDefined();
      spyOn(lumine.workspace, "open").and.callThrough();
      spyOn(lumine.notifications, "addWarning");

      await suggestion.callback();

      expect(lumine.workspace.open).not.toHaveBeenCalled();
      expect(lumine.notifications.addWarning.calls.count()).toBe(1);
      const [message, options] = lumine.notifications.addWarning.calls.mostRecent().args;
      expect(message).toBe("Unable to open the link.");
      expect(options.dismissable).toBeTrue();
      expect(options.detail).toContain(destination === "more" ? "not a file" : "ENOENT");
    });
  }

  it("reports an editor opener failure", async () => {
    const editor = await openEditor("[integration](text-buffer-tree-sitter.md)");
    const suggestion = await query(editor, "tree");
    spyOn(lumine.workspace, "open").and.rejectWith(new Error("opener unavailable"));
    spyOn(lumine.notifications, "addWarning");

    await suggestion.callback();

    expect(lumine.notifications.addWarning).toHaveBeenCalledOnceWith("Unable to open the link.", {
      detail: "opener unavailable",
      dismissable: true,
    });
  });

  it("rejects invalid encodings, remote schemes, and unbased paths", () => {
    for (const destination of [
      "bad%ZZ.md",
      "bad%00.md",
      "https://example.com/guide.md",
      "//example.com/guide.md",
      "javascript:alert(1)",
      "data:text/plain,content",
      "#heading",
    ]) {
      expect(filePathForLink(destination, sourcePath)).toBeUndefined();
    }
    expect(filePathForLink("guide.md")).toBeUndefined();
    expect(filePathForLink(pathToFileURL(targetPath).href)).toBe(targetPath);
    expect(filePathForLink(targetPath)).toBe(targetPath);
  });
});
