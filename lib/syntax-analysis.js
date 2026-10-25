function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
}

function markdownDocumentAt(editor, position) {
  return editor.getSyntaxNodeAtBufferPosition?.(
    position,
    (node, grammar) => node.type === "document" && grammar.scopeName === "source.gfm",
  );
}

function findReference(editor, linkName, root, allowTextFallback = false) {
  if (root && !root.hasChanges) {
    const label = normalizeLabel(linkName);
    // An injected Markdown document owns its definitions. Walking only this
    // block tree cannot borrow a definition from a sibling cell or a fence.
    for (const definition of root.descendantsOfType("link_reference_definition")) {
      if (definition.hasError) continue;
      const name = definition.namedChildren.find((node) => node.type === "link_label");
      if (!name || normalizeLabel(name.text.slice(1, -1)) !== label) continue;
      return definition.namedChildren.find((node) => node.type === "link_destination")?.text;
    }
    return;
  }
  if (!allowTextFallback) return;
  let link;
  const label = require("@lumine-code/underscore-plus")
    .escapeRegExp(linkName.trim())
    .replace(/\s+/g, "[ \\t\\r\\n]+");
  const regex = new RegExp(`^[ \\t]*\\[${label}\\]:[ \\t]*(?:\\r?\\n[ \\t]*)?(.+)$`, "gi");
  // The public reference helper can also run without a current syntax tree.
  // Keep that fallback limited to a top-level Markdown document.
  editor.scanInBufferRange(
    regex,
    [
      [0, 0],
      [Infinity, Infinity],
    ],
    ({ match, stop }) => {
      const destination = destinationPrefix(match[1]);
      if (destination == null) return;
      link = destination;
      stop();
    },
  );
  return link;
}

const PUNCTUATION = /^[!-/:-@[-`{-~]$/;
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

exports.reference = (editor, { name }) => {
  if (editor.getGrammar().scopeName !== "source.gfm") return;
  return findReference(editor, name, markdownDocumentAt(editor, [0, 0]), true);
};

exports.target = (editor, { position }) => {
  let range = editor.bufferRangeForScopeAtPosition(".markup.underline.link", position);
  if (!range) return null;
  let destination = editor.getTextInBufferRange(range);
  const node = editor.getSyntaxNodeAtBufferPosition(
    position,
    (node, grammar) =>
      ["source.gfm", "source.gfm.inline"].includes(grammar.scopeName) &&
      [
        "link_destination",
        "link_label",
        "uri_autolink",
        "email_autolink",
        "collapsed_reference_link",
        "shortcut_link",
      ].includes(node.type),
  );
  if (node && !node.hasChanges && !node.hasError) {
    const nativeRange = editor.bufferRangeForScopeAtPosition(
      ".markup.underline.link.gfm",
      position,
    );
    if (nativeRange) {
      range = nativeRange;
      const referenceName =
        node.type === "link_label"
          ? node.text.slice(1, -1)
          : ["collapsed_reference_link", "shortcut_link"].includes(node.type)
            ? node.namedChildren.find((child) => child.type === "link_text")?.text
            : null;
      destination =
        referenceName != null
          ? findReference(editor, referenceName, markdownDocumentAt(editor, position))
          : node.type === "email_autolink"
            ? `mailto:${node.text.slice(1, -1)}`
            : node.text;
      return destination == null
        ? null
        : {
            range,
            destination,
            markdown: true,
            ...(["uri_autolink", "email_autolink"].includes(node.type)
              ? {}
              : { destinationSyntax: "markdown" }),
          };
    }
  }
  let destinationSyntax;
  editor.getSyntaxNodeAtBufferPosition(position, (node, grammar) => {
    if (grammar.scopeName === "text.tex.latex" && node.type === "uri") {
      destinationSyntax = "latex";
      return true;
    }
    if (grammar.scopeName === "text.html.basic" && node.type === "attribute_value") {
      destinationSyntax = "html";
      return true;
    }
    if (
      grammar.scopeName === "text.xml" &&
      ["AttValue", "CharData", "EntityRef", "CharRef"].includes(node.type)
    ) {
      destinationSyntax = "xml";
      return true;
    }
    return false;
  });
  return {
    range,
    destination,
    markdown: false,
    ...(destinationSyntax ? { destinationSyntax } : {}),
  };
};
