$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$rootPrefix = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://localhost:5173/')
$listener.Start()
Write-Host 'Calendar is available at http://localhost:5173/ (press Ctrl+C to stop)'
$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg' = 'image/svg+xml'
}
try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
      $target = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
      if (-not $target.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $target -PathType Leaf)) {
        $context.Response.StatusCode = 404
        $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
        $context.Response.OutputStream.Write($body, 0, $body.Length)
      } else {
        $extension = [System.IO.Path]::GetExtension($target).ToLowerInvariant()
        if ($types.ContainsKey($extension)) { $context.Response.ContentType = $types[$extension] }
        $body = [System.IO.File]::ReadAllBytes($target)
        $context.Response.ContentLength64 = $body.Length
        $context.Response.OutputStream.Write($body, 0, $body.Length)
      }
    } finally { $context.Response.Close() }
  }
} finally { $listener.Stop(); $listener.Close() }
