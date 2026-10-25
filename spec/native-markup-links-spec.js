const { Point, Range } = require("lumine");

describe("native markup link boundaries", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let main, editor, popup;

  beforeEach(async () => {
    for (const name of [
      "language-hyperlink",
      "language-gfm",
      "language-latex",
      "language-html",
      "language-xml",
      "link",
    ])
      await lumine.packages.activatePackage(name);
    main = lumine.packages.getActivePackage("link").mainModule;
    spyOn(lumine.shell, "openExternal").and.resolveTo();
  });

  afterEach(() => {
    popup?.close({ cancelled: true });
    popup = null;
    editor?.destroy();
  });

  async function openText(text, scope) {
    editor = await lumine.workspace.open();
    editor.setGrammar(lumine.grammars.grammarForScopeName(scope));
    editor.setText(text);
    await editor.whenGrammarSettled();
  }

  function rangeFor(text) {
    const start = editor.getText().indexOf(text);
    expect(start).toBeGreaterThanOrEqual(0);
    const buffer = editor.getBuffer();
    return new Range(
      buffer.positionForCharacterIndex(start),
      buffer.positionForCharacterIndex(start + text.length),
    );
  }

  const plain = "https://example.com/manual.pdf?first=1&second=2#page=3";
  const cases = [
    ["Markdown angle destination", "source.gfm", `[guide](<${plain}> "Title")`, plain, plain],
    ["Markdown autolink", "source.gfm", `<${plain}>`, plain, plain],
    ["LaTeX url", "text.tex.latex", String.raw`\url{${plain}}`, plain, plain],
    ["LaTeX href", "text.tex.latex", String.raw`\href{${plain}}{Label}`, plain, plain],
    [
      "LaTeX href options",
      "text.tex.latex",
      String.raw`\href[page=2]{${plain}}{Label}`,
      plain,
      plain,
    ],
    ["LaTeX urldef", "text.tex.latex", String.raw`\urldef{\manual}\url{${plain}}`, plain, plain],
    [
      "LaTeX bracket query",
      "text.tex.latex",
      String.raw`\url{https://example.com/?filter[name]=x}`,
      "https://example.com/?filter[name]=x",
      "https://example.com/?filter[name]=x",
    ],
    [
      "LaTeX escaped href",
      "text.tex.latex",
      String.raw`\href{https://example.com/my\_file.pdf?a=1\&b=2\#page=3}{Label}`,
      String.raw`https://example.com/my\_file.pdf?a=1\&b=2\#page=3`,
      "https://example.com/my_file.pdf?a=1&b=2#page=3",
    ],
    [
      "LaTeX literal entities",
      "text.tex.latex",
      String.raw`\url{https://example.com/?a=1&amp;b=2}`,
      "https://example.com/?a=1&amp;b=2",
      "https://example.com/?a=1&amp;b=2",
    ],
    [
      "LaTeX mailto",
      "text.tex.latex",
      String.raw`\href{mailto:hello@example.com}{Email}`,
      "mailto:hello@example.com",
      "mailto:hello@example.com",
    ],
    [
      "HTML attribute entities",
      "text.html.basic",
      '<a href="https://example.com/?a=1&amp;b=2&#35;page=3">Label</a>',
      "https://example.com/?a=1&amp;b=2&#35;page=3",
      "https://example.com/?a=1&b=2#page=3",
    ],
    [
      "HTML comment entities",
      "text.html.basic",
      "<!-- https://example.com/?a=1&amp;b=2 -->",
      "https://example.com/?a=1&amp;b=2",
      "https://example.com/?a=1&amp;b=2",
    ],
    [
      "HTML terminal entity",
      "text.html.basic",
      '<a href="https://example.com/?last=&amp;">Label</a>',
      "https://example.com/?last=&amp;",
      "https://example.com/?last=&",
    ],
    [
      "HTML attribute spaces",
      "text.html.basic",
      '<a href="https://example.com/my manual.pdf">Label</a>',
      "https://example.com/my manual.pdf",
      "https://example.com/my%20manual.pdf",
    ],
    [
      "HTML mailto",
      "text.html.basic",
      '<a href="mailto:hello@example.com">Email</a>',
      "mailto:hello@example.com",
      "mailto:hello@example.com",
    ],
    [
      "HTML descriptive attribute",
      "text.html.basic",
      '<div title="https://example.com/?a=1&amp;b=2 is the manual."></div>',
      "https://example.com/?a=1&amp;b=2",
      "https://example.com/?a=1&b=2",
    ],
    [
      "XML terminal entity",
      "text.xml",
      '<manual href="https://example.com/?last=&amp;"/>',
      "https://example.com/?last=&amp;",
      "https://example.com/?last=&",
    ],
    [
      "XML text entities",
      "text.xml",
      "<manual>https://example.com/?a=1&amp;b=2&#x23;page=3</manual>",
      "https://example.com/?a=1&amp;b=2&#x23;page=3",
      "https://example.com/?a=1&b=2#page=3",
    ],
    [
      "XML comment entities",
      "text.xml",
      "<!-- https://example.com/?a=1&amp;b=2 --><manual/>",
      "https://example.com/?a=1&amp;b=2",
      "https://example.com/?a=1&amp;b=2",
    ],
    [
      "XML descriptive attribute",
      "text.xml",
      '<manual title="https://example.com/?a=1&amp;b=2 is the manual."/>',
      "https://example.com/?a=1&amp;b=2",
      "https://example.com/?a=1&b=2",
    ],
  ];

  for (const [name, scope, text, source, url] of cases) {
    it(`highlights and opens exactly the ${name}`, async () => {
      await openText(text, scope);
      const range = rangeFor(source);
      const point = range.start.translate([0, 8]);
      expect(await editor.bufferRangeForScopeAtPosition(".markup.underline.link", point)).toEqual(
        range,
      );
      expect(await main.targetAtPosition(editor, point)).toEqual({ range, url });
      if (range.start.column > 0)
        expect(await main.targetAtPosition(editor, range.start.translate([0, -1]))).toBeUndefined();
      expect(await main.targetAtPosition(editor, range.end)).toBeUndefined();
      editor.setCursorBufferPosition(point);
      await lumine.commands.dispatch(editor.getElement(), "link:open");
      expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith(url);
    });
  }

  it("does not offer embedded addresses inside unsupported HTML link destinations", async () => {
    for (const source of [
      "<a href=\"javascript:open('https://example.com/manual.pdf')\">Label</a>",
      '<a href="/redirect?next=https://example.com/manual.pdf">Label</a>',
    ]) {
      await openText(source, "text.html.basic");
      const position = rangeFor("https://example.com/manual.pdf").start;
      expect(await main.targetAtPosition(editor, position)).toBeUndefined();
      editor.setCursorBufferPosition(position);
      await lumine.commands.dispatch(editor.getElement(), "link:open");
      expect(lumine.shell.openExternal).not.toHaveBeenCalled();
      editor.destroy();
    }
  });

  for (const [name, scope, text, source, url] of cases.filter(([name]) =>
    ["Markdown angle destination", "LaTeX url", "LaTeX href", "HTML attribute entities"].includes(
      name,
    ),
  )) {
    it(`opens the ${name} through its actual context menu`, async () => {
      const workspace = lumine.workspace.getElement();
      workspace.style.width = "800px";
      workspace.style.height = "300px";
      jasmine.attachToDOM(workspace);
      await openText(text, scope);
      editor.setCursorBufferPosition([0, 0]);
      const clicked = rangeFor(source).start.translate([0, 10]);
      const element = editor.getElement();
      const component = element.getComponent();
      component.updateSync();
      await editor.languageMode.refresh?.();
      component.updateSync();
      const screen = editor.screenPositionForBufferPosition(clicked);
      const pixel = element.pixelPositionForBufferPosition(clicked);
      const bounds = component.refs.lineTiles.getBoundingClientRect();
      const target = element.querySelector(
        `[data-screen-row="${screen.row}"] .syntax--markup.syntax--underline.syntax--link`,
      );
      expect(target).not.toBeNull();
      popup = lumine.contextMenu.showForEvent({
        target,
        clientX: bounds.left + pixel.left + component.getBaseCharacterWidth() * 0.2,
        clientY: bounds.top + pixel.top + component.getLineHeight() / 2,
      });
      const item = popup.rootList.items.find((item) => item.template.command === "link:open");
      expect(item).toBeDefined();
      spyOn(main, "openLink").and.callThrough();
      item.element.click();
      await conditionPromise(
        () => main.openLink.calls.count() > 0,
        "context-menu command dispatch",
      );
      await main.openLink.calls.mostRecent().returnValue;
      expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith(url);
      expect(editor.getCursorBufferPosition()).toEqual(new Point(0, 0));
    });
  }
});
