#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "========================================"
echo "  ABCAR Dashboard — Capacitor Sync"
echo "========================================"
echo ""

# Check node
if ! command -v node &>/dev/null; then
    fail "Node.js not found — install from https://nodejs.org"
    exit 1
fi
ok "Node.js $(node --version)"

# Check npm
if ! command -v npm &>/dev/null; then
    fail "npm not found"
    exit 1
fi
ok "npm $(npm --version)"

# Install dependencies
echo ""
echo "Installing npm dependencies..."
cd "$SCRIPT_DIR"
npm install
ok "npm install complete"

# Detect Android SDK
ANDROID_SDK_CANDIDATES=(
    "$HOME/Library/Android/sdk"
    "/usr/local/share/android-sdk"
    "/opt/android-sdk"
    "$HOME/Android/Sdk"
)

SDK_FOUND=""
for candidate in "${ANDROID_SDK_CANDIDATES[@]}"; do
    if [ -d "$candidate" ]; then
        SDK_FOUND="$candidate"
        break
    fi
done

echo ""
if [ -n "$SDK_FOUND" ]; then
    export ANDROID_HOME="$SDK_FOUND"
    export PATH="$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$PATH"
    ok "Android SDK found at: $ANDROID_HOME"
else
    warn "Android SDK not found at common paths."
    warn "Set ANDROID_HOME manually before opening Android Studio:"
    warn "  export ANDROID_HOME=~/Library/Android/sdk"
fi

# Check if Android platform needs to be added (gradlew missing = fresh project)
echo ""
if [ ! -f "$SCRIPT_DIR/android/gradlew" ]; then
    warn "Gradle wrapper not found — running 'npx cap add android' to initialize platform..."
    # Back up our custom android/ files
    BACKUP_DIR="$SCRIPT_DIR/.android_backup_$$"
    mkdir -p "$BACKUP_DIR"
    cp -r "$SCRIPT_DIR/android/app/src" "$BACKUP_DIR/src" 2>/dev/null || true
    cp "$SCRIPT_DIR/android/variables.gradle" "$BACKUP_DIR/" 2>/dev/null || true
    # Remove partial android/ so Capacitor can create it fresh
    rm -rf "$SCRIPT_DIR/android"
    npx cap add android
    # Restore our custom www-asset-related files
    cp "$BACKUP_DIR/variables.gradle" "$SCRIPT_DIR/android/variables.gradle" 2>/dev/null || true
    rm -rf "$BACKUP_DIR"
    ok "Android platform initialized"
fi

# Sync Capacitor
echo ""
echo "Syncing Capacitor to Android project..."
npx cap sync android
ok "Capacitor sync complete (www/ → android/app/src/main/assets/public/)"

echo ""
echo "========================================"
echo "  Next steps"
echo "========================================"
echo ""
echo "Open in Android Studio:"
echo "  npx cap open android"
echo ""
echo "Or build debug APK directly:"
echo "  ./android/gradlew assembleDebug"
echo ""
echo "Or use the build script:"
echo "  bash BUILD-APK.sh"
echo ""
