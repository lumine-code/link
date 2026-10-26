const { TextBuffer } = require("lumine");

function giant(text = "x") {
  let source = TextBuffer.createTextSnapshot(text.repeat(65536));
  for (let i = 0; i < 14; i++) source = source.replace(source.length, source.length, source);
  return source;
}

describe("Bounded source link resolution", () => {
  let buffer, reference, target, ReferenceScanner, run, main;
  beforeEach(async () => {
    jasmine.useRealClock();
    main = (await lumine.packages.activatePackage("link")).mainModule;
    ({ reference, target } = require("../lib/syntax-analysis"));
    ({ ReferenceScanner, run } = require("../lib/source-reference"));
    buffer = new TextBuffer();
  });
  afterEach(() => buffer.destroy());
  const context = (buffer, root = null) => ({
    getBuffer: () => buffer,
    getGrammar: () => ({ scopeName: "source.gfm" }),
    getSyntaxNodeAtBufferPosition: () => root,
  });

  it("finds a reference after a giant unrelated line and ignores a giant unused title", async () => {
    const body = giant();
    let source = body.replace(body.length, body.length, '\n[docs]: https://example.com "');
    source = source
      .replace(source.length, source.length, body)
      .replace(source.length + body.length, source.length + body.length, '"');
    buffer.setTextInRange(buffer.getRange(), source);
    spyOn(buffer, "getText").and.throwError("Whole document string");
    spyOn(buffer, "getTextInRange").and.throwError("Whole reference line string");
    expect(await reference(context(buffer), { name: "docs" })).toBe("https://example.com");
  });

  it("preserves angle, escape, balanced-parenthesis and title-prefix rules", async () => {
    const fixtures = [
      ['<https://example.com/my docs> "title"', "<https://example.com/my docs>"],
      [String.raw`<https://example.com/a\>b> trailing`, String.raw`<https://example.com/a\>b>`],
      [String.raw`https://example.com/a\(b\) "title"`, String.raw`https://example.com/a\(b\)`],
      ["https://example.com/a(b(c)d) ('title')", "https://example.com/a(b(c)d)"],
      ["https://example.com/a(b", undefined],
      ["https://example.com/a)b", undefined],
      ["https://example.com/a trailing", undefined],
      ["<https://example.com/<bad>>", undefined],
    ];
    for (const [text, expected] of fixtures) {
      const scanner = new ReferenceScanner(TextBuffer.createTextSnapshot(`[name]: ${text}`));
      expect(await run(scanner.find("name"), () => {}))
        .withContext(text)
        .toBe(expected);
    }
    const scanner = new ReferenceScanner(
      TextBuffer.createTextSnapshot(" [Some\r\n docs]:\r\n\thttps://example.com\r\n"),
    );
    expect(await run(scanner.find("some docs"), () => {})).toBe("https://example.com");
  });

  it("declines complete oversized destinations and query labels without truncating them", async () => {
    buffer.setTextInRange(buffer.getRange(), giant().replace(0, 0, "[name]: https://example.com/"));
    expect(await reference(context(buffer), { name: "name" })).toBeUndefined();
    const source = buffer.getTextSnapshot();
    const ctx = { ...context(buffer), bufferRangeForScopeAtPosition: () => buffer.getRange() };
    expect(await target(ctx, { position: { row: 0, column: 12 } })).toBeNull();
    expect(buffer.getTextSnapshot().equals(source)).toBe(true);
    const editor = {
      getGrammar: () => ({ scopeName: "source.gfm" }),
      analyzeSyntax: jasmine.createSpy("syntax"),
    };
    expect(await main.urlForLink(editor, "x".repeat(65537))).toBeUndefined();
    expect(await main.linkForName(editor, "x".repeat(4097))).toBeUndefined();
    expect(editor.analyzeSyntax).not.toHaveBeenCalled();
  });

  it("uses indexed children and a disposable cursor rather than eager descendant arrays or node.text", async () => {
    buffer.setText("[other] [docs] https://example.com");
    const name = (startIndex, endIndex) => ({
      type: "link_label",
      startIndex,
      endIndex,
      get text() {
        throw new Error("Unbounded native text");
      },
    });
    const destination = {
      type: "link_destination",
      startIndex: 15,
      endIndex: buffer.getLength(),
      get text() {
        throw new Error("Unbounded destination");
      },
    };
    const definitions = Array.from({ length: 12000 }, (_, index) => ({
      type: "link_reference_definition",
      namedChildCount: 2,
      namedChild: (child) => (child ? destination : index === 11999 ? name(8, 14) : name(0, 7)),
      get namedChildren() {
        throw new Error("Eager children");
      },
    }));
    let disposed = false;
    const root = {
      type: "document",
      descendantsOfType() {
        throw new Error("Eager reference array");
      },
      walk() {
        let index = -1;
        return {
          get currentNode() {
            return index < 0 ? root : definitions[index];
          },
          gotoFirstChild() {
            if (index < 0) {
              index = 0;
              return true;
            }
            return false;
          },
          gotoNextSibling() {
            if (index >= 0 && index < definitions.length - 1) {
              index++;
              return true;
            }
            return false;
          },
          gotoParent() {
            if (index >= 0) {
              index = -1;
              return true;
            }
            return false;
          },
          delete() {
            disposed = true;
          },
        };
      },
    };
    expect(await reference(context(buffer, root), { name: "docs" })).toBe("https://example.com");
    expect(disposed).toBe(true);
  });

  it("reads bounded native URI spans and never evaluates node.text", async () => {
    buffer.setText("<https://example.com>");
    const node = {
      type: "uri_autolink",
      startIndex: 0,
      endIndex: buffer.getLength(),
      get text() {
        throw new Error("Native text getter");
      },
    };
    const ctx = {
      ...context(buffer, node),
      bufferRangeForScopeAtPosition: () => buffer.getRange(),
    };
    expect((await target(ctx, { position: { row: 0, column: 5 } })).destination).toBe(
      "<https://example.com>",
    );
    buffer.setTextInRange(buffer.getRange(), giant());
    node.endIndex = buffer.getLength();
    expect(await target(ctx, { position: { row: 0, column: 5 } })).toBeNull();
  });

  it("cancels whitespace-heavy fallback work when the source request is superseded", async () => {
    buffer.setTextInRange(buffer.getRange(), giant(" ").replace(0, 0, "[some "));
    const controller = new AbortController(),
      ctx = { ...context(buffer), signal: controller.signal };
    const pending = reference(ctx, { name: "some docs" });
    controller.abort();
    await expectAsync(pending).toBeRejectedWith(jasmine.objectContaining({ name: "AbortError" }));
  });

  it("keeps escaped destinations within cooperative scan steps", () => {
    const text = "https://example.com/" + String.raw`\/`.repeat(16000);
    const iterator = new ReferenceScanner(TextBuffer.createTextSnapshot(text)).destination(
      0,
      text.length,
    );
    let steps = 0,
      item;
    do {
      item = iterator.next();
      if (!item.done) steps++;
    } while (!item.done);
    expect(item.value).toBe(text);
    expect(steps).toBeGreaterThan(10);
  });
});
