const { MAX_LABEL, MAX_DESTINATION } = require("./link-limits");
const PUNCTUATION = /^[!-/:-@[-`{-~]$/;

function checkFor(editor) {
  const buffer = editor.getBuffer(),
    revision = buffer.getTextRevision();
  return () => {
    editor.signal?.throwIfAborted();
    if (buffer.getTextRevision() !== revision)
      throw Object.assign(new Error("Link lookup was superseded"), { name: "AbortError" });
  };
}

async function run(iterator, check) {
  let deadline = performance.now() + 4;
  try {
    for (;;) {
      check();
      const next = iterator.next();
      if (next.done) return next.value;
      if (performance.now() >= deadline) {
        await new Promise((resolve) => setImmediate(resolve));
        deadline = performance.now() + 4;
      }
    }
  } finally {
    iterator.return?.();
  }
}

class ReferenceScanner {
  constructor(source) {
    this.source = source;
    this.start = -1;
    this.text = "";
  }
  read(index) {
    if (index < 0 || index >= this.source.length) return "";
    if (index < this.start || index >= this.start + this.text.length) {
      this.start = Math.floor(index / 16384) * 16384;
      this.text = this.source.slice(this.start, Math.min(this.source.length, this.start + 16384));
    }
    return this.text[index - this.start];
  }
  lineEnd(row) {
    let end =
      row + 1 < this.source.lineCount ? this.source.lineStart(row + 1) - 1 : this.source.length;
    if (row + 1 < this.source.lineCount && this.read(end - 1) === "\r") end--;
    return end;
  }
  *skip(index, end, pattern) {
    while (index < end) {
      const text = this.source.slice(index, Math.min(end, index + 16384));
      const count = pattern.exec(text)[0].length;
      index += count;
      if (count !== text.length) return index;
      yield;
    }
    return index;
  }
  *destination(start, end) {
    const angle = this.read(start) === "<";
    let depth = 0,
      index = start + (angle ? 1 : 0);
    let checkpoint = index + 2048;
    for (; index < end; index++) {
      if (index >= checkpoint) {
        yield;
        checkpoint = index + 2048;
      }
      if (index - start >= MAX_DESTINATION) return;
      const char = this.read(index);
      if (char === "\\" && PUNCTUATION.test(this.read(index + 1))) {
        index++;
        continue;
      }
      if (angle) {
        if (char === ">") return this.source.slice(start, index + 1);
        if (char === "<" || char === "\r" || char === "\n") return;
      } else {
        if (char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) break;
        if (char === "(") depth++;
        else if (char === ")" && --depth < 0) return;
      }
    }
    if (angle || depth || index === start || index - start > MAX_DESTINATION) return;
    const remainder = yield* this.skip(index, end, /^\s*/u);
    if (remainder < end && !['"', "'", "("].includes(this.read(remainder))) return;
    return this.source.slice(start, index);
  }
  *find(name) {
    if (typeof name !== "string" || name.length > MAX_LABEL) return;
    const pieces = name.trim().split(/\s+/);
    const patterns = pieces.map(
      (piece) => new RegExp(`^${piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    );
    for (let row = 0; row < this.source.lineCount; row++) {
      let index = yield* this.skip(this.source.lineStart(row), this.lineEnd(row), /^[ \t]*/);
      if (this.read(index) !== "[") {
        if (row % 256 === 0) yield;
        continue;
      }
      index++;
      let matched = true;
      for (let part = 0; part < pieces.length; part++) {
        if (part) {
          const before = index;
          index = yield* this.skip(index, this.source.length, /^[ \t\r\n]*/);
          if (index === before) {
            matched = false;
            break;
          }
        }
        const length = pieces[part].length;
        if (
          index + length > this.source.length ||
          !patterns[part].test(this.source.slice(index, index + length))
        ) {
          matched = false;
          break;
        }
        index += length;
      }
      if (!matched || this.read(index) !== "]" || this.read(index + 1) !== ":") {
        yield;
        continue;
      }
      index = yield* this.skip(index + 2, this.source.length, /^[ \t]*/);
      if (this.read(index) === "\r" && this.read(index + 1) === "\n") index += 2;
      else if (this.read(index) === "\n") index++;
      index = yield* this.skip(index, this.source.length, /^[ \t]*/);
      const destinationRow = this.source.positionAt(index).row,
        end = this.lineEnd(destinationRow);
      if (index < end) {
        const result = yield* this.destination(index, end);
        if (result !== undefined) return result;
        row = destinationRow;
      }
      yield;
    }
  }
}

module.exports = { ReferenceScanner, checkFor, run };
