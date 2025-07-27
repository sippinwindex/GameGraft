#!/bin/bash

# Steam Integration Consolidation Implementation Script
# This script safely migrates from useSteam to useSteamConnection

echo "🚀 Starting Steam Integration Consolidation..."

# Safety: Create backup branch
echo "📦 Creating backup branch..."
git checkout -b steam-consolidation-backup
git add .
git commit -m "Backup before Steam consolidation" || echo "No changes to commit"
git checkout -b steam-consolidation

echo "✅ Created backup and working branch"

# Step 1: Update GameLibrary.jsx
echo "🔄 Updating GameLibrary.jsx..."
cp "src/front/pages/GameLibrary.jsx" "src/front/pages/GameLibrary.jsx.backup"

# Replace the import
sed -i "s/import { useSteam } from '..\/hooks\/useSteam';/import useSteamConnection from '..\/hooks\/useSteamConnection';/" src/front/pages/GameLibrary.jsx

# Replace the component import
sed -i "s/import { SteamManager } from '..\/components\/SteamManager';/import SteamManagerCORS from '..\/components\/SteamManagerCORS';/" src/front/pages/GameLibrary.jsx

# Replace SteamManager usage
sed -i "s/<SteamManager \/>/<SteamManagerCORS \/>/g" src/front/pages/GameLibrary.jsx

echo "✅ Updated GameLibrary.jsx imports"

# Step 2: Update any other files importing SteamManager
echo "🔍 Finding other SteamManager imports..."
find src/front -name "*.jsx" -exec grep -l "SteamManager[^C]" {} \; | while read file; do
    echo "  Updating $file..."
    cp "$file" "$file.backup"
    sed -i "s/SteamManager/SteamManagerCORS/g" "$file"
    sed -i "s/..\/components\/SteamManagerCORS/..\/components\/SteamManagerCORS/g" "$file"
done

echo "✅ Updated all SteamManager references"

# Step 3: Check for broken imports before deletion
echo "🔍 Checking for imports of files we're about to delete..."

# Check for steamServiceProxy imports
PROXY_IMPORTS=$(grep -r "steamServiceProxy" src/front/ || true)
if [ ! -z "$PROXY_IMPORTS" ]; then
    echo "⚠️  Found steamServiceProxy imports:"
    echo "$PROXY_IMPORTS"
    echo "❌ Cannot safely delete steamServiceProxy.js - fix these imports first"
    exit 1
fi

# Check for useSteam imports (excluding useSteamConnection)
USSTEAM_IMPORTS=$(grep -r "useSteam" src/front/ | grep -v "useSteamConnection" || true)
if [ ! -z "$USSTEAM_IMPORTS" ]; then
    echo "⚠️  Found remaining useSteam imports:"
    echo "$USSTEAM_IMPORTS"
    echo "❌ Cannot safely delete useSteam.js - fix these imports first"
    exit 1
fi

echo "✅ No problematic imports found"

# Step 4: Remove obsolete files
echo "🗑️  Removing obsolete files..."

# Remove duplicate service files
if [ -f "src/front/services/steamServiceProxy.js" ]; then
    echo "  Removing steamServiceProxy.js..."
    rm "src/front/services/steamServiceProxy.js"
fi

if [ -f "src/front/services/steamService.js.backup" ]; then
    echo "  Removing steamService.js.backup..."
    rm "src/front/services/steamService.js.backup"
fi

# Remove obsolete hook
if [ -f "src/front/hooks/useSteam.js" ]; then
    echo "  Removing useSteam.js..."
    rm "src/front/hooks/useSteam.js"
fi

# Remove obsolete component
if [ -f "src/front/components/SteamManager.jsx" ]; then
    echo "  Removing SteamManager.jsx (keeping SteamManagerCORS.jsx)..."
    rm "src/front/components/SteamManager.jsx"
fi

echo "✅ Removed obsolete files"

