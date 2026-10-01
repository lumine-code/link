const _ = require("@lumine-code/underscore-plus");

const LINK_SCOPE_REGEX = /markup\.underline\.link/;

module.exports = {
  provideHyperclick() {
    return {
      priority: 1,
      providerName: "link",
      getSuggestionForWord: (editor, _text, range) => {
        const linkRange = editor.bufferRangeForScopeAtPosition(
          ".markup.underline.link",
          range.start,
        );
        if (!linkRange) return;
        const url = this.urlForLink(editor, editor.getTextInBufferRange(linkRange));
        if (!url) return;
        return {
          range: linkRange,
          callback: () => this.openUrl(url),
        };
      },
    };
  },

  provideBackgroundTips() {
    return {
      packageName: "link",
      tips: [
        "You can open the http link under the cursor in your browser without leaving the editor.",
      ],
    };
  },

  activate() {
    this.commandDisposable = lumine.commands.add("lumine-text-editor:not([mini])", "link:open", {
      description: "Open the clicked URL or the URL under the cursor in a browser.",
      didDispatch: (event) => this.openLink(event),
    });
    this.contextMenuDisposable = lumine.contextMenu.add({
      "lumine-text-editor:not([mini]) .syntax--markup.syntax--underline.syntax--link": [
        { type: "separator" },
        {
          label: "Open Link",
          command: "link:open",
          created(event) {
            if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
            const element = event.target.closest("lumine-text-editor:not([mini])");
            const editor = element.getModel();
            const screenPosition = element.getComponent().screenPositionForMouseEvent(event);
            this.commandDetail = {
              bufferPosition: editor.bufferPositionForScreenPosition(screenPosition),
            };
          },
        },
        { type: "separator" },
      ],
    });
  },

  deactivate() {
    this.commandDisposable.dispose();
    this.contextMenuDisposable.dispose();
  },

  async openLink(event) {
    // The editor the command is about: the one it was dispatched from — a
    // right-click reaches an editor that need not be the active one — and the
    // active one when it came from the palette.
    const editor =
      lumine.workspace.getTextEditorForElement(event?.target, { includeMini: false }) ??
      lumine.workspace.getActiveTextEditor() ??
      null;
    if (editor == null) return;

    const bufferPosition = event?.detail?.bufferPosition ?? editor.getCursorBufferPosition();
    const link = this.linkNearPosition(editor, bufferPosition);
    if (link == null) return;

    const url = this.urlForLink(editor, link);
    if (url) await this.openUrl(url);
  },

  urlForLink(editor, link) {
    if (editor.getGrammar().scopeName === "source.gfm") {
      link = this.linkForName(editor, link);
    }

    let url;
    try {
      url = new URL(link);
    } catch {
      return;
    }
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return;
    return url.href;
  },

  async openUrl(url) {
    try {
      await lumine.shell.openExternal(url);
    } catch (error) {
      lumine.notifications.addWarning("Unable to open the link.", {
        detail: error.message,
        dismissable: true,
      });
    }
  },

  // Get the link at or immediately before a buffer position in the editor.
  //
  // Returns a {String} link or undefined if no link found.
  linkNearPosition(editor, bufferPosition) {
    const link = this.linkAtPosition(editor, bufferPosition);
    if (link != null) return link;

    // Mouse hit-testing can round the last character to the end of the link.
    if (bufferPosition.column > 0) {
      return this.linkAtPosition(editor, bufferPosition.translate([0, -1]));
    }
  },

  // Get the link at the buffer position in the editor.
  //
  // Returns a {String} link or undefined if no link found.
  linkAtPosition(editor, bufferPosition) {
    const token = editor.tokenForBufferPosition(bufferPosition);
    if (token && token.value && token.scopes.some((scope) => LINK_SCOPE_REGEX.test(scope))) {
      return token.value;
    }
  },

  // Get the link for the given name.
  //
  // This is for Markdown links of the style:
  //
  // ```
  // [label][name]
  //
  // [name]: https://github.com
  // ```
  //
  // Returns a {String} link
  linkForName(editor, linkName) {
    let link = linkName;
    const regex = new RegExp(`^\\s*\\[${_.escapeRegExp(linkName)}\\]\\s*:\\s*(.+)$`, "g");
    editor.backwardsScanInBufferRange(
      regex,
      [
        [0, 0],
        [Infinity, Infinity],
      ],
      ({ match, stop }) => {
        link = match[1];
        stop();
      },
    );
    return link;
  },
};
