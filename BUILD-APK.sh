#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/android"
APK_SRC="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
APK_DEST="$SCRIPT_DIR/ABCARDashboard.apk"

echo ""
echo "========================================"
echo "  ABCAR Dashboard — Build Debug APK"
echo "========================================"
echo ""

if [ ! -f "$ANDROID_DIR/gradlew" ]; then
    fail "gradlew not found at $ANDROID_DIR/gradlew — run APPLY-TO-ANDROID-STUDIO.sh first"
fi

# Detect Android SDK so gradlew can find it
ANDROID_SDK_CANDIDATES=(
    "$HOME/Library/Android/sdk"
    "/usr/local/share/android-sdk"
    "/opt/android-sdk"
    "$HOME/Android/Sdk"
)
for candidate in "${ANDROID_SDK_CANDIDATES[@]}"; do
    if [ -d "$candidate" ]; then
        export ANDROID_HOME="$candidate"
        export PATH="$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$PATH"
        break
    fi
done

if [ -z "$ANDROID_HOME" ]; then
    warn "ANDROID_HOME not set — gradle may fail if SDK is not configured in local.properties"
fi

echo "Building debug APK..."
cd "$ANDROID_DIR"
chmod +x gradlew
./gradlew assembleDebug

if [ ! -f "$APK_SRC" ]; then
    fail "Build succeeded but APK not found at expected path: $APK_SRC"
fi

cp "$APK_SRC" "$APK_DEST"
ok "APK built and copied to:"
echo "  $APK_DEST"
echo ""

# Optional ADB install
if command -v adb &>/dev/null; then
    DEVICES=$(adb devices | grep -v "List of devices" | grep "device$" | wc -l | tr -d ' ')
    if [ "$DEVICES" -gt 0 ]; then
        echo "ADB device detected ($DEVICES connected)."
        read -r -p "Install ABCARDashboard.apk on device? [y/N] " answer
        if [[ "$answer" =~ ^[Yy]$ ]]; then
            adb install -r "$APK_DEST"
            ok "APK installed on device"
        fi
    else
        warn "ADB found but no devices connected — skipping install"
    fi
else
    warn "ADB not in PATH — skipping device install option"
fi

echo ""
