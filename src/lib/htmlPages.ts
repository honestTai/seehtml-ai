export interface HtmlPage {
  id: string;
  title: string;
  html: string;
}

export function splitHtmlPages(html: string): HtmlPage[] {
  if (!html.trim()) return [];

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const head = doc.head?.innerHTML || '';
    const body = doc.body;
    if (!body) return [{ id: 'page-1', title: 'Page 1', html }];

    const candidates = collectPageElements(body);
    if (candidates.length === 0) {
      return [{ id: 'page-1', title: extractDocumentTitle(doc) || 'Page 1', html: toCompleteHtml(doc, head, body.innerHTML) }];
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
        html: toCompleteHtml(doc, head, `${page.outerHTML}\n${sharedBodyAssets}`),
      };
    });
  } catch {
    return [{ id: 'page-1', title: 'Page 1', html }];
  }
}

function collectPageElements(body: HTMLElement): HTMLElement[] {
  const selectors = [
    '[data-slide]',
    '[data-page]',
    'section.slide',
    'section.page',
    '.slide',
    '.page',
    'main > section',
    'body > section',
  ];
  const seen = new Set<HTMLElement>();
  const pages: HTMLElement[] = [];

  for (const selector of selectors) {
    for (const element of Array.from(body.querySelectorAll(selector))) {
      if (!(element instanceof HTMLElement) || seen.has(element)) continue;
      seen.add(element);
      pages.push(element);
    }
  }

  return pages
    .filter((page) => !pages.some((other) => other !== page && page.contains(other)))
    .sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
}

function toCompleteHtml(doc: Document, head: string, bodyContent: string): string {
  const lang = doc.documentElement.getAttribute('lang') || 'zh-CN';
  const bodyAttrs = Array.from(doc.body.attributes)
    .map((attr) => `${attr.name}="${escapeAttribute(attr.value)}"`)
    .join(' ');
  return `<!DOCTYPE html>
<html lang="${escapeAttribute(lang)}">
<head>
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
