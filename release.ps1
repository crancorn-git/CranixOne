<#
.SYNOPSIS
    The "Do Everything" Release Script for CranixOne.
.DESCRIPTION
    1. Fixes Git remotes and branch names.
    2. Auto-commits any unsaved work.
    3. Bumps version.
    4. Builds .exe.
    5. Pushes to GitHub.
    6. Publishes Release.
#>

$ErrorActionPreference = "Stop"
$RepoURL = "https://github.com/crancorn-git/CranixOne.git"

function Write-Step { Write-Host "`n[CRANIX-AUTO] $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "[SUCCESS] $args" -ForegroundColor Green }
function Write-ErrorMsg { Write-Host "[ERROR] $args" -ForegroundColor Red }

# --- STEP 1: GIT HEALTH CHECK ---
Write-Step "Checking Git Configuration..."

# 1. Initialize if needed
if (!(Test-Path ".git")) {
    Write-Host "Initializing Git..."
    git init
}

# 2. Fix Remote Origin
$currentRemote = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0 -or $currentRemote -ne $RepoURL) {
    Write-Host "Fixing GitHub Remote Link..."
    if ($currentRemote) { git remote remove origin }
    git remote add origin $RepoURL
}

# 3. Fix Branch Name (Force 'main')
$currentBranch = git rev-parse --abbrev-ref HEAD
if ($currentBranch -ne "main") {
    Write-Host "Renaming branch '$currentBranch' to 'main'..."
    git branch -M main
}

# 4. Auto-Commit Dirty Work
if (git status --porcelain) {
    Write-Host "Unsaved changes detected. Auto-committing..."
    git add .
    git commit -m "feat: pre-release updates"
}

# --- STEP 2: BUMP VERSION ---
Write-Step "Bumping Version..."
# This updates package.json
$newVersion = npm version patch --no-git-tag-version
$versionNum = $newVersion -replace "v",""
Write-Success "Target Version: $newVersion"

# --- STEP 3: BUILD ---
Write-Step "Building Electron App (This takes 1-2 mins)..."
try {
    npm run dist
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
}
catch {
    Write-ErrorMsg "Build crashed. Reverting version..."
    git checkout package.json package-lock.json
    exit 1
}
Write-Success "Build Complete."

# --- STEP 4: COMMIT RELEASE & PUSH ---
Write-Step "Pushing to GitHub..."

git add package.json package-lock.json
git commit -m "chore: release $newVersion"
git tag $newVersion

# Push Code and Tags
git push -u origin main
git push origin $newVersion

# --- STEP 5: UPLOAD TO GITHUB ---
Write-Step "Creating GitHub Release..."

$exePath = "dist\CranixOne Setup $versionNum.exe"
$ymlPath = "dist\latest.yml"

if (!(Test-Path $exePath)) {
    Write-ErrorMsg "Error: .exe not found at $exePath"
    exit 1
}

# Create Release using GitHub CLI
try {
    # --generate-notes automatically fills in the changelog based on commits
    gh release create $newVersion $exePath $ymlPath --title "CranixOne $newVersion" --generate-notes
    
    Write-Host "`n========================================================" -ForegroundColor Magenta
    Write-Host "   RELEASE PUBLISHED! 🚀" -ForegroundColor Magenta
    Write-Host "========================================================" -ForegroundColor Magenta
    Write-Host "Version: $newVersion"
    Write-Host "Link: https://github.com/crancorn-git/CranixOne/releases/tag/$newVersion"
    Write-Host "========================================================"
}
catch {
    Write-ErrorMsg "GitHub upload failed. Make sure you ran 'gh auth login'."
}