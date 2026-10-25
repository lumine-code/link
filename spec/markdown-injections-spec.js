const path = require("node:path");
const { Range } = require("lumine");

describe("links owned by Markdown language layers", () => {
  let main, editor;

  beforeEach(async () => {
    for (const name of [
      "language-hyperlink",
      "language-gfm",
      "language-python",
      "language-ipython",
      "language-html",
      "language-javascript",
      "link",
    ]) {
      await lumine.packages.activatePackage(name);
    }
    main = lumine.packages.getActivePackage("link").mainModule;
    spyOn(lumine.shell, "openExternal").and.resolveTo();
  });

  afterEach(() => editor?.destroy());

  async function open(text, scope = "source.python.ipy", filePath = "links.ipy") {
    editor?.destroy();
    editor = await lumine.workspace.open(filePath);
    editor.setText(text);
    lumine.grammars.assignLanguageMode(editor.getBuffer(), scope);
    await editor.whenGrammarSettled();
    return editor;
  }

  function position(text, occurrence = 0) {
    const source = editor.getText();
    let index = -1;
    for (let count = 0; count <= occurrence; count++) index = source.indexOf(text, index + 1);
    expect(index).toBeGreaterThanOrEqual(0);
    return editor.getBuffer().positionForCharacterIndex(index);
  }

  function rangeFor(text, occurrence = 0) {
    const start = position(text, occurrence);
    return new Range(start, start.translate([0, text.length]));
  }

  async function expectWebLink(text, url, occurrence = 0) {
    const range = rangeFor(text, occurrence);
    expect(
      await editor.bufferRangeForScopeAtPosition(".markup.underline.link", range.start),
    ).toEqual(range);
    expect(await main.targetAtPosition(editor, range.start)).toEqual({ range, url });
    const suggestion = await main.provideHyperclick().getSuggestionForWord(editor, text, range);
    expect(suggestion?.range).toEqual(range);
    await suggestion?.callback();
    expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith(url);
    lumine.shell.openExternal.calls.reset();
    editor.setCursorBufferPosition(range.start);
    await lumine.commands.dispatch(editor.getElement(), "link:open");
    expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith(url);
    lumine.shell.openExternal.calls.reset();
    return range;
  }

  for (const [kind, prefix] of [
    ["a Markdown cell", "# %% [markdown]\n"],
    ["a Markdown cell magic", "%%markdown\n"],
  ]) {
    it(`decodes only the inline destination in ${kind}, excluding its title`, async () => {
      const destination = String.raw`https://example.com/a\(b\)?a=1&amp;b=2`;
      await open(`${prefix}[docs](${destination} "Documentation")\n`);
      await expectWebLink(destination, "https://example.com/a(b)?a=1&b=2");
      expect(await main.targetAtPosition(editor, position("Documentation"))).toBeUndefined();
    });
  }

  it("resolves full references only from the clicked Markdown cell", async () => {
    await open(
      [
        "# %% [markdown] First",
        "[first][Docs]",
        "",
        '[docs]: https://first.example/?a=1&amp;b=2 "First title"',
        "# %% [markdown] Second",
        "[second][Docs]",
        "",
        '[docs]: https://second.example/?a=1&amp;b=2 "Second title"',
        "# %% [markdown] Missing",
        "[third][Docs]",
      ].join("\n"),
    );
    await expectWebLink("Docs", "https://first.example/?a=1&b=2", 0);
    await expectWebLink("Docs", "https://second.example/?a=1&b=2", 1);
    expect(await main.targetAtPosition(editor, position("Docs", 2))).toBeUndefined();
  });

  it("keeps a nested Markdown fence's references separate from its host document", async () => {
    await open(
      [
        "[outer][docs]",
        "",
        "[docs]: https://outer.example",
        "",
        "```markdown",
        "[inner][docs]",
        "",
        "[docs]: https://inner.example",
        "```",
      ].join("\n"),
      "source.gfm",
      "links.md",
    );
    await expectWebLink("docs", "https://outer.example/", 0);
    await expectWebLink("docs", "https://inner.example/", 2);
  });

  it("does not borrow an outer definition for an unresolved nested Markdown reference", async () => {
    await open(
      "[docs]: https://outer.example\n\n```markdown\n[inner][docs]\n```\n",
      "source.gfm",
      "links.md",
    );
    expect(await main.targetAtPosition(editor, position("docs", 1))).toBeUndefined();
  });

  it("resolves a reference defined in a blockquote with normalized label whitespace", async () => {
    await open(
      "# %% [markdown]\n[guide][some docs]\n\n> [some   docs]: https://example.com/guide\n",
    );
    await expectWebLink("some docs", "https://example.com/guide");
  });

  it("opens a relative Markdown destination from its enclosing IPython file", async () => {
    const sourcePath = path.join(__dirname, "fixtures", "source.ipy");
    const filePath = path.join(__dirname, "fixtures", "text-buffer-tree-sitter.md");
    const destination = "text-buffer-tree-sitter.md";
    await open(`# %% [markdown]\n[guide](${destination} "Guide")`, "source.python.ipy", sourcePath);
    const range = rangeFor(destination);
    expect(await main.targetAtPosition(editor, range.start)).toEqual({ range, filePath });
    await main.openLink({ target: editor.getElement(), detail: { bufferPosition: range.start } });
    expect(lumine.workspace.getActiveTextEditor().getPath()).toBe(filePath);
    expect(lumine.shell.openExternal).not.toHaveBeenCalled();
  });

  it("preserves an angle autolink's literal entities inside injected Markdown", async () => {
    const url = "https://example.com/?a=1&amp;b=2";
    await open(`# %% [markdown]\n<${url}>\n`);
    const range = await expectWebLink(url, url);
    expect(await main.targetAtPosition(editor, range.start.translate([0, -1]))).toBeUndefined();
    expect(await main.targetAtPosition(editor, range.end)).toBeUndefined();
  });

  it("scopes an angle destination's complete text while excluding its delimiters and title", async () => {
    const destination = "https://example.com/my docs?a=1&amp;b=2";
    await open(`# %% [markdown]\n[docs](<${destination}> "Documentation")\n`);
    const range = await expectWebLink(destination, "https://example.com/my%20docs?a=1&b=2");
    expect(await main.targetAtPosition(editor, range.start.translate([0, -1]))).toBeUndefined();
    expect(await main.targetAtPosition(editor, range.end)).toBeUndefined();
    expect(await main.targetAtPosition(editor, position("Documentation"))).toBeUndefined();
  });

  it("opens a native email autolink from injected Markdown", async () => {
    await open("# %% [markdown]\n<hello@example.com>\n");
    const range = await expectWebLink("hello@example.com", "mailto:hello@example.com");
    expect(await main.targetAtPosition(editor, range.start.translate([0, -1]))).toBeUndefined();
    expect(await main.targetAtPosition(editor, range.end)).toBeUndefined();
  });

  it("preserves a URL's literal text inside a Python fence hosted by Markdown", async () => {
    const url = "https://example.com/?a=1&amp;b=2&copy;=3";
    await open(`\`\`\`python\nvalue = r"${url}"\n\`\`\`\n`, "source.gfm", "links.md");
    await expectWebLink(url, url);
  });

  it("preserves a script string's literal text inside Markdown-hosted HTML", async () => {
    const url = "https://example.com/?a=1&amp;b=2&copy;=3";
    await open(`<script>\nconst value = "${url}";\n</script>\n`, "source.gfm", "links.md");
    await expectWebLink(url, url);
  });

  it("decodes Markdown inside a JavaScript template without decoding neighboring JavaScript URLs", async () => {
    const destination = "https://example.com/?a=1&amp;b=2";
    await open(
      `const literal = "${destination}";\nconst page = markdown\`[docs](${destination} "Title")\`;`,
      "source.js",
      "links.js",
    );
    await expectWebLink(destination, destination, 0);
    await expectWebLink(destination, "https://example.com/?a=1&b=2", 1);
  });

  it("does not treat bracketed prose as a resolved reference", async () => {
    await open("# %% [markdown]\n[ordinary] and [missing][]\n");
    for (const text of ["ordinary", "missing"]) {
      expect(await main.targetAtPosition(editor, position(text))).toBeUndefined();
    }
  });
});
