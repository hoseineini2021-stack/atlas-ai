import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Check, ChevronDown, ChevronLeft, CircleHelp, Code2, Copy, Edit3, ExternalLink, KeyRound,
  Menu, MessageCircle, Moon, MoreVertical, Palette, Plus, RefreshCw, Search,
  Send, Settings, Sparkles, Square, Sun, Trash2, X,
} from 'lucide-react';

type Role = 'user' | 'assistant';
type ThemeMode = 'system' | 'light' | 'dark';
type Language = 'en' | 'fa';

type ChatMessage = { id: string; role: Role; content: string; status?: 'streaming' | 'error' };
type Conversation = { id: string; title: string; messages: ChatMessage[]; updatedAt: number };

const STORAGE_CONVERSATIONS = 'atlas-conversations';
const STORAGE_ACTIVE_CHAT = 'atlas-active-chat';
const STORAGE_LEGACY_MESSAGES = 'atlas-chat-messages';
const STORAGE_API_KEY = 'atlas-api-key';
const STORAGE_STREAM = 'atlas-stream-enabled';
const STORAGE_THEME = 'atlas-theme-mode';
const STORAGE_LANGUAGE = 'atlas-language';
const STORAGE_MODEL = 'atlas-model';
const API_URL = 'https://atlas.synapt.workers.dev/v1/chat/completions';
const DEFAULT_MODEL = 'star-1';
const AVAILABLE_MODELS = ['Ai-2', 'Ai-3', 'Star-1'] as const;
const API_GUIDE_URL = 'https://atlas.synapt.workers.dev/api';
const ATLAS_LOGO = '/assets/atlas-logo.png';

const translations = {
  en: {
    welcome: 'Hi! I’m **ATLAS AI**. I can help with questions, writing, code, and ideas. What would you like to work on?',
    newChat: 'New chat', settings: 'Settings', clearMessages: 'Clear messages', history: 'Chat history',
    close: 'Close', options: 'Options', dismiss: 'Dismiss message', copy: 'Copy', copied: 'Copied',
    regenerate: 'Regenerate', edit: 'Edit', send: 'Send message', stop: 'Stop response',
    placeholder: 'Write a message…', disclaimer: 'ATLAS AI can make mistakes. Check important information.',
    search: 'Search chats', emptyHistory: 'No chats found', emptyHistoryHint: 'Try another search term.',
    rename: 'Rename chat', delete: 'Delete chat', save: 'Save', clearNotice: 'This chat was cleared.',
    copyUnavailable: 'Copy is not available on this device.', stopFirst: 'Stop the current response first.',
    enterKey: 'Enter your personal Atlas API key in Settings to start.', invalidKey: 'The API key is invalid.',
    welcomeGuide: 'To get started, grab your personal Atlas API key and add it in Settings.', getApiKey: 'Get API key',
    responseError: (status: number) => `The request failed with status ${status}.`, noResponse: 'No response was received.',
    streamUnavailable: 'Streaming responses are not available on this connection.', stopped: 'Response stopped.',
    connectionError: 'Could not connect to Atlas.', settingsSaved: 'Settings saved.',
    appearance: 'Appearance', automatic: 'System', light: 'Light', dark: 'Dark', appearanceHint: 'System follows your phone’s appearance settings.',
    language: 'Language', english: 'English', persian: 'فارسی', personalKey: 'Personal Atlas API key',
    keyHint: 'The key is stored only on this device and is not bundled into the app.', apiGuide: 'Atlas API key guide',
    streaming: 'Stream responses', streamingHint: 'Show the response as it arrives.',
    settingsSubtitle: 'Appearance, language, and connection', assistantName: 'Your AI assistant', noChat: 'Empty chat',
    renameChat: 'Rename chat', newChatHint: 'Start a fresh conversation', clearChatHint: 'Remove all messages from this chat',
    quick: ['Create a daily plan for me', 'Make this text more professional', 'Give me a business idea'],
    quickFa: ['یک برنامه روزانه برای من بساز', 'این متن را حرفه‌ای‌تر کن', 'یک ایده برای کسب‌وکار بده'],
    code: 'code',
  },
  fa: {
    welcome: 'سلام! من **ATLAS AI** هستم. برای پاسخ به سؤال‌ها، نوشتن متن، کدنویسی و ایده‌پردازی کنار شما هستم. از کجا شروع کنیم؟',
    newChat: 'گفتگوی تازه', settings: 'تنظیمات', clearMessages: 'پاک کردن پیام‌ها', history: 'تاریخچه گفتگوها',
    close: 'بستن', options: 'گزینه‌ها', dismiss: 'بستن پیام', copy: 'کپی', copied: 'کپی شد',
    regenerate: 'پاسخ دوباره', edit: 'ویرایش', send: 'ارسال پیام', stop: 'توقف پاسخ',
    placeholder: 'پیام خود را بنویسید…', disclaimer: 'ATLAS AI ممکن است اشتباه کند؛ اطلاعات مهم را بررسی کنید.',
    search: 'جست‌وجو در گفتگوها', emptyHistory: 'گفتگویی پیدا نشد', emptyHistoryHint: 'عبارت دیگری را امتحان کنید.',
    rename: 'تغییر نام گفتگو', delete: 'حذف گفتگو', save: 'ذخیره', clearNotice: 'پیام‌های این گفتگو پاک شد.',
    copyUnavailable: 'کپی کردن متن در این دستگاه در دسترس نیست.', stopFirst: 'ابتدا پاسخ در حال دریافت را متوقف کنید.',
    enterKey: 'برای شروع، کلید شخصی Atlas را در تنظیمات وارد کنید.', invalidKey: 'کلید واردشده معتبر نیست.',
    welcomeGuide: 'برای شروع، کلید شخصی API خود را از این لینک دریافت کرده و در تنظیمات وارد کنید.', getApiKey: 'دریافت کلید API',
    responseError: (status: number) => `دریافت پاسخ با خطای ${status} روبه‌رو شد.`, noResponse: 'پاسخی دریافت نشد.',
    streamUnavailable: 'امکان دریافت پاسخ پیوسته فراهم نیست.', stopped: 'پاسخ متوقف شد.',
    connectionError: 'ارتباط با Atlas برقرار نشد.', settingsSaved: 'تنظیمات ذخیره شد.',
    appearance: 'حالت نمایش', automatic: 'خودکار', light: 'روشن', dark: 'تیره', appearanceHint: 'حالت خودکار با تنظیمات ظاهر گوشی هماهنگ می‌شود.',
    language: 'زبان', english: 'English', persian: 'فارسی', personalKey: 'کلید شخصی Atlas',
    keyHint: 'کلید فقط روی همین دستگاه نگه‌داری می‌شود و داخل برنامه قرار نمی‌گیرد.', apiGuide: 'راهنمای دریافت کلید Atlas',
    streaming: 'نمایش تدریجی پاسخ', streamingHint: 'پاسخ‌ها همان لحظه و بخش‌به‌بخش ظاهر شوند.',
    settingsSubtitle: 'ظاهر، زبان و اتصال', assistantName: 'همراه هوشمند شما', noChat: 'گفتگوی خالی',
    renameChat: 'تغییر نام گفتگو', newChatHint: 'یک گفتگوی جدید شروع کنید', clearChatHint: 'همه پیام‌های این گفتگو را حذف کنید',
    quick: ['یک برنامه روزانه برای من بساز', 'این متن را حرفه‌ای‌تر کن', 'یک ایده برای کسب‌وکار بده'],
    quickFa: ['یک برنامه روزانه برای من بساز', 'این متن را حرفه‌ای‌تر کن', 'یک ایده برای کسب‌وکار بده'],
    code: 'کد',
  },
} as const;

