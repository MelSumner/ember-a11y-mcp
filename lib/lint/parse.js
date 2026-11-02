import { preprocess } from '@glimmer/syntax';
import { Preprocessor } from 'content-tag';

const contentTag = new Preprocessor();

export function detectKind(filename, source) {
  if (filename) {
    if (/\.hbs$/i.test(filename)) return 'hbs';
    if (/\.g[jt]s$/i.test(filename)) return 'gjs';
  }
  return /<template[\s>]/.test(source) && /(^|\n)\s*(import|export|class|const|let)\b/.test(source) ? 'gjs' : 'hbs';
}

function positionAt(source, index) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: index - last - 1 };
}

/**
 * Returns [{ ast, contents, offset: {line, column} }] — one per template.
 * `offset` is the source position of the first character of the template contents,
 * so finding positions can be mapped back to the original file.
 */
export function parseTemplates(source, { filename } = {}) {
  const kind = detectKind(filename, source);
  const chunks = [];
  if (kind === 'hbs') {
    chunks.push({ contents: source, offset: { line: 1, column: 0 } });
  } else {
    let parsed;
    try {
      parsed = contentTag.parse(source, { filename });
    } catch (error) {
      // content-tag rejects JavaScript syntax errors before any template can be extracted.
      const text = String(error?.message ?? error);
      const m = /:(\d+):(\d+)/.exec(text);
      const reason = /×\s*(.+)/.exec(error?.source_code ?? '')?.[1]?.trim();
      const message = `JavaScript syntax error${reason ? `: ${reason}` : ''}`;
      return [{ contents: '', offset: { line: 1, column: 0 }, kind, ast: null, error: { message, line: m ? Number(m[1]) : 1, column: m ? Number(m[2]) - 1 : 0 } }];
    }
    for (const t of parsed) {
      const start = t.contentRange.startUtf16Codepoint;
      chunks.push({ contents: t.contents, offset: positionAt(source, start) });
    }
  }
  return chunks.map((chunk) => {
    try {
      return { ...chunk, kind, ast: preprocess(chunk.contents, { mode: 'codemod' }) };
    } catch (error) {
      const m = /line (\d+)/i.exec(error.message);
      return { ...chunk, kind, ast: null, error: { message: error.message.split('\n')[0], line: m ? Number(m[1]) : 1 } };
    }
  });
}

export function mapPosition(pos, offset) {
  return {
    line: pos.line + offset.line - 1,
    column: pos.line === 1 ? pos.column + offset.column : pos.column,
  };
}
