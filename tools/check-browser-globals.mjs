import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {ESLint} from "eslint";

// The application deliberately shares names across classic script tags.
// Check unresolved references against the actual declarations, DOM library and
// external map SDK instead of disabling no-undef for every application file.
export async function checkBrowserGlobals() {
  const files = fs.readdirSync("js").filter(file => file.endsWith(".js")).map(file => "js/" + file);
  const globals = {kakao: "readonly"};
  function declarations(source, filename) {
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) ||
          ts.isModuleDeclaration(statement)) && statement.name && ts.isIdentifier(statement.name)) {
        globals[statement.name.text] = "writable";
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) globals[declaration.name.text] = "writable";
        }
      }
    }
  }
  const dom = path.join(path.dirname(ts.getDefaultLibFilePath({})), "lib.dom.d.ts");
  declarations(fs.readFileSync(dom, "utf8"), dom);
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    declarations(source, file);
    for (const match of source.matchAll(/\b(?:window|global|globalThis)\.([A-Za-z_$][\w$]*)\s*=(?!=|>)/g)) {
      globals[match[1]] = "writable";
    }
  }
  const eslint = new ESLint({overrideConfig: [{
    files: ["js/**/*.js"], languageOptions: {globals}, rules: {"no-undef": "error"}
  }]});
  const results = await eslint.lintFiles(files);
  return results.flatMap(result => result.messages.filter(message => message.ruleId === "no-undef")
    .map(message => ({file: path.relative(process.cwd(), result.filePath), line: message.line, message: message.message})));
}

export async function checkWorkerGlobals() {
  // Workers expose Web APIs but have no window/document or DOM elements.
  const globals = Object.fromEntries([
    "fetch", "crypto", "caches", "Request", "Response", "Headers", "URL", "URLSearchParams",
    "ReadableStream", "WritableStream", "TransformStream", "TextEncoder", "TextDecoder",
    "AbortController", "AbortSignal", "DOMException", "atob", "btoa", "console",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance",
    "Blob", "File", "FormData", "CompressionStream", "DecompressionStream",
    "WebSocket", "WebSocketPair", "HTMLRewriter", "Event"
  ].map(name => [name, "readonly"]));
  const eslint = new ESLint({overrideConfig: [{
    files: ["cloudflare/**/*.js"], languageOptions: {globals}, rules: {"no-undef": "error"}
  }]});
  return (await eslint.lintFiles(["cloudflare/**/*.js"])).flatMap(result =>
    result.messages.filter(message => message.ruleId === "no-undef")
      .map(message => ({file: path.relative(process.cwd(), result.filePath), line: message.line, message: message.message})));
}
