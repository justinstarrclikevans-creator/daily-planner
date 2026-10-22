#!/bin/bash
set -e

# ==============================================================================
# ToDo Companion TestFlight Build & Deployment Script
# Automatically archives and deploys the iOS companion app to TestFlight
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SCHEME="ToDoCompanion"
PROJECT="ToDoCompanion.xcodeproj"
BUILD_DIR="$SCRIPT_DIR/build"
ARCHIVE_PATH="$BUILD_DIR/ToDoCompanion.xcarchive"
EXPORT_PATH="$BUILD_DIR/Exported"
UPLOAD_PLIST="$SCRIPT_DIR/UploadOptions.plist"
EXPORT_PLIST="$SCRIPT_DIR/ExportOptions.plist"

BUILD_NUMBER=$(date +%Y%m%d%H%M)
echo "🚀 Preparing TestFlight build (Build #$BUILD_NUMBER)..."

mkdir -p "$BUILD_DIR"
rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH"

# 1. Clean & Archive
echo "📦 1/2 Archiving $SCHEME..."
xcodebuild clean archive \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE_PATH" \
    CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
    -allowProvisioningUpdates

echo "✅ Archive created at $ARCHIVE_PATH"

# 2. Upload directly to TestFlight using Xcode's active Apple Developer account
echo "📤 2/2 Uploading build to TestFlight / App Store Connect..."
if xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportOptionsPlist "$UPLOAD_PLIST" \
    -allowProvisioningUpdates; then
    echo ""
    echo "=========================================================================="
    echo "🎉 TestFlight Upload Successful!"
    echo "Build #$BUILD_NUMBER has been sent to App Store Connect."
    echo "Your iPhone will receive the TestFlight update notification shortly."
    echo "=========================================================================="
else
    echo ""
    echo "⚠️ Direct CLI upload encountered an issue (usually missing App Record on App Store Connect)."
    echo ""
    echo "Exporting local IPA as fallback..."
    xcodebuild -exportArchive \
        -archivePath "$ARCHIVE_PATH" \
        -exportOptionsPlist "$EXPORT_PLIST" \
        -exportPath "$EXPORT_PATH" \
        -allowProvisioningUpdates

    echo ""
    echo "=========================================================================="
    echo "📱 NEXT STEP TO COMPLETE FIRST-TIME SETUP:"
    echo "1. Run: open \"$ARCHIVE_PATH\""
    echo "2. In Xcode Organizer, click 'Distribute App' -> 'TestFlight & App Store'"
    echo "3. If prompted to create the App Record on App Store Connect, click 'Create'"
    echo "4. Once created, all future runs of ./ship-testflight.sh will upload automatically!"
    echo "=========================================================================="
fi
