# Local preview server for the Balar Overseas website.
# Run:  powershell -ExecutionPolicy Bypass -File serve.ps1   then open http://localhost:5510
$root = $PSScriptRoot
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:5510/")
$l.Start()
Write-Host "Serving $root on http://localhost:5510/"
$types = @{ ".html"="text/html; charset=utf-8"; ".css"="text/css"; ".js"="application/javascript"; ".json"="application/json"; ".png"="image/png"; ".jpg"="image/jpeg"; ".svg"="image/svg+xml" }
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  if ($p -eq "") { $p = "index.html" }
  # dev only: the page can save scene exports (for the Blender render) into _export/
  if ($c.Request.HttpMethod -eq "PUT" -and $p -match '^_export/[\w.\-]+$') {
    $dir = Join-Path $root "_export"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory $dir | Out-Null }
    $fs = [IO.File]::Create((Join-Path $root $p))
    $c.Request.InputStream.CopyTo($fs)
    $fs.Close()
    $c.Response.Close()
    continue
  }
  $f = Join-Path $root $p
  if (Test-Path $f -PathType Leaf) {
    $b = [IO.File]::ReadAllBytes($f)
    $ext = [IO.Path]::GetExtension($f)
    if ($types.ContainsKey($ext)) { $c.Response.ContentType = $types[$ext] }
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
