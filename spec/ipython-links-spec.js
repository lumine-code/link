const { Range } = require("lumine");

const URL =
  "https://dot.ca.gov/-/media/dot-media/programs/engineering/documents/structureconstruction/201906-sc-trenchingshoring-a11y.pdf";
const LINK_SCOPE = "markup.underline.link.hyperlink";

describe("links in IPython strings", () => {
  let main, editor, popup;

  beforeEach(async () => {
    for (const name of ["language-hyperlink", "language-python", "language-ipython", "link"])
      await lumine.packages.activatePackage(name);
    main = lumine.packages.getActivePackage("link").mainModule;
    spyOn(lumine.shell, "openExternal").and.resolveTo();
  });

  afterEach(() => {
    popup?.close({ cancelled: true });
    popup = null;
    editor?.destroy();
  });

  async function openString(
    contents = String.raw`opis \href{${URL}}{Caltrans, Trenching and Shoring Manual, rozdział 8}.`,
  ) {
    editor = await lumine.workspace.open("links.ipy");
    editor.setText(`doc.x(r'''\n${contents}\n''')`);
    lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python.ipy");
    await editor.whenGrammarSettled();
    return editor;
  }

  function position(text) {
    const column = editor.lineTextForBufferRow(1).indexOf(text);
    expect(column).toBeGreaterThanOrEqual(0);
    return [1, column];
  }

  function urlRange(url = URL) {
    const start = position(url);
    return new Range(start, [start[0], start[1] + url.length]);
  }

  it("scopes and opens only the href destination, excluding braces and the label", async () => {
    await openString();
    const range = urlRange();
    const target = await main.targetAtPosition(editor, position("dot.ca.gov"));
    expect(target).toEqual({ range, url: URL });
    expect(editor.scopeDescriptorForBufferPosition(range.start).getScopesArray()).toContain(
      LINK_SCOPE,
    );
    expect(editor.scopeDescriptorForBufferPosition(range.end).getScopesArray()).not.toContain(
      LINK_SCOPE,
    );
    expect(await main.targetAtPosition(editor, range.end)).toBeUndefined();
    expect(
      editor.scopeDescriptorForBufferPosition(position("Caltrans")).getScopesArray(),
    ).not.toContain(LINK_SCOPE);
    expect(await main.targetAtPosition(editor, position("Caltrans"))).toBeUndefined();

    editor.setCursorBufferPosition(position("pdf"));
    await lumine.commands.dispatch(editor.getElement(), "link:open");
    expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith(URL);

    lumine.shell.openExternal.calls.reset();
    editor.setCursorBufferPosition(position("Caltrans"));
    await lumine.commands.dispatch(editor.getElement(), "link:open");
    expect(lumine.shell.openExternal).not.toHaveBeenCalled();
  });

  it("offers the same destination and exact range through hyperclick", async () => {
    await openString();
    const provider = main.provideHyperclick();
    for (const word of ["https", "dot", "structureconstruction", "pdf"]) {
      const start = position(word);
      const suggestion = await provider.getSuggestionForWord(
        editor,
        word,
        new Range(start, [start[0], start[1] + word.length]),
      );
      expect(suggestion).toBeDefined();
      expect(suggestion.range).toEqual(urlRange());
      await suggestion.callback();
      expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith(URL);
      lumine.shell.openExternal.calls.reset();
    }
  });

  it("opens the right-clicked wrapped URL while preserving a cursor elsewhere", async () => {
    const workspace = lumine.workspace.getElement();
    workspace.style.width = "560px";
    workspace.style.height = "300px";
    jasmine.attachToDOM(workspace);
    await openString();
    editor.setSoftWrapped(true);
    editor.setCursorBufferPosition([0, 0]);
    const element = editor.getElement();
    const component = element.getComponent();
    component.updateSync();
    await editor.languageMode.refresh?.();
    component.updateSync();
    const clickedPosition = position("pdf");
    const screenPosition = editor.screenPositionForBufferPosition(clickedPosition);
    expect(screenPosition.row).toBeGreaterThan(
      editor.screenPositionForBufferPosition(urlRange().start).row,
    );
    const pixelPosition = element.pixelPositionForBufferPosition(clickedPosition);
    const linesRect = component.refs.lineTiles.getBoundingClientRect();
    const target = element.querySelector(
      `[data-screen-row="${screenPosition.row}"] .syntax--markup.syntax--underline.syntax--link`,
    );
    expect(target).not.toBeNull();
    popup = lumine.contextMenu.showForEvent({
      target,
      clientX: linesRect.left + pixelPosition.left + component.getBaseCharacterWidth() * 0.2,
      clientY: linesRect.top + pixelPosition.top + component.getLineHeight() / 2,
    });
    const item = popup.rootList.items.find((item) => item.template.command === "link:open");
    expect(item).toBeDefined();
    spyOn(main, "openLink").and.callThrough();
    item.element.click();
    await conditionPromise(() => main.openLink.calls.count() > 0, "context-menu command dispatch");
    await main.openLink.calls.mostRecent().returnValue;
    expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith(URL);
    expect(editor.getCursorBufferPosition()).toEqual([0, 0]);
  });

  it("updates the destination after inserting and removing a TeX label", async () => {
    await openString(URL);
    const end = urlRange().end;
    editor.getBuffer().insert(end, "}{Caltrans");
    await editor.languageMode.atTransactionEnd();
    expect(await main.targetAtPosition(editor, position("dot.ca.gov"))).toEqual({
      range: urlRange(),
      url: URL,
    });
    editor.getBuffer().delete(new Range(end, end.translate([0, "}{Caltrans".length])));
    await editor.languageMode.atTransactionEnd();
    expect(await main.targetAtPosition(editor, position("dot.ca.gov"))).toEqual({
      range: urlRange(),
      url: URL,
    });
  });

  it("preserves percent-encoded braces in the URL", async () => {
    const url = "https://example.com/%7Bdocument%7D.pdf?filter=%7Bvalue%7D";
    await openString(String.raw`\href{${url}}{Document}`);
    expect(await main.targetAtPosition(editor, position("example"))).toEqual({
      range: urlRange(url),
      url,
    });
  });

  it("preserves literal character references in a Python URL", async () => {
    const url = "https://example.com/?a=1&amp;b=2&copy;=3";
    await openString(url);
    editor.setCursorBufferPosition(position("example"));
    await lumine.commands.dispatch(editor.getElement(), "link:open");
    expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith(url);
  });

  it("preserves a literal backslash escape in a Python URL query", async () => {
    const url = String.raw`https://example.com/?find=\*value`;
    await openString(url);
    editor.setCursorBufferPosition(position("example"));
    await lumine.commands.dispatch(editor.getElement(), "link:open");
    expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith(url);
  });
});
