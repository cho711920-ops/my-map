// Shared XML row parser for building-register and elevator public data.
function text(value) {
  return String(value == null ? "" : value).trim();
}

function decodeXml(value) {
  return text(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseXmlRows(xml) {
  const rows = [];
  const source = text(xml);
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch;
  while ((itemMatch = itemPattern.exec(source))) {
    const row = {};
    const fieldPattern = /<([A-Za-z0-9_]+)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g;
    let fieldMatch;
    while ((fieldMatch = fieldPattern.exec(itemMatch[1]))) {
      row[fieldMatch[1]] = decodeXml(fieldMatch[2]);
    }
    rows.push(row);
  }
  return rows;
}
