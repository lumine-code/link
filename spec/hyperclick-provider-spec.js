const { Range } = require("lumine");

describe("link hyperclick provider", () => {
  let mainModule, hyperclick, provider;

  beforeEach(async () => {
    await lumine.packages.activatePackage("language-hyperlink");
    await lumine.packages.activatePackage("language-gfm");
    mainModule = (await lumine.packages.activatePackage("link")).mainModule;
    hyperclick = (await lumine.packages.activatePackage("hyperclick")).mainModule;
    provider = mainModule.provideHyperclick();
    spyOn(lumine.shell, "openExternal").and.resolveTo();
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("link");
    await lumine.packages.deactivatePackage("hyperclick");
  });

  async function openEditor(text, name = "hyperclick-links.md", options) {
    const editor = await lumine.workspace.open(name, options);
    const languageMode = editor.getBuffer().getLanguageMode();
    await languageMode.ready;
    editor.setText(text);
    await languageMode.atTransactionEnd();
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

  it("registers its provider through the hyperclick service", () => {
    const registration = hyperclick.registry.registrations.find(
      ({ provider }) => provider.providerName === "link",
    );
    expect(registration).toBeDefined();
    expect(registration.provider.priority).toBe(1);
    expect(registration.provider.getSuggestionForWord).toEqual(jasmine.any(Function));
  });

  it("offers the whole URL from its protocol, domain, and path words", async () => {
    const url = "https://example.com/path?q=1";
    // The hyperlink grammar currently truncates queries before trailing prose.
    // At end of line it recognizes the whole URL, including its query string.
    const editor = await openEditor(`before ${url}`);
    const expectedRange = new Range([0, 7], [0, 7 + url.length]);

    for (const text of ["https", "example", "path"]) {
      const suggestion = await query(editor, text);
      expect(suggestion).toBeDefined();
      expect(suggestion.range).toEqual(expectedRange);
      expect(lumine.shell.openExternal).not.toHaveBeenCalled();
      await suggestion.callback();
      expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith(url);
      lumine.shell.openExternal.calls.reset();
    }
  });

  it("opens the offered link when the cursor and active editor point elsewhere", async () => {
    const editor = await openEditor("https://first.example/path https://second.example/path");
    editor.setCursorBufferPosition([0, 35]);
    const suggestion = await query(editor, "first");
    const activeEditor = await openEditor("https://active.example", "active-links.md", {
      split: "right",
    });
    activeEditor.setCursorBufferPosition([0, 9]);
    expect(lumine.workspace.getActiveTextEditor()).toBe(activeEditor);

    await suggestion.callback();

    expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith("https://first.example/path");
    expect(editor.getCursorBufferPosition()).toEqual([0, 35]);
    expect(activeEditor.getCursorBufferPosition()).toEqual([0, 9]);
  });

  it("declines ordinary text, unresolved Markdown references, and unsupported schemes", async () => {
    const editor = await openEditor(
      "ordinary text\n[click][missing]\n[download](ftp://example.com/file)",
    );

    expect(await query(editor, "ordinary")).toBeUndefined();
    expect(await query(editor, "missing", 1)).toBeUndefined();
    expect(await query(editor, "ftp", 2)).toBeUndefined();
    expect(lumine.shell.openExternal).not.toHaveBeenCalled();
  });

  it("resolves a named Markdown reference and underlines its reference name", async () => {
    const editor = await openEditor("[click][here]\n\n[here]: http://example.com");
    const suggestion = await query(editor, "here");

    expect(suggestion).toBeDefined();
    expect(suggestion.range).toEqual(new Range([0, 8], [0, 12]));
    await suggestion.callback();
    expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith("http://example.com/");
  });

  it("preserves mailto links recognized by the Markdown grammar", async () => {
    const editor = await openEditor("<mailto:hello@example.com>");
    const suggestion = await query(editor, "hello");

    expect(suggestion).toBeDefined();
    expect(suggestion.range).toEqual(new Range([0, 1], [0, 25]));
    await suggestion.callback();
    expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith("mailto:hello@example.com");
  });

  it("reports a browser failure through the existing link warning", async () => {
    const editor = await openEditor("https://example.com");
    const suggestion = await query(editor, "example");
    lumine.shell.openExternal.and.rejectWith(new Error("browser unavailable"));
    spyOn(lumine.notifications, "addWarning");

    await suggestion.callback();

    expect(lumine.notifications.addWarning).toHaveBeenCalledOnceWith("Unable to open the link.", {
      detail: "browser unavailable",
      dismissable: true,
    });
  });

  it("follows its registered link through the keyboard hyperclick command", async () => {
    const editor = await openEditor("https://example.com");
    editor.setCursorBufferPosition([0, 9]);

    lumine.commands.dispatch(editor.getElement(), "hyperclick:confirm-cursor");
    await conditionPromise(() => lumine.shell.openExternal.calls.count() === 1);

    expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith("https://example.com/");
    expect(editor.getCursorBufferPosition()).toEqual([0, 9]);
  });

  it("removes its displayed link and cached callback when the package deactivates", async () => {
    const editor = await openEditor("https://example.com");
    const controller = hyperclick.editors.get(editor);
    const suggestion = await controller.lookup(new Range([0, 8], [0, 15]));
    expect(suggestion.provider.providerName).toBe("link");
    expect(controller.markers.length).toBe(1);

    await lumine.packages.deactivatePackage("link");

    expect(
      hyperclick.registry.registrations.some(({ provider }) => provider.providerName === "link"),
    ).toBe(false);
    expect(controller.suggestion).toBeNull();
    expect(controller.markers).toEqual([]);
    expect(await controller.confirm(suggestion)).toBe(false);
    expect(lumine.shell.openExternal).not.toHaveBeenCalled();
  });
});
