# tests.ps1
# Pokreni: powershell -ExecutionPolicy Bypass -File .\tests.ps1
# Server mora vec raditi na http://localhost:3000

$base = "http://localhost:3000"

function Call($method, $url, $body = $null) {
  $params = @{
    Method      = $method
    Uri         = $url
    ContentType = "application/json"
  }
  if ($body -ne $null) {
    $params.Body = ($body | ConvertTo-Json -Depth 10)
  }

  try {
    $res = Invoke-RestMethod @params
    return @{ ok=$true; data=$res }
  } catch {
    $resp = $_.Exception.Response
    if ($resp -ne $null) {
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $text = $reader.ReadToEnd()
      return @{ ok=$false; status=[int]$resp.StatusCode; raw=$text }
    }
    return @{ ok=$false; status=0; raw=$_.Exception.Message }
  }
}

Write-Host "TEST 1: Kreiranje scenarija"
$t1 = Call "POST" "$base/api/scenarios" @{ title="Moj prvi scenarij" }
if (-not $t1.ok) { Write-Host "FAIL: $($t1.status) $($t1.raw)"; exit 1 }
$scenarioId = $t1.data.id
Write-Host "OK: scenarioId=$scenarioId"

Write-Host "`nTEST 2: Ucitavanje scenarija"
$t2 = Call "GET" "$base/api/scenarios/$scenarioId"
if (-not $t2.ok) { Write-Host "FAIL: $($t2.status) $($t2.raw)"; exit 1 }
Write-Host "OK: title=$($t2.data.title)"

Write-Host "`nTEST 3: Lock linije (uspjesno)"
$t3 = Call "POST" "$base/api/scenarios/$scenarioId/lines/1/lock" @{ userId=1 }
if (-not $t3.ok) { Write-Host "FAIL: $($t3.status) $($t3.raw)"; exit 1 }
Write-Host "OK: $($t3.data.message)"

Write-Host "`nTEST 4: Lock linije (konflikt, drugi user)"
$t4 = Call "POST" "$base/api/scenarios/$scenarioId/lines/1/lock" @{ userId=2 }
if ($t4.ok) { Write-Host "FAIL: trebao je 409"; exit 1 }
if ($t4.status -ne 409) { Write-Host "FAIL: status=$($t4.status) raw=$($t4.raw)"; exit 1 }
Write-Host "OK: konflikt 409"

Write-Host "`nTEST 5: Update linije (kratka) - mora uspjeti za user 1"
$t5 = Call "PUT" "$base/api/scenarios/$scenarioId/lines/1" @{ userId=1; newText=@("INT. KUHINJA - DAY") }
if (-not $t5.ok) { Write-Host "FAIL: $($t5.status) $($t5.raw)"; exit 1 }
Write-Host "OK: $($t5.data.message)"

Write-Host "`nTEST 6: Update bez locka (mora pasti jer se lock automatski otkljuca poslije update-a)"
$t6 = Call "PUT" "$base/api/scenarios/$scenarioId/lines/1" @{ userId=1; newText=@("OVO NE SMIJE PROCI") }
if ($t6.ok) { Write-Host "FAIL: trebao je 409"; exit 1 }
if ($t6.status -ne 409) { Write-Host "FAIL: status=$($t6.status) raw=$($t6.raw)"; exit 1 }
Write-Host "OK: 409 (nije zakljucana)"

Write-Host "`nTEST 7: Lock pa dugi update (wrapping >20 rijeci)"
# opet lock
$t7a = Call "POST" "$base/api/scenarios/$scenarioId/lines/1/lock" @{ userId=1 }
if (-not $t7a.ok) { Write-Host "FAIL: $($t7a.status) $($t7a.raw)"; exit 1 }

$longText = "This is a very long sentence with more than twenty words in it which should trigger automatic line wrapping functionality and create new lines in scenario content"
$t7b = Call "PUT" "$base/api/scenarios/$scenarioId/lines/1" @{ userId=1; newText=@($longText) }
if (-not $t7b.ok) { Write-Host "FAIL: $($t7b.status) $($t7b.raw)"; exit 1 }
Write-Host "OK: long update"

Write-Host "`nTEST 8: Ucitaj scenario i provjeri da ima vise od 1 linije (wrapping kreirao nove)"
$t8 = Call "GET" "$base/api/scenarios/$scenarioId"
if (-not $t8.ok) { Write-Host "FAIL: $($t8.status) $($t8.raw)"; exit 1 }
if ($t8.data.content.Count -lt 2) { Write-Host "FAIL: ocekivao >=2 linije, dobio $($t8.data.content.Count)"; exit 1 }
Write-Host "OK: linija ukupno=$($t8.data.content.Count)"

Write-Host "`nTEST 9: Lock karaktera"
$t9 = Call "POST" "$base/api/scenarios/$scenarioId/characters/lock" @{ userId=1; characterName="ALICE" }
if (-not $t9.ok) { Write-Host "FAIL: $($t9.status) $($t9.raw)"; exit 1 }
Write-Host "OK: $($t9.data.message)"

Write-Host "`nTEST 10: Rename karaktera (bez pojavljivanja u tekstu je OK - samo radi delta, ili nema promjene)"
$t10 = Call "POST" "$base/api/scenarios/$scenarioId/characters/update" @{ userId=1; oldName="ALICE"; newName="ALICIA" }
if (-not $t10.ok) { Write-Host "FAIL: $($t10.status) $($t10.raw)"; exit 1 }
Write-Host "OK: $($t10.data.message)"

Write-Host "`nTEST 11: Delte (since daleko u buducnosti -> prazno)"
$t11 = Call "GET" "$base/api/scenarios/$scenarioId/deltas?since=9999999999"
if (-not $t11.ok) { Write-Host "FAIL: $($t11.status) $($t11.raw)"; exit 1 }
if ($t11.data.deltas.Count -ne 0) { Write-Host "FAIL: ocekivao 0 delti"; exit 1 }
Write-Host "OK: deltas=[]"

Write-Host "`nSVE OK ✅"