type Copy = { [K in keyof typeof translations.en]: (typeof translations.en)[K] | (typeof translations.fa)[K] };

function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function initialMessage(language: Language): ChatMessage {
  return { id: 'welcome', role: 'assistant', content: translations[language].welcome };
}

function createConversation(language: Language): Conversation {
  return { id: makeId(), title: language === 'fa' ? 'گفتگوی تازه' : 'New chat', messages: [{ ...initialMessage(language), id: makeId() }], updatedAt: Date.now() };
}

function TypingDots({ label }: { label: string }) {
  return <span className="flex min-h-7 items-center gap-1 px-1" aria-label={label}>{[0, 1, 2].map((dot) => <i key={dot} className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400" style={{ animationDelay: `${dot * 150}ms` }} />)}</span>;
}

function formatConversationDate(timestamp: number, language: Language) {
  const date = new Date(timestamp); const today = new Date();
  return date.toDateString() === today.toDateString()
    ? new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', { hour: '2-digit', minute: '2-digit' }).format(date)
    : new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', { month: 'short', day: 'numeric' }).format(date);
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_|https?:\/\/[^\s<]+)/g);
  return <>{parts.map((part, index) => {
    const key = `${index}-${part.slice(0, 10)}`;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key} className="font-extrabold">{part.slice(2, -2)}</strong>;
    if (part.startsWith('__') && part.endsWith('__')) return <strong key={key} className="font-extrabold">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key} dir="ltr" className="rounded-md bg-slate-900/8 px-1.5 py-0.5 font-mono text-[0.86em] text-violet-700 dark:bg-white/10 dark:text-violet-200">{part.slice(1, -1)}</code>;
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return <em key={key}>{part.slice(1, -1)}</em>;
    if (/^https?:\/\//.test(part)) return <a key={key} href={part} target="_blank" rel="noreferrer" dir="ltr" className="break-all font-semibold text-blue-600 underline decoration-blue-300 underline-offset-4 transition hover:text-violet-600 dark:text-blue-300">{part}</a>;
    return <span key={key}>{part}</span>;
  })}</>;
}

