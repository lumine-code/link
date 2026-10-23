const { Range } = require("lumine");
const path = require("node:path");

describe("Link requests across asynchronous changes", () => {
  let main, editor, release;
  const target = () => ({
    range: [
      [0, 0],
      [0, 20],
    ],
    destination: "https://example.com/",
    markdown: false,
  });
  beforeEach(async () => {
    main = (await lumine.packages.activatePackage("link")).mainModule;
    editor = await lumine.workspace.open();
    editor.setText("https://example.com/");
    editor.setCursorBufferPosition([0, 2]);
    spyOn(main, "openTarget").and.resolveTo();
  });
  afterEach(() => {
    release?.(null);
    editor.destroy();
  });
  it("does not open an answer belonging to a deactivated generation", async () => {
    spyOn(editor, "analyzeSyntax").and.returnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = main.openLink();
    await lumine.packages.deactivatePackage("link");
    release(target());
    await pending;
    expect(main.openTarget).not.toHaveBeenCalled();
  });
  it("does not retry at an old coordinate after the buffer changes", async () => {
    const query = spyOn(editor, "analyzeSyntax").and.returnValues(
      new Promise((resolve) => {
        release = resolve;
      }),
      Promise.resolve(target()),
    );
    const pending = main.openLink();
    editor.setText("different content");
    release(null);
    await pending;
    expect(query).toHaveBeenCalledTimes(1);
    expect(main.openTarget).not.toHaveBeenCalled();
  });
  it("does not open a local target after ownership changes during its filesystem check", async () => {
    main.openTarget.and.callThrough();
    const open = spyOn(lumine.workspace, "open").and.resolveTo();
    let current = true;
    const pending = main.openTarget(
      { filePath: path.join(__dirname, "fixtures/source.md") },
      { isCurrent: () => current },
    );
    current = false;
    await pending;
    expect(open).not.toHaveBeenCalled();
  });
  it("retires an already offered hyperclick callback when the provider deactivates", async () => {
    spyOn(editor, "analyzeSyntax").and.resolveTo(target());
    const provider = main.provideHyperclick();
    const suggestion = await provider.getSuggestionForWord(
      editor,
      "example",
      new Range([0, 0], [0, 7]),
    );
    expect(suggestion).toBeDefined();
    await lumine.packages.deactivatePackage("link");
    await lumine.packages.activatePackage("link");
    await suggestion.callback();
    expect(main.openTarget).not.toHaveBeenCalled();
  });
});
