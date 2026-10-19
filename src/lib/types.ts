export type Role = 'user' | 'assistant';
export type ThemeMode = 'system' | 'light' | 'dark';
export type Language = 'en' | 'fa';

/** A file or image attached to a user message (already compressed / minified). */
export type Attachment = {
  id: string;
  name: string;
  mime: string;
  isImage: boolean;
  /** Size of the file the user picked, in bytes. */
  originalSize: number;
  /** Size of what is actually sent (compressed image / minified text), in bytes. */
  sentSize: number;
  /** Small JPEG data URL used only to show the image inside the chat. */
  thumb?: string;
  /** Minified text content for code / text files (this is what the model receives). */
  text?: string;
  /** True when the text had to be cut to stay under the character cap. */
  truncated?: boolean;
};

export type PendingAttachment = Attachment & { status: 'processing' | 'ready' | 'error' };

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  status?: 'streaming' | 'error';
  kind?: 'welcome';
  attachments?: Attachment[];
  /** Shown while Star-2 is reasoning (the reasoning itself is never displayed). */
  thinking?: boolean;
  /** Message came from the voice section (transcript or spoken reply). */
  voice?: boolean;
};

export type Conversation = { id: string; title: string; messages: ChatMessage[]; updatedAt: number };
