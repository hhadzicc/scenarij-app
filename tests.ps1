# tests.ps1
# Pokreni: powershell -ExecutionPolicy Bypass -File .\tests.ps1
# Server mora vec raditi na http://localhost:3000

$base = "http://localhost:3000"
$testCount = 0
$passCount = 0

function Call($method, $url, $body = $null) {
  $headers = @{ "Content-Type" = "application/json" }
  $jsonBody = $null
  if ($body -ne $null) {
    $jsonBody = ($body | ConvertTo-Json -Depth 10)
  }

  try {
    $resp = Invoke-WebRequest -Method $method -Uri $url -Headers $headers -Body $jsonBody -UseBasicParsing
    $content = $resp.Content
    $data = $null
    if ($content) { 
      try { $data = $content | ConvertFrom-Json } catch { $data = $content }
    }
    return @{ ok=$true; status=[int]$resp.StatusCode; data=$data; raw=$content }
  } catch {
    $resp = $_.Exception.Response
    if ($resp -ne $null) {
      $status = [int]$resp.StatusCode
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $text = $reader.ReadToEnd()
      $data = $null
      if ($text) {
        try { $data = $text | ConvertFrom-Json } catch { $data = $text }
      }
      return @{ ok=$false; status=$status; data=$data; raw=$text }
    }
    return @{ ok=$false; status=0; raw=$_.Exception.Message }
  }
}


function Test-Case($name, $scriptBlock) {
  $script:testCount++
  Write-Host "`n[$script:testCount] $name" -ForegroundColor Cyan
  try {
    & $scriptBlock
    $script:passCount++
    Write-Host "  ✅ PASS" -ForegroundColor Green
  } catch {
    Write-Host "  ❌ FAIL: $_" -ForegroundColor Red
  }
}

function Assert-True($condition, $message = "Assertion failed") {
  if (-not $condition) { throw $message }
}

function Assert-Equals($actual, $expected, $message = "Values not equal") {
  if ($actual -ne $expected) {
    throw "$message (expected: $expected, got: $actual)"
  }
}

Write-Host "===========================================" -ForegroundColor Yellow
Write-Host "  SVEOBUHVATNI TESTOVI - SPIRALA 3" -ForegroundColor Yellow
Write-Host "===========================================" -ForegroundColor Yellow

# =================== SEKCIJA 1: KREIRANJE SCENARIJA ===================
Write-Host "`n### SEKCIJA 1: KREIRANJE SCENARIJA ###" -ForegroundColor Magenta

Test-Case "1.1: Kreiranje scenarija sa naslovom" {
  $res = Call "POST" "$base/api/scenarios" @{ title="Test Scenario Alpha" }
  Assert-True $res.ok "Request failed"
  Assert-Equals $res.data.title "Test Scenario Alpha"
  Assert-Equals $res.data.content.Count 1
  Assert-Equals $res.data.content[0].lineId 1
  Assert-Equals $res.data.content[0].nextLineId $null
  Assert-Equals $res.data.content[0].text ""
  $script:sid1 = $res.data.id
}

Test-Case "1.2: Kreiranje scenarija bez naslova (treba default)" {
  $res = Call "POST" "$base/api/scenarios" @{ }
  Assert-True $res.ok
  Assert-Equals $res.data.title "Neimenovani scenarij"
  $script:sid2 = $res.data.id
}

Test-Case "1.3: Kreiranje scenarija sa praznim naslovom (treba default)" {
  $res = Call "POST" "$base/api/scenarios" @{ title="" }
  Assert-True $res.ok
  Assert-Equals $res.data.title "Neimenovani scenarij"
  $script:sid3 = $res.data.id
}

Test-Case "1.4: Kreiranje scenarija sa naslovom koji ima razmake" {
  $res = Call "POST" "$base/api/scenarios" @{ title="   Naslov sa razmakom   " }
  Assert-True $res.ok
  Assert-Equals $res.data.title "Naslov sa razmakom"
}

Test-Case "1.5: Kreiranje vise scenarija (provjeriti unique ID-eve)" {
  $res1 = Call "POST" "$base/api/scenarios" @{ title="Scenario A" }
  $res2 = Call "POST" "$base/api/scenarios" @{ title="Scenario B" }
  Assert-True $res1.ok
  Assert-True $res2.ok
  Assert-True ($res1.data.id -ne $res2.data.id) "IDs should be unique"
}

