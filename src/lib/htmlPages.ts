export interface HtmlPage {
  id: string;
  title: string;
  html: string;
}

interface SplitOptions {
  baseHref?: string;
}

export function splitHtmlPages(html: string, options: SplitOptions = {}): HtmlPage[] {
  if (!html.trim()) return [];

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const head = doc.head?.innerHTML || '';
    const body = doc.body;
    if (!body) return [{ id: 'page-1', title: 'Page 1', html }];

    const candidates = collectPageElements(body);
    if (candidates.length === 0) {
      return [{ id: 'page-1', title: extractDocumentTitle(doc) || 'Page 1', html: toCompleteHtml(doc, head, body.innerHTML, options.baseHref) }];
    }

    const sharedBodyAssets = Array.from(body.children)
      .filter((element) => !candidates.some((page) => page === element || page.contains(element)))
      .filter((element) => ['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(element.tagName))
      .map((element) => element.outerHTML)
      .join('\n');

    return candidates.map((page, index) => {
      const title = extractElementTitle(page) || `${extractDocumentTitle(doc) || 'Page'} ${index + 1}`;
      return {
        id: page.id || `page-${index + 1}`,
        title,
        html: toCompleteHtml(doc, head, `${page.outerHTML}\n${sharedBodyAssets}`, options.baseHref),
      };
    });
  } catch {
    return [{ id: 'page-1', title: 'Page 1', html }];
  }
}

function collectPageElements(body: HTMLElement): HTMLElement[] {
  const selectorGroups = [
    ['[data-slide]', '[data-page]'],
    ['main > section', 'body > main > section', 'body > section'],
    ['section.slide', 'section.page'],
    ['.slide', '.page'],
  ];

  for (const group of selectorGroups) {
    const seen = new Set<HTMLElement>();
    const pages: HTMLElement[] = [];
    for (const selector of group) {
      for (const element of Array.from(body.querySelectorAll(selector))) {
        if (!(element instanceof HTMLElement) || seen.has(element)) continue;
        if (!isMeaningfulPageElement(element)) continue;
        seen.add(element);
        pages.push(element);
      }
    }

    const normalized = normalizePageOrder(pages);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return [];
}

function normalizePageOrder(pages: HTMLElement[]): HTMLElement[] {
  return pages
    .filter((page) => !pages.some((other) => other !== page && other.contains(page)))
    .sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
}

function isMeaningfulPageElement(element: HTMLElement): boolean {
  if (element.closest('nav,header,footer,aside,button')) return false;
  const text = (element.textContent || '').replace(/\s+/g, '');
  const hasMedia = Boolean(element.querySelector('img,video,canvas,svg,iframe,object,picture'));
  const hasExplicitPageMarker = Boolean(element.matches('[data-slide],[data-page],section.slide,section.page,.slide,.page'));
  const inlineStyle = element.getAttribute('style') || '';
  const hasVisualBackground = /background|border|box-shadow|filter|transform/i.test(inlineStyle);
  return text.length >= 8 || hasMedia || (hasExplicitPageMarker && text.length >= 2) || (hasVisualBackground && text.length >= 4);
}

function toCompleteHtml(doc: Document, head: string, bodyContent: string, baseHref?: string): string {
  const lang = doc.documentElement.getAttribute('lang') || 'zh-CN';
  const bodyAttrs = Array.from(doc.body.attributes)
    .map((attr) => `${attr.name}="${escapeAttribute(attr.value)}"`)
    .join(' ');
  const base = baseHref && !/<base\s/i.test(head)
    ? `<base href="${escapeAttribute(baseHref)}" />\n`
    : '';
  return `<!DOCTYPE html>
<html lang="${escapeAttribute(lang)}">
<head>
${base}
${head}
</head>
<body${bodyAttrs ? ` ${bodyAttrs}` : ''}>
${bodyContent}
</body>
</html>`;
}

function extractDocumentTitle(doc: Document): string | null {
  const title = doc.querySelector('title')?.textContent?.trim();
  return title || null;
}

function extractElementTitle(element: Element): string | null {
  const heading = element.querySelector('h1,h2,h3,[data-title]')?.textContent?.trim();
  return heading || element.getAttribute('aria-label') || null;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
