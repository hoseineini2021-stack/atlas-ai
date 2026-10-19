// Run after `npx cap add android`. Adds the microphone permission (voice section) and sets the app version.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
const gradlePath = 'android/app/build.gradle';
const VERSION_NAME = '1.5';
const VERSION_CODE = '15';

if (!existsSync(manifestPath)) { console.error(`${manifestPath} not found — run "npx cap add android" first.`); process.exit(1); }

let manifest = readFileSync(manifestPath, 'utf8');
const permissions = ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'];
for (const permission of permissions) {
  if (manifest.includes(permission)) continue;
  manifest = manifest.replace('<application', `<uses-permission android:name="${permission}" />\n    <application`);
}
// The microphone is optional hardware: do not hide the app from devices without it.
if (!manifest.includes('android.hardware.microphone')) {
  manifest = manifest.replace('<application', '<uses-feature android:name="android.hardware.microphone" android:required="false" />\n    <application');
}
writeFileSync(manifestPath, manifest);

if (existsSync(gradlePath)) {
  let gradle = readFileSync(gradlePath, 'utf8');
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`).replace(/versionName\s+"[^"]*"/, `versionName "${VERSION_NAME}"`);
  writeFileSync(gradlePath, gradle);
}
console.log('Android project patched: microphone permission + version', VERSION_NAME);
