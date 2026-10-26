const { MAX_LABEL, MAX_DESTINATION, boundedText } = require("./link-limits");
const { ReferenceScanner, checkFor, run } = require("./source-reference");

function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
}

function markdownDocumentAt(editor, position) {
  return editor.getSyntaxNodeAtBufferPosition?.(
    position,
    (node, grammar) => node.type === "document" && grammar.scopeName === "source.gfm",
  );
}

function nodeText(source, node, maximum) {
  return node ? boundedText(source, node.startIndex, node.endIndex, maximum) : undefined;
}

async function findNamedChild(node, type, check) {
  const count = node?.namedChildCount;
  if (!Number.isSafeInteger(count) || typeof node.namedChild !== "function") return;
  let deadline = performance.now() + 4;
  for (let index = 0; index < count; index++) {
    check();
    const child = node.namedChild(index);
    if (child?.type === type) return child;
    if (performance.now() >= deadline) {
      await new Promise((resolve) => setImmediate(resolve));
      deadline = performance.now() + 4;
    }
  }
}

async function findReference(editor, linkName, root, allowTextFallback = false) {
  if (typeof linkName !== "string" || linkName.length > MAX_LABEL) return;
  const source = editor.getBuffer().getTextSnapshot(),
    check = checkFor(editor);
  if (root && !root.hasChanges) {
    const label = normalizeLabel(linkName),
      cursor = root.walk();
    let deadline = performance.now() + 4;
    try {
      for (;;) {
        check();
        const definition = cursor.currentNode;
        let descend = true;
        if (definition.type === "link_reference_definition") {
          descend = false;
          if (!definition.hasError) {
            const nameNode = await findNamedChild(definition, "link_label", check);
            const name = nodeText(source, nameNode, MAX_LABEL + 2);
            // Unreadable earlier metadata could be the first definition of this
            // label. Decline rather than opening a possibly different duplicate.
            if (nameNode && name === undefined) return;
            if (name && normalizeLabel(name.slice(1, -1)) === label) {
              const destination = await findNamedChild(definition, "link_destination", check);
              return nodeText(source, destination, MAX_DESTINATION);
            }
          }
        }
        if (!(descend && cursor.gotoFirstChild())) {
          while (!cursor.gotoNextSibling()) if (!cursor.gotoParent()) return;
        }
        if (performance.now() >= deadline) {
          await new Promise((resolve) => setImmediate(resolve));
          deadline = performance.now() + 4;
        }
      }
    } finally {
      cursor.delete?.();
    }
  }
  if (allowTextFallback) return run(new ReferenceScanner(source).find(linkName), check);
}

exports.reference = async (editor, { name }) => {
  if (
    editor.getGrammar().scopeName !== "source.gfm" ||
    typeof name !== "string" ||
    name.length > MAX_LABEL
  )
    return;
  return findReference(editor, name, markdownDocumentAt(editor, [0, 0]), true);
};

exports.target = async (editor, { position }) => {
  let range = editor.bufferRangeForScopeAtPosition(".markup.underline.link", position);
  if (!range) return null;
  const buffer = editor.getBuffer(),
    source = buffer.getTextSnapshot(),
    check = checkFor(editor);
  let destination;
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
      let referenceName;
      if (node.type === "link_label") {
        const text = nodeText(source, node, MAX_LABEL + 2);
        if (text === undefined) return null;
        referenceName = text.slice(1, -1);
      } else if (["collapsed_reference_link", "shortcut_link"].includes(node.type)) {
        referenceName = nodeText(source, await findNamedChild(node, "link_text", check), MAX_LABEL);
        if (referenceName === undefined) return null;
      }
      if (referenceName !== undefined)
        destination = await findReference(
          editor,
          referenceName,
          markdownDocumentAt(editor, position),
        );
      else {
        const text = nodeText(source, node, MAX_DESTINATION);
        if (text === undefined) return null;
        destination = node.type === "email_autolink" ? `mailto:${text.slice(1, -1)}` : text;
      }
      check();
      return destination == null || destination.length > MAX_DESTINATION
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
  destination = boundedText(
    source,
    buffer.characterIndexForPosition(range.start),
    buffer.characterIndexForPosition(range.end),
    MAX_DESTINATION,
  );
  if (destination === undefined) return null;
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
