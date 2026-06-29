export interface ElementStylePatch {
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: string;
  padding?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  margin?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  borderRadius?: string;
  boxShadow?: string;
  opacity?: string;
  position?: string;
  left?: string;
  top?: string;
  width?: string;
  height?: string;
}

export interface ElementPatch {
  path: string;
  text?: string;
  style?: ElementStylePatch;
}

export interface ElementPatchResult {
  ok: boolean;
  html: string;
  reason?: string;
}

export interface SelectedElementContext {
  tagName: string;
  path: string;
  text: string;
  pageLabel?: string;
  id?: string;
  className?: string;
  style?: Partial<Record<keyof ElementStylePatch, string>>;
}

const SAFE_STYLE_PROPS: Record<keyof ElementStylePatch, string> = {
  color: 'color',
  backgroundColor: 'background-color',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  lineHeight: 'line-height',
  letterSpacing: 'letter-spacing',
  textAlign: 'text-align',
  padding: 'padding',
  paddingTop: 'padding-top',
  paddingRight: 'padding-right',
  paddingBottom: 'padding-bottom',
  paddingLeft: 'padding-left',
  margin: 'margin',
  marginTop: 'margin-top',
  marginRight: 'margin-right',
  marginBottom: 'margin-bottom',
  marginLeft: 'margin-left',
  borderRadius: 'border-radius',
  boxShadow: 'box-shadow',
  opacity: 'opacity',
  position: 'position',
  left: 'left',
  top: 'top',
  width: 'width',
  height: 'height',
};

const SAFE_CSS_NAMES = new Set(Object.values(SAFE_STYLE_PROPS));
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

interface ElementRange {
  path: string;
  startTagStart: number;
  startTagEnd: number;
  innerStart: number;
  innerEnd: number;
}

interface StackFrame {
  tagName: string;
  path: string;
  startTagStart: number;
  startTagEnd: number;
  siblingCounts: Map<string, number>;
}

export function mergeInlineStyle(currentStyle: string, patch: ElementStylePatch = {}): string {
  const declarations: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const declaration of currentStyle.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator === -1) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!name || !value || !SAFE_CSS_NAMES.has(name) || seen.has(name)) continue;
    declarations.push([name, value]);
    seen.add(name);
  }

  for (const [key, value] of Object.entries(patch) as Array<[keyof ElementStylePatch, string | undefined]>) {
    const cssName = SAFE_STYLE_PROPS[key];
    const cssValue = value?.trim();
    if (!cssName || !cssValue) continue;
    const existing = declarations.findIndex(([name]) => name === cssName);
    if (existing >= 0) {
      declarations[existing] = [cssName, cssValue];
    } else {
      declarations.push([cssName, cssValue]);
    }
    seen.add(cssName);
  }

  return declarations.map(([name, value]) => `${name}: ${value}`).join('; ');
}

export function applyElementPatch(html: string, patch: ElementPatch): ElementPatchResult {
  const target = normalizePath(patch.path);
  if (!target) return { ok: false, html, reason: 'Missing element path' };

  const range = findElementRange(html, target);
  if (!range) return { ok: false, html, reason: 'Target element was not found' };

  const originalStartTag = html.slice(range.startTagStart, range.startTagEnd);
  const nextStartTag = patch.style
    ? setStyleAttribute(originalStartTag, mergeInlineStyle(readStyleAttribute(originalStartTag), patch.style))
    : originalStartTag;

  let next = html;
  if (patch.text !== undefined) {
    next = `${next.slice(0, range.innerStart)}${escapeHtml(patch.text)}${next.slice(range.innerEnd)}`;
  }

  next = `${next.slice(0, range.startTagStart)}${nextStartTag}${next.slice(range.startTagEnd)}`;
  return { ok: true, html: next };
}

