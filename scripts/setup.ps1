<#
.SYNOPSIS
    One-time setup of a Windows PC for adding pictures to this gallery.

.DESCRIPTION
    Safe to run again; every step is skipped when it's already done.
    - Installs Node.js LTS, ImageMagick and Git with winget (when missing)
    - Makes an SSH deploy key for this gallery's private repo (<repo-name>_deploy) and a
      ~/.ssh/config alias (github-<repo-name>) that uses it, so no GitHub account is needed
    - Checks GitHub accepts the key; until Ryan adds it as a deploy key, prints it and stops
    - Downloads the repo into Documents\<repo-name> through that alias, so pushes use the key
    - Sets a repo-local Git name/email when none is set globally
    - Creates Documents\To_Import and an "Import Pictures" shortcut on the Desktop

    The repo name comes from "repo" in site.json next to this script's folder.
    Run it with Setup.cmd (double-click), which bypasses the script execution policy for this one run.

.PARAMETER WhatIf
    Shows what would be done without installing, generating keys, downloading or creating anything.

.PARAMETER SshDir
    Folder for the key and ssh config (default ~\.ssh). For testing.

.PARAMETER DocumentsDir
    Where the repo and To_Import go (default: the Documents folder). For testing.

.PARAMETER DesktopDir
    Where the shortcut goes (default: the Desktop). For testing.

.PARAMETER RemoteUrl
    Repo address to check and clone (default git@github-<repo-name>:<owner>/<repo-name>.git). For testing.

.EXAMPLE
    .\setup.ps1
.EXAMPLE
    .\setup.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [string]$SshDir = (Join-Path $HOME '.ssh'),
    [string]$DocumentsDir = [Environment]::GetFolderPath('MyDocuments'),
    [string]$DesktopDir = [Environment]::GetFolderPath('Desktop'),
    [string]$RemoteUrl = ''
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$SitePath = Join-Path (Split-Path $PSScriptRoot -Parent) 'site.json'
$Site = Get-Content -Raw -Path $SitePath | ConvertFrom-Json
$RepoFull = $Site.repo                       # e.g. rbrock44/kl-crafts-images
$RepoName = ($RepoFull -split '/')[-1]       # e.g. kl-crafts-images
$HostAlias = "github-$RepoName"
$KeyPath = Join-Path $SshDir "$($RepoName)_deploy"
$SshConfig = Join-Path $SshDir 'config'
if (-not $RemoteUrl) { $RemoteUrl = "git@$($HostAlias):$RepoFull.git" }
$RepoPath = Join-Path $DocumentsDir $RepoName
$ImportFolder = Join-Path $DocumentsDir 'To_Import'

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "== $Message" -ForegroundColor Cyan
}

function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-Tool([string]$Command, [string]$WingetId, [string]$Label) {
    if (Test-Command $Command) {
        Write-Host "$Label is already installed."
        return
    }
    if (-not (Test-Command 'winget')) {
        throw "winget is missing. Install 'App Installer' from the Microsoft Store, then run Setup again."
    }
    if ($PSCmdlet.ShouldProcess($Label, "winget install --id $WingetId")) {
        Write-Host "Installing $Label..."
        & winget install --id $WingetId --exact --silent --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) { throw "Installing $Label failed (winget exit code $LASTEXITCODE)." }
        Update-SessionPath
        if (-not (Test-Command $Command)) {
            Write-Warning "$Label installed, but '$Command' isn't on PATH yet. Close this window and run Setup again."
        }
    }
}

function Find-SshKeygen {
    $found = Get-Command 'ssh-keygen' -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    foreach ($candidate in @("$env:SystemRoot\System32\OpenSSH\ssh-keygen.exe", "$env:ProgramFiles\Git\usr\bin\ssh-keygen.exe")) {
        if (Test-Path $candidate) { return $candidate }
    }
    throw 'ssh-keygen is missing. Install Git (or the Windows OpenSSH client) and run Setup again.'
}

# Runs git without Windows PowerShell turning its stderr into an error; returns the exit code
function Invoke-GitQuiet([string[]]$GitArgs) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & git @GitArgs 2>&1 | Out-Null
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Show-DeployKey {
    Write-Host ''
    Write-Host '----------------------------------------------------------------' -ForegroundColor Yellow
    Write-Host 'Send this to Ryan (copy all of the line below, or take a photo):' -ForegroundColor Yellow
    Write-Host ''
    if (Test-Path "$KeyPath.pub") {
        Write-Host (Get-Content -Raw "$KeyPath.pub").Trim()
    } else {
        Write-Host "(the key will be in $KeyPath.pub)"
    }
    Write-Host ''
    Write-Host "For Ryan: GitHub -> $RepoFull -> Settings -> Deploy keys -> Add deploy key,"
    Write-Host '          paste the key, tick "Allow write access", Add key.'
    Write-Host '----------------------------------------------------------------' -ForegroundColor Yellow
}

