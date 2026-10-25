const { Range } = require("lumine");

const URL = "https://example.com/manual.pdf?q=1&part=2#section";
const ENTITY_URL = "https://example.com/manual.pdf?a=1&amp;b=2&copy;=3";
const LITERAL_URL = String.raw`https://example.com/manual.pdf?find=\*value`;
const href = (url = URL) => String.raw`\href{${url}}{Manual}`;
const urlCommand = (url = URL) => String.raw`\url{${url}}`;

// These fixtures exercise comment and string contexts, native markup, and
// multiple injection depths across the registered host grammars.
// They intentionally use the registered package grammars rather than a test
// grammar or a second URL recognizer.
const CASES = [
  {
    name: "a Python comment",
    scope: "source.python",
    package: "language-python",
    text: `# ${href()}`,
  },
  {
    name: "a Python raw string",
    scope: "source.python",
    package: "language-python",
    text: `doc.x(r'''${href()}''')`,
  },
  {
    name: "an IPython raw string",
    scope: "source.python.ipy",
    package: "language-ipython",
    dependencies: ["language-python"],
    text: `doc.x(r'''${href()}''')`,
  },
  {
    name: "an IPython comment",
    scope: "source.python.ipy",
    package: "language-ipython",
    dependencies: ["language-python"],
    text: `# ${urlCommand()}`,
  },
  {
    name: "a JavaScript line comment",
    scope: "source.js",
    package: "language-javascript",
    text: `// ${href()}`,
  },
  {
    name: "a JavaScript block comment",
    scope: "source.js",
    package: "language-javascript",
    text: `/* ${urlCommand()} */`,
  },
  {
    name: "a JSDoc description",
    scope: "source.js",
    package: "language-javascript",
    text: `/** Documentation: ${href()} */`,
  },
  {
    name: "a JavaScript string",
    scope: "source.js",
    package: "language-javascript",
    text: `const manual = "${href()}";`,
  },
  {
    name: "a JavaScript template",
    scope: "source.js",
    package: "language-javascript",
    text: `const manual = \`${href()}\`;`,
  },
  {
    name: "a JSON string",
    scope: "source.json",
    package: "language-json",
    text: JSON.stringify({ manual: href() }),
  },
  {
    name: "a JSONC comment",
    scope: "source.json.jsonc",
    package: "language-json",
    text: `// ${href()}\n{}`,
  },
  {
    name: "a JSON5 string",
    scope: "source.json5",
    package: "language-json",
    text: `{ manual: '${URL}' }`,
  },
  {
    name: "an HTML attribute",
    scope: "text.html.basic",
    package: "language-html",
    text: `<a href="${URL}">Manual</a>`,
  },
  {
    name: "an HTML attribute containing TeX prose",
    scope: "text.html.basic",
    package: "language-html",
    text: `<div data-note="${href()}"></div>`,
  },
  {
    name: "an HTML comment",
    scope: "text.html.basic",
    package: "language-html",
    text: `<!-- ${href()} -->`,
  },
  {
    name: "a script comment nested in HTML",
    scope: "text.html.basic",
    package: "language-html",
    dependencies: ["language-javascript"],
    text: `<script>// ${href()}\n</script>`,
  },
  {
    name: "a template nested in HTML",
    scope: "text.html.basic",
    package: "language-html",
    dependencies: ["language-javascript"],
    text: `<script>const manual = \`${href()}\`;</script>`,
  },
  { name: "a CSS comment", scope: "source.css", package: "language-css", text: `/* ${href()} */` },
  {
    name: "a CSS string",
    scope: "source.css",
    package: "language-css",
    text: `a { content: "${href()}"; }`,
  },
  {
    name: "a CSS URL value",
    scope: "source.css",
    package: "language-css",
    text: `a { background-image: url(${URL}); }`,
  },
  {
    name: "a CSS string nested in HTML",
    scope: "text.html.basic",
    package: "language-html",
    dependencies: ["language-css"],
    text: `<style>a { content: "${href()}"; }</style>`,
  },
  { name: "a YAML comment", scope: "source.yaml", package: "language-yaml", text: `# ${href()}` },
  {
    name: "a YAML plain scalar",
    scope: "source.yaml",
    package: "language-yaml",
    text: `manual: ${URL}`,
  },
  {
    name: "a YAML quoted scalar",
    scope: "source.yaml",
    package: "language-yaml",
    text: `manual: '${href()}'`,
  },
  {
    name: "a TOML comment",
    scope: "source.toml",
    package: "language-toml",
    text: `# ${urlCommand()}`,
  },
  {
    name: "a TOML literal string",
    scope: "source.toml",
    package: "language-toml",
    text: `manual = '${href()}'`,
  },
  {
    name: "a shell comment",
    scope: "source.shell",
    package: "language-shellscript",
    text: `# ${href()}`,
  },
  {
    name: "a shell quoted string",
    scope: "source.shell",
    package: "language-shellscript",
    text: `printf '%s' '${href()}'`,
  },
  { name: "Markdown prose", scope: "source.gfm", package: "language-gfm", text: `See ${href()}.` },
  { name: "a Markdown autolink", scope: "source.gfm", package: "language-gfm", text: `<${URL}>` },
  {
    name: "a Markdown link destination",
    scope: "source.gfm",
    package: "language-gfm",
    text: `[Manual](${URL})`,
  },
  {
    name: "an angle Markdown link destination",
    scope: "source.gfm",
    package: "language-gfm",
    text: `[Manual](<${URL}>)`,
  },
  {
    name: "a Python string nested in Markdown",
    scope: "source.gfm",
    package: "language-gfm",
    dependencies: ["language-python"],
    text: `\`\`\`python\ndoc.x(r'''${href()}''')\n\`\`\``,
  },
  {
    name: "a JavaScript string nested in Markdown",
    scope: "source.gfm",
    package: "language-gfm",
    dependencies: ["language-javascript"],
    text: `\`\`\`javascript\nconst manual = "${href()}";\n\`\`\``,
  },
  {
    name: "an HTML attribute nested in Markdown",
    scope: "source.gfm",
    package: "language-gfm",
    dependencies: ["language-html"],
    text: `<a href="${URL}">Manual</a>`,
  },
  {
    name: "an XML system identifier",
    scope: "text.xml",
    package: "language-xml",
    text: `<!DOCTYPE manual SYSTEM "${URL}"><manual/>`,
  },
  {
    name: "an XML attribute",
    scope: "text.xml",
    package: "language-xml",
    text: `<manual href="${URL.replaceAll("&", "&amp;")}"/>`,
    destination: URL.replaceAll("&", "&amp;"),
    url: URL,
  },
  {
    name: "an XML comment",
    scope: "text.xml",
    package: "language-xml",
    text: `<!-- ${href()} --><manual/>`,
  },
  { name: "a native LaTeX href", scope: "text.tex.latex", package: "language-latex", text: href() },
  {
    name: "a native LaTeX URL",
    scope: "text.tex.latex",
    package: "language-latex",
    text: urlCommand(),
  },
  {
    name: "a LaTeX comment",
    scope: "text.tex.latex",
    package: "language-latex",
    text: `% ${href()}`,
  },
  {
    name: "a native Typst URL",
    scope: "source.typst",
    package: "language-typst",
    text: `${URL} [Manual]`,
  },
  {
    name: "a Typst comment",
    scope: "source.typst",
    package: "language-typst",
    text: `// ${href()}`,
  },
  {
    name: "literal entities in a Python raw string",
    scope: "source.python",
    package: "language-python",
    text: `r'''${ENTITY_URL}'''`,
    destination: ENTITY_URL,
  },
  {
    name: "literal entities in a JavaScript string",
    scope: "source.js",
    package: "language-javascript",
    text: `const manual = "${ENTITY_URL}";`,
    destination: ENTITY_URL,
  },
  {
    name: "literal entities in a JSON string",
    scope: "source.json",
    package: "language-json",
    text: JSON.stringify({ manual: ENTITY_URL }),
    destination: ENTITY_URL,
  },
  {
    name: "literal entities in an HTML comment",
    scope: "text.html.basic",
    package: "language-html",
    text: `<!-- ${ENTITY_URL} -->`,
    destination: ENTITY_URL,
  },
  {
    name: "literal entities in a TOML literal string",
    scope: "source.toml",
    package: "language-toml",
    text: `manual = '${ENTITY_URL}'`,
    destination: ENTITY_URL,
  },
  {
    name: "literal escapes in a Python raw string",
    scope: "source.python",
    package: "language-python",
    text: `r'''${LITERAL_URL}'''`,
    destination: LITERAL_URL,
  },
  {
    name: "literal escapes in a JavaScript comment",
    scope: "source.js",
    package: "language-javascript",
    text: `// ${LITERAL_URL}`,
    destination: LITERAL_URL,
  },
  {
    name: "literal escapes in a TOML literal string",
    scope: "source.toml",
    package: "language-toml",
    text: `manual = '${LITERAL_URL}'`,
    destination: LITERAL_URL,
  },
  {
    name: "entities in an HTML href attribute",
    scope: "text.html.basic",
    package: "language-html",
    text: `<a href="https://example.com/manual.pdf?a=1&amp;b=2">Manual</a>`,
    destination: "https://example.com/manual.pdf?a=1&amp;b=2",
    url: "https://example.com/manual.pdf?a=1&b=2",
  },
  {
    name: "a literal escape and an entity in an HTML attribute",
    scope: "text.html.basic",
    package: "language-html",
    text: `<a href="${LITERAL_URL}&amp;next=2">Manual</a>`,
    destination: `${LITERAL_URL}&amp;next=2`,
    url: `${LITERAL_URL}&next=2`,
  },
  {
    name: "HTML attribute entities nested in Markdown",
    scope: "source.gfm",
    package: "language-gfm",
    dependencies: ["language-html"],
    text: '<a href="https://example.com/manual.pdf?a=1&amp;b=2">Manual</a>',
    destination: "https://example.com/manual.pdf?a=1&amp;b=2",
    url: "https://example.com/manual.pdf?a=1&b=2",
  },
  {
    name: "literal entities in JavaScript nested in HTML",
    scope: "text.html.basic",
    package: "language-html",
    dependencies: ["language-javascript"],
    text: `<script>const manual = "${ENTITY_URL}";</script>`,
    destination: ENTITY_URL,
  },
  {
    name: "literal entities in Python nested in Markdown",
    scope: "source.gfm",
    package: "language-gfm",
    dependencies: ["language-python"],
    text: `\`\`\`python\nr'''${ENTITY_URL}'''\n\`\`\``,
    destination: ENTITY_URL,
  },
  {
    name: "literal entities in an XML comment",
    scope: "text.xml",
    package: "language-xml",
    text: `<!-- ${ENTITY_URL} --><manual/>`,
    destination: ENTITY_URL,
  },
];