# =================== SEKCIJA 2: CITANJE SCENARIJA ===================
Write-Host "`n### SEKCIJA 2: CITANJE SCENARIJA ###" -ForegroundColor Magenta

Test-Case "2.1: Ucitavanje postojeceg scenarija" {
  $res = Call "GET" "$base/api/scenarios/$script:sid1"
  Assert-True $res.ok
  Assert-Equals $res.data.id $script:sid1
  Assert-Equals $res.data.title "Test Scenario Alpha"
}

Test-Case "2.2: Ucitavanje nepostojeceg scenarija (404)" {
  $res = Call "GET" "$base/api/scenarios/999999"
  Assert-Equals $res.status 404
  Assert-Equals $res.data.message "Scenario ne postoji!"
}

Test-Case "2.3: Ucitavanje scenarija sa ID 0 (404)" {
  $res = Call "GET" "$base/api/scenarios/0"
  Assert-Equals $res.status 404
}

Test-Case "2.4: Ucitavanje scenarija sa negativnim ID (404)" {
  $res = Call "GET" "$base/api/scenarios/-5"
  Assert-Equals $res.status 404
}

# =================== SEKCIJA 3: ZAKLJUCAVANJE LINIJA ===================
Write-Host "`n### SEKCIJA 3: ZAKLJUCAVANJE LINIJA ###" -ForegroundColor Magenta

Test-Case "3.1: Lock validne linije" {
  $res = Call "POST" "$base/api/scenarios/$script:sid1/lines/1/lock" @{ userId=1 }
  Assert-True $res.ok
  Assert-Equals $res.data.message "Linija je uspjesno zakljucana!"
}

Test-Case "3.2: Lock iste linije od istog usera (treba uspjeti)" {
  $res = Call "POST" "$base/api/scenarios/$script:sid1/lines/1/lock" @{ userId=1 }
  Assert-True $res.ok
}

Test-Case "3.3: Lock iste linije od drugog usera (konflikt 409)" {
  $res = Call "POST" "$base/api/scenarios/$script:sid1/lines/1/lock" @{ userId=2 }
  Assert-Equals $res.status 409
  Assert-Equals $res.data.message "Linija je vec zakljucana!"
}

Test-Case "3.4: Lock nepostojece linije (404)" {
  $res = Call "POST" "$base/api/scenarios/$script:sid1/lines/999/lock" @{ userId=1 }
  Assert-Equals $res.status 404
  Assert-Equals $res.data.message "Linija ne postoji!"
}

Test-Case "3.5: Lock u nepostojecem scenariju (404)" {
  $res = Call "POST" "$base/api/scenarios/999999/lines/1/lock" @{ userId=1 }
  Assert-Equals $res.status 404
  Assert-Equals $res.data.message "Scenario ne postoji!"
}

Test-Case "3.6: User lock-uje drugu liniju (prva se automatski otključava)" {
  $newRes = Call "POST" "$base/api/scenarios" @{ title="Multi-line test" }
  $nsid = $newRes.data.id

  $lock1 = Call "POST" "$base/api/scenarios/$nsid/lines/1/lock" @{ userId=10 }
  Assert-True $lock1.ok

  $longText = "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17 word18 word19 word20 word21"
  $upd = Call "PUT" "$base/api/scenarios/$nsid/lines/1" @{ userId=10; newText=@($longText) }
  Assert-True $upd.ok

  $lock2 = Call "POST" "$base/api/scenarios/$nsid/lines/2/lock" @{ userId=10 }
  Assert-True $lock2.ok

  $lock1again = Call "POST" "$base/api/scenarios/$nsid/lines/1/lock" @{ userId=11 }
  Assert-True $lock1again.ok
}

# =================== SEKCIJA 4: AZURIRANJE LINIJA - BASIC ===================
Write-Host "`n### SEKCIJA 4: AZURIRANJE LINIJA - BASIC ###" -ForegroundColor Magenta

