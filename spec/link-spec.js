describe("link package", () => {
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-hyperlink");
    await lumine.packages.activatePackage("language-gfm");

    const activationPromise = lumine.packages.activatePackage("link");
    lumine.commands.dispatch(lumine.views.getView(lumine.workspace), "link:open");
    await activationPromise;
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
      expect(lumine.shell.openExternal.argsForCall[0][0]).toBe("http://github.com");

      lumine.shell.openExternal.reset();
      editor.setCursorBufferPosition([0, 8]);
      lumine.commands.dispatch(lumine.views.getView(editor), "link:open");

      expect(lumine.shell.openExternal).toHaveBeenCalled();
      expect(lumine.shell.openExternal.argsForCall[0][0]).toBe("http://github.com");

      lumine.shell.openExternal.reset();
      editor.setCursorBufferPosition([0, 20]);
      lumine.commands.dispatch(lumine.views.getView(editor), "link:open");

      expect(lumine.shell.openExternal).toHaveBeenCalled();
      expect(lumine.shell.openExternal.argsForCall[0][0]).toBe("http://github.com");
    });

    // NOTE: I don't think anyone realized that this was a feature. Our
    // `tree-sitter-markdown` parser doesn't recognize these as URLs. We'd need
    // our custom `tree-sitter-hyperlink` to support this, and it doesn't right
    // now, but I'll keep it in mind for the future.
    xit("opens a 'lumine:' link", async () => {
      await lumine.workspace.open("sample.md");

      const editor = lumine.workspace.getActiveTextEditor();
      editor.setText("// lumine://core/open/file?filename=sample.js&line=1&column=2 ");

      spyOn(lumine.shell, "openExternal");
      lumine.commands.dispatch(lumine.views.getView(editor), "link:open");
      expect(lumine.shell.openExternal).not.toHaveBeenCalled();

      editor.setCursorBufferPosition([0, 4]);
      lumine.commands.dispatch(lumine.views.getView(editor), "link:open");

      expect(lumine.shell.openExternal).toHaveBeenCalled();
      expect(lumine.shell.openExternal.argsForCall[0][0]).toBe(
        "lumine://core/open/file?filename=sample.js&line=1&column=2",
      );

      lumine.shell.openExternal.reset();
      editor.setCursorBufferPosition([0, 8]);
      lumine.commands.dispatch(lumine.views.getView(editor), "link:open");

      expect(lumine.shell.openExternal).toHaveBeenCalled();
      expect(lumine.shell.openExternal.argsForCall[0][0]).toBe(
        "lumine://core/open/file?filename=sample.js&line=1&column=2",
      );

      lumine.shell.openExternal.reset();
      editor.setCursorBufferPosition([0, 59]);
      lumine.commands.dispatch(lumine.views.getView(editor), "link:open");

      expect(lumine.shell.openExternal).toHaveBeenCalled();
      expect(lumine.shell.openExternal.argsForCall[0][0]).toBe(
        "lumine://core/open/file?filename=sample.js&line=1&column=2",
      );
    });

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
        expect(lumine.shell.openExternal.argsForCall[0][0]).toBe("http://github.com");

        lumine.shell.openExternal.reset();
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
