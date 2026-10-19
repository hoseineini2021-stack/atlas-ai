import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  Brain, Check, ChevronDown, ChevronLeft, CircleHelp, Copy as CopyIcon, Edit3, ExternalLink, KeyRound,
  Menu, MessageCircle, Mic, Moon, MoreVertical, Palette, Paperclip, Plus, RefreshCw, Search,
  Send, Settings, Sparkles, Square, Sun, Trash2, Volume2, VolumeX, X,
} from 'lucide-react';
import { PendingChips, MessageAttachments } from './components/Attachments';
import { RichMessage } from './components/RichMessage';
import { translations, type Copy } from './i18n';
import { collectBases } from './lib/bases';
import { ChatError, requestChat } from './lib/chat';
import { API_GUIDE_URL, ATLAS_LOGO, AVAILABLE_MODELS, DEFAULT_MODEL, MAX_ATTACHMENTS, THINKING_MODEL } from './lib/config';
import { FileError, processFile } from './lib/files';
import { buildRequestMessages } from './lib/history';
import { KEYS, persistConversations, readBool, safeSet } from './lib/storage';
import type { Attachment, ChatMessage, Conversation, Language, PendingAttachment, ThemeMode } from './lib/types';
import { playAudio, sendVoice, startRecording, stopPlayback, voiceSupported, VoiceError, type Recorder } from './lib/voice';

const LEGACY_WELCOME = [
  'Hi! I’m **ATLAS AI**. I can help with questions, writing, code, and ideas. What would you like to work on?',
  'سلام! من **ATLAS AI** هستم. برای پاسخ به سؤال‌ها، نوشتن متن، کدنویسی و ایده‌پردازی کنار شما هستم. از کجا شروع کنیم؟',
];
const isWelcome = (m: ChatMessage) => m.kind === 'welcome' || (m.role === 'assistant' && (m.content === translations.en.welcome || m.content === translations.fa.welcome || LEGACY_WELCOME.includes(m.content)));
const isDefaultTitle = (title: string) => title === 'New chat' || title === 'گفتگوی تازه';

// Voice replies (audio data) are too big for localStorage, so they live only for the session.
const audioStore = new Map<string, string>();

