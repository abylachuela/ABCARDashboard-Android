# ABCAR LineUp Dashboard — Android App

Native Android wrapper for the ABCAR lineup management system, built with Capacitor 6.

**Server:** http://38.57.232.64:3336  
**Package:** com.dgt.abcar  
**Min SDK:** 22 (Android 5.1+)  
**Target SDK:** 34

---

## Architecture

Capacitor 6 wraps the web app in a native Android WebView, giving it access to native APIs without a full native rewrite.

```
www/          ← web source (HTML/CSS/JS)
android/      ← native Android project
  app/        ← main application module
```

## Native superpowers

- **WebSocket** — persistent connection to 38.57.232.64:3336 for real-time lineup updates
- **Offline cache** — Service Worker caches last-known lineup so the app works without connectivity
- **Native share** — system share sheet via Web Share API
- **Wake lock** — screen stays on while the lineup board is visible
- **Pull-to-refresh** — swipe down to force-reload from server
- **Vibration** — haptic feedback on lineup change alerts

---

## Setup

### Prerequisites

- Node.js 18+ and npm
- Android Studio (Hedgehog or newer)
- Android SDK 34 (installed via Android Studio SDK Manager)
- Java 17 (bundled with Android Studio)

### First-time setup

```bash
# 1. Install dependencies and sync to Android project
bash APPLY-TO-ANDROID-STUDIO.sh

# 2. Open in Android Studio
npx cap open android
```

After opening in Android Studio, let Gradle sync complete (bottom status bar), then press Run.

### Subsequent syncs (after editing www/)

```bash
bash APPLY-TO-ANDROID-STUDIO.sh
```

This runs `npm install` and `npx cap sync android` — sufficient for web-only changes.

---

## Open in Android Studio

```bash
npx cap open android
```

Or open Android Studio manually and choose **Open** → select the `android/` folder.

---

## Build APK

### Via script (easiest)

```bash
bash BUILD-APK.sh
```

Produces `ABCARDashboard.apk` in the project root. If an ADB device is connected, the script offers to install it.

### Via Android Studio

Build → Generate Signed Bundle / APK → APK → debug

### Via command line

```bash
cd android
./gradlew assembleDebug
# APK at: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Install on device

```bash
adb install -r ABCARDashboard.apk
```

Or use `BUILD-APK.sh` which prompts automatically when a device is connected.
