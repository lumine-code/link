const { stat } = require("node:fs/promises");
const filePathForLink = require("./file-link");

module.exports = {
  provideHyperclick() {
    return {
      priority: 1,
      providerName: "link",
      getSuggestionForWord: (editor, _text, range) => {
        const target = this.targetAtPosition(editor, range.start);
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
      this.targetAtPosition(editor, bufferPosition) ??
      (bufferPosition.column > 0
        ? this.targetAtPosition(editor, bufferPosition.translate([0, -1]))
        : null);
    if (target) await this.openTarget(target);
  },

  targetAtPosition(editor, bufferPosition) {
    const range = editor.bufferRangeForScopeAtPosition(".markup.underline.link", bufferPosition);
    if (!range) return;
    let destination = editor.getTextInBufferRange(range);
    if (editor.getGrammar().scopeName === "source.gfm") {
      const node = editor
        .getBuffer()
        .getLanguageMode()
        .getSyntaxNodeAtPosition?.(
          bufferPosition,
          (node) => node.type === "link_destination" || node.type === "link_label",
        );
      if (node && !node.hasChanges && !node.hasError) {
        if (node.type === "link_label") {
          destination = this.linkForName(editor, destination);
          if (destination == null) return;
        } else {
          destination = decodeDestination(stripAngles(node.text));
        }
        const url = externalUrl(destination);
        if (url) return { range, url };
        const filePath = filePathForLink(destination, editor.getPath());
        if (filePath) return { range, filePath };
        return;
      }
    }
    // Autolinks and injected URLs keep working while a new syntax tree parses.
    // Local paths require a real Markdown destination, never a guessed label.
    const url = this.urlForLink(editor, destination);
    if (url) return { range, url };
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

  urlForLink(editor, link) {
    if (editor.getGrammar().scopeName === "source.gfm") {
      link = this.linkForName(editor, link) ?? link;
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
  linkForName(editor, linkName) {
    let link;
    const label = require("@lumine-code/underscore-plus")
      .escapeRegExp(linkName.trim())
      .replace(/\s+/g, "[ \\t\\r\\n]+");
    const regex = new RegExp(`^[ \\t]*\\[${label}\\]:[ \\t]*(?:\\r?\\n[ \\t]*)?(.+)$`, "gi");
    const languageMode = editor.getBuffer().getLanguageMode();
    const root = languageMode.getSyntaxNodeAtPosition?.(
      [0, 0],
      (node, grammar) => node.type === "document" && grammar.scopeName === "source.gfm",
    );
    const syntaxReady = root && !root.hasChanges;
    // CommonMark uses the first definition. The grammar already separates the
    // destination from titles, including multiline titles and escaped symbols.
    editor.scanInBufferRange(
      regex,
      [
        [0, 0],
        [Infinity, Infinity],
      ],
      ({ match, range, stop }) => {
        let destination;
        if (syntaxReady) {
          const definition = languageMode.getSyntaxNodeAtPosition(
            range.start.translate([0, match[0].indexOf("[")]),
            (node) => node.type === "link_reference_definition" && node.tree === root.tree,
          );
          const node = definition?.namedChildren.find((node) => node.type === "link_destination");
          if (!node || definition.hasError) return;
          destination = node.text;
        } else {
          // Commands and the public helper stay synchronous while a fresh tree
          // is being parsed. Read the current text rather than a stale node.
          destination = destinationPrefix(match[1]);
        }
        if (destination == null) return;
        link = decodeDestination(stripAngles(destination));
        stop();
      },
    );
    return link;
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

const PUNCTUATION = /^[!-/:-@[-`{-~]$/;
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

// Only the destination field is needed when Tree-sitter is unavailable. Angle
// destinations may contain spaces; bare ones require balanced parentheses.
function destinationPrefix(text) {
  const angle = text.startsWith("<");
  let depth = 0;
  let end = angle ? 1 : 0;
  for (; end < text.length; end++) {
    const character = text[end];
    if (character === "\\" && PUNCTUATION.test(text[end + 1] ?? "")) {
      end++;
      continue;
    }
    if (angle) {
      if (character === ">") return text.slice(0, end + 1);
      if (character === "<" || character === "\r" || character === "\n") return;
    } else {
      if (character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127) break;
      if (character === "(") depth++;
      else if (character === ")" && --depth < 0) return;
    }
  }
  if (angle || depth !== 0 || end === 0) return;
  const remainder = text.slice(end).trim();
  if (remainder && !['"', "'", "("].includes(remainder[0])) return;
  return text.slice(0, end);
}