Test-Case "4.1: Update zaključane linije - uspjeh" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Update test" }
  $sid = $newScn.data.id

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=20 }
  Assert-True $lock.ok

  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=20; newText=@("INT. KUHINJA - DAY") }
  Assert-True $upd.ok
  Assert-Equals $upd.data.message "Linija je uspjesno azurirana!"
}

Test-Case "4.2: Update nezaključane linije (409)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="No lock test" }
  $sid = $newScn.data.id

  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=20; newText=@("text") }
  Assert-Equals $upd.status 409
  Assert-Equals $upd.data.message "Linija nije zakljucana!"
}

Test-Case "4.3: Update linije zaključane od drugog usera (409)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Wrong user test" }
  $sid = $newScn.data.id

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=30 }
  Assert-True $lock.ok

  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=31; newText=@("text") }
  Assert-Equals $upd.status 409
  Assert-Equals $upd.data.message "Linija je vec zakljucana!"
}

Test-Case "4.4: Update sa praznim newText nizom (400)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Empty array test" }
  $sid = $newScn.data.id

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=40 }
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=40; newText=@() }
  Assert-Equals $upd.status 400
  Assert-Equals $upd.data.message "Niz new_text ne smije biti prazan!"
}

Test-Case "4.5: Update sa praznim stringom u newText (OK, dozvoljen prazan string)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Empty string test" }
  $sid = $newScn.data.id

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=50 }
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=50; newText=@("") }
  Assert-True $upd.ok
}

Test-Case "4.6: Update automatski otključava liniju" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Auto unlock test" }
  $sid = $newScn.data.id

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=60 }
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=60; newText=@("test") }
  Assert-True $upd.ok

  $upd2 = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=60; newText=@("test2") }
  Assert-Equals $upd2.status 409
}

Test-Case "4.7: Update nepostojece linije (404)" {
  $upd = Call "PUT" "$base/api/scenarios/$script:sid1/lines/999" @{ userId=70; newText=@("x") }
  Assert-Equals $upd.status 404
}

# =================== SEKCIJA 5: WORD WRAPPING (20 rijeci) ===================
Write-Host "`n### SEKCIJA 5: WORD WRAPPING ###" -ForegroundColor Magenta

Test-Case "5.1: Tekst sa tacno 20 rijeci (1 linija)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Wrap 20" }
  $sid = $newScn.data.id

  $text = "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13 w14 w15 w16 w17 w18 w19 w20"

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=100 }
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=100; newText=@($text) }
  Assert-True $upd.ok

  $get = Call "GET" "$base/api/scenarios/$sid"
  Assert-Equals $get.data.content.Count 1
}

Test-Case "5.2: Tekst sa 21 riječi (2 linije)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Wrap 21" }
  $sid = $newScn.data.id

  $text = "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13 w14 w15 w16 w17 w18 w19 w20 w21"

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=101 }
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=101; newText=@($text) }
  Assert-True $upd.ok

  $get = Call "GET" "$base/api/scenarios/$sid"
  Assert-Equals $get.data.content.Count 2
}

Test-Case "5.3: Tekst sa 40 rijeci (2 linije: 20+20)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Wrap 40" }
  $sid = $newScn.data.id

  $words = 1..40 | ForEach-Object { "w$_" }
  $text = $words -join " "

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=102 }
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=102; newText=@($text) }
  Assert-True $upd.ok

  $get = Call "GET" "$base/api/scenarios/$sid"
  Assert-Equals $get.data.content.Count 2
}

Test-Case "5.4: Tekst sa 45 rijeci (3 linije: 20+20+5)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Wrap 45" }
  $sid = $newScn.data.id

  $words = 1..45 | ForEach-Object { "word$_" }
  $text = $words -join " "

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=103 }
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=103; newText=@($text) }
  Assert-True $upd.ok

  $get = Call "GET" "$base/api/scenarios/$sid"
  Assert-Equals $get.data.content.Count 3
}

Test-Case "5.5: Multiple newText elementi (svaki se wrapa posebno)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Multi wrap" }
  $sid = $newScn.data.id

  $text1 = (1..25 | ForEach-Object { "a$_" }) -join " "  # 25 riječi -> 2 linije
  $text2 = (1..15 | ForEach-Object { "b$_" }) -join " "  # 15 riječi -> 1 linija

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=104 }
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=104; newText=@($text1, $text2) }
  Assert-True $upd.ok

  $get = Call "GET" "$base/api/scenarios/$sid"
  Assert-True ($get.data.content.Count -ge 3) "Expected at least 3 lines"
}

