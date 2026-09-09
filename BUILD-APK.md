# ATLAS AI — build APK without Android Studio

This project is prepared as a Capacitor Android app. The web app remains a normal Vite/React project, and GitHub Actions can build the APK in the cloud, so Android Studio is not required on your computer.

## What was changed

- Replaced the old circular logo with the new silver ATLAS emblem.
- Added the logo to the header and assistant messages.
- Added English as the default language.
- Added Persian as a second language.
- Language selection is saved on the device.
- Fixed the stored-chat selection bug when a deleted/invalid chat ID was saved.
- Improved mobile-safe layout and web-app metadata.
- Added Capacitor configuration for Android.
- Added an automated GitHub Actions workflow at `.github/workflows/build-apk.yml` that produces an installable debug APK.
- Added icon/splash source assets for Capacitor.

## Build the APK without Android Studio

1. Create a GitHub account if you do not already have one.
2. Create a **private repository** for this project.
3. Upload the contents of this folder to that repository. Do not upload any API key.
4. Open the repository's **Actions** tab.
5. Select **Build ATLAS AI APK**.
6. Click **Run workflow**.
7. Wait for the workflow to finish.
8. Open the completed workflow run and download the artifact named **ATLAS-AI-debug-apk**.
9. Extract the artifact and install `app-debug.apk` on your Android phone.

The workflow installs the Java/Android build environment in the cloud, builds the Vite app, creates the Capacitor Android project, generates the app icon from `assets/logo.png`, and runs Gradle to produce the APK.

## Local development (optional)

You only need Node.js for the web project:

```bash
npm install
npm run dev
```

To prepare Android locally, Capacitor can create the Android project with:

```bash
npm install
npm run build
npx cap add android
npx @capacitor/assets generate --android --iconBackgroundColor '#090b14' --iconBackgroundColorDark '#090b14' --splashBackgroundColor '#090b14' --splashBackgroundColorDark '#090b14'
npx cap sync android
```

Android Studio is **not** needed for the GitHub Actions route.

## API key

The app asks for the Atlas API key inside Settings. The key is stored in the device's local storage and is not hard-coded into the source. Never commit a real API key to GitHub.
