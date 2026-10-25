function findReference(editor, linkName) {
  let link;
  const label = require("@lumine-code/underscore-plus")
    .escapeRegExp(linkName.trim())
    .replace(/\s+/g, "[ \\t\\r\\n]+");
  const regex = new RegExp(`^[ \\t]*\\[${label}\\]:[ \\t]*(?:\\r?\\n[ \\t]*)?(.+)$`, "gi");
  const root = editor.getSyntaxNodeAtBufferPosition?.(
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
        const definition = editor.getSyntaxNodeAtBufferPosition(
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

exports.reference = (editor, { name }) => findReference(editor, name);

exports.target = (editor, { position }) => {
  const range = editor.bufferRangeForScopeAtPosition(".markup.underline.link", position);
  if (!range) return null;
  let destination = editor.getTextInBufferRange(range);
  if (editor.getGrammar().scopeName === "source.gfm") {
    const node = editor.getSyntaxNodeAtBufferPosition(position, (node) =>
      ["link_destination", "link_label", "uri_autolink"].includes(node.type),
    );
    if (node && !node.hasChanges && !node.hasError) {
      destination = node.type === "link_label" ? findReference(editor, destination) : node.text;
      return destination == null
        ? null
        : {
            range,
            destination,
            markdown: true,
            decodeMarkdownDestination: node.type !== "uri_autolink",
          };
    }
    const reference = findReference(editor, destination);
    if (reference != null)
      return { range, destination: reference, markdown: true, decodeMarkdownDestination: true };
  }
  return { range, destination, markdown: false };
};