function MarkdownSegment({ text }: { text: string }) {
  const lines = text.split('\n'); const blocks: ReactNode[] = []; let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { const level = heading[1].length; const classes = level === 1 ? 'text-xl font-black leading-8' : level === 2 ? 'text-lg font-extrabold leading-7' : 'text-base font-extrabold leading-7'; blocks.push(<h3 key={`heading-${index}`} className={`mt-1 ${classes}`}><InlineText text={heading[2]} /></h3>); index += 1; continue; }
    if (line.startsWith('>')) { const quotes: string[] = []; while (index < lines.length && lines[index].startsWith('>')) { quotes.push(lines[index].replace(/^>\s?/, '')); index += 1; } blocks.push(<blockquote key={`quote-${index}`} className="my-2 border-r-2 border-violet-400/80 pe-3 text-slate-600 dark:text-slate-300"><InlineText text={quotes.join('\n')} /></blockquote>); continue; }
    if (/^[-*+]\s+/.test(line)) { const items: string[] = []; while (index < lines.length && /^[-*+]\s+/.test(lines[index])) { items.push(lines[index].replace(/^[-*+]\s+/, '')); index += 1; } blocks.push(<ul key={`ul-${index}`} className="my-2 list-disc space-y-1 ps-5 marker:text-violet-500">{items.map((item, itemIndex) => <li key={itemIndex}><InlineText text={item} /></li>)}</ul>); continue; }
    if (/^\d+[.)]\s+/.test(line)) { const items: string[] = []; while (index < lines.length && /^\d+[.)]\s+/.test(lines[index])) { items.push(lines[index].replace(/^\d+[.)]\s+/, '')); index += 1; } blocks.push(<ol key={`ol-${index}`} className="my-2 list-decimal space-y-1 ps-5 marker:font-bold marker:text-violet-500">{items.map((item, itemIndex) => <li key={itemIndex}><InlineText text={item} /></li>)}</ol>); continue; }
    const paragraph: string[] = []; while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+/.test(lines[index]) && !lines[index].startsWith('>') && !/^[-*+]\s+/.test(lines[index]) && !/^\d+[.)]\s+/.test(lines[index])) { paragraph.push(lines[index]); index += 1; }
    blocks.push(<p key={`paragraph-${index}`} className="whitespace-pre-wrap break-words"><InlineText text={paragraph.join('\n')} /></p>);
  }
  return <>{blocks}</>;
}

function RichMessage({ content, messageId, onCopyCode, copiedCodeId, copy, codeLabel }: { content: string; messageId: string; onCopyCode: (value: string, id: string) => void; copiedCodeId: string | null; copy: string; codeLabel: string }) {
  const regex = /```([a-zA-Z0-9+#.-]*)\n?([\s\S]*?)```/g; const sections: ReactNode[] = []; let lastIndex = 0; let match: RegExpExecArray | null; let codeIndex = 0;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) sections.push(<MarkdownSegment key={`text-${lastIndex}`} text={content.slice(lastIndex, match.index)} />);
    const language = match[1] || codeLabel; const code = match[2].replace(/^\n|\n$/g, ''); const copyId = `code-${messageId}-${codeIndex}`;
    sections.push(<div key={copyId} className="my-3 min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-800/80 bg-[#12131d] text-left shadow-inner"><div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-3 py-2" dir="rtl"><span className="flex items-center gap-1.5 text-xs font-bold text-slate-300"><Code2 size={15} className="text-cyan-300" />{language}</span><button type="button" onClick={() => onCopyCode(code, copyId)} className="flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300">{copiedCodeId === copyId ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}{copiedCodeId === copyId ? '✓' : copy}</button></div><pre dir="ltr" className="max-w-full min-w-0 overflow-x-auto p-4 text-left text-[13px] leading-6 text-slate-100"><code className="whitespace-pre-wrap break-words sm:whitespace-pre sm:break-normal">{code}</code></pre></div>);
    lastIndex = regex.lastIndex; codeIndex += 1;
  }
  if (lastIndex < content.length) sections.push(<MarkdownSegment key={`text-${lastIndex}`} text={content.slice(lastIndex)} />);
  return <div className="space-y-2">{sections}</div>;
}

