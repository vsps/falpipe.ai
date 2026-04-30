param([string]$Version)

$current = (Get-Content package.json | ConvertFrom-Json).version

if (-not $Version) {
    Write-Host $current
    exit 0
}

$pkg = Get-Content package.json | ConvertFrom-Json
$pkg.version = $Version
$pkg | ConvertTo-Json -Depth 10 | Set-Content package.json

(Get-Content src-tauri/Cargo.toml) -replace '^version = ".*"', "version = `"$Version`"" |
    Set-Content src-tauri/Cargo.toml

$conf = Get-Content src-tauri/tauri.conf.json | ConvertFrom-Json
$conf.version = $Version
$conf | ConvertTo-Json -Depth 10 | Set-Content src-tauri/tauri.conf.json

npm run tauri build
