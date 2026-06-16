import { useCallback, useSyncExternalStore } from 'react';

export type Lang = 'zh' | 'en';

type Dict = Record<string, string>;
type Translations = Record<Lang, Dict>;

const zh: Dict = {
  'app.title': 'SeeHTML AI — AI 营销助手',
  'sidebar.agents': '智能体', 'sidebar.files': '文件', 'sidebar.skills': '技能',
  'sidebar.fileTree': '文件树',
  'sidebar.workspace': '工作区',
  'sidebar.openFile': '打开文件',
  'sidebar.chooseFolder': '选择文件夹',
  'sidebar.refresh': '刷新',
  'sidebar.loading': '正在加载文件...',
  'sidebar.empty': '没有可显示的文件',
  'sidebar.unavailable': '文件树需要在 Tauri 桌面端中使用',
  'sidebar.hiddenHeavy': '已隐藏大型构建目录',
  'project.title': '项目',
  'project.open': '打开项目',
  'sessions.title': '会话',
  'sessions.new': '新会话',
  'sessions.current': '当前会话',
  'sessions.htmlQuality': 'HTML 质量会话',
  'sessions.previewExport': '预览与导出',
  'editor.preview': '预览', 'editor.source': '源码', 'editor.export': '导出',
  'editor.savePng': '保存 PNG',
  'editor.exportOptions': '导出选项',
  'editor.capturePng': '捕获当前页面为 PNG',
  'editor.exportPptx': '导出 PowerPoint 文件',
  'editor.exportMarkdown': '导出 Markdown',
  'editor.exportVideo': '从页面图片生成视频',
  'editor.exportPdf': '导出 PDF',
  'editor.ocrText': '从图片中提取文字',
  'editor.noSource': '打开或生成 HTML 后会在这里显示源码。',
  'welcome.subtitle': '带多轮工具调用的 HTML 页面助手。',
  'welcome.open': '打开 HTML 文件或粘贴 HTML 内容',
  'welcome.generate': 'AI 根据主题生成页面',
  'welcome.preview': '实时预览 HTML',
  'welcome.export': '导出 PNG / PPTX / Video / PDF',
  'welcome.ocr': '内置 OCR 图片文字提取',
  'preview.emptyTitle': '预览窗口',
  'preview.emptyHint': '从左侧选择 HTML / Video / PDF / Markdown / PNG，或让 Agent 生成 HTML',
  'preview.generatedHtml': 'AI 生成 HTML',
  'preview.loading': '正在打开预览...',
  'preview.error': '预览失败',
  'preview.unsupported': '暂不支持此文件类型',
  'preview.welcome': '从左侧文件树打开 HTML、视频、PDF、Markdown 或 PNG；也可以在右侧让 Agent 生成或修改 HTML。',
  'chat.title': 'Agent 窗口', 'chat.placeholder': '输入消息，粘贴图片（Ctrl+V），或添加图片...',
  'chat.placeholderImage': '描述这张图要怎么处理，留空则自动分析...',
  'chat.processing': '处理中...', 'chat.ready': '就绪', 'chat.messages': '条消息',
  'chat.stop': '停止',
  'chat.append': '追加',
  'chat.orchestrating': 'Agent 编排中',
  'chat.queue': '追加队列',
  'chat.queueHint': '当前轮结束后继续',
  'chat.timeout': '请求超时，已停止处理。你可以重试，或换一个更短的需求。',
  'chat.attachImage': '添加图片（也可 Ctrl+V 粘贴）',
  'chat.pasteImage': 'Ctrl+V 粘贴图片',
  'chat.cancelled': '已取消。',
  'chat.opened': '已打开 HTML，预览已更新。',
  'chat.openedFile': '已打开文件，预览已更新。',
  'chat.generated': '已生成 HTML，预览已更新。',
  'chat.updated': '已更新 HTML，预览已刷新。',
  'chat.exported': '已导出文件。',
  'chat.noHtmlDocument': '请先打开或生成一个 HTML 页面。',
  'chat.noDisplayableResult': '请求已处理，但模型没有返回可预览的 HTML 或可展示文本。',
  'chat.imageDefault': '分析这张图片，并生成匹配的 HTML 页面。',
  'export.png': 'PNG 图片', 'export.pptx': 'PowerPoint', 'export.markdown': 'Markdown',
  'export.video': '视频 MP4', 'export.ocr': 'OCR 文字',
  'export.pdf': 'PDF',
  'export.page': '页面',
  'export.rendering': '渲染中',
  'export.renderingPage': '逐页渲染中',
  'export.exporting': '导出中',
  'export.exportingByPage': '按页面导出中',
  'export.encodingMp4': 'FFmpeg 合成 MP4 中',
  'status.ready': '就绪', 'status.processing': '处理中',
  'status.htmlLoaded': 'HTML 已加载',
  'panel.collapse': '折叠',
  'panel.expand': '展开',
  'panel.dragResize': '拖动调整宽度',
  'skill.run': 'AI Agent 运行', 'skill.processing': '处理中...',
  'theme.light': '浅色', 'theme.dark': '深色', 'theme.auto': '自动',
  'lang.zh': '中文', 'lang.en': 'English',
};