try {
    Write-Step 'Installing tools'
    Install-Tool 'node' 'OpenJS.NodeJS.LTS' 'Node.js'
    Install-Tool 'magick' 'ImageMagick.ImageMagick' 'ImageMagick'
    Install-Tool 'git' 'Git.Git' 'Git'

    Write-Step "Making the key for $RepoFull"
    if (Test-Path $KeyPath) {
        Write-Host "The key is already there: $KeyPath"
    } elseif ($PSCmdlet.ShouldProcess($KeyPath, 'Generate an ed25519 deploy key with no passphrase')) {
        if (-not (Test-Path $SshDir)) { New-Item -ItemType Directory -Path $SshDir | Out-Null }
        $keygen = Find-SshKeygen
        # One raw argument string so the empty passphrase survives on every PowerShell version
        $arguments = "-q -t ed25519 -N `"`" -C `"$RepoName deploy key ($env:COMPUTERNAME)`" -f `"$KeyPath`""
        $process = Start-Process -FilePath $keygen -ArgumentList $arguments -NoNewWindow -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "Making the key failed (ssh-keygen exit code $($process.ExitCode))." }
        Write-Host "Made the key: $KeyPath"
    }

    $configText = ''
    if (Test-Path $SshConfig) { $configText = Get-Content -Raw $SshConfig }
    if ($configText -match "(?m)^\s*Host\s+$([regex]::Escape($HostAlias))\s*$") {
        Write-Host "The ssh config already has $HostAlias."
    } elseif ($PSCmdlet.ShouldProcess($SshConfig, "Add Host $HostAlias")) {
        if (-not (Test-Path $SshDir)) { New-Item -ItemType Directory -Path $SshDir | Out-Null }
        $identity = $KeyPath -replace '\\', '/'
        $block = @(
            '',
            "# $RepoFull deploy key (added by setup.ps1)",
            "Host $HostAlias",
            '    HostName github.com',
            '    User git',
            "    IdentityFile `"$identity`"",
            '    IdentitiesOnly yes',
            '    StrictHostKeyChecking accept-new',
            '    BatchMode yes',
            ''
        ) -join "`n"
        [IO.File]::AppendAllText($SshConfig, $block, $Utf8NoBom)
        Write-Host "Added $HostAlias to $SshConfig"
    }

    Write-Step 'Checking GitHub accepts the key'
    $env:GIT_TERMINAL_PROMPT = '0'
    if ((Invoke-GitQuiet @('ls-remote', $RemoteUrl)) -ne 0) {
        Show-DeployKey
        Write-Host ''
        Write-Host "Ryan hasn't added the key yet. Run Setup again after he does." -ForegroundColor Yellow
        exit 2
    }
    Write-Host 'GitHub accepted the key.'

    Write-Step "Downloading the pictures repo into $RepoPath"
    if (Test-Path (Join-Path $RepoPath '.git')) {
        Write-Host 'Already downloaded.'
    } elseif (Test-Path $RepoPath) {
        throw "$RepoPath exists but isn't a Git repo. Move it out of the way and run Setup again."
    } elseif ($PSCmdlet.ShouldProcess($RepoPath, "git clone $RemoteUrl")) {
        if ((Invoke-GitQuiet @('clone', '--quiet', $RemoteUrl, $RepoPath)) -ne 0) { throw "Downloading $RepoFull failed." }
        Write-Host 'Downloaded.'
    }

    Write-Step 'Setting the Git name and email'
    $globalName = & git config --global user.name
    $globalEmail = & git config --global user.email
    if ($globalName -and $globalEmail) {
        Write-Host "Git already uses $globalName <$globalEmail>."
    } elseif ($PSCmdlet.ShouldProcess($RepoPath, 'Set a repo-local Git name and email')) {
        if (-not $globalName) { & git -C $RepoPath config user.name "$($Site.title) import" }
        if (-not $globalEmail) { & git -C $RepoPath config user.email "import@$RepoName.local" }
        Write-Host "Pictures will be saved as `"$($Site.title) import`"."
    }

    Write-Step "Making the import folder $ImportFolder"
    if (Test-Path $ImportFolder) {
        Write-Host 'Already there.'
    } elseif ($PSCmdlet.ShouldProcess($ImportFolder, 'Create folder')) {
        New-Item -ItemType Directory -Path $ImportFolder | Out-Null
    }

    Write-Step 'Adding the "Import Pictures" shortcut to the Desktop'
    $shortcutPath = Join-Path $DesktopDir 'Import Pictures.lnk'
    $cmdPath = Join-Path $RepoPath 'Import Pictures.cmd'
    if ($PSCmdlet.ShouldProcess($shortcutPath, "Create shortcut to $cmdPath")) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $cmdPath
        $shortcut.WorkingDirectory = $RepoPath
        $shortcut.Description = 'Add the pictures in Documents\To_Import to the website'
        $shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,67"
        $shortcut.Save()
    }

    Write-Host ''
    Write-Host 'Setup is finished.' -ForegroundColor Green
    Write-Host "Put pictures in $ImportFolder, then double-click 'Import Pictures' on the Desktop."
    exit 0
} catch {
    Write-Host ''
    Write-Host "Setup stopped: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
