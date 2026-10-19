import type { Language } from './lib/types';

const en = {
  welcome: 'Hi! I’m **ATLAS AI**. I can help with questions, writing, code, and ideas. You can also send images and files, or talk to me with voice. What would you like to work on?',
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
  settingsSubtitle: 'Appearance, language, voice and connection', assistantName: 'Your AI assistant', noChat: 'Empty chat',
  quick: ['Create a daily plan for me', 'Make this text more professional', 'Give me a business idea'],
  code: 'code',
  // v1.5 — attachments
  attach: 'Attach images or files', attachLimit: (n: number) => `You can attach up to ${n} files per message.`,
  fileTooLarge: 'This file is larger than 20 MB.', unsupportedFile: 'This file type isn’t supported. Attach images or text/code files.',
  unreadableFile: 'This file could not be read.', preparing: 'Compressing…', removeAttachment: 'Remove attachment',
  attachWait: 'Please wait until your attachments are ready.', tokens: 'tokens', truncatedFile: 'shortened', imageWord: 'Image',
  // v1.5 — thinking
  thinking: 'Thinking…', thinkToggle: 'Deep thinking', thinkHint: 'Star-2 reasons before answering (slower, more accurate).',
  // v1.5 — voice
  voiceMessage: 'Voice message', recording: 'Recording…', sendVoice: 'Send voice message', cancelRecording: 'Cancel recording',
  micDenied: 'Microphone access was denied. Allow it in your phone’s app settings.', micUnsupported: 'Voice recording isn’t supported on this device.',
  voiceTooShort: 'The recording was too short. Hold on a little longer and try again.', voiceProcessing: 'Listening…',
  voiceFailed: 'The voice request failed: ', playReply: 'Play voice reply', stopReply: 'Stop voice',
  autoPlay: 'Play voice replies automatically', autoPlayHint: 'Spoken replies start as soon as they arrive.', voiceSection: 'Voice',
  // v1.5 — code & edits
  download: 'Save', editLabel: 'Suggested edits', editApply: 'Apply & save file', editNotFound: 'The original text for these edits was not found. Attach the file again.',
  editApplied: 'Edits applied', fileSaved: 'File ready', saveFailed: 'The file could not be saved.',
  // v1.5 — token saver
  tokenSaver: 'Smart token saving', tokenSaverHint: 'Sends a compact history and optimised files: fewer tokens, faster replies.',
  limit: 'Limits',
};

type Strings = typeof en;

const fa: Strings = {
  welcome: 'سلام! من **ATLAS AI** هستم. برای پاسخ به سؤال‌ها، نوشتن متن، کدنویسی و ایده‌پردازی کنار شما هستم. می‌توانید عکس و فایل بفرستید یا با صدا با من صحبت کنید. از کجا شروع کنیم؟',
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
  settingsSubtitle: 'ظاهر، زبان، صدا و اتصال', assistantName: 'همراه هوشمند شما', noChat: 'گفتگوی خالی',
  quick: ['یک برنامه روزانه برای من بساز', 'این متن را حرفه‌ای‌تر کن', 'یک ایده برای کسب‌وکار بده'],
  code: 'کد',
  attach: 'پیوست عکس یا فایل', attachLimit: (n: number) => `در هر پیام حداکثر ${n} فایل می‌توانید پیوست کنید.`,
  fileTooLarge: 'حجم این فایل بیشتر از ۲۰ مگابایت است.', unsupportedFile: 'این نوع فایل پشتیبانی نمی‌شود. عکس یا فایل متنی/کد پیوست کنید.',
  unreadableFile: 'خواندن این فایل ممکن نشد.', preparing: 'در حال فشرده‌سازی…', removeAttachment: 'حذف پیوست',
  attachWait: 'لطفاً صبر کنید تا پیوست‌ها آماده شوند.', tokens: 'توکن', truncatedFile: 'کوتاه‌شده', imageWord: 'تصویر',
  thinking: 'در حال فکر کردن…', thinkToggle: 'تفکر عمیق', thinkHint: 'Star-2 پیش از پاسخ استدلال می‌کند (کندتر، دقیق‌تر).',
  voiceMessage: 'پیام صوتی', recording: 'در حال ضبط…', sendVoice: 'ارسال پیام صوتی', cancelRecording: 'لغو ضبط',
  micDenied: 'دسترسی به میکروفون داده نشد. آن را در تنظیمات برنامه‌ی گوشی مجاز کنید.', micUnsupported: 'ضبط صدا در این دستگاه پشتیبانی نمی‌شود.',
  voiceTooShort: 'ضبط خیلی کوتاه بود. کمی طولانی‌تر صحبت کنید و دوباره امتحان کنید.', voiceProcessing: 'در حال گوش دادن…',
  voiceFailed: 'درخواست صوتی ناموفق بود: ', playReply: 'پخش پاسخ صوتی', stopReply: 'توقف صدا',
  autoPlay: 'پخش خودکار پاسخ صوتی', autoPlayHint: 'پاسخ گفتاری به‌محض رسیدن پخش می‌شود.', voiceSection: 'صدا',
  download: 'ذخیره', editLabel: 'ویرایش‌های پیشنهادی', editApply: 'اعمال و ذخیره فایل', editNotFound: 'متن اصلی این ویرایش‌ها پیدا نشد. فایل را دوباره پیوست کنید.',
  editApplied: 'ویرایش‌ها اعمال شد', fileSaved: 'فایل آماده شد', saveFailed: 'ذخیره‌ی فایل ممکن نشد.',
  tokenSaver: 'صرفه‌جویی هوشمند توکن', tokenSaverHint: 'تاریخچه‌ی فشرده و فایل‌های بهینه می‌فرستد: توکن کمتر، پاسخ سریع‌تر.',
  limit: 'محدودیت‌ها',
};

export const translations: Record<Language, Strings> = { en, fa };
export type Copy = Strings;
