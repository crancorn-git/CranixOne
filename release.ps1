<#
.SYNOPSIS
    The "Do Everything" Release Script for CranixOne (Fixed for Spaces).
#>

$ErrorActionPreference = "Stop"
$RepoURL = "https://github.com/crancorn-git/CranixOne.git"

function Write-Step { Write-Host "`n[CRANIX-AUTO] $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "[SUCCESS] $args" -ForegroundColor Green }
function Write-ErrorMsg { Write-Host "[ERROR] $args" -ForegroundColor Red }

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

if (git status --porcelain) {
    Write-Host "Unsaved changes detected. Auto-committing..."
    git add .
    git commit -m "feat: pre-release updates"
}

# --- STEP 2: BUMP VERSION ---
Write-Step "Bumping Version..."
$newVersion = npm version patch --no-git-tag-version
$versionNum = $newVersion -replace "v",""
Write-Success "Target Version: $newVersion"

# --- STEP 3: BUILD ---
Write-Step "Building Electron App..."
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

git push -u origin main
git push origin $newVersion

# --- STEP 5: UPLOAD TO GITHUB ---
Write-Step "Creating GitHub Release..."

# QUOTES ARE CRITICAL HERE FOR POWERSHELL
$exePath = "dist\CranixOne Setup $versionNum.exe"
$ymlPath = "dist\latest.yml"

if (!(Test-Path $exePath)) {
    Write-ErrorMsg "Error: File not found: '$exePath'"
    # List directory to show what IS there for debugging
    Get-ChildItem dist
    exit 1
}

try {
    # Using specific arguments array to handle spaces correctly
    Write-Host "Uploading: $exePath"
    
    # Create the release AND upload assets in one go
    # We use Start-Process to avoid PowerShell parsing issues with spaces
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
    Write-ErrorMsg "GitHub upload failed. Try running this manually:"
    Write-Host "gh release create $newVersion `"$exePath`" `"$ymlPath`" --generate-notes" -ForegroundColor Yellow
}