function App() {
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem(STORAGE_LANGUAGE) as Language) || 'en');
  const copy: Copy = translations[language];
  const defaultTitle = language === 'fa' ? 'گفتگوی تازه' : 'New chat';
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_CONVERSATIONS);
      if (saved) { const parsed = JSON.parse(saved) as Conversation[]; if (Array.isArray(parsed) && parsed.length) return parsed; }
      const legacy = localStorage.getItem(STORAGE_LEGACY_MESSAGES);
      if (legacy) { const messages = JSON.parse(legacy) as ChatMessage[]; if (Array.isArray(messages) && messages.length) return [{ id: makeId(), title: 'Previous chat', messages, updatedAt: Date.now() }]; }
    } catch { /* Invalid saved data should never block startup. */ }
    return [createConversation(language)];
  });
  const [activeConversationId, setActiveConversationId] = useState(() => localStorage.getItem(STORAGE_ACTIVE_CHAT) ?? '');
  const [input, setInput] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_API_KEY) ?? '');
  const [streamEnabled, setStreamEnabled] = useState(() => localStorage.getItem(STORAGE_STREAM) !== 'false');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => (localStorage.getItem(STORAGE_THEME) as ThemeMode) || 'system');
  const [model, setModel] = useState<string>(() => localStorage.getItem(STORAGE_MODEL) || DEFAULT_MODEL);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false); const [optionsOpen, setOptionsOpen] = useState(false); const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState(''); const [renamingId, setRenamingId] = useState<string | null>(null); const [renameValue, setRenameValue] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null); const [notice, setNotice] = useState<ReactNode | null>(null); const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null); const bottomRef = useRef<HTMLDivElement | null>(null); const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0];
  const messages = activeConversation?.messages ?? [initialMessage(language)];
  const filteredConversations = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase(language === 'fa' ? 'fa-IR' : 'en-US');
    return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).filter((conversation) => !query || conversation.title.toLocaleLowerCase(language === 'fa' ? 'fa-IR' : 'en-US').includes(query) || conversation.messages.some((message) => message.content.toLocaleLowerCase(language === 'fa' ? 'fa-IR' : 'en-US').includes(query)));
  }, [conversations, historyQuery, language]);

  useEffect(() => {
    const valid = conversations.some((conversation) => conversation.id === activeConversationId);
    if ((!activeConversationId || !valid) && conversations[0]) setActiveConversationId(conversations[0].id);
  }, [activeConversationId, conversations]);
  useEffect(() => { localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(conversations.map((conversation) => ({ ...conversation, messages: conversation.messages.filter((message) => message.status !== 'streaming') })))); }, [conversations]);
  useEffect(() => { if (activeConversation) localStorage.setItem(STORAGE_ACTIVE_CHAT, activeConversation.id); }, [activeConversation]);
  useEffect(() => { localStorage.setItem(STORAGE_API_KEY, apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem(STORAGE_STREAM, String(streamEnabled)); }, [streamEnabled]);
  useEffect(() => { localStorage.setItem(STORAGE_THEME, themeMode); }, [themeMode]);
  useEffect(() => { localStorage.setItem(STORAGE_MODEL, model); }, [model]);
  useEffect(() => { localStorage.setItem(STORAGE_LANGUAGE, language); document.documentElement.lang = language; document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr'; document.body.dataset.language = language; }, [language]);
  useEffect(() => { setConversations((current) => current.map((conversation) => conversation.messages.length === 1 && conversation.messages[0].role === 'assistant' && (conversation.messages[0].content === translations.en.welcome || conversation.messages[0].content === translations.fa.welcome) ? { ...conversation, title: conversation.title === 'New chat' || conversation.title === 'گفتگوی تازه' ? defaultTitle : conversation.title, messages: [{ ...conversation.messages[0], content: translations[language].welcome }] } : conversation)); }, [language, defaultTitle]);
  useEffect(() => { const media = window.matchMedia('(prefers-color-scheme: dark)'); const applyTheme = () => document.documentElement.classList.toggle('dark', themeMode === 'dark' || (themeMode === 'system' && media.matches)); applyTheme(); media.addEventListener('change', applyTheme); return () => media.removeEventListener('change', applyTheme); }, [themeMode]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!apiKey.trim()) setNotice(<span className="flex flex-wrap items-center gap-1.5">{copy.welcomeGuide}<a href={API_GUIDE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-extrabold text-violet-700 underline underline-offset-2 dark:text-violet-200">{copy.getApiKey}<ExternalLink size={13} /></a></span>); }, []);
  useEffect(() => { const textarea = textareaRef.current; if (!textarea) return; textarea.style.height = '0px'; textarea.style.height = `${Math.min(textarea.scrollHeight, 152)}px`; }, [input]);

  const updateConversationMessages = (conversationId: string, change: (current: ChatMessage[]) => ChatMessage[]) => setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, messages: change(conversation.messages), updatedAt: Date.now() } : conversation));
  const updateAssistant = (conversationId: string, id: string, change: (message: ChatMessage) => ChatMessage) => updateConversationMessages(conversationId, (current) => current.map((message) => message.id === id ? change(message) : message));
  const extractDelta = (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return '';
    const choice = (payload as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string }; text?: string }> }).choices?.[0];
    return choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? '';
  };

  const sendMessage = async (requestedText?: string, regenerate = false, editId?: string) => {
    const text = (requestedText ?? input).trim(); if (!text || sending || !activeConversation) return;
    if (!apiKey.trim()) { setSettingsOpen(true); setNotice(copy.enterKey); return; }
    const conversationId = activeConversation.id; const assistantId = makeId();
    const assistantMessage: ChatMessage = { id: assistantId, role: 'assistant', content: '', status: 'streaming' };
    const lastUserIndex = activeConversation.messages.map((message) => message.role).lastIndexOf('user');
    const editIndex = editId ? activeConversation.messages.findIndex((message) => message.id === editId) : -1;
    const userMessage: ChatMessage = { id: editId ?? makeId(), role: 'user', content: text };
    const seedMessages = editIndex >= 0
      ? activeConversation.messages.slice(0, editIndex)
      : regenerate && lastUserIndex >= 0 ? activeConversation.messages.slice(0, lastUserIndex + 1) : activeConversation.messages;
    const history = [...seedMessages.filter((message) => message.content.trim()), ...(regenerate ? [] : [userMessage])].map(({ role, content }) => ({ role, content }));
    const controller = new AbortController(); controllerRef.current = controller; setSending(true); setInput(''); setNotice(null); setEditingId(null);
    setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, title: !regenerate && (conversation.title === 'New chat' || conversation.title === 'گفتگوی تازه') ? text.slice(0, 44) : conversation.title, messages: [...seedMessages, ...(regenerate ? [] : [userMessage]), assistantMessage], updatedAt: Date.now() } : conversation));
    try {
      const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` }, body: JSON.stringify({ model: model.toLowerCase(), messages: history, stream: streamEnabled }), signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 ? copy.invalidKey : copy.responseError(response.status));
      if (!streamEnabled) { const content = extractDelta(await response.json()); updateAssistant(conversationId, assistantId, (message) => ({ ...message, content: content || copy.noResponse })); return; }
      if (!response.body) throw new Error(copy.streamUnavailable);
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let receivedText = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.trim(); if (!line || line.startsWith(':')) continue; const data = line.startsWith('data:') ? line.slice(5).trim() : line; if (data === '[DONE]') continue;
          try { const delta = extractDelta(JSON.parse(data)); if (delta) { receivedText += delta; updateAssistant(conversationId, assistantId, (message) => ({ ...message, content: receivedText })); } } catch { /* Ignore incomplete SSE records. */ }
        }
      }
      if (buffer.trim() && buffer.trim() !== '[DONE]') { try { const delta = extractDelta(JSON.parse(buffer.trim().replace(/^data:\s*/, ''))); if (delta) { receivedText += delta; updateAssistant(conversationId, assistantId, (message) => ({ ...message, content: receivedText })); } } catch { /* Empty final marker is valid. */ } }
      if (!receivedText) updateAssistant(conversationId, assistantId, (message) => ({ ...message, content: copy.noResponse }));
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') updateAssistant(conversationId, assistantId, (message) => ({ ...message, content: message.content || copy.stopped }));
      else updateAssistant(conversationId, assistantId, (message) => ({ ...message, content: error instanceof Error ? error.message : copy.connectionError, status: 'error' }));
    } finally { controllerRef.current = null; setSending(false); updateAssistant(conversationId, assistantId, (message) => ({ ...message, status: undefined })); }
  };

  const stopResponse = () => controllerRef.current?.abort();
  const startNewChat = () => { if (sending) { setNotice(copy.stopFirst); return; } const next = createConversation(language); setConversations((current) => [next, ...current]); setActiveConversationId(next.id); setHistoryOpen(false); setOptionsOpen(false); setInput(''); };
  const selectConversation = (id: string) => { if (sending && id !== activeConversation?.id) { setNotice(copy.stopFirst); return; } setActiveConversationId(id); setHistoryOpen(false); setOptionsOpen(false); };
  const deleteConversation = (id: string) => { const remaining = conversations.filter((conversation) => conversation.id !== id); if (!remaining.length) { const next = createConversation(language); setConversations([next]); setActiveConversationId(next.id); } else { setConversations(remaining); if (activeConversation?.id === id) setActiveConversationId(remaining[0].id); } setRenamingId(null); };
  const clearChat = () => { if (sending || !activeConversation) return; setConversations((current) => current.map((conversation) => conversation.id === activeConversation.id ? { ...conversation, title: defaultTitle, messages: [{ ...initialMessage(language), id: makeId() }], updatedAt: Date.now() } : conversation)); setOptionsOpen(false); setNotice(copy.clearNotice); };
  const copyText = async (value: string, id: string) => {
    try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value); else throw new Error('clipboard'); setCopiedId(id); window.setTimeout(() => setCopiedId(null), 1600); }
    catch { setNotice(copy.copyUnavailable); }
  };
  const saveRename = () => { if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; } setConversations((current) => current.map((conversation) => conversation.id === renamingId ? { ...conversation, title: renameValue.trim().slice(0, 60), updatedAt: Date.now() } : conversation)); setRenamingId(null); };
  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(undefined, false, editingId ?? undefined); } };
  const cancelEdit = () => { setEditingId(null); setInput(''); };
  const showQuickPrompts = messages.length === 1 && messages[0].content === translations.en.welcome || messages.length === 1 && messages[0].content === translations.fa.welcome;
  const quickPrompts = language === 'fa' ? copy.quickFa : copy.quick;

  return <main className="atlas-shell relative flex h-dvh overflow-hidden text-slate-900 dark:text-slate-100" data-testid="atlas-app">
    <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-500/25 blur-3xl" /><div className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-violet-500/25 blur-3xl" />
    <section className="relative mx-auto flex h-dvh w-full max-w-5xl min-h-0 flex-col border-x border-white/45 bg-white/50 shadow-2xl shadow-indigo-950/15 backdrop-blur-2xl dark:border-white/10 dark:bg-[#10121e]/62">
      <header className="glass-header flex shrink-0 items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3"><button type="button" onClick={() => setHistoryOpen(true)} className="icon-button" aria-label={copy.history}><Menu size={21} /></button><img src={ATLAS_LOGO} alt="ATLAS AI" className="h-10 w-10 shrink-0 object-contain drop-shadow-lg" /><div className="min-w-0"><h1 className="truncate text-[17px] font-black tracking-tight">ATLAS AI</h1><p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{activeConversation?.title ?? copy.assistantName}</p></div><div className="relative shrink-0"><button type="button" onClick={() => setModelMenuOpen((open) => !open)} className="flex h-8 items-center gap-1 rounded-xl border border-indigo-300/50 bg-indigo-500/10 px-2.5 text-xs font-extrabold text-indigo-700 transition hover:bg-indigo-500/15 dark:border-indigo-400/25 dark:text-indigo-200" aria-haspopup="listbox" aria-expanded={modelMenuOpen}>{model}<ChevronDown size={14} /></button>{modelMenuOpen && <><button type="button" className="fixed inset-0 z-20 cursor-default" onClick={() => setModelMenuOpen(false)} aria-label={copy.close} /><div className="glass-menu absolute start-0 top-10 z-30 w-32 p-1.5">{AVAILABLE_MODELS.map((option) => <button key={option} type="button" onClick={() => { setModel(option); setModelMenuOpen(false); }} className={`menu-action justify-between ${model === option ? 'text-indigo-600 dark:text-indigo-300' : ''}`}>{option}{model === option && <Check size={14} />}</button>)}</div></>}</div></div>
        <div className="relative"><button type="button" onClick={() => setOptionsOpen((open) => !open)} className="icon-button" aria-label={copy.options}><MoreVertical size={21} /></button>{optionsOpen && <><button type="button" className="fixed inset-0 z-20 cursor-default" onClick={() => setOptionsOpen(false)} aria-label={copy.close} /><div className="glass-menu absolute end-0 top-12 z-30 w-56 p-1.5"><button type="button" onClick={startNewChat} className="menu-action"><Plus size={17} />{copy.newChat}</button><button type="button" onClick={() => { setSettingsOpen(true); setOptionsOpen(false); }} className="menu-action"><Settings size={17} />{copy.settings}</button><button type="button" onClick={clearChat} disabled={sending} className="menu-action text-rose-600 hover:bg-rose-500/10 dark:text-rose-300"><Trash2 size={17} />{copy.clearMessages}</button></div></>}</div>
      </header>
      {notice && <div className="mx-4 mt-3 flex shrink-0 items-start gap-2 rounded-2xl border border-violet-200/70 bg-violet-50/75 px-4 py-3 text-sm font-medium leading-6 text-violet-800 shadow-sm backdrop-blur dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-100 sm:mx-6" role="status"><Sparkles className="mt-1 shrink-0 text-violet-500" size={15} /><span className="min-w-0 flex-1">{notice}</span><button type="button" onClick={() => setNotice(null)} className="shrink-0 rounded-lg p-1 hover:bg-violet-100 dark:hover:bg-white/10" aria-label={copy.dismiss}><X size={16} /></button></div>}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 sm:px-6"><div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
        {messages.map((message) => <article key={message.id} className={`group flex w-full max-w-[94%] min-w-0 gap-2.5 sm:max-w-[84%] ${message.role === 'user' ? 'ms-auto flex-row-reverse' : 'me-auto'}`}>
          {message.role === 'assistant' && <img src={ATLAS_LOGO} alt="ATLAS AI" className="mt-1 h-8 w-8 shrink-0 object-contain" />}
          <div className="min-w-0"><div className={`message-bubble text-[15px] leading-7 ${message.role === 'user' ? 'user-bubble' : message.status === 'error' ? 'error-bubble' : 'assistant-bubble'}`}>{message.content ? <RichMessage content={message.content} messageId={message.id} onCopyCode={copyText} copiedCodeId={copiedId} copy={copy.copy} codeLabel={copy.code} /> : message.status === 'streaming' ? <TypingDots label={language === 'fa' ? 'ATLAS AI در حال نوشتن است' : 'ATLAS AI is typing'} /> : null}</div>
            {message.content && <div className="mt-1.5 flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100"><button type="button" onClick={() => void copyText(message.content, message.id)} className="message-tool">{copiedId === message.id ? <Check size={14} /> : <Copy size={14} />}{copiedId === message.id ? copy.copied : copy.copy}</button>{message.role === 'assistant' && !sending && <button type="button" onClick={() => void sendMessage(messages.filter((item) => item.role === 'user').at(-1)?.content, true)} className="message-tool"><RefreshCw size={14} />{copy.regenerate}</button>}{message.role === 'user' && !sending && <button type="button" onClick={() => { setEditingId(message.id); setInput(message.content); textareaRef.current?.focus(); }} className="message-tool"><Edit3 size={14} />{copy.edit}</button>}</div>}
          </div>
        </article>)}
        {showQuickPrompts && <div className="ms-10 mt-1 flex flex-wrap gap-2">{quickPrompts.map((prompt) => <button key={prompt} type="button" onClick={() => void sendMessage(prompt)} className="rounded-2xl border border-indigo-200/70 bg-white/50 px-3 py-2 text-sm font-bold text-indigo-700 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-indigo-400 hover:bg-indigo-50 dark:border-indigo-400/25 dark:bg-white/5 dark:text-indigo-200 dark:hover:bg-indigo-500/15">{prompt}</button>)}</div>}
        <div ref={bottomRef} />
      </div></div>
      <div className="glass-composer shrink-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:px-6">{editingId && <div className="mx-auto mb-2 flex w-full max-w-3xl items-center justify-between gap-2 rounded-xl bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-200"><span className="flex items-center gap-1.5"><Edit3 size={13} />{copy.edit}</span><button type="button" onClick={cancelEdit} className="rounded-md p-1 hover:bg-indigo-500/15" aria-label={copy.close}><X size={14} /></button></div>}<div className="composer-shell mx-auto flex w-full max-w-3xl items-end gap-2 p-2"><textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={onInputKeyDown} placeholder={copy.placeholder} rows={1} disabled={sending} className="max-h-38 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] leading-6 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:placeholder:text-slate-500" aria-label={copy.placeholder} />{sending ? <button type="button" onClick={stopResponse} className="send-button bg-rose-500 shadow-rose-500/25 hover:bg-rose-600" aria-label={copy.stop}><Square size={16} fill="currentColor" /></button> : <button type="button" onClick={() => void sendMessage(undefined, false, editingId ?? undefined)} disabled={!input.trim()} className="send-button bg-gradient-to-bl from-blue-500 to-violet-600 shadow-indigo-500/30 hover:brightness-110 disabled:opacity-40" aria-label={copy.send}><Send size={19} className="-rotate-45" /></button>}</div><p className="mx-auto mt-2 max-w-3xl px-2 text-center text-xs leading-5 text-slate-400">{copy.disclaimer}</p></div>
    </section>

    {historyOpen && <div className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={copy.history}><button type="button" className="absolute inset-0 cursor-default" onClick={() => setHistoryOpen(false)} aria-label={copy.close} /><aside className="glass-drawer relative flex h-full w-[min(88%,380px)] flex-col"><div className="flex items-center justify-between border-b border-white/20 p-4 dark:border-white/10"><div className="flex items-center gap-2"><MessageCircle size={20} className="text-indigo-600 dark:text-indigo-300" /><h2 className="font-black">{copy.history}</h2></div><button type="button" onClick={() => setHistoryOpen(false)} className="icon-button h-10 w-10" aria-label={copy.close}><ChevronLeft size={21} /></button></div><div className="p-4"><button type="button" onClick={startNewChat} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-blue-500 to-violet-600 px-4 text-sm font-extrabold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110"><Plus size={18} />{copy.newChat}</button><label className="relative mt-4 block"><Search size={17} className={`pointer-events-none absolute top-3 text-slate-400 ${language === 'fa' ? 'right-3' : 'left-3'}`} /><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder={copy.search} className={`glass-input h-11 w-full py-2 ${language === 'fa' ? 'pe-3 ps-10' : 'ps-10 pe-3'} text-sm`} /></label></div><div className="flex-1 overflow-y-auto px-3 pb-5">{filteredConversations.length ? filteredConversations.map((conversation) => <div key={conversation.id} className={`group mb-1 rounded-2xl transition ${conversation.id === activeConversation?.id ? 'bg-indigo-500/15 ring-1 ring-indigo-400/25' : 'hover:bg-white/45 dark:hover:bg-white/6'}`}><div className="flex min-w-0 items-center"><button type="button" onClick={() => selectConversation(conversation.id)} className="min-w-0 flex-1 px-3 py-3 text-start"><strong className="block truncate text-sm">{conversation.title}</strong><span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">{conversation.messages.at(-1)?.content || copy.noChat}</span></button><div className="flex shrink-0 items-center pe-2"><span className="hidden text-[11px] text-slate-400 sm:block">{formatConversationDate(conversation.updatedAt, language)}</span><button type="button" onClick={() => { setRenamingId(conversation.id); setRenameValue(conversation.title); }} className="drawer-action" aria-label={copy.rename}><Edit3 size={15} /></button><button type="button" onClick={() => deleteConversation(conversation.id)} className="drawer-action hover:text-rose-600" aria-label={copy.delete}><Trash2 size={15} /></button></div></div>{renamingId === conversation.id && <form onSubmit={(event) => { event.preventDefault(); saveRename(); }} className="flex gap-2 border-t border-indigo-200/40 px-3 py-2 dark:border-white/10"><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className="glass-input h-9 min-w-0 flex-1 px-2 text-sm" /><button className="rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white">{copy.save}</button></form>}</div>) : <div className="px-4 py-12 text-center"><Search className="mx-auto mb-3 text-slate-300" size={30} /><p className="text-sm font-bold">{copy.emptyHistory}</p><p className="mt-1 text-xs leading-5 text-slate-500">{copy.emptyHistoryHint}</p></div>}</div></aside></div>}

    {settingsOpen && <div className="fixed inset-0 z-40 flex items-end bg-slate-950/45 p-0 backdrop-blur-md sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={copy.settings}><button type="button" className="absolute inset-0 cursor-default" onClick={() => setSettingsOpen(false)} aria-label={copy.close} /><div className="glass-modal relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[30px] p-5 shadow-2xl sm:max-w-lg sm:rounded-[30px] sm:p-7"><div className="mb-6 flex items-center justify-between"><div><h2 className="text-xl font-black">{copy.settings}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy.settingsSubtitle}</p></div><button type="button" onClick={() => setSettingsOpen(false)} className="icon-button" aria-label={copy.close}><X size={21} /></button></div>
      <section><div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><Palette size={17} className="text-indigo-600 dark:text-indigo-300" />{copy.appearance}</div><div className="grid grid-cols-3 gap-2">{([{ id: 'system', label: copy.automatic, icon: Palette }, { id: 'light', label: copy.light, icon: Sun }, { id: 'dark', label: copy.dark, icon: Moon }] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setThemeMode(id)} className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${themeMode === id ? 'border-indigo-400 bg-indigo-500/15 text-indigo-700 dark:text-indigo-100' : 'border-white/40 bg-white/35 text-slate-600 hover:border-indigo-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'}`} aria-pressed={themeMode === id}><Icon size={18} />{label}</button>)}</div><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{copy.appearanceHint}</p></section>
      <section className="mt-6 border-t border-slate-200/60 pt-6 dark:border-white/10"><div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><MessageCircle size={17} className="text-indigo-600 dark:text-indigo-300" />{copy.language}</div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setLanguage('en')} className={`min-h-12 rounded-2xl border text-sm font-bold ${language === 'en' ? 'border-indigo-400 bg-indigo-500/15 text-indigo-700 dark:text-indigo-100' : 'border-white/40 bg-white/35 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'}`}>{copy.english}</button><button type="button" onClick={() => setLanguage('fa')} className={`min-h-12 rounded-2xl border text-sm font-bold ${language === 'fa' ? 'border-indigo-400 bg-indigo-500/15 text-indigo-700 dark:text-indigo-100' : 'border-white/40 bg-white/35 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'}`}>{copy.persian}</button></div></section>
      <section className="mt-6 border-t border-slate-200/60 pt-6 dark:border-white/10"><label className="block" htmlFor="atlas-api-key"><span className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><KeyRound size={17} className="text-indigo-600 dark:text-indigo-300" />{copy.personalKey}</span><input id="atlas-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="ATLAS-..." autoComplete="off" dir="ltr" className="glass-input h-12 w-full px-4 text-left text-sm" /></label><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{copy.keyHint}</p><a href={API_GUIDE_URL} target="_blank" rel="noreferrer" className="mt-3 flex min-h-12 items-center gap-3 rounded-2xl border border-indigo-300/45 bg-indigo-500/10 px-4 text-sm font-bold text-indigo-700 transition hover:bg-indigo-500/15 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-indigo-400/25 dark:text-indigo-200"><CircleHelp size={19} /><span className="min-w-0">{copy.apiGuide}</span><ExternalLink className="ms-auto shrink-0" size={17} /></a></section>
      <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-white/35 bg-white/35 p-4 dark:border-white/10 dark:bg-white/5"><div className="min-w-0"><h3 className="text-sm font-bold">{copy.streaming}</h3><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{copy.streamingHint}</p></div><button type="button" onClick={() => setStreamEnabled((value) => !value)} className={`relative h-8 w-14 shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-[#202235] ${streamEnabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`} role="switch" aria-checked={streamEnabled}><span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${streamEnabled ? 'translate-x-1' : '-translate-x-5'}`} /></button></div>
      <button type="button" onClick={() => { setSettingsOpen(false); setNotice(copy.settingsSaved); }} className="mt-6 flex min-h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-l from-blue-500 to-violet-600 px-5 text-sm font-extrabold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-[#202235]">{copy.save}</button>
    </div></div>}
  </main>;
}

export default App;
