const path = require("node:path");
const { fileURLToPath } = require("node:url");

// Markdown destinations are URLs: separate their suffix before decoding so
// encoded # and ? characters remain part of the filename.
module.exports = function filePathForLink(destination, sourcePath) {
  if (!destination || destination.startsWith("#") || destination.startsWith("//")) return;
  try {
    let filePath;
    if (/^file:/i.test(destination)) {
      filePath = fileURLToPath(destination);
    } else {
      const windowsPath = /^[a-z]:[\\/]/i.test(destination) || destination.startsWith("\\\\");
      if (!windowsPath && /^[a-z][a-z\d+.-]*:/i.test(destination)) return;
      filePath = decodeURIComponent(destination.split(/[?#]/, 1)[0]);
      if (!filePath || filePath.includes("\0")) return;
      if (windowsPath && process.platform !== "win32") return;
      if (!path.isAbsolute(filePath)) {
        if (!sourcePath) return;
        filePath = path.resolve(path.dirname(sourcePath), filePath);
      }
    }
    if (filePath.includes("\0")) return;
    return filePath;
  } catch {
    // Invalid percent encoding or file URLs are not navigable destinations.
  }
};
