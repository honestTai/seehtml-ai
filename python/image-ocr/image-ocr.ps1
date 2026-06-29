param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $RemainingArgs
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ocrScript = Join-Path $scriptDir "ocr_image.py"

function Has-Flag {
    param([string] $Name)
    return $RemainingArgs -contains $Name
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = @($machinePath, $userPath, $env:Path) -join ";"
}

function Install-WithWinget {
    param(
        [string] $PackageId,
        [string] $Label
    )

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($null -eq $winget) {
        throw "winget is required for automatic Windows dependency installation."
    }

    $wingetArgs = @(
        "install",
        "--id", $PackageId,
        "--exact",
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--silent"
    )

    if (Has-Flag "--dry-run") {
        Write-Host "[dry-run] winget $($wingetArgs -join ' ')"
        return
    }

    Write-Host "Installing $Label with winget..."
    & $winget.Source @wingetArgs
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$launchers = @(
    @{ Command = "python"; Args = @() },
    @{ Command = "py"; Args = @("-3") },
    @{ Command = "python3"; Args = @() }
)

foreach ($launcher in $launchers) {
    $command = Get-Command $launcher.Command -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        continue
    }

    & $command.Source @($launcher.Args) $ocrScript @RemainingArgs
    exit $LASTEXITCODE
}

if (Has-Flag "--install-deps") {
    Install-WithWinget -PackageId "Python.Python.3.14" -Label "Python 3"
    Refresh-Path

    foreach ($launcher in $launchers) {
        $command = Get-Command $launcher.Command -ErrorAction SilentlyContinue
        if ($null -eq $command) {
            continue
        }

        & $command.Source @($launcher.Args) $ocrScript @RemainingArgs
        exit $LASTEXITCODE
    }

    [Console]::Error.WriteLine("image-ocr: Python installation finished, but Python is not visible on PATH in this terminal.")
    [Console]::Error.WriteLine("Restart the terminal, then rerun image-ocr --install-deps --doctor.")
    exit 127
}

[Console]::Error.WriteLine("image-ocr: Python 3 is required but was not found on PATH.")
[Console]::Error.WriteLine("")
[Console]::Error.WriteLine("Install Python 3 from https://www.python.org/downloads/windows/ and enable `"Add python.exe to PATH`".")
[Console]::Error.WriteLine("Or rerun with automatic dependency installation:")
[Console]::Error.WriteLine("  image-ocr --install-deps --doctor")
[Console]::Error.WriteLine("")
[Console]::Error.WriteLine("After installing Python, run:")
[Console]::Error.WriteLine("  image-ocr --doctor")
exit 127
