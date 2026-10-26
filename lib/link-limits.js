const MAX_LABEL = 4096;
const MAX_DESTINATION = 65536;

function boundedText(source, start, end, maximum) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > source.length ||
    end - start > maximum
  )
    return;
  return source.slice(start, end);
}

module.exports = { MAX_LABEL, MAX_DESTINATION, boundedText };
