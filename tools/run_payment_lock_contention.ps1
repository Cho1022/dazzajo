[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:8080",
    [string]$K6BaseUrl = "http://host.docker.internal:8080",
    [int]$Repeats = 3,
    [int[]]$ControlledFanOut = @(10, 25, 50),
    [int]$ControlRate = 10,
    [string]$Duration = "10s",
    [int]$SampleIntervalMs = 200,
    [string]$K6Image = "grafana/k6:0.54.0",
    [string]$PostgresDatabase = "buildgraph",
    [string]$RunId
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$fixtureSqlPath = Join-Path $PSScriptRoot "payment_lock_contention_fixture.sql"
$cleanupSqlPath = Join-Path $PSScriptRoot "payment_lock_contention_cleanup.sql"
$k6ScriptPath = "infra/k6/payment-lock-contention.js"
$postgresContainer = "buildgraph-postgres"
$apiContainer = "buildgraph-api"

if ([string]::IsNullOrWhiteSpace($RunId)) {
    $RunId = "{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), ((& git -C $repoRoot rev-parse --short HEAD).Trim())
}
if ($RunId -notmatch '^[A-Za-z0-9_-]+$') {
    throw "RunId must contain only letters, numbers, underscores, and hyphens."
}

$runDir = Join-Path $repoRoot ".qa-results\payment-lock-contention\$RunId"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$allResults = [System.Collections.Generic.List[object]]::new()

function Invoke-PsqlText {
    param(
        [Parameter(Mandatory = $true)][string]$Sql,
        [hashtable]$Variables = @{}
    )

    $arguments = @("exec", "-i", $postgresContainer, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "buildgraph", "-d", $PostgresDatabase)
    foreach ($entry in $Variables.GetEnumerator()) {
        $arguments += @("-v", "$($entry.Key)=$($entry.Value)")
    }
    $output = $Sql | & docker @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "psql failed with exit code $LASTEXITCODE"
    }
    return @($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Remove-Fixture {
    param([string]$FixtureKey)
    $cleanupSql = Get-Content -Raw -Encoding UTF8 $cleanupSqlPath
    [void](Invoke-PsqlText -Sql $cleanupSql -Variables @{ run_id = $FixtureKey })
}

function New-Fixture {
    param([string]$FixtureKey)

    Remove-Fixture -FixtureKey $FixtureKey
    $fixtureSql = Get-Content -Raw -Encoding UTF8 $fixtureSqlPath
    $rows = @(Invoke-PsqlText -Sql $fixtureSql -Variables @{ run_id = $FixtureKey })
    if ($rows.Count -ne 1) {
        throw "Expected one fixture row, received $($rows.Count): $($rows -join '; ')"
    }
    $parts = $rows[0].Split('|')
    if ($parts.Count -ne 4) {
        throw "Unexpected fixture output: $($rows[0])"
    }
    return [pscustomobject]@{
        HotInternalId = [long]$parts[0]
        HotPublicId = $parts[1]
        ControlInternalId = [long]$parts[2]
        ControlPublicId = $parts[3]
    }
}

function Get-AccessToken {
    $body = @{ email = "user@example.com"; password = "passw0rd!" } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -ContentType "application/json" -Body $body -TimeoutSec 10
    if ([string]::IsNullOrWhiteSpace($response.accessToken)) {
        throw "Login response did not contain accessToken."
    }
    return $response.accessToken
}

function Initialize-HotAttempt {
    param(
        [string]$AccessToken,
        [string]$HotRequestPublicId,
        [string]$FixtureKey
    )

    $headers = @{
        Authorization = "Bearer $AccessToken"
        "Idempotency-Key" = "$FixtureKey-attempt"
    }
    $attempt = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/assembly-requests/$HotRequestPublicId/payments/attempts" `
        -Headers $headers -ContentType "application/json" -Body '{"method":"CARD"}' -TimeoutSec 15
    if ([string]::IsNullOrWhiteSpace($attempt.id)) {
        throw "Payment attempt response did not contain id."
    }
    Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/payments/attempts/$($attempt.id)/mock-result" `
        -Headers @{ Authorization = "Bearer $AccessToken" } -ContentType "application/json" `
        -Body '{"result":"SUCCESS"}' -TimeoutSec 10 | Out-Null
    return $attempt.id
}

function Start-HikariCollector {
    param([string]$OutputPath, [string]$StopPath)

    "timestamp|active|pending|timeout" | Set-Content -Path $OutputPath -Encoding UTF8
    Remove-Item -LiteralPath $StopPath -Force -ErrorAction SilentlyContinue
    return Start-Job -ArgumentList $BaseUrl,$OutputPath,$StopPath,$SampleIntervalMs -ScriptBlock {
        param($CollectorBaseUrl, $CollectorOutputPath, $CollectorStopPath, $IntervalMs)

        function Read-Meter([string]$Name) {
            try {
                $response = Invoke-RestMethod -Uri "$CollectorBaseUrl/actuator/metrics/$Name" -TimeoutSec 1
                if ($response.measurements.Count -gt 0) {
                    return [double]$response.measurements[0].value
                }
            } catch {
                return $null
            }
            return $null
        }

        while (-not (Test-Path -LiteralPath $CollectorStopPath)) {
            $started = [System.Diagnostics.Stopwatch]::StartNew()
            $active = Read-Meter "hikaricp.connections.active"
            $pending = Read-Meter "hikaricp.connections.pending"
            $timeouts = Read-Meter "hikaricp.connections.timeout"
            "$(Get-Date -Format o)|$active|$pending|$timeouts" | Add-Content -Path $CollectorOutputPath -Encoding UTF8
            $remaining = [math]::Max(0, $IntervalMs - $started.ElapsedMilliseconds)
            if ($remaining -gt 0) {
                Start-Sleep -Milliseconds $remaining
            }
        }
    }
}

function Start-DbLockCollector {
    param([string]$OutputPath, [string]$StopPath)

    "timestampMs|waiters|maxWaitMs|blockers" | Set-Content -Path $OutputPath -Encoding UTF8
    Remove-Item -LiteralPath $StopPath -Force -ErrorAction SilentlyContinue
    $sql = @"
SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint,
       count(*),
       round(coalesce(max(extract(epoch FROM (clock_timestamp() - query_start)) * 1000), 0)::numeric, 3),
       coalesce(string_agg(pid::text || ':' || array_to_string(pg_blocking_pids(pid), ','), ';'), '')
FROM pg_stat_activity
WHERE datname = current_database()
  AND wait_event_type = 'Lock'
"@
    $containerStopPath = "/tmp/payment-lock-db-$([guid]::NewGuid().ToString('N')).stop"
    $sampleSeconds = [math]::Max(0.05, [math]::Round(($SampleIntervalMs - 40) / 1000, 3))
    $singleLineSql = $sql -replace "`r?`n", " "
    $sqlBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($singleLineSql))
    $loopCommand = @'
rm -f '{0}'
collector_sql=$(printf '%s' '{1}' | base64 -d)
while [ ! -f '{0}' ]
do
  psql -X -qAt -F '|' -U buildgraph -d '{2}' -c "$collector_sql"
  sleep {3}
done
rm -f '{0}'
'@ -f $containerStopPath,$sqlBase64,$PostgresDatabase,$sampleSeconds
    $job = Start-Job -ArgumentList $OutputPath,$postgresContainer,$loopCommand -ScriptBlock {
        param($CollectorOutputPath, $PostgresContainer, $LoopCommand)
        $LoopCommand | & docker exec -i $PostgresContainer sh 2>&1 |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Add-Content -Path $CollectorOutputPath -Encoding UTF8
        if ($LASTEXITCODE -ne 0) {
            throw "DB lock collector failed with exit code $LASTEXITCODE"
        }
    }
    $job | Add-Member -NotePropertyName ContainerStopPath -NotePropertyValue $containerStopPath
    return $job
}

function Stop-Collector {
    param($Job, [string]$StopPath)
    New-Item -ItemType File -Force -Path $StopPath | Out-Null
    if ($null -ne $Job.PSObject.Properties["ContainerStopPath"]) {
        & docker exec $postgresContainer touch $Job.ContainerStopPath | Out-Null
    }
    $completed = Wait-Job $Job -Timeout 3
    if ($null -eq $completed) {
        Stop-Job $Job -ErrorAction SilentlyContinue
    }
    Receive-Job $Job -ErrorAction Stop | Out-Null
    if ($null -ne $Job.PSObject.Properties["ContainerStopPath"]) {
        & docker exec $postgresContainer rm -f $Job.ContainerStopPath | Out-Null
    }
    Remove-Job $Job -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $StopPath -Force -ErrorAction SilentlyContinue
}

function Start-LockHolder {
    param([long]$HotRequestInternalId, [string]$ApplicationName)

    $sql = @'
BEGIN;
SET LOCAL application_name = '{0}';
SELECT id FROM assembly_requests WHERE id = {1} FOR UPDATE;
DO $holder$
DECLARE
    waiter_deadline timestamptz := clock_timestamp() + interval '15 seconds';
BEGIN
    WHILE NOT EXISTS (
        SELECT 1
        FROM pg_stat_activity activity
        WHERE pg_backend_pid() = ANY(pg_blocking_pids(activity.pid))
    ) LOOP
        IF clock_timestamp() >= waiter_deadline THEN
            RAISE EXCEPTION 'Hot Request waiter did not arrive within 15 seconds';
        END IF;
        PERFORM pg_sleep(0.05);
    END LOOP;
    PERFORM pg_sleep(5);
END
$holder$;
COMMIT;
'@ -f $ApplicationName,$HotRequestInternalId
    return Start-Job -ArgumentList $postgresContainer,$PostgresDatabase,$sql -ScriptBlock {
        param($PostgresContainer, $Database, $HolderSql)
        $HolderSql | & docker exec -i $PostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 -U buildgraph -d $Database
        if ($LASTEXITCODE -ne 0) {
            throw "Lock holder psql failed with exit code $LASTEXITCODE"
        }
    }
}

function Wait-LockHolder {
    param([string]$ApplicationName)

    $deadline = (Get-Date).AddSeconds(5)
    do {
        $sql = "SELECT count(*) FROM pg_stat_activity WHERE application_name = '$ApplicationName' AND wait_event = 'PgSleep'"
        $value = (& docker exec $postgresContainer psql -X -qAt -U buildgraph -d $PostgresDatabase -c $sql).Trim()
        if ($LASTEXITCODE -eq 0 -and [int]$value -eq 1) {
            return
        }
        Start-Sleep -Milliseconds 50
    } while ((Get-Date) -lt $deadline)
    throw "Lock holder did not acquire the Hot Request lock."
}

function Invoke-K6 {
    param(
        [string]$Scenario,
        [int]$FanOut,
        [string]$AccessToken,
        [string]$HotRequestPublicId,
        [string]$ControlRequestPublicId,
        [string]$HotAttemptPublicId,
        [string]$SummaryPath,
        [string]$ConsolePath
    )

    $summaryRelative = $SummaryPath.Substring($repoRoot.Length + 1).Replace('\', '/')
    $environment = @(
        "SCENARIO=$Scenario",
        "BASE_URL=$K6BaseUrl",
        "ACCESS_TOKEN=$AccessToken",
        "HOT_REQUEST_ID=$HotRequestPublicId",
        "CONTROL_REQUEST_ID=$ControlRequestPublicId",
        "HOT_ATTEMPT_ID=$HotAttemptPublicId",
        "HOT_FAN_OUT=$FanOut",
        "CONTROL_RATE=$ControlRate",
        "DURATION=$Duration",
        "SUMMARY_PATH=/work/$summaryRelative"
    )
    $arguments = @("run", "--rm")
    foreach ($entry in $environment) {
        $arguments += @("-e", $entry)
    }
    $arguments += @("-v", "${repoRoot}:/work", "-w", "/work", $K6Image, "run", "--quiet", $k6ScriptPath)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & docker @arguments 2>&1 | Tee-Object -FilePath $ConsolePath | Out-Host
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previous
    return $exitCode
}

function Get-MetricValue {
    param($Summary, [string]$MetricName, [string]$ValueName, [double]$Default = 0)
    $metric = $Summary.metrics.PSObject.Properties[$MetricName]
    if ($null -eq $metric) {
        return $Default
    }
    $value = $metric.Value.values.PSObject.Properties[$ValueName]
    if ($null -eq $value) {
        return $Default
    }
    return [double]$value.Value
}

function Get-Maximum {
    param($Rows, [string]$Property)
    $values = @($Rows | ForEach-Object {
        $raw = $_.$Property
        if (-not [string]::IsNullOrWhiteSpace($raw)) { [double]$raw }
    })
    if ($values.Count -eq 0) { return 0 }
    return [double](($values | Measure-Object -Maximum).Maximum)
}

function Get-HikariTimeoutDelta {
    param($Rows)
    $values = @($Rows | ForEach-Object {
        if (-not [string]::IsNullOrWhiteSpace($_.timeout)) { [double]$_.timeout }
    })
    if ($values.Count -lt 2) { return 0 }
    return [math]::Max(0, $values[-1] - $values[0])
}

function Read-FinalState {
    param([long]$HotRequestInternalId)
    $sql = @"
SELECT ar.status || '|' || ap.status || '|' || coalesce(attempt.status, 'NONE') || '|' ||
       coalesce(ap.paid_at::text, 'NULL') || '|' || coalesce(ap.refunded_at::text, 'NULL')
FROM assembly_requests ar
JOIN assembly_payments ap ON ap.assembly_request_id = ar.id
LEFT JOIN LATERAL (
    SELECT status
    FROM assembly_payment_attempts
    WHERE assembly_payment_id = ap.id
    ORDER BY created_at DESC, id DESC
    LIMIT 1
) attempt ON true
WHERE ar.id = $HotRequestInternalId
"@
    $rows = @(Invoke-PsqlText -Sql $sql)
    if ($rows.Count -ne 1) { throw "Final state was not found for Hot Request $HotRequestInternalId" }
    $parts = $rows[0].Split('|')
    return [pscustomobject]@{
        RequestStatus = $parts[0]
        PaymentStatus = $parts[1]
        AttemptStatus = $parts[2]
        PaidAt = $parts[3]
        RefundedAt = $parts[4]
    }
}

function Invoke-ExperimentRun {
    param(
        [string]$Condition,
        [string]$Scenario,
        [int]$FanOut,
        [int]$Repeat,
        [string]$AccessToken
    )

    $caseName = "$Condition-r$Repeat"
    $caseDir = Join-Path $runDir $caseName
    New-Item -ItemType Directory -Force -Path $caseDir | Out-Null
    $fixtureKey = "$RunId-$caseName"
    $fixture = $null
    $hikariJob = $null
    $dbJob = $null
    $holderJob = $null
    $hikariStop = Join-Path $caseDir ".stop-hikari"
    $dbStop = Join-Path $caseDir ".stop-db"
    $hikariPath = Join-Path $caseDir "hikari.csv"
    $dbPath = Join-Path $caseDir "db-locks.csv"
    $summaryPath = Join-Path $caseDir "k6-summary.json"
    $consolePath = Join-Path $caseDir "k6.console.log"
    $startedAt = Get-Date
    $runCompleted = $false

    try {
        $fixture = New-Fixture -FixtureKey $fixtureKey
        $attemptId = Initialize-HotAttempt -AccessToken $AccessToken -HotRequestPublicId $fixture.HotPublicId -FixtureKey $fixtureKey
        $hikariJob = Start-HikariCollector -OutputPath $hikariPath -StopPath $hikariStop
        $dbJob = Start-DbLockCollector -OutputPath $dbPath -StopPath $dbStop

        if ($Scenario -eq "controlled") {
            $holderName = "payment-lock-holder-$caseName"
            $holderJob = Start-LockHolder -HotRequestInternalId $fixture.HotInternalId -ApplicationName $holderName
            Wait-LockHolder -ApplicationName $holderName
        }

        $exitCode = Invoke-K6 -Scenario $Scenario -FanOut $FanOut -AccessToken $AccessToken `
            -HotRequestPublicId $fixture.HotPublicId -ControlRequestPublicId $fixture.ControlPublicId `
            -HotAttemptPublicId $attemptId -SummaryPath $summaryPath -ConsolePath $consolePath

        if ($null -ne $holderJob) {
            Wait-Job $holderJob -Timeout 10 | Out-Null
            Receive-Job $holderJob -ErrorAction Stop | Out-Null
            Remove-Job $holderJob -Force -ErrorAction SilentlyContinue
            $holderJob = $null
        }
        if ($exitCode -ne 0) {
            throw "k6 failed for $caseName with exit code $exitCode"
        }
        $runCompleted = $true
    } finally {
        $shutdownError = $null
        if ($null -ne $hikariJob) {
            try { Stop-Collector -Job $hikariJob -StopPath $hikariStop } catch { $shutdownError = $_ }
        }
        if ($null -ne $dbJob) {
            try { Stop-Collector -Job $dbJob -StopPath $dbStop } catch { if ($null -eq $shutdownError) { $shutdownError = $_ } }
        }
        if ($null -ne $holderJob) {
            Stop-Job $holderJob -ErrorAction SilentlyContinue
            Remove-Job $holderJob -Force -ErrorAction SilentlyContinue
        }
        if (-not $runCompleted -and $null -ne $fixture) {
            Remove-Fixture -FixtureKey $fixtureKey
            $fixture = $null
        }
        if ($null -ne $shutdownError) {
            throw $shutdownError
        }
    }

    try {
        $summary = Get-Content -Raw -Encoding UTF8 $summaryPath | ConvertFrom-Json
        $hikariRows = @(Import-Csv -Path $hikariPath -Delimiter '|')
        $dbRows = @(Import-Csv -Path $dbPath -Delimiter '|')
        $state = Read-FinalState -HotRequestInternalId $fixture.HotInternalId
        $apiLogs = @(& docker logs --since $startedAt.ToUniversalTime().ToString("o") $apiContainer 2>&1)
        $connectionTimeoutLogs = @($apiLogs | Select-String -Pattern 'Connection is not available|request timed out after 1500').Count
        $isForbidden = $state.RequestStatus -eq "CANCELLED" -and $state.PaymentStatus -eq "PAID" -and `
            $state.AttemptStatus -eq "SUCCEEDED" -and $state.RefundedAt -eq "NULL"
        $allowed = if ($Scenario -eq "baseline") {
            $state.RequestStatus -eq "MATCHED" -and $state.PaymentStatus -eq "PENDING" -and $state.AttemptStatus -eq "PROCESSING"
        } elseif ($Scenario -eq "controlled") {
            $state.RequestStatus -eq "CANCELLED" -and $state.PaymentStatus -eq "CANCELLED" -and $state.AttemptStatus -eq "CANCELLED"
        } else {
            ($state.RequestStatus -eq "CANCELLED" -and $state.PaymentStatus -eq "CANCELLED" -and $state.AttemptStatus -eq "CANCELLED") -or
            ($state.RequestStatus -eq "MATCHED" -and $state.PaymentStatus -eq "PAID" -and $state.AttemptStatus -eq "SUCCEEDED")
        }

        return [pscustomobject]@{
            Condition = $Condition
            Scenario = $Scenario
            FanOut = $FanOut
            Repeat = $Repeat
            ControlP50Ms = Get-MetricValue $summary "control_duration" "med"
            ControlP95Ms = Get-MetricValue $summary "control_duration" "p(95)"
            ControlP99Ms = Get-MetricValue $summary "control_duration" "p(99)"
            ThroughputRps = Get-MetricValue $summary "http_reqs" "rate"
            Control2xx = Get-MetricValue $summary "control_2xx" "count"
            Control5xx = Get-MetricValue $summary "control_5xx" "count"
            ControlOther = Get-MetricValue $summary "control_other" "count"
            Hot2xx = Get-MetricValue $summary "hot_2xx" "count"
            Hot409 = Get-MetricValue $summary "hot_409" "count"
            Hot5xx = Get-MetricValue $summary "hot_5xx" "count"
            HotOther = Get-MetricValue $summary "hot_other" "count"
            Expected409 = Get-MetricValue $summary "expected_conflict_409" "count"
            Unexpected5xx = Get-MetricValue $summary "unexpected_5xx" "count"
            TimeoutLikeResponses = Get-MetricValue $summary "timeout_like_response" "count"
            DroppedIterations = Get-MetricValue $summary "dropped_iterations" "count"
            HikariActiveMax = Get-Maximum $hikariRows "active"
            HikariPendingMax = Get-Maximum $hikariRows "pending"
            HikariTimeoutDelta = Get-HikariTimeoutDelta $hikariRows
            DbLockWaitersMax = Get-Maximum $dbRows "waiters"
            DbMaxWaitMs = Get-Maximum $dbRows "maxWaitMs"
            ConnectionTimeoutLogCount = $connectionTimeoutLogs
            RequestStatus = $state.RequestStatus
            PaymentStatus = $state.PaymentStatus
            AttemptStatus = $state.AttemptStatus
            ForbiddenState = [int]$isForbidden
            PartialState = [int](-not $allowed)
            ResultDir = $caseDir.Substring($repoRoot.Length + 1)
        }
    } finally {
        Remove-Fixture -FixtureKey $fixtureKey
    }
}

function Get-Median {
    param([double[]]$Values)
    if ($Values.Count -eq 0) { return 0 }
    $sorted = @($Values | Sort-Object)
    $middle = [math]::Floor($sorted.Count / 2)
    if ($sorted.Count % 2 -eq 1) { return [double]$sorted[$middle] }
    return ([double]$sorted[$middle - 1] + [double]$sorted[$middle]) / 2
}

try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 5
    if ($health.status -ne "UP") { throw "API health is $($health.status)" }
    $accessToken = Get-AccessToken

    $conditions = @(
        [pscustomobject]@{ Name = "baseline"; Scenario = "baseline"; FanOut = 0 }
    )
    foreach ($fanOut in $ControlledFanOut) {
        $conditions += [pscustomobject]@{ Name = "controlled-$fanOut"; Scenario = "controlled"; FanOut = $fanOut }
    }
    $conditions += [pscustomobject]@{ Name = "realistic"; Scenario = "realistic"; FanOut = 2 }

    for ($repeat = 1; $repeat -le $Repeats; $repeat++) {
        foreach ($condition in $conditions) {
            Write-Host "[payment-lock] $($condition.Name) repeat=$repeat/$Repeats"
            $result = Invoke-ExperimentRun -Condition $condition.Name -Scenario $condition.Scenario `
                -FanOut $condition.FanOut -Repeat $repeat -AccessToken $accessToken
            $allResults.Add($result)
            $allResults | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $runDir "runs.json") -Encoding UTF8
            Start-Sleep -Seconds 1
        }
    }

    $baselineP95 = Get-Median @($allResults | Where-Object Condition -eq "baseline" | ForEach-Object { [double]$_.ControlP95Ms })
    $summaryRows = foreach ($group in ($allResults | Group-Object Condition)) {
        $rows = @($group.Group)
        $controlP95 = Get-Median @($rows | ForEach-Object { [double]$_.ControlP95Ms })
        [pscustomobject]@{
            Condition = $group.Name
            Repeats = $rows.Count
            ControlP50MedianMs = [math]::Round((Get-Median @($rows | ForEach-Object { [double]$_.ControlP50Ms })), 3)
            ControlP95MedianMs = [math]::Round($controlP95, 3)
            ControlP99MedianMs = [math]::Round((Get-Median @($rows | ForEach-Object { [double]$_.ControlP99Ms })), 3)
            ControlP95ChangePct = if ($baselineP95 -gt 0) { [math]::Round((($controlP95 - $baselineP95) / $baselineP95) * 100, 2) } else { 0 }
            ThroughputRpsMedian = [math]::Round((Get-Median @($rows | ForEach-Object { [double]$_.ThroughputRps })), 3)
            HikariActiveMaxMedian = Get-Median @($rows | ForEach-Object { [double]$_.HikariActiveMax })
            HikariPendingMaxMedian = Get-Median @($rows | ForEach-Object { [double]$_.HikariPendingMax })
            HikariTimeoutMedian = Get-Median @($rows | ForEach-Object { [double]$_.HikariTimeoutDelta })
            DbLockWaitersMaxMedian = Get-Median @($rows | ForEach-Object { [double]$_.DbLockWaitersMax })
            DbMaxWaitMedianMs = [math]::Round((Get-Median @($rows | ForEach-Object { [double]$_.DbMaxWaitMs })), 3)
            Control5xxTotal = ($rows | Measure-Object Control5xx -Sum).Sum
            ControlOtherTotal = ($rows | Measure-Object ControlOther -Sum).Sum
            Hot2xxTotal = ($rows | Measure-Object Hot2xx -Sum).Sum
            Hot409Total = ($rows | Measure-Object Hot409 -Sum).Sum
            Hot5xxTotal = ($rows | Measure-Object Hot5xx -Sum).Sum
            HotOtherTotal = ($rows | Measure-Object HotOther -Sum).Sum
            Unexpected5xxTotal = ($rows | Measure-Object Unexpected5xx -Sum).Sum
            TimeoutLikeResponsesTotal = ($rows | Measure-Object TimeoutLikeResponses -Sum).Sum
            DroppedIterationsTotal = ($rows | Measure-Object DroppedIterations -Sum).Sum
            ConnectionTimeoutLogsTotal = ($rows | Measure-Object ConnectionTimeoutLogCount -Sum).Sum
            ForbiddenStateTotal = ($rows | Measure-Object ForbiddenState -Sum).Sum
            PartialStateTotal = ($rows | Measure-Object PartialState -Sum).Sum
        }
    }

    $summaryRows | Export-Csv -Path (Join-Path $runDir "summary.csv") -NoTypeInformation -Encoding UTF8
    $summaryRows | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $runDir "summary.json") -Encoding UTF8
    $summaryRows | Sort-Object Condition | Format-Table -AutoSize
    Write-Output $runDir
} finally {
    # Each experiment run owns and removes only the jobs it created.
}