Test-Case "5.6: Wrapping sa interpunkcijom (zarez, tačka)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Wrap punctuation" }
  $sid = $newScn.data.id

  $text = "word1, word2. word3, word4. word5, word6. word7, word8. word9, word10. word11, word12. word13, word14. word15, word16. word17, word18. word19, word20. word21, word22. word23, word24. word25."

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=105 }
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=105; newText=@($text) }
  Assert-True $upd.ok

  $get = Call "GET" "$base/api/scenarios/$sid"
  Assert-True ($get.data.content.Count -ge 1)
}

# =================== SEKCIJA 6: NEXTLINEID I REDOSLIJED ===================
Write-Host "`n### SEKCIJA 6: NEXTLINEID I REDOSLIJED ###" -ForegroundColor Magenta

Test-Case "6.1: Provjera nextLineId nakon wrap-a" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="NextLineId test" }
  $sid = $newScn.data.id

  $text = (1..25 | ForEach-Object { "x$_" }) -join " "

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=110 }
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=110; newText=@($text) }
  Assert-True $upd.ok

  $get = Call "GET" "$base/api/scenarios/$sid"
  $lines = $get.data.content

  Assert-Equals $lines[0].nextLineId $lines[1].lineId
  Assert-Equals $lines[-1].nextLineId $null
}

Test-Case "6.2: Redoslijed linija se čuva nakon update-a" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Order test" }
  $sid = $newScn.data.id

  $text = (1..50 | ForEach-Object { "w$_" }) -join " "
  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=111 }
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=111; newText=@($text) } | Out-Null

  $lock2 = Call "POST" "$base/api/scenarios/$sid/lines/2/lock" @{ userId=111 }
  $upd2 = Call "PUT" "$base/api/scenarios/$sid/lines/2" @{ userId=111; newText=@("MIDDLE LINE") } | Out-Null

  $get2 = Call "GET" "$base/api/scenarios/$sid"
  Assert-Equals $get2.data.content[1].text "MIDDLE LINE"
}

# =================== SEKCIJA 7: ZAKLJUCAVANJE KARAKTERA ===================
Write-Host "`n### SEKCIJA 7: ZAKLJUCAVANJE KARAKTERA ###" -ForegroundColor Magenta

Test-Case "7.1: Lock imena karaktera - uspjeh" {
  $res = Call "POST" "$base/api/scenarios/$script:sid1/characters/lock" @{ userId=200; characterName="ALICE" }
  Assert-True $res.ok
  Assert-Equals $res.data.message "Ime lika je uspjesno zakljucano!"
}

Test-Case "7.2: Lock istog imena karaktera od istog usera (OK)" {
  $res = Call "POST" "$base/api/scenarios/$script:sid1/characters/lock" @{ userId=200; characterName="ALICE" }
  Assert-True $res.ok
}

Test-Case "7.3: Lock istog imena karaktera od drugog usera (409)" {
  $res = Call "POST" "$base/api/scenarios/$script:sid1/characters/lock" @{ userId=201; characterName="ALICE" }
  Assert-Equals $res.status 409
  Assert-Equals $res.data.message "Konflikt! Ime lika je vec zakljucano!"
}

Test-Case "7.4: Lock u nepostojecem scenariju (404)" {
  $res = Call "POST" "$base/api/scenarios/999999/characters/lock" @{ userId=200; characterName="BOB" }
  Assert-Equals $res.status 404
}

Test-Case "7.5: Lock vise razlicitih imena istovremeno (OK)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Multi char lock" }
  $sid = $newScn.data.id

  $lock1 = Call "POST" "$base/api/scenarios/$sid/characters/lock" @{ userId=202; characterName="CHARLIE" }
  $lock2 = Call "POST" "$base/api/scenarios/$sid/characters/lock" @{ userId=203; characterName="DIANA" }

  Assert-True $lock1.ok
  Assert-True $lock2.ok
}

