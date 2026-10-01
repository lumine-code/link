const path = require("path");

const languageHyperlinkRoot = path.join(__dirname, "..", "..", "language-hyperlink");

describe("link package", () => {
  beforeEach(async () => {
    await lumine.packages.activatePackage(languageHyperlinkRoot);
    await lumine.packages.activatePackage("language-gfm");

    const activationPromise = lumine.packages.activatePackage("link");
    lumine.commands.dispatch(lumine.views.getView(lumine.workspace), "link:open");
    await activationPromise;
  });

  describe("when opening a link from the context menu", () => {
    let popup;

    beforeEach(() => {
      const workspaceElement = lumine.workspace.getElement();
      workspaceElement.style.width = "800px";
      workspaceElement.style.height = "300px";
      jasmine.attachToDOM(workspaceElement);
      spyOn(lumine.shell, "openExternal").and.resolveTo();
    });

    afterEach(() => popup?.close({ cancelled: true }));

    async function openEditor(text, name = "sample.md", options) {
      const editor = await lumine.workspace.open(name, options);
      const languageMode = editor.getBuffer().getLanguageMode();
      await languageMode.ready;
      editor.setText(text);
      await languageMode.atTransactionEnd();
      editor.getElement().getComponent().updateSync();
      return editor;
    }

    async function openLinkAt(editor, bufferPosition, characterOffset = 0.2) {
      const element = editor.getElement();
      const component = element.getComponent();
      component.updateSync();
      const screenPosition = editor.screenPositionForBufferPosition(bufferPosition);
      const pixelPosition = element.pixelPositionForBufferPosition(bufferPosition);
      const linesRect = component.refs.lineTiles.getBoundingClientRect();
      const target = element.querySelector(
        `[data-screen-row="${screenPosition.row}"] .syntax--markup.syntax--underline.syntax--link`,
      );
      expect(target).not.toBeNull();
      popup = lumine.contextMenu.showForEvent({
        target,
        clientX:
          linesRect.left + pixelPosition.left + component.getBaseCharacterWidth() * characterOffset,
        clientY: linesRect.top + pixelPosition.top + component.getLineHeight() / 2,
      });
      const item = popup.rootList.items.find((item) => item.template.command === "link:open");
      expect(item).toBeDefined();
      item.element.click();
      await Promise.resolve();
    }

    it("opens the clicked link while preserving a cursor elsewhere, then uses the cursor for commands", async () => {
      const editor = await openEditor("before\nhttps://github.com\nhttps://example.com");
      editor.setCursorBufferPosition([0, 0]);
      await openLinkAt(editor, [1, 9]);
      expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith("https://github.com/");
      expect(editor.getCursorBufferPosition()).toEqual([0, 0]);

      lumine.shell.openExternal.calls.reset();
      editor.setCursorBufferPosition([2, 9]);
      await openLinkAt(editor, [1, 9]);
      expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith("https://github.com/");
      expect(editor.getCursorBufferPosition()).toEqual([2, 9]);

      lumine.shell.openExternal.calls.reset();
      lumine.commands.dispatch(editor.getElement(), "link:open");
      expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith("https://example.com/");
    });

    it("opens a link in the clicked editor when another editor is active", async () => {
      const clickedEditor = await openEditor("before\nhttps://github.com", "clicked.md");
      clickedEditor.setCursorBufferPosition([0, 0]);
      const activeEditor = await openEditor("https://example.com", "active.md", { split: "right" });
      activeEditor.setCursorBufferPosition([0, 9]);
      expect(lumine.workspace.getActiveTextEditor()).toBe(activeEditor);

      await openLinkAt(clickedEditor, [1, 9]);
      expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith("https://github.com/");
      expect(clickedEditor.getCursorBufferPosition()).toEqual([0, 0]);
      expect(activeEditor.getCursorBufferPosition()).toEqual([0, 9]);
    });

    it("opens a scrolled link when clicking the right half of its final character", async () => {
      const prefix = Array.from({ length: 30 }, (_, index) => `row ${index}`).join("\n");
      const editor = await openEditor(`${prefix}\nhttps://github.com\nafter`);
      editor.setCursorBufferPosition([0, 0]);
      const element = editor.getElement();
      const component = element.getComponent();
      element.setScrollTop(component.getLineHeight() * 28);
      component.updateSync();
      expect(element.getScrollTop()).toBeGreaterThan(0);

      await openLinkAt(editor, [30, "https://github.com".length - 1], 0.75);
      expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith("https://github.com/");
      expect(editor.getCursorBufferPosition()).toEqual([0, 0]);
    });
  });

  describe("when the cursor is on a link", () => {
    it("opens the link using the 'open' command", async () => {
      await lumine.workspace.open("sample.md");

      const editor = lumine.workspace.getActiveTextEditor();
      let languageMode = editor.getBuffer().getLanguageMode();
      await languageMode.ready;
      editor.setText("// http://github.com ");
      await languageMode.atTransactionEnd();

      spyOn(lumine.shell, "openExternal");
      lumine.commands.dispatch(lumine.views.getView(editor), "link:open");
      expect(lumine.shell.openExternal).not.toHaveBeenCalled();

      editor.setCursorBufferPosition([0, 4]);
      lumine.commands.dispatch(lumine.views.getView(editor), "link:open");

      expect(lumine.shell.openExternal).toHaveBeenCalled();
      expect(lumine.shell.openExternal.calls.argsFor(0)[0]).toBe("http://github.com/");

      lumine.shell.openExternal.calls.reset();
      editor.setCursorBufferPosition([0, 8]);
      lumine.commands.dispatch(lumine.views.getView(editor), "link:open");

      expect(lumine.shell.openExternal).toHaveBeenCalled();
      expect(lumine.shell.openExternal.calls.argsFor(0)[0]).toBe("http://github.com/");

      lumine.shell.openExternal.calls.reset();
      editor.setCursorBufferPosition([0, 20]);
      lumine.commands.dispatch(lumine.views.getView(editor), "link:open");

      expect(lumine.shell.openExternal).toHaveBeenCalled();
      expect(lumine.shell.openExternal.calls.argsFor(0)[0]).toBe("http://github.com/");
    });

    // No spec for a `lumine:` URL: neither `tree-sitter-markdown` nor
    // `tree-sitter-hyperlink` tokenizes one as a link, so `link:open` never
    // sees it. Restoring this needs the hyperlink grammar to recognise the
    // scheme first.

    describe("when the cursor is on a [name][url-name] style markdown link", () =>
      it("opens the named url", async () => {
        jasmine.useRealClock();
        await lumine.workspace.open("README.md");

        const editor = lumine.workspace.getActiveTextEditor();
        let languageMode = editor.getBuffer().getLanguageMode();
        await languageMode.ready;

        editor.setText(`\
you should [click][here]
you should not [click][her]

[here]: http://github.com\
`);
        // Allow for time for injections to populate
        await languageMode.atTransactionEnd();

        spyOn(lumine.shell, "openExternal");
        editor.setCursorBufferPosition([0, 0]);
        lumine.commands.dispatch(lumine.views.getView(editor), "link:open");
        expect(lumine.shell.openExternal).not.toHaveBeenCalled();

        editor.setCursorBufferPosition([0, 19]);
        lumine.commands.dispatch(lumine.views.getView(editor), "link:open");

        expect(lumine.shell.openExternal).toHaveBeenCalled();
        expect(lumine.shell.openExternal.calls.argsFor(0)[0]).toBe("http://github.com/");

        lumine.shell.openExternal.calls.reset();
        editor.setCursorBufferPosition([1, 24]);
        lumine.commands.dispatch(lumine.views.getView(editor), "link:open");

        expect(lumine.shell.openExternal).not.toHaveBeenCalled();
      }));

    it("does not open non-HTTP(S) links", async () => {
      await lumine.workspace.open("sample.md");

      const editor = lumine.workspace.getActiveTextEditor();
      editor.setText("// ftp://github.com\n");

      spyOn(lumine.shell, "openExternal");
      lumine.commands.dispatch(lumine.views.getView(editor), "link:open");
      expect(lumine.shell.openExternal).not.toHaveBeenCalled();

      editor.setCursorBufferPosition([0, 5]);
      lumine.commands.dispatch(lumine.views.getView(editor), "link:open");

      expect(lumine.shell.openExternal).not.toHaveBeenCalled();
    });
  });
});
