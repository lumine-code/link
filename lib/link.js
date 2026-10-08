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
    const label = _.escapeRegExp(linkName.trim()).replace(/\s+/g, "[ \\t\\r\\n]+");
    const regex = new RegExp(`^[ \\t]{0,3}\\[${label}\\]:[ \\t]*(?:\\r?\\n[ \\t]*)?(.+)$`, "gi");
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
            range.start,
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
        if (destination.startsWith("<")) destination = destination.slice(1, -1);
        link = decodeDestination(destination);
        stop();
      },
    );
    return link;
  },
};

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