Test-Case "7.6: Lock case-sensitive (ALICE != alice)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Case sensitive" }
  $sid = $newScn.data.id

  $lock1 = Call "POST" "$base/api/scenarios/$sid/characters/lock" @{ userId=204; characterName="ALICE" }
  $lock2 = Call "POST" "$base/api/scenarios/$sid/characters/lock" @{ userId=205; characterName="alice" }

  Assert-True $lock1.ok
  Assert-True $lock2.ok
}

# =================== SEKCIJA 8: RENAME KARAKTERA ===================
Write-Host "`n### SEKCIJA 8: RENAME KARAKTERA ###" -ForegroundColor Magenta

Test-Case "8.1: Rename karaktera - basic" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Rename test" }
  $sid = $newScn.data.id

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=300 }
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=300; newText=@("ALICE govori nesto") } | Out-Null

  $lockChar = Call "POST" "$base/api/scenarios/$sid/characters/lock" @{ userId=300; characterName="ALICE" }
  Assert-True $lockChar.ok

  $rename = Call "POST" "$base/api/scenarios/$sid/characters/update" @{ userId=300; oldName="ALICE"; newName="ALICIA" }
  Assert-True $rename.ok

  $get = Call "GET" "$base/api/scenarios/$sid"
  Assert-True ($get.data.content[0].text -match "ALICIA")
}

Test-Case "8.2: Rename bez lock-a (409)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="No lock rename" }
  $sid = $newScn.data.id

  $rename = Call "POST" "$base/api/scenarios/$sid/characters/update" @{ userId=301; oldName="BOB"; newName="BOBBY" }
  Assert-Equals $rename.status 409
}

Test-Case "8.3: Rename od drugog usera (409)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Wrong user rename" }
  $sid = $newScn.data.id

  $lock = Call "POST" "$base/api/scenarios/$sid/characters/lock" @{ userId=302; characterName="CHARLIE" } | Out-Null
  $rename = Call "POST" "$base/api/scenarios/$sid/characters/update" @{ userId=303; oldName="CHARLIE"; newName="CHARLES" }
  Assert-Equals $rename.status 409
}

Test-Case "8.4: Rename automatski otključava ime" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Auto unlock char" }
  $sid = $newScn.data.id

  $lock = Call "POST" "$base/api/scenarios/$sid/characters/lock" @{ userId=304; characterName="DIANA" } | Out-Null
  $rename = Call "POST" "$base/api/scenarios/$sid/characters/update" @{ userId=304; oldName="DIANA"; newName="DI" }
  Assert-True $rename.ok

  $lock2 = Call "POST" "$base/api/scenarios/$sid/characters/lock" @{ userId=305; characterName="DI" }
  Assert-True $lock2.ok
}

Test-Case "8.5: Rename case-sensitive (ALICE -> alice)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Case rename" }
  $sid = $newScn.data.id

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=306 } | Out-Null
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=306; newText=@("ALICE and alice are different") } | Out-Null

  $lockChar = Call "POST" "$base/api/scenarios/$sid/characters/lock" @{ userId=306; characterName="ALICE" } | Out-Null
  $rename = Call "POST" "$base/api/scenarios/$sid/characters/update" @{ userId=306; oldName="ALICE"; newName="ALICIA" }
  Assert-True $rename.ok

  $get = Call "GET" "$base/api/scenarios/$sid"
  Assert-True ($get.data.content[0].text -match "ALICIA")
  Assert-True ($get.data.content[0].text -match "alice")
}

Test-Case "8.6: Rename u nepostojecem scenariju (404)" {
  $res = Call "POST" "$base/api/scenarios/999999/characters/update" @{ userId=307; oldName="X"; newName="Y" }
  Assert-Equals $res.status 404
}

# =================== SEKCIJA 9: DELTAS ===================
Write-Host "`n### SEKCIJA 9: DELTAS ###" -ForegroundColor Magenta

Test-Case "9.1: Deltas nakon line_update (treba barem 1 delta)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Deltas line_update" }
  $sid = $newScn.data.id

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=400 } | Out-Null
  Start-Sleep -Milliseconds 1100
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=400; newText=@("Hello world") }
  Assert-True $upd.ok

  $d = Call "GET" "$base/api/scenarios/$sid/deltas?since=0"
  Assert-True $d.ok
  Assert-True ($d.data.deltas.Count -ge 1) "Expected at least 1 delta"
  Assert-Equals $d.data.deltas[-1].type "line_update"
  Assert-Equals $d.data.deltas[-1].scenarioId $sid
}

