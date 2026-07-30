import { Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Cross-platform message box.
 *
 * `alert()` is a browser global. On React Native it exists but is a no-op shim
 * on iOS, so every validation message the app relies on -- "add at least one
 * beneficiary", "percentages must add up to 100%" -- would simply never appear
 * and the user would tap Next and see nothing happen.
 */
export function notify(message: string, title = 'Will Writer'): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(message);
  } else {
    Alert.alert(title, message);
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * pdf-lib hands back raw bytes and expo-file-system wants base64. Neither
 * `btoa` nor `Buffer` is reliably present in the Hermes runtime, so the
 * conversion is done by hand.
 */
function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

/**
 * Gets the finished will in front of the user.
 *
 * On the web that means a download. On iOS there is no download folder to
 * download to, so the PDF is written to the app's cache and handed to the
 * system share sheet -- which gives Print, Save to Files, Mail and AirDrop for
 * free, and is also the route by which a user gets the file onto a printer.
 * The cache directory is used rather than documents because the file is
 * disposable: the will itself is the saved answers, not this render of them.
 */
export async function deliverPdf(bytes: Uint8Array, filename: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }

  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, toBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });

  if (!(await Sharing.isAvailableAsync())) {
    notify(
      `Your will has been saved to the app's files as ${filename}, but this device cannot open the share sheet.`,
    );
    return;
  }

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: 'Your will',
  });
}
