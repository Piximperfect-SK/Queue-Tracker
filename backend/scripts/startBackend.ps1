# Starts backend server in background with required env vars
param(
  [string]$mongo = 'mongodb+srv://Admin:QTPortal2026@queue-tracker-database.qltfavm.mongodb.net/?appName=Queue-Tracker-Database',
  [string]$reg = 'cul1na',
  [string]$jwt = 'c76dd33f780d1aa9690477dfcd32a513d1289c8e3d6250ef4941350f6165f6eb'
)

$startInfo = @{ 
  FilePath = 'node'
  ArgumentList = 'server.js'
  WorkingDirectory = Split-Path -Parent $MyInvocation.MyCommand.Definition
  WindowStyle = 'Hidden'
  }

$env:MONGODB_URI = $mongo
$env:REGISTRATION_SECRET = $reg
$env:JWT_SECRET = $jwt

Start-Process @startInfo | Out-Null
Write-Host 'Backend started (background) with provided env vars.'