Test-Case "9.2: Deltas nakon wrap-a (više line_update delti)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Deltas wrap" }
  $sid = $newScn.data.id

  $text = (1..45 | ForEach-Object { "w$_" }) -join " "  # 45 riječi -> 3 linije
  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=401 } | Out-Null
  Start-Sleep -Milliseconds 1100
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=401; newText=@($text) }
  Assert-True $upd.ok

  $d = Call "GET" "$base/api/scenarios/$sid/deltas?since=0"
  Assert-True $d.ok
  # minimalno 2 (realno 3), ali da ne bude krhak test:
  Assert-True ($d.data.deltas.Count -ge 2) "Expected multiple deltas after wrapping"
  Assert-True (($d.data.deltas | ForEach-Object { $_.type }) -contains "line_update") "Expected line_update in deltas"
}

Test-Case "9.3: Deltas nakon char_rename (treba char_rename delta)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Deltas char_rename" }
  $sid = $newScn.data.id

  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=402 } | Out-Null
  Start-Sleep -Milliseconds 1100
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=402; newText=@("ALICE govori nesto") } | Out-Null

  $lockChar = Call "POST" "$base/api/scenarios/$sid/characters/lock" @{ userId=402; characterName="ALICE" } | Out-Null
  Start-Sleep -Milliseconds 1100
  $rename = Call "POST" "$base/api/scenarios/$sid/characters/update" @{ userId=402; oldName="ALICE"; newName="ALICIA" }
  Assert-True $rename.ok

  $d = Call "GET" "$base/api/scenarios/$sid/deltas?since=0"
  Assert-True $d.ok
  Assert-True (($d.data.deltas | ForEach-Object { $_.type }) -contains "char_rename") "Expected char_rename delta"
}

Test-Case "9.4: Deltas since u budućnosti (mora biti prazno)" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Deltas since future" }
  $sid = $newScn.data.id

  $d = Call "GET" "$base/api/scenarios/$sid/deltas?since=9999999999"
  Assert-True $d.ok
  Assert-Equals $d.data.deltas.Count 0
}

# =================== SEKCIJA 10: RENAME KONFLIKT (LINIJA LOCKOVANA) ===================
Write-Host "`n### SEKCIJA 10: RENAME KONFLIKT (LOCKOVANE LINIJE) ###" -ForegroundColor Magenta

Test-Case "10.1: Rename mora pasti ako je linija koja sadrži oldName lockovana od drugog usera" {
  $newScn = Call "POST" "$base/api/scenarios" @{ title="Rename conflict test" }
  $sid = $newScn.data.id

  # user500 upiše tekst sa imenom
  $lock = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=500 } | Out-Null
  Start-Sleep -Milliseconds 1100
  $upd = Call "PUT" "$base/api/scenarios/$sid/lines/1" @{ userId=500; newText=@("ALICE: hello") } | Out-Null

  # user501 lockuje liniju 1 (da napravi konflikt)
  $lockLineOther = Call "POST" "$base/api/scenarios/$sid/lines/1/lock" @{ userId=501 }
  Assert-True $lockLineOther.ok

  # user500 lockuje ime i pokuša rename -> mora pasti jer linija lockovana od user501
  $lockChar = Call "POST" "$base/api/scenarios/$sid/characters/lock" @{ userId=500; characterName="ALICE" }
  Assert-True $lockChar.ok

  $rename = Call "POST" "$base/api/scenarios/$sid/characters/update" @{ userId=500; oldName="ALICE"; newName="ALICIA" }
  Assert-Equals $rename.status 409
  Assert-Equals $rename.data.message "Konflikt! Neke linije su zakljucane od drugog korisnika."
}

# =================== SUMMARY ===================
Write-Host "`n===========================================" -ForegroundColor Yellow
Write-Host ("  REZULTAT: {0}/{1} TESTOVA PROŠLO" -f $passCount, $testCount) -ForegroundColor Yellow
Write-Host "===========================================" -ForegroundColor Yellow

if ($passCount -ne $testCount) {
  exit 1
} else {
  exit 0
}
