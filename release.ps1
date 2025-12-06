<#
.SYNOPSIS
    The "Do Everything" Release Script for CranixOne.
    - Loads GH_TOKEN from .env
    - Syncs with GitHub (Prevents "fetch first" errors)
    - Bumps Version
    - Builds App
    - Uploads to GitHub
#>

$ErrorActionPreference = "Stop"
$RepoURL = "https://github.com/crancorn-git/CranixOne.git"

function Write-Step { Write-Host "`n[CRANIX-AUTO] $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "[SUCCESS] $args" -ForegroundColor Green }
function Write-ErrorMsg { Write-Host "[ERROR] $args" -ForegroundColor Red }

# --- STEP 0: LOAD SECRETS ---
if (Test-Path ".env") {
    Get-Content .env | ForEach-Object {
        $parts = $_ -split '=', 2
        if ($parts.Count -eq 2) {
            $name = $parts[0].Trim()
            $value = $parts[1].Trim()
            if ($name -eq "GH_TOKEN") { 
                $env:GH_TOKEN = $value 
                Write-Host "[AUTH] Loaded GH_TOKEN from .env" -ForegroundColor Green
            }
        }
    }
}

# --- STEP 1: GIT HEALTH CHECK ---
Write-Step "Checking Git Configuration..."

if (!(Test-Path ".git")) {
    Write-Host "Initializing Git..."
    git init
}

$currentRemote = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0 -or $currentRemote -ne $RepoURL) {
    Write-Host "Fixing GitHub Remote Link..."
    if ($currentRemote) { git remote remove origin }
    git remote add origin $RepoURL
}

$currentBranch = git rev-parse --abbrev-ref HEAD
if ($currentBranch -ne "main") {
    Write-Host "Renaming branch '$currentBranch' to 'main'..."
    git branch -M main
}

# Commit local work BEFORE pulling to avoid losing it
if (git status --porcelain) {
    Write-Host "Unsaved changes detected. Auto-committing..."
    git add .
    git commit -m "feat: pre-release updates"
}

# --- NEW STEP: SYNC WITH GITHUB ---
Write-Step "Syncing with GitHub..."
try {
    # This prevents the "rejected... fetch first" error
    git pull origin main
}
catch {
    Write-ErrorMsg "Git Pull Failed! You have merge conflicts."
    Write-ErrorMsg "Please manually run 'git pull origin main', fix conflicts, then run this script again."
    exit 1
}

# --- STEP 2: BUMP VERSION ---
Write-Step "Bumping Version..."
# This updates package.json and returns vX.X.X
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

# --- STEP 4: COMMIT & PUSH ---
Write-Step "Pushing to GitHub..."

git add package.json package-lock.json
git commit -m "chore: release $newVersion"
git tag $newVersion

# Push commits first
git push origin main
# Then push the tag
git push origin $newVersion

# --- STEP 5: UPLOAD TO GITHUB ---
Write-Step "Creating GitHub Release..."

$exePath = "dist\CranixOne-Setup-$versionNum.exe"
$ymlPath = "dist\latest.yml"

if (!(Test-Path $exePath)) {
    Write-ErrorMsg "Error: File not found: '$exePath'"
    Get-ChildItem dist
    exit 1
}

try {
    Write-Host "Uploading: $exePath"
    
    # We use an array for arguments to safely handle spaces in filenames
    $ghArgs = @("release", "create", "$newVersion", "$exePath", "$ymlPath", "--title", "CranixOne $newVersion", "--generate-notes")
    
    & gh $ghArgs
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n========================================================" -ForegroundColor Magenta
        Write-Host "   RELEASE PUBLISHED! 🚀" -ForegroundColor Magenta
        Write-Host "========================================================" -ForegroundColor Magenta
        Write-Host "Version: $newVersion"
        Write-Host "Link: https://github.com/crancorn-git/CranixOne/releases/tag/$newVersion"
        Write-Host "========================================================"
    } else {
        throw "GH CLI returned error code"
    }
}
catch {
    Write-ErrorMsg "GitHub upload failed. If it was a permissions error, check your .env file."
    Write-Host "Manual Fallback Command:"
    Write-Host "gh release create $newVersion `"$exePath`" `"$ymlPath`" --generate-notes" -ForegroundColor Yellow
}