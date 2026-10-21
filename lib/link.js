const { stat } = require("node:fs/promises");
const { Range } = require("lumine");
const filePathForLink = require("./file-link");

module.exports = {
  provideHyperclick() {
    return {
      priority: 1,
      providerName: "link",
      getSuggestionForWord: async (editor, _text, range) => {
        const target = await this.targetAtPosition(editor, range.start);
        if (!target) return;
        return {
          range: target.range,
          callback: () => this.openTarget(target),
        };
      },
    };
  },

  provideBackgroundTips() {
    return {
      packageName: "link",
      tips: [
        "You can follow the link under the cursor with {{ 'link:open' | keystroke }}; web links open in the browser and Markdown file links open in the editor.",
      ],
    };
  },

  activate() {
    this.commandDisposable = lumine.commands.add("lumine-text-editor:not([mini])", "link:open", {
      description: "Open the clicked link or the link under the cursor in the browser or editor.",
      didDispatch: (event) => this.openLink(event),
    });
    this.contextMenuDisposable = lumine.contextMenu.add({
      "lumine-text-editor:not([mini]) .syntax--markup.syntax--underline.syntax--link": [
        {
          label: "Open Link",
          command: "link:open",
          group: "navigation",
          order: 10,
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
      ],
    });
  },

  deactivate() {
    this.commandDisposable?.dispose();
    this.contextMenuDisposable?.dispose();
    this.commandDisposable = this.contextMenuDisposable = null;
  },

  async openLink(event) {
    const editor = event?.target
      ? lumine.workspace.getTextEditorForElement(event.target, { includeMini: false })
      : lumine.workspace.getActiveTextEditor();
    if (editor == null) return;

    const bufferPosition = event?.detail?.bufferPosition ?? editor.getCursorBufferPosition();
    const target =
      (await this.targetAtPosition(editor, bufferPosition)) ??
      (bufferPosition.column > 0
        ? await this.targetAtPosition(editor, bufferPosition.translate([0, -1]))
        : null);
    if (target) await this.openTarget(target);
  },

  async targetAtPosition(editor, bufferPosition) {
    const target = await editor.analyzeSyntax(require.resolve("./syntax-analysis"), "target", {
      position: bufferPosition,
    });
    if (!target) return;
    const range = Range.fromObject(target.range);
    const destination = decodeDestination(stripAngles(target.destination));
    const url = externalUrl(destination);
    if (url) return { range, url };
    if (target.markdown) {
      const filePath = filePathForLink(destination, editor.getPath());
      if (filePath) return { range, filePath };
    }
  },

  async openTarget(target) {
    if (target.url) return this.openUrl(target.url);
    try {
      if (!(await stat(target.filePath)).isFile()) {
        throw new Error("The link target is not a file.");
      }
      await lumine.workspace.open(target.filePath);
    } catch (error) {
      this.reportOpenError(error);
    }
  },

  async urlForLink(editor, link) {
    if (editor.getGrammar().scopeName === "source.gfm") {
      link = (await this.linkForName(editor, link)) ?? link;
    }

    return externalUrl(link);
  },

  async openUrl(url) {
    try {
      await lumine.shell.openExternal(url);
    } catch (error) {
      this.reportOpenError(error);
    }
  },

  reportOpenError(error) {
    lumine.notifications.addWarning("Unable to open the link.", {
      detail: error.message,
      dismissable: true,
    });
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
  async linkForName(editor, linkName) {
    const value = await editor.analyzeSyntax(require.resolve("./syntax-analysis"), "reference", {
      name: linkName,
    });
    return value == null ? undefined : decodeDestination(stripAngles(value));
  },
};

function externalUrl(destination) {
  try {
    const url = new URL(destination);
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return url.href;
  } catch {
    // Relative Markdown destinations are resolved separately.
  }
}

function stripAngles(destination) {
  return destination.startsWith("<") ? destination.slice(1, -1) : destination;
}

const ESCAPE_OR_ENTITY = /\\([!-/:-@[-`{-~])|&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g;

function decodeDestination(destination) {
  return destination.replace(ESCAPE_OR_ENTITY, (match, escaped) => {
    if (escaped) return escaped;
    const element = document.createElement("textarea");
    element.innerHTML = match;
    const decoded = element.value;
    // A legacy prefix of an unknown name leaves its suffix and semicolon.
    // A fully decoded reference ends in a semicolon only for &semi; / &#59;.
    return decoded.length > 1 && decoded.endsWith(";") ? match : decoded;
  });
}
