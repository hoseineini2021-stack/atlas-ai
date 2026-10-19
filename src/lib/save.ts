import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80) || 'atlas-file.txt';
}

/**
 * Saves a text file. In the Android app a blob download does nothing inside the WebView,
 * so there the file is written to the cache and opened in the system share sheet
 * (Save to Files / Drive / send to another app). In a browser it is a normal download.
 */
export async function saveTextFile(name: string, text: string): Promise<void> {
  const fileName = safeName(name);
  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({ path: fileName, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: fileName, files: [written.uri], dialogTitle: fileName });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