const en: Dict = {
  'app.title': 'SeeHTML AI — Marketing Assistant',
  'sidebar.agents': 'Agents', 'sidebar.files': 'Files', 'sidebar.skills': 'Skills',
  'sidebar.fileTree': 'File Tree',
  'sidebar.workspace': 'Workspace',
  'sidebar.openFile': 'Open file',
  'sidebar.chooseFolder': 'Choose folder',
  'sidebar.refresh': 'Refresh',
  'sidebar.loading': 'Loading files...',
  'sidebar.empty': 'No files to show',
  'sidebar.unavailable': 'File tree is available in the Tauri desktop app',
  'sidebar.hiddenHeavy': 'Large build folders are hidden',
  'project.title': 'Project',
  'project.open': 'Open project',
  'sessions.title': 'Sessions',
  'sessions.new': 'New session',
  'sessions.current': 'Current session',
  'sessions.htmlQuality': 'HTML quality session',
  'sessions.previewExport': 'Preview and export',
  'editor.preview': 'Preview', 'editor.source': 'Source', 'editor.export': 'Export',
  'editor.savePng': 'Save PNG',
  'editor.exportOptions': 'Export Options',
  'editor.capturePng': 'Capture the current page as PNG',
  'editor.exportPptx': 'Export as PPTX file',
  'editor.exportMarkdown': 'Export as Markdown',
  'editor.exportVideo': 'Generate video from page images',
  'editor.exportPdf': 'Export as PDF',
  'editor.ocrText': 'Extract text from image',
  'editor.noSource': 'Open or generate HTML to see the source here.',
  'welcome.subtitle': 'HTML page assistant with multi-step tool calling.',
  'welcome.open': 'Open an HTML file or paste HTML content',
  'welcome.generate': 'AI generates pages from your topic',
  'welcome.preview': 'Preview renders HTML in real time',
  'welcome.export': 'Export as PNG / PPTX / Video / PDF',
  'welcome.ocr': 'Built-in OCR for image text extraction',
  'preview.emptyTitle': 'Preview',
  'preview.emptyHint': 'Choose HTML / Video / PDF / Markdown / PNG on the left, or ask the Agent to generate HTML',
  'preview.generatedHtml': 'AI Generated HTML',
  'preview.loading': 'Opening preview...',
  'preview.error': 'Preview failed',
  'preview.unsupported': 'Unsupported file type',
  'preview.welcome': 'Open HTML, video, PDF, Markdown, or PNG from the file tree, or ask the Agent to generate or edit HTML.',
  'chat.title': 'Agent', 'chat.placeholder': 'Type a message, paste an image (Ctrl+V), or attach one...',
  'chat.placeholderImage': 'Describe what to do with this image, or leave empty for auto-analysis...',
  'chat.processing': 'Processing...', 'chat.ready': 'Ready', 'chat.messages': 'msgs',
  'chat.stop': 'Stop',
  'chat.append': 'Append',
  'chat.orchestrating': 'Agent routing',
  'chat.queue': 'Queued',
  'chat.queueHint': 'Runs after this turn',
  'chat.timeout': 'Request timed out and processing was stopped. Try again with a shorter request.',
  'chat.attachImage': 'Attach image (or paste with Ctrl+V)',
  'chat.pasteImage': 'Paste image via Ctrl+V',
  'chat.cancelled': 'Cancelled.',
  'chat.opened': 'HTML opened and preview updated.',
  'chat.openedFile': 'File opened and preview updated.',
  'chat.generated': 'HTML generated and preview updated.',
  'chat.updated': 'HTML updated and preview refreshed.',
  'chat.exported': 'File exported.',
  'chat.noHtmlDocument': 'Open or generate an HTML page first.',
  'chat.noDisplayableResult': 'The request was processed, but the model did not return previewable HTML or display text.',
  'chat.imageDefault': 'Analyze this image and generate a matching HTML page.',
  'export.png': 'PNG Image', 'export.pptx': 'PowerPoint', 'export.markdown': 'Markdown',
  'export.video': 'Video MP4', 'export.ocr': 'OCR Text',
  'export.pdf': 'PDF',
  'export.page': 'Page',
  'export.rendering': 'Rendering',
  'export.renderingPage': 'Rendering page',
  'export.exporting': 'Exporting',
  'export.exportingByPage': 'Exporting by page',
  'export.encodingMp4': 'Encoding MP4 with FFmpeg',
  'status.ready': 'Ready', 'status.processing': 'Processing',
  'status.htmlLoaded': 'HTML loaded',
  'panel.collapse': 'Collapse',
  'panel.expand': 'Expand',
  'panel.dragResize': 'Drag to resize',
  'skill.run': 'AI Agent Run', 'skill.processing': 'Processing...',
  'theme.light': 'Light', 'theme.dark': 'Dark', 'theme.auto': 'Auto',
  'lang.zh': '中文', 'lang.en': 'English',
};

const translations: Translations = { zh, en };

function normalizeLang(value: string | null): Lang {
  return value === 'en' ? 'en' : 'zh';
}

let currentLang: Lang = normalizeLang(localStorage.getItem('seehtml-lang'));

export function setLanguage(l: Lang): void {
  currentLang = l;
  localStorage.setItem('seehtml-lang', l);
  window.dispatchEvent(new CustomEvent('languagechange', { detail: l }));
}

export function getLanguage(): Lang { return currentLang; }

function translate(lang: Lang, key: string): string {
  const dict = translations[lang] || translations.en;
  return dict[key] || key;
}

export function t(key: string): string {
  return translate(currentLang, key);
}

function subscribeLanguageChange(callback: () => void): () => void {
  window.addEventListener('languagechange', callback);
  return () => window.removeEventListener('languagechange', callback);
}

export function useI18n() {
  const lang = useSyncExternalStore(subscribeLanguageChange, getLanguage, getLanguage);
  const translateKey = useCallback((key: string) => translate(lang, key), [lang]);
  return {
    lang,
    setLanguage,
    t: translateKey,
  };
}