describe("links across registered host grammars", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let main, editor;

  beforeEach(async () => {
    await lumine.packages.activatePackage("language-hyperlink");
    const pack = await lumine.packages.activatePackage("link");
    main = pack.mainModule;
    spyOn(lumine.shell, "openExternal").and.resolveTo();
  });

  afterEach(() => editor?.destroy());

  for (const fixture of CASES) {
    it(`uses the exact highlighted destination in ${fixture.name}`, async () => {
      for (const name of [...(fixture.dependencies ?? []), fixture.package])
        await lumine.packages.activatePackage(name);
      const grammar = lumine.grammars.grammarForScopeName(fixture.scope);
      expect(grammar).withContext(fixture.scope).toBeDefined();
      editor = await lumine.workspace.open();
      editor.setText(fixture.text);
      lumine.grammars.assignLanguageMode(editor.getBuffer(), fixture.scope);
      await editor.whenGrammarSettled();
      await editor.languageMode.refresh?.();

      const destination = fixture.destination ?? URL;
      const index = fixture.text.indexOf(destination);
      expect(index).toBeGreaterThanOrEqual(0);
      const buffer = editor.getBuffer();
      const range = new Range(
        buffer.positionForCharacterIndex(index),
        buffer.positionForCharacterIndex(index + destination.length),
      );
      const position = buffer.positionForCharacterIndex(index + "https://".length);
      const target = await main.targetAtPosition(editor, position);
      const scopes = editor.scopeDescriptorForBufferPosition(position).getScopesArray();
      expect(target).withContext(JSON.stringify(scopes)).toBeDefined();
      if (!target) return;
      expect(
        await editor.bufferRangeForScopeAtPosition(".markup.underline.link", position),
      ).toEqual(range);
      expect(target).toEqual({ range, url: fixture.url ?? destination });
      // EOF may report the preceding scope even though it contains no character.
      if (index + destination.length < fixture.text.length)
        expect(await main.targetAtPosition(editor, range.end)).toBeUndefined();
      editor.setCursorBufferPosition(position);
      await lumine.commands.dispatch(editor.getElement(), "link:open");
      expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith(fixture.url ?? destination);
    });
  }
});
