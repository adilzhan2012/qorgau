<#
.SYNOPSIS
  Запасной мост ESP32 → сайт, если браузер не открывает COM-порт.

.DESCRIPTION
  Обычно порт читает сама страница через Web Serial — кнопка «ESP32 по USB».
  Этот скрипт нужен, только если браузер не Chrome и не Edge, или если Web
  Serial отключён политикой.

  Никаких установок: System.IO.Ports входит в Windows, npm-пакет serialport
  с его нативной сборкой не нужен.

.EXAMPLE
  # посмотреть, какие порты есть
  powershell -ExecutionPolicy Bypass -File scripts\serial-bridge.ps1 -List

.EXAMPLE
  # запустить мост
  powershell -ExecutionPolicy Bypass -File scripts\serial-bridge.ps1 -Port COM5
#>

param(
  [string]$Port = "",
  [int]$Baud = 115200,
  [string]$Url = "http://localhost:3100/api/ingest",
  [switch]$List
)

$ErrorActionPreference = "Stop"

# @() matters: with a single port this is a bare string, and $available[0]
# would then return its first character instead of the port name.
$available = @([System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object)

if ($List -or -not $Port) {
  if ($available.Count -eq 0) {
    Write-Host "COM-портов не найдено. Плата подключена по USB?" -ForegroundColor Yellow
  } else {
    Write-Host "Доступные порты:" -ForegroundColor Cyan
    $available | ForEach-Object { Write-Host "  $_" }
    Write-Host ""
    Write-Host "Запуск:  .\scripts\serial-bridge.ps1 -Port $($available[0])"
  }
  return
}

if ($available -notcontains $Port) {
  Write-Host "Порт $Port не найден. Есть: $($available -join ', ')" -ForegroundColor Red
  return
}

$sp = New-Object System.IO.Ports.SerialPort $Port, $Baud, 'None', 8, 'One'
$sp.ReadTimeout = 3000
$sp.NewLine = "`n"

try {
  $sp.Open()
} catch {
  # Почти всегда причина одна и та же, поэтому называем её прямо.
  Write-Host "Не удалось открыть $Port : $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Закройте Монитор порта в Arduino IDE — порт держит только одна программа." -ForegroundColor Yellow
  return
}

Write-Host "Мост запущен: $Port -> $Url" -ForegroundColor Green
Write-Host "Остановить — Ctrl+C." -ForegroundColor DarkGray

$sent = 0
$failed = 0

try {
  while ($true) {
    try {
      $line = $sp.ReadLine()
    } catch [TimeoutException] {
      continue   # плата молчит — просто ждём дальше
    }

    $line = $line.Trim()
    if (-not $line.StartsWith("{")) { continue }   # загрузочные сообщения платы

    try {
      Invoke-RestMethod -Uri $Url -Method Post -ContentType "application/json; charset=utf-8" -Body $line -TimeoutSec 3 | Out-Null
      $sent++
      if ($sent % 25 -eq 0) { Write-Host "передано пакетов: $sent" -ForegroundColor DarkGray }
    } catch {
      $failed++
      if ($failed -eq 1) {
        Write-Host "Сайт не отвечает на $Url — запущен ли 'npm run dev'?" -ForegroundColor Yellow
      }
    }
  }
} finally {
  if ($sp.IsOpen) { $sp.Close() }
  Write-Host "`nМост остановлен. Передано пакетов: $sent" -ForegroundColor Cyan
}