# Step 5: Verify remaining files
echo "📋 Verifying remaining Steam files..."
echo "Files that should remain:"
ls -la src/front/services/steamService.js 2>/dev/null && echo "  ✅ steamService.js (main service)"
ls -la src/front/hooks/useSteamConnection.js 2>/dev/null && echo "  ✅ useSteamConnection.js (main hook)"
ls -la src/front/components/SteamManagerCORS.jsx 2>/dev/null && echo "  ✅ SteamManagerCORS.jsx (main component)"
ls -la src/front/utils/steamUtils.js 2>/dev/null && echo "  ✅ steamUtils.js (utilities)"

echo ""
echo "Files that should be gone:"
ls -la src/front/services/steamServiceProxy.js 2>/dev/null && echo "  ❌ steamServiceProxy.js still exists!" || echo "  ✅ steamServiceProxy.js removed"
ls -la src/front/services/steamService.js.backup 2>/dev/null && echo "  ❌ steamService.js.backup still exists!" || echo "  ✅ steamService.js.backup removed"
ls -la src/front/hooks/useSteam.js 2>/dev/null && echo "  ❌ useSteam.js still exists!" || echo "  ✅ useSteam.js removed"
ls -la src/front/components/SteamManager.jsx 2>/dev/null && echo "  ❌ SteamManager.jsx still exists!" || echo "  ✅ SteamManager.jsx removed"

# Step 6: Check for broken imports after deletion
echo "🔍 Checking for broken imports..."

BROKEN_IMPORTS=""

# Check for broken steamServiceProxy imports
if grep -r "steamServiceProxy" src/front/ 2>/dev/null; then
    BROKEN_IMPORTS="$BROKEN_IMPORTS\n- steamServiceProxy imports found"
fi

# Check for broken steamService.js.backup imports
if grep -r "steamService.js.backup" src/front/ 2>/dev/null; then
    BROKEN_IMPORTS="$BROKEN_IMPORTS\n- steamService.js.backup imports found"
fi

# Check for broken useSteam imports
if grep -r "useSteam" src/front/ | grep -v "useSteamConnection" 2>/dev/null; then
    BROKEN_IMPORTS="$BROKEN_IMPORTS\n- useSteam imports found"
fi

# Check for broken SteamManager imports (non-CORS)
if grep -r "SteamManager" src/front/ | grep -v "SteamManagerCORS" 2>/dev/null; then
    BROKEN_IMPORTS="$BROKEN_IMPORTS\n- SteamManager (non-CORS) imports found"
fi

if [ ! -z "$BROKEN_IMPORTS" ]; then
    echo "❌ Found broken imports:"
    echo -e "$BROKEN_IMPORTS"
    echo ""
    echo "🔧 To fix manually:"
    echo "1. Replace 'useSteam' imports with 'useSteamConnection'"
    echo "2. Replace 'SteamManager' imports with 'SteamManagerCORS'"
    echo "3. Update any steamServiceProxy imports to use steamService"
    exit 1
else
    echo "✅ No broken imports found"
fi

# Step 7: Create summary
echo ""
echo "🎉 Steam Integration Consolidation Complete!"
echo ""
echo "📊 Summary:"
echo "  ✅ Removed 4 duplicate/obsolete files"
echo "  ✅ Updated GameLibrary.jsx to use useSteamConnection"
echo "  ✅ Updated all SteamManager imports to SteamManagerCORS"
echo "  ✅ No broken imports detected"
echo ""
echo "📂 Remaining Steam files:"
echo "  • src/front/services/steamService.js (main service)"
echo "  • src/front/hooks/useSteamConnection.js (main hook)"
echo "  • src/front/components/SteamManagerCORS.jsx (main component)"
echo "  • src/front/utils/steamUtils.js (utilities)"
echo ""
echo "🧪 Next steps:"
echo "1. Test Steam connection functionality"
echo "2. Test game library loading"
echo "3. Verify no console errors"
echo "4. If tests pass: git add . && git commit -m 'Consolidate Steam integration'"
echo "5. If tests fail: git checkout steam-consolidation-backup"
echo ""
echo "🚀 Consolidation completed successfully!"