function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function initialMessage(language: Language): ChatMessage { return { id: 'welcome', role: 'assistant', kind: 'welcome', content: translations[language].welcome }; }
function createConversation(language: Language): Conversation {
  return { id: makeId(), title: language === 'fa' ? 'گفتگوی تازه' : 'New chat', messages: [{ ...initialMessage(language), id: makeId() }], updatedAt: Date.now() };
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function TypingDots({ label }: { label: string }) {
  return <span className="flex min-h-7 items-center gap-1 px-1" aria-label={label}>{[0, 1, 2].map((dot) => <i key={dot} className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400" style={{ animationDelay: `${dot * 150}ms` }} />)}</span>;
}

function ThinkingIndicator({ label }: { label: string }) {
  return <span className="flex min-h-7 items-center gap-2 px-1 text-sm font-bold text-violet-600 dark:text-violet-300" aria-label={label}><Brain size={17} className="animate-pulse" />{label}<TypingDots label="" /></span>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" onClick={onChange} role="switch" aria-checked={checked} aria-label={label} className={`relative h-8 w-14 shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-[#202235] ${checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
    <span className={`absolute start-1 top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-0'}`} />
  </button>;
}

function SettingRow({ title, hint, checked, onChange }: { title: string; hint: string; checked: boolean; onChange: () => void }) {
  return <div className="mt-3 flex items-center justify-between gap-4 rounded-2xl border border-white/35 bg-white/35 p-4 dark:border-white/10 dark:bg-white/5"><div className="min-w-0"><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{hint}</p></div><Toggle checked={checked} onChange={onChange} label={title} /></div>;
}

function formatConversationDate(timestamp: number, language: Language) {
  const date = new Date(timestamp); const today = new Date(); const locale = language === 'fa' ? 'fa-IR' : 'en-US';
  return date.toDateString() === today.toDateString() ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date) : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
}

function App() {
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem(KEYS.language) as Language) || 'en');
  const copy: Copy = translations[language];
  const defaultTitle = language === 'fa' ? 'گفتگوی تازه' : 'New chat';
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const saved = localStorage.getItem(KEYS.conversations);
      if (saved) { const parsed = JSON.parse(saved) as Conversation[]; if (Array.isArray(parsed) && parsed.length) return parsed; }
      const legacy = localStorage.getItem(KEYS.legacyMessages);
      if (legacy) { const messages = JSON.parse(legacy) as ChatMessage[]; if (Array.isArray(messages) && messages.length) return [{ id: makeId(), title: 'Previous chat', messages, updatedAt: Date.now() }]; }
    } catch { /* Invalid saved data should never block startup. */ }
    return [createConversation(language)];
  });
  const [activeConversationId, setActiveConversationId] = useState(() => localStorage.getItem(KEYS.activeChat) ?? '');
  const [input, setInput] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEYS.apiKey) ?? '');
  const [streamEnabled, setStreamEnabled] = useState(() => readBool(KEYS.stream, true));
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => (localStorage.getItem(KEYS.theme) as ThemeMode) || 'system');
  const [model, setModel] = useState<string>(() => { const saved = localStorage.getItem(KEYS.model) || DEFAULT_MODEL; return AVAILABLE_MODELS.find((m) => m.toLowerCase() === saved.toLowerCase()) ?? DEFAULT_MODEL; });
  const [think, setThink] = useState(() => readBool(KEYS.think, false));
  const [tokenSaver, setTokenSaver] = useState(() => readBool(KEYS.tokenSaver, true));
  const [autoPlay, setAutoPlay] = useState(() => readBool(KEYS.autoPlay, true));
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false); const [optionsOpen, setOptionsOpen] = useState(false); const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState(''); const [renamingId, setRenamingId] = useState<string | null>(null); const [renameValue, setRenameValue] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null); const [notice, setNotice] = useState<ReactNode | null>(null); const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [recState, setRecState] = useState<'idle' | 'recording'>('idle'); const [recSeconds, setRecSeconds] = useState(0); const [autoStopTick, setAutoStopTick] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null); const bottomRef = useRef<HTMLDivElement | null>(null); const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null); const recorderRef = useRef<Recorder | null>(null);

  const modelKey = model.toLowerCase(); const canThink = modelKey === THINKING_MODEL;
  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? conversations[0];
  const messages = activeConversation?.messages ?? [initialMessage(language)];
  const filteredConversations = useMemo(() => {
    const locale = language === 'fa' ? 'fa-IR' : 'en-US'; const query = historyQuery.trim().toLocaleLowerCase(locale);
    return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).filter((c) => !query || c.title.toLocaleLowerCase(locale).includes(query) || c.messages.some((m) => m.content.toLocaleLowerCase(locale).includes(query)));
  }, [conversations, historyQuery, language]);

  useEffect(() => { const valid = conversations.some((c) => c.id === activeConversationId); if ((!activeConversationId || !valid) && conversations[0]) setActiveConversationId(conversations[0].id); }, [activeConversationId, conversations]);
  // Saving is debounced and paused while a reply streams in (stringifying every chunk made long chats laggy).
  useEffect(() => { if (sending) return undefined; const id = window.setTimeout(() => persistConversations(conversations), 400); return () => window.clearTimeout(id); }, [conversations, sending]);
  useEffect(() => { if (activeConversation) safeSet(KEYS.activeChat, activeConversation.id); }, [activeConversation]);
  useEffect(() => { safeSet(KEYS.apiKey, apiKey); }, [apiKey]);
  useEffect(() => { safeSet(KEYS.stream, String(streamEnabled)); }, [streamEnabled]);
  useEffect(() => { safeSet(KEYS.theme, themeMode); }, [themeMode]);
  useEffect(() => { safeSet(KEYS.model, model); }, [model]);
  useEffect(() => { safeSet(KEYS.think, String(think)); }, [think]);
  useEffect(() => { safeSet(KEYS.tokenSaver, String(tokenSaver)); }, [tokenSaver]);
  useEffect(() => { safeSet(KEYS.autoPlay, String(autoPlay)); }, [autoPlay]);
  useEffect(() => { safeSet(KEYS.language, language); document.documentElement.lang = language; document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr'; document.body.dataset.language = language; }, [language]);
  useEffect(() => {
    setConversations((current) => current.map((c) => c.messages.length === 1 && isWelcome(c.messages[0])
      ? { ...c, title: isDefaultTitle(c.title) ? defaultTitle : c.title, messages: [{ ...c.messages[0], kind: 'welcome', content: translations[language].welcome }] } : c));
  }, [language, defaultTitle]);
  useEffect(() => { const media = window.matchMedia('(prefers-color-scheme: dark)'); const apply = () => document.documentElement.classList.toggle('dark', themeMode === 'dark' || (themeMode === 'system' && media.matches)); apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply); }, [themeMode]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: sending ? 'auto' : 'smooth', block: 'end' }); }, [messages, sending]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!apiKey.trim()) setNotice(<span className="flex flex-wrap items-center gap-1.5">{copy.welcomeGuide}<a href={API_GUIDE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-extrabold text-violet-700 underline underline-offset-2 dark:text-violet-200">{copy.getApiKey}<ExternalLink size={13} /></a></span>); }, []);
  useEffect(() => { const el = textareaRef.current; if (!el) return; el.style.height = '0px'; el.style.height = `${Math.min(el.scrollHeight, 152)}px`; }, [input]);
  useEffect(() => { if (recState !== 'recording') return undefined; const id = window.setInterval(() => setRecSeconds((s) => s + 1), 1000); return () => window.clearInterval(id); }, [recState]);
  useEffect(() => () => { recorderRef.current?.cancel(); stopPlayback(); }, []);

  const updateConversation = (conversationId: string, change: (c: Conversation) => Conversation) => setConversations((current) => current.map((c) => (c.id === conversationId ? change(c) : c)));
  const updateMessages = (conversationId: string, change: (m: ChatMessage[]) => ChatMessage[]) => updateConversation(conversationId, (c) => ({ ...c, messages: change(c.messages), updatedAt: Date.now() }));
  const updateMessage = (conversationId: string, id: string, change: (m: ChatMessage) => ChatMessage) => updateMessages(conversationId, (list) => list.map((m) => (m.id === id ? change(m) : m)));
  const getBases = useCallback(() => collectBases(activeConversation?.messages ?? []), [activeConversation]);

  const describeError = (error: unknown): string => {
    if (error instanceof ChatError) {
      if (error.code === 'invalidKey') return copy.invalidKey;
      if (error.code === 'http') return `${copy.responseError(error.status)}${error.detail ? ` ${error.detail}` : ''}`;
      if (error.code === 'noStream') return copy.streamUnavailable;
      return copy.connectionError;
    }
    return error instanceof Error ? error.message : copy.connectionError;
  };

  // ---------------- attachments ----------------
  const onFilesPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []); event.target.value = '';
    const room = Math.max(0, MAX_ATTACHMENTS - pending.length);
    if (files.length > room) setNotice(copy.attachLimit(MAX_ATTACHMENTS));
    files.slice(0, room).forEach((file) => {
      const tempId = makeId();
      setPending((cur) => [...cur, { id: tempId, name: file.name, mime: file.type, isImage: file.type.startsWith('image/'), originalSize: file.size, sentSize: 0, status: 'processing' }]);
      processFile(file)
        .then((attachment) => setPending((cur) => cur.map((p) => (p.id === tempId ? { ...attachment, status: 'ready' as const } : p))))
        .catch((error) => {
          setPending((cur) => cur.filter((p) => p.id !== tempId));
          const code = error instanceof FileError ? error.code : 'unreadable';
          setNotice(code === 'tooLarge' ? copy.fileTooLarge : code === 'unsupported' ? copy.unsupportedFile : copy.unreadableFile);
        });
    });
  };
  const removePending = (id: string) => setPending((cur) => cur.filter((p) => p.id !== id));

  // ---------------- text chat ----------------
  const sendMessage = async (opts: { text?: string; regenerate?: boolean; editId?: string } = {}) => {
    if (sending || !activeConversation) return;
    const { regenerate = false, editId } = opts;
    if (!apiKey.trim()) { setSettingsOpen(true); setNotice(copy.enterKey); return; }
    if (pending.some((p) => p.status === 'processing')) { setNotice(copy.attachWait); return; }
    const list = activeConversation.messages;
    const lastUserIndex = list.map((m) => m.role).lastIndexOf('user');
    const editIndex = editId ? list.findIndex((m) => m.id === editId) : -1;
    let text = (opts.text ?? input).trim();
    let attachments: Attachment[] = pending.filter((p) => p.status === 'ready').map(({ status: _status, ...rest }) => rest);
    if (regenerate) { const last = list[lastUserIndex]; if (!last) return; text = last.content; attachments = last.attachments ?? []; }
    else if (editIndex >= 0) attachments = [...(list[editIndex].attachments ?? []), ...attachments];
    if (!text && !attachments.length) return;

    const conversationId = activeConversation.id; const assistantId = makeId();
    const assistantMessage: ChatMessage = { id: assistantId, role: 'assistant', content: '', status: 'streaming', thinking: canThink && think };
    const userMessage: ChatMessage = { id: editId ?? makeId(), role: 'user', content: text, ...(attachments.length ? { attachments } : {}) };
    const seed = editIndex >= 0 ? list.slice(0, editIndex) : regenerate && lastUserIndex >= 0 ? list.slice(0, lastUserIndex + 1) : list;
    const apiMessages = buildRequestMessages([...seed, ...(regenerate ? [] : [userMessage])], tokenSaver, isWelcome);

    const controller = new AbortController(); controllerRef.current = controller;
    setSending(true); setInput(''); setNotice(null); setEditingId(null); setPending([]); stopPlayback(); setPlayingId(null);
    updateConversation(conversationId, (c) => ({
      ...c,
      title: !regenerate && isDefaultTitle(c.title) ? (text || attachments[0]?.name || c.title).slice(0, 44) : c.title,
      messages: [...seed, ...(regenerate ? [] : [userMessage]), assistantMessage], updatedAt: Date.now(),
    }));

    // Chunks arrive faster than React should re-render; show them at most ~20 times a second.
    let shown = ''; let timer: number | undefined;
    const flush = () => { timer = undefined; updateMessage(conversationId, assistantId, (m) => ({ ...m, content: shown, thinking: false })); };
    try {
      const full = await requestChat({
        apiKey: apiKey.trim(), model: modelKey, messages: apiMessages, stream: streamEnabled, think: canThink && think, signal: controller.signal,
        onDelta: (delta) => { shown += delta; if (timer === undefined) timer = window.setTimeout(flush, 50); },
        onThinking: () => updateMessage(conversationId, assistantId, (m) => (m.thinking || m.content ? m : { ...m, thinking: true })),
      });
      if (timer !== undefined) window.clearTimeout(timer);
      updateMessage(conversationId, assistantId, (m) => ({ ...m, content: full || shown || copy.noResponse, thinking: false }));
    } catch (error) {
      if (timer !== undefined) window.clearTimeout(timer);
      if ((error as DOMException).name === 'AbortError') updateMessage(conversationId, assistantId, (m) => ({ ...m, content: shown || m.content || copy.stopped, thinking: false }));
      else updateMessage(conversationId, assistantId, (m) => ({ ...m, content: shown ? `${shown}\n\n${describeError(error)}` : describeError(error), status: 'error', thinking: false }));
    } finally { controllerRef.current = null; setSending(false); updateMessage(conversationId, assistantId, (m) => ({ ...m, status: m.status === 'error' ? 'error' : undefined, thinking: false })); }
  };

  // ---------------- voice ----------------
  const startPlayback = (id: string) => { const url = audioStore.get(id); if (!url) return; setPlayingId(id); void playAudio(url, () => setPlayingId((cur) => (cur === id ? null : cur))); };
  const togglePlayback = (id: string) => { if (playingId === id) { stopPlayback(); setPlayingId(null); } else startPlayback(id); };

  const beginVoice = async () => {
    if (sending || recState !== 'idle' || !activeConversation) return;
    if (!apiKey.trim()) { setSettingsOpen(true); setNotice(copy.enterKey); return; }
    stopPlayback(); setPlayingId(null);
    try { recorderRef.current = await startRecording(() => setAutoStopTick((n) => n + 1)); setRecSeconds(0); setRecState('recording'); setNotice(null); }
    catch (error) { setNotice(error instanceof VoiceError && error.code === 'denied' ? copy.micDenied : copy.micUnsupported); }
  };
  const cancelVoice = () => { recorderRef.current?.cancel(); recorderRef.current = null; setRecState('idle'); };

  const finishVoice = async () => {
    const recorder = recorderRef.current; if (!recorder || !activeConversation) return;
    recorderRef.current = null; setRecState('idle');
    const blob = await recorder.stop();
    if (!blob) { setNotice(copy.voiceTooShort); return; }
    const conversationId = activeConversation.id; const userId = makeId(); const assistantId = makeId();
    const history = activeConversation.messages.filter((m) => !isWelcome(m) && m.content.trim() && m.status !== 'error').map((m) => ({ role: m.role, content: m.content.replace(/^🎤\s*/, '') }));
    const controller = new AbortController(); controllerRef.current = controller; setSending(true);
    updateMessages(conversationId, (list) => [...list, { id: userId, role: 'user', content: '🎤 …', voice: true }, { id: assistantId, role: 'assistant', content: '', status: 'streaming', voice: true }]);
    try {
      const result = await sendVoice({ blob, apiKey: apiKey.trim(), model: modelKey, lang: language, history, signal: controller.signal });
      const transcript = result.transcript || '…';
      updateConversation(conversationId, (c) => ({
        ...c, title: isDefaultTitle(c.title) ? transcript.slice(0, 44) : c.title, updatedAt: Date.now(),
        messages: c.messages.map((m) => (m.id === userId ? { ...m, content: `🎤 ${transcript}` } : m.id === assistantId ? { ...m, content: result.reply || copy.noResponse, status: undefined } : m)),
      }));
      if (result.audioUrl) { audioStore.set(assistantId, result.audioUrl); if (autoPlay) startPlayback(assistantId); }
    } catch (error) {
      const aborted = (error as DOMException).name === 'AbortError' && controller.signal.aborted && !(error instanceof VoiceError);
      updateMessages(conversationId, (list) => list.map((m) => (m.id === assistantId ? { ...m, content: aborted ? copy.stopped : `${copy.voiceFailed}${error instanceof VoiceError ? error.detail : error instanceof Error ? error.message : ''}`, status: aborted ? undefined : 'error' } : m)));
    } finally { controllerRef.current = null; setSending(false); }
  };
  useEffect(() => { if (autoStopTick > 0 && recorderRef.current) void finishVoice(); }, [autoStopTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- chat management ----------------
  const stopResponse = () => { controllerRef.current?.abort(); stopPlayback(); setPlayingId(null); };
  const startNewChat = () => { if (sending) { setNotice(copy.stopFirst); return; } const next = createConversation(language); setConversations((c) => [next, ...c]); setActiveConversationId(next.id); setHistoryOpen(false); setOptionsOpen(false); setInput(''); setPending([]); };
  const selectConversation = (id: string) => { if (sending && id !== activeConversation?.id) { setNotice(copy.stopFirst); return; } setActiveConversationId(id); setHistoryOpen(false); setOptionsOpen(false); };
  const deleteConversation = (id: string) => { const remaining = conversations.filter((c) => c.id !== id); if (!remaining.length) { const next = createConversation(language); setConversations([next]); setActiveConversationId(next.id); } else { setConversations(remaining); if (activeConversation?.id === id) setActiveConversationId(remaining[0].id); } setRenamingId(null); };
  const clearChat = () => { if (sending || !activeConversation) return; updateConversation(activeConversation.id, (c) => ({ ...c, title: defaultTitle, messages: [{ ...initialMessage(language), id: makeId() }], updatedAt: Date.now() })); setOptionsOpen(false); setNotice(copy.clearNotice); };
  const copyText = async (value: string, id: string) => {
    try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value); else throw new Error('clipboard'); setCopiedId(id); window.setTimeout(() => setCopiedId(null), 1600); }
    catch { setNotice(copy.copyUnavailable); }
  };
  const saveRename = () => { if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; } updateConversation(renamingId, (c) => ({ ...c, title: renameValue.trim().slice(0, 60), updatedAt: Date.now() })); setRenamingId(null); };
  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage({ editId: editingId ?? undefined }); } };
  const cancelEdit = () => { setEditingId(null); setInput(''); };
  const showQuickPrompts = messages.length === 1 && isWelcome(messages[0]);
  const canSend = !!input.trim() || pending.some((p) => p.status === 'ready');
  const micAvailable = voiceSupported();

  return <main className="atlas-shell relative flex h-dvh overflow-hidden text-slate-900 dark:text-slate-100" data-testid="atlas-app">
    <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-500/25 blur-3xl" /><div className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-violet-500/25 blur-3xl" />
    <section className="relative mx-auto flex h-dvh w-full max-w-5xl min-h-0 flex-col border-x border-white/45 bg-white/50 shadow-2xl shadow-indigo-950/15 backdrop-blur-2xl dark:border-white/10 dark:bg-[#10121e]/62">
      <header className="glass-header flex shrink-0 items-center justify-between px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6">
        <div className="flex min-w-0 items-center gap-3"><button type="button" onClick={() => setHistoryOpen(true)} className="icon-button" aria-label={copy.history}><Menu size={21} /></button><img src={ATLAS_LOGO} alt="ATLAS AI" className="h-10 w-10 shrink-0 object-contain drop-shadow-lg" /><div className="min-w-0"><h1 className="truncate text-[17px] font-black tracking-tight">ATLAS AI</h1><p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{activeConversation?.title ?? copy.assistantName}</p></div>
          <div className="relative shrink-0"><button type="button" onClick={() => setModelMenuOpen((open) => !open)} className="flex h-8 items-center gap-1 rounded-xl border border-indigo-300/50 bg-indigo-500/10 px-2.5 text-xs font-extrabold text-indigo-700 transition hover:bg-indigo-500/15 dark:border-indigo-400/25 dark:text-indigo-200" aria-haspopup="listbox" aria-expanded={modelMenuOpen}>{model}<ChevronDown size={14} /></button>
            {modelMenuOpen && <><button type="button" className="fixed inset-0 z-20 cursor-default" onClick={() => setModelMenuOpen(false)} aria-label={copy.close} /><div className="glass-menu absolute start-0 top-10 z-30 w-32 p-1.5">{AVAILABLE_MODELS.map((option) => <button key={option} type="button" onClick={() => { setModel(option); setModelMenuOpen(false); }} className={`menu-action justify-between ${model === option ? 'text-indigo-600 dark:text-indigo-300' : ''}`}>{option}{model === option && <Check size={14} />}</button>)}</div></>}</div></div>
        <div className="relative"><button type="button" onClick={() => setOptionsOpen((open) => !open)} className="icon-button" aria-label={copy.options}><MoreVertical size={21} /></button>{optionsOpen && <><button type="button" className="fixed inset-0 z-20 cursor-default" onClick={() => setOptionsOpen(false)} aria-label={copy.close} /><div className="glass-menu absolute end-0 top-12 z-30 w-56 p-1.5"><button type="button" onClick={startNewChat} className="menu-action"><Plus size={17} />{copy.newChat}</button><button type="button" onClick={() => { setSettingsOpen(true); setOptionsOpen(false); }} className="menu-action"><Settings size={17} />{copy.settings}</button><button type="button" onClick={clearChat} disabled={sending} className="menu-action text-rose-600 hover:bg-rose-500/10 dark:text-rose-300"><Trash2 size={17} />{copy.clearMessages}</button></div></>}</div>
      </header>
      {notice && <div className="mx-4 mt-3 flex shrink-0 items-start gap-2 rounded-2xl border border-violet-200/70 bg-violet-50/75 px-4 py-3 text-sm font-medium leading-6 text-violet-800 shadow-sm backdrop-blur dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-100 sm:mx-6" role="status"><Sparkles className="mt-1 shrink-0 text-violet-500" size={15} /><span className="min-w-0 flex-1">{notice}</span><button type="button" onClick={() => setNotice(null)} className="shrink-0 rounded-lg p-1 hover:bg-violet-100 dark:hover:bg-white/10" aria-label={copy.dismiss}><X size={16} /></button></div>}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 sm:px-6"><div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
        {messages.map((message) => <article key={message.id} className={`group flex w-full max-w-[94%] min-w-0 gap-2.5 sm:max-w-[84%] ${message.role === 'user' ? 'ms-auto flex-row-reverse' : 'me-auto'}`}>
          {message.role === 'assistant' && <img src={ATLAS_LOGO} alt="ATLAS AI" className="mt-1 h-8 w-8 shrink-0 object-contain" />}
          <div className="min-w-0 max-w-full"><div className={`message-bubble text-[15px] leading-7 ${message.role === 'user' ? 'user-bubble' : message.status === 'error' ? 'error-bubble' : 'assistant-bubble'}`}>
            {message.attachments?.length ? <MessageAttachments items={message.attachments} copy={copy} /> : null}
            {message.content ? <RichMessage content={message.content} messageId={message.id} copy={copy} copiedId={copiedId} onCopy={copyText} getBases={getBases} notify={setNotice} />
              : message.status === 'streaming' ? (message.thinking ? <ThinkingIndicator label={copy.thinking} /> : <TypingDots label={language === 'fa' ? 'ATLAS AI در حال نوشتن است' : 'ATLAS AI is typing'} />) : null}</div>
            {message.content && message.status !== 'streaming' && <div className="mt-1.5 flex flex-wrap items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
              <button type="button" onClick={() => void copyText(message.content, message.id)} className="message-tool">{copiedId === message.id ? <Check size={14} /> : <CopyIcon size={14} />}{copiedId === message.id ? copy.copied : copy.copy}</button>
              {message.role === 'assistant' && audioStore.has(message.id) && <button type="button" onClick={() => togglePlayback(message.id)} className="message-tool">{playingId === message.id ? <VolumeX size={14} /> : <Volume2 size={14} />}{playingId === message.id ? copy.stopReply : copy.playReply}</button>}
              {message.role === 'assistant' && !sending && <button type="button" onClick={() => void sendMessage({ regenerate: true })} className="message-tool"><RefreshCw size={14} />{copy.regenerate}</button>}
              {message.role === 'user' && !sending && <button type="button" onClick={() => { setEditingId(message.id); setInput(message.content.replace(/^🎤\s*/, '')); textareaRef.current?.focus(); }} className="message-tool"><Edit3 size={14} />{copy.edit}</button>}</div>}
          </div>
        </article>)}
        {showQuickPrompts && <div className="ms-10 mt-1 flex flex-wrap gap-2">{copy.quick.map((prompt) => <button key={prompt} type="button" onClick={() => void sendMessage({ text: prompt })} className="rounded-2xl border border-indigo-200/70 bg-white/50 px-3 py-2 text-sm font-bold text-indigo-700 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-indigo-400 hover:bg-indigo-50 dark:border-indigo-400/25 dark:bg-white/5 dark:text-indigo-200 dark:hover:bg-indigo-500/15">{prompt}</button>)}</div>}
        <div ref={bottomRef} />
      </div></div>

      <div className="glass-composer shrink-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:px-6">
        {editingId && <div className="mx-auto mb-2 flex w-full max-w-3xl items-center justify-between gap-2 rounded-xl bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-200"><span className="flex items-center gap-1.5"><Edit3 size={13} />{copy.edit}</span><button type="button" onClick={cancelEdit} className="rounded-md p-1 hover:bg-indigo-500/15" aria-label={copy.close}><X size={14} /></button></div>}
        {canThink && <div className="mx-auto mb-2 flex w-full max-w-3xl"><button type="button" onClick={() => setThink((v) => !v)} aria-pressed={think} title={copy.thinkHint} className={`flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-extrabold transition ${think ? 'border-violet-400 bg-violet-500/15 text-violet-700 dark:text-violet-200' : 'border-slate-300/60 bg-white/40 text-slate-500 dark:border-white/12 dark:bg-white/5 dark:text-slate-300'}`}><Brain size={15} className={think ? 'text-violet-500' : ''} />{copy.thinkToggle}<span className={`h-2 w-2 rounded-full ${think ? 'bg-violet-500' : 'bg-slate-400'}`} /></button></div>}
        <PendingChips items={pending} copy={copy} onRemove={removePending} />
        {recState === 'recording'
          ? <div className="composer-shell mx-auto flex w-full max-w-3xl items-center gap-3 p-2"><button type="button" onClick={cancelVoice} className="send-button bg-slate-500/80 shadow-none hover:bg-slate-600" aria-label={copy.cancelRecording}><X size={19} /></button>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-3 text-sm font-extrabold text-rose-600 dark:text-rose-300"><span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500/70" /><span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500" /></span><span dir="ltr" className="tabular-nums">{clock(recSeconds)}</span><span className="truncate">{copy.recording}</span></div>
            <button type="button" onClick={() => void finishVoice()} className="send-button bg-gradient-to-bl from-blue-500 to-violet-600 shadow-indigo-500/30 hover:brightness-110" aria-label={copy.sendVoice}><Send size={19} className="-rotate-45 rtl:rotate-[225deg]" /></button></div>
          : <div className="composer-shell mx-auto flex w-full max-w-3xl items-end gap-1.5 p-2">
            <input ref={fileInputRef} type="file" multiple onChange={onFilesPicked} className="hidden" />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={sending || pending.length >= MAX_ATTACHMENTS} className="icon-button shrink-0 disabled:opacity-40" aria-label={copy.attach}><Paperclip size={20} /></button>
            <textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={onInputKeyDown} placeholder={copy.placeholder} rows={1} disabled={sending} className="max-h-38 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-6 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:placeholder:text-slate-500" aria-label={copy.placeholder} />
            {micAvailable && !sending && !canSend && !editingId && <button type="button" onClick={() => void beginVoice()} className="icon-button shrink-0" aria-label={copy.voiceMessage}><Mic size={21} /></button>}
            {sending ? <button type="button" onClick={stopResponse} className="send-button bg-rose-500 shadow-rose-500/25 hover:bg-rose-600" aria-label={copy.stop}><Square size={16} fill="currentColor" /></button>
              : <button type="button" onClick={() => void sendMessage({ editId: editingId ?? undefined })} disabled={!canSend} className="send-button bg-gradient-to-bl from-blue-500 to-violet-600 shadow-indigo-500/30 hover:brightness-110 disabled:opacity-40" aria-label={copy.send}><Send size={19} className="-rotate-45 rtl:rotate-[225deg]" /></button>}
          </div>}
        <p className="mx-auto mt-2 max-w-3xl px-2 text-center text-xs leading-5 text-slate-400">{copy.disclaimer}</p>
      </div>
    </section>

    {historyOpen && <div className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={copy.history}><button type="button" className="absolute inset-0 cursor-default" onClick={() => setHistoryOpen(false)} aria-label={copy.close} /><aside className="glass-drawer relative flex h-full w-[min(88%,380px)] flex-col"><div className="flex items-center justify-between border-b border-white/20 p-4 pt-[calc(1rem+env(safe-area-inset-top))] dark:border-white/10"><div className="flex items-center gap-2"><MessageCircle size={20} className="text-indigo-600 dark:text-indigo-300" /><h2 className="font-black">{copy.history}</h2></div><button type="button" onClick={() => setHistoryOpen(false)} className="icon-button h-10 w-10" aria-label={copy.close}><ChevronLeft size={21} className="rtl:rotate-180" /></button></div><div className="p-4"><button type="button" onClick={startNewChat} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-blue-500 to-violet-600 px-4 text-sm font-extrabold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110"><Plus size={18} />{copy.newChat}</button><label className="relative mt-4 block"><Search size={17} className="pointer-events-none absolute start-3 top-3 text-slate-400" /><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder={copy.search} className="glass-input h-11 w-full py-2 pe-3 ps-10 text-sm" /></label></div><div className="flex-1 overflow-y-auto px-3 pb-5">{filteredConversations.length ? filteredConversations.map((c) => <div key={c.id} className={`group mb-1 rounded-2xl transition ${c.id === activeConversation?.id ? 'bg-indigo-500/15 ring-1 ring-indigo-400/25' : 'hover:bg-white/45 dark:hover:bg-white/6'}`}><div className="flex min-w-0 items-center"><button type="button" onClick={() => selectConversation(c.id)} className="min-w-0 flex-1 px-3 py-3 text-start"><strong className="block truncate text-sm">{c.title}</strong><span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">{c.messages.at(-1)?.content || copy.noChat}</span></button><div className="flex shrink-0 items-center pe-2"><span className="hidden text-[11px] text-slate-400 sm:block">{formatConversationDate(c.updatedAt, language)}</span><button type="button" onClick={() => { setRenamingId(c.id); setRenameValue(c.title); }} className="drawer-action" aria-label={copy.rename}><Edit3 size={15} /></button><button type="button" onClick={() => deleteConversation(c.id)} className="drawer-action hover:text-rose-600" aria-label={copy.delete}><Trash2 size={15} /></button></div></div>{renamingId === c.id && <form onSubmit={(event) => { event.preventDefault(); saveRename(); }} className="flex gap-2 border-t border-indigo-200/40 px-3 py-2 dark:border-white/10"><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className="glass-input h-9 min-w-0 flex-1 px-2 text-sm" /><button className="rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white">{copy.save}</button></form>}</div>) : <div className="px-4 py-12 text-center"><Search className="mx-auto mb-3 text-slate-300" size={30} /><p className="text-sm font-bold">{copy.emptyHistory}</p><p className="mt-1 text-xs leading-5 text-slate-500">{copy.emptyHistoryHint}</p></div>}</div></aside></div>}

    {settingsOpen && <div className="fixed inset-0 z-40 flex items-end bg-slate-950/45 p-0 backdrop-blur-md sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={copy.settings}><button type="button" className="absolute inset-0 cursor-default" onClick={() => setSettingsOpen(false)} aria-label={copy.close} /><div className="glass-modal relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[30px] p-5 shadow-2xl sm:max-w-lg sm:rounded-[30px] sm:p-7"><div className="mb-6 flex items-center justify-between"><div><h2 className="text-xl font-black">{copy.settings}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy.settingsSubtitle}</p></div><button type="button" onClick={() => setSettingsOpen(false)} className="icon-button" aria-label={copy.close}><X size={21} /></button></div>
      <section><div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><Palette size={17} className="text-indigo-600 dark:text-indigo-300" />{copy.appearance}</div><div className="grid grid-cols-3 gap-2">{([{ id: 'system', label: copy.automatic, icon: Palette }, { id: 'light', label: copy.light, icon: Sun }, { id: 'dark', label: copy.dark, icon: Moon }] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setThemeMode(id)} className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${themeMode === id ? 'border-indigo-400 bg-indigo-500/15 text-indigo-700 dark:text-indigo-100' : 'border-white/40 bg-white/35 text-slate-600 hover:border-indigo-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'}`} aria-pressed={themeMode === id}><Icon size={18} />{label}</button>)}</div><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{copy.appearanceHint}</p></section>
      <section className="mt-6 border-t border-slate-200/60 pt-6 dark:border-white/10"><div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><MessageCircle size={17} className="text-indigo-600 dark:text-indigo-300" />{copy.language}</div><div className="grid grid-cols-2 gap-2">{(['en', 'fa'] as const).map((code) => <button key={code} type="button" onClick={() => setLanguage(code)} className={`min-h-12 rounded-2xl border text-sm font-bold ${language === code ? 'border-indigo-400 bg-indigo-500/15 text-indigo-700 dark:text-indigo-100' : 'border-white/40 bg-white/35 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'}`}>{code === 'en' ? copy.english : copy.persian}</button>)}</div></section>
      <section className="mt-6 border-t border-slate-200/60 pt-6 dark:border-white/10"><label className="block" htmlFor="atlas-api-key"><span className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><KeyRound size={17} className="text-indigo-600 dark:text-indigo-300" />{copy.personalKey}</span><input id="atlas-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="ATLAS-..." autoComplete="off" dir="ltr" className="glass-input h-12 w-full px-4 text-left text-sm" /></label><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{copy.keyHint}</p><a href={API_GUIDE_URL} target="_blank" rel="noreferrer" className="mt-3 flex min-h-12 items-center gap-3 rounded-2xl border border-indigo-300/45 bg-indigo-500/10 px-4 text-sm font-bold text-indigo-700 transition hover:bg-indigo-500/15 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-indigo-400/25 dark:text-indigo-200"><CircleHelp size={19} /><span className="min-w-0">{copy.apiGuide}</span><ExternalLink className="ms-auto shrink-0" size={17} /></a></section>
      <div className="mt-5"><SettingRow title={copy.streaming} hint={copy.streamingHint} checked={streamEnabled} onChange={() => setStreamEnabled((v) => !v)} /><SettingRow title={copy.tokenSaver} hint={copy.tokenSaverHint} checked={tokenSaver} onChange={() => setTokenSaver((v) => !v)} /><SettingRow title={copy.autoPlay} hint={copy.autoPlayHint} checked={autoPlay} onChange={() => setAutoPlay((v) => !v)} /></div>
      <button type="button" onClick={() => { setSettingsOpen(false); setNotice(copy.settingsSaved); }} className="mt-6 flex min-h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-l from-blue-500 to-violet-600 px-5 text-sm font-extrabold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-[#202235]">{copy.save}</button>
    </div></div>}
  </main>;
}

export default App;
