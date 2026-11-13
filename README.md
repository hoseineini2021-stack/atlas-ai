# ATLAS AI

ATLAS AI is an AI-powered chat application built with React, TypeScript, Vite, and Capacitor. It brings the core website experience to Android, combining AI chat, voice interaction, file sharing, and code-editing tools in a responsive interface.

## Features

- AI chat with multiple models, including Star-2 and an optional Thinking mode
- Rich Markdown rendering with tables, links, headings, and code blocks
- Image and document attachments with automatic size optimization
- Voice recording, transcription, spoken replies, and audio playback
- Conversation history with token-saving context management
- SEARCH/REPLACE code edits with file saving and sharing
- Smooth streaming responses and an adaptive interface

## What's New in v1.5.3

| Feature | Description |
| --- | --- |
| **Star-2 and Thinking mode** | Adds the Star-2 model and an optional Thinking toggle, with a thinking indicator while the model is processing. Private reasoning is not displayed. |
| **Markdown tables and formatting** | Supports Markdown tables, column alignment, horizontal scrolling, links, horizontal rules, and headings from level 1 to 6. |
| **Image and file attachments** | Compresses images to a maximum dimension of 1024 px in JPEG format (quality 0.7), and trims unnecessary whitespace and repeated blank lines from text/code files. Supports up to 4 attachments and 20 MB per message. |
| **Voice interaction** | Record voice messages, receive speech transcription and AI replies, and play audio responses. Automatic playback can be disabled. Recordings are limited to 120 seconds. |
| **Reduced token usage** | Smart history management prioritizes recent messages, trims older large content, and keeps the latest message and two most recent files intact. |
| **SEARCH/REPLACE code editing** | Applies model-provided code changes to the original file, with options to save or share the result. Code blocks can also be saved individually. |
| **Smoother performance** | Optimizes streaming updates and delayed history saving, while keeping incomplete code blocks readable during streaming. |
| **Android build and interface improvements** | Improves microphone permission handling, fixes the three-dot menu layout, adds menu and message animations, and respects reduced-motion preferences. |

## Security

Your API key is entered in Settings and stored on your device. Never commit a real API key or other secrets to the repository.