export function buildElementEditPrompt(element: SelectedElementContext, request: string): string {
  const styleSummary = element.style
    ? Object.entries(element.style)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}: ${value}`)
      .join('; ')
    : '';

  return [
    '请只修改当前选中元素及必要的相邻样式，保持多页 HTML 的整体风格、页面数量、导出接口和结尾一致。',
    '',
    '选中元素:',
    `- 页面: ${element.pageLabel || '当前页面'}`,
    `- 标签: ${element.tagName}`,
    `- 路径: ${element.path}`,
    element.id ? `- ID: ${element.id}` : '',
    element.className ? `- Class: ${element.className}` : '',
    element.text ? `- 当前文本: ${element.text.slice(0, 240)}` : '',
    styleSummary ? `- 当前样式: ${styleSummary}` : '',
    '',
    `修改要求: ${request}`,
  ].filter(Boolean).join('\n');
}

function findElementRange(html: string, targetPath: string): ElementRange | null {
  const stack: StackFrame[] = [];
  let targetFrame: StackFrame | null = null;
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor);
    if (tagStart === -1) break;
    const tagEnd = html.indexOf('>', tagStart + 1);
    if (tagEnd === -1) break;

    const rawTag = html.slice(tagStart, tagEnd + 1);
    if (isSkippableTag(rawTag)) {
      cursor = tagEnd + 1;
      continue;
    }

    const closing = /^<\s*\//.test(rawTag);
    if (closing) {
      const closingName = rawTag.match(/^<\s*\/\s*([a-zA-Z0-9:-]+)/)?.[1]?.toLowerCase();
      if (!closingName) {
        cursor = tagEnd + 1;
        continue;
      }

      let frame = stack.pop();
      while (frame && frame.tagName !== closingName) {
        frame = stack.pop();
      }
      if (frame?.path === targetPath) {
        return {
          path: frame.path,
          startTagStart: frame.startTagStart,
          startTagEnd: frame.startTagEnd,
          innerStart: frame.startTagEnd,
          innerEnd: tagStart,
        };
      }
      cursor = tagEnd + 1;
      continue;
    }

    const tagName = rawTag.match(/^<\s*([a-zA-Z0-9:-]+)/)?.[1]?.toLowerCase();
    if (!tagName) {
      cursor = tagEnd + 1;
      continue;
    }

    const parent = stack[stack.length - 1];
    const siblingCounts = parent?.siblingCounts || new Map<string, number>();
    const nth = (siblingCounts.get(tagName) || 0) + 1;
    siblingCounts.set(tagName, nth);
    const path = parent ? `${parent.path} > ${tagName}:nth-of-type(${nth})` : `${tagName}:nth-of-type(${nth})`;
    const selfClosing = /\/\s*>$/.test(rawTag) || VOID_TAGS.has(tagName);

    const frame: StackFrame = {
      tagName,
      path,
      startTagStart: tagStart,
      startTagEnd: tagEnd + 1,
      siblingCounts: new Map<string, number>(),
    };

    if (path === targetPath) {
      if (selfClosing) {
        return {
          path,
          startTagStart: tagStart,
          startTagEnd: tagEnd + 1,
          innerStart: tagEnd + 1,
          innerEnd: tagEnd + 1,
        };
      }
      targetFrame = frame;
    }

    if (!selfClosing) stack.push(frame);
    if (targetFrame && targetFrame.path === path && selfClosing) break;
    cursor = tagEnd + 1;
  }

  return null;
}

function isSkippableTag(tag: string): boolean {
  return /^<!|^<\?|^<!--/.test(tag);
}

function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\s*>\s*/g, ' > ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function readStyleAttribute(tag: string): string {
  const match = tag.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  return match?.[2] ?? match?.[3] ?? '';
}

function setStyleAttribute(tag: string, style: string): string {
  const escaped = escapeAttribute(style);
  if (/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.test(tag)) {
    return tag.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i, style ? ` style="${escaped}"` : '');
  }
  if (!style) return tag;
  return tag.replace(/\/?>$/, (suffix) => ` style="${escaped}"${suffix}`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
