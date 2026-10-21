# Only the disposable conformance shim and its correlated child may be inspected.
# Start/stop subscriptions are deliberately broader BEFORE spawn; only bounded
# PID/parent/time/name/exit metadata is collected transiently, never command lines.
param([ValidateSet('Preflight','Capture')][string]$Mode,
      [string]$Cdb, [string]$SymbolCache)
if ($Mode -eq 'Capture') { [Console]::Out.WriteLine('{"kind":"startup","stage":"script-entered"}') }
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Emit($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 6)) }
function UtcMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
if ($Mode -eq 'Preflight') {
    try {
        $debugRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Debuggers\x64'
        $tools = @('cdb.exe','symchk.exe') | ForEach-Object { Join-Path $debugRoot $_ }
        $identities = @($tools | ForEach-Object {
            $signature = Get-AuthenticodeSignature -LiteralPath $_
            if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
                throw 'unsigned-tool'
            }
            @{ name = [IO.Path]::GetFileName($_); version = (Get-Item -LiteralPath $_).VersionInfo.FileVersion;
               sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash }
        })
        Get-CimClass -Namespace root/cimv2 -ClassName Win32_ProcessStartTrace | Out-Null
        Get-CimClass -Namespace root/cimv2 -ClassName Win32_ProcessStopTrace | Out-Null
        Emit @{ available = $true; cdb = $tools[0]; symchk = $tools[1]; tools = $identities;
            modules = @("$env:SystemRoot\System32\ntdll.dll", "$env:SystemRoot\System32\KernelBase.dll",
                        "$env:SystemRoot\System32\kernel32.dll", "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\clr.dll") }
        exit 0
    } catch { Emit @{ available = $false; reason = 'installed-capability-unavailable' }; exit 1 }
}
# Direct .NET callbacks avoid PowerShell's unbounded event-action queue. Stop
# admitting after256 total records; even a drained queue cannot reset this cap.
Emit @{ kind='startup'; stage='compile-types' }
Add-Type -ReferencedAssemblies 'System.dll','System.Management.dll' -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Management;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
public static class CaptureInput {
    // Console.In is synchronized: even ReadLineAsync blocks its caller.
    // One pending observer-owned read; never run it on the event-draining thread.
    public static Task<string> Read() {
        return Task.Factory.StartNew(() => {
            var line = new StringBuilder();
            for (;;) {
                int value = Console.In.Read();
                if (value < 0) return line.Length == 0 ? null : line.ToString();
                if (value == '\n') return line.ToString();
                if (line.Length >= 65536) throw new System.IO.IOException("capture-input-bound");
                line.Append((char)value);
            }
        }, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
    }
}
public sealed class CaptureEvents : IDisposable {
    readonly object gate = new object();
    readonly Queue<Dictionary<string,object>> queue = new Queue<Dictionary<string,object>>();
    readonly ManagementEventWatcher start, stop;
    int admitted;
    public volatile bool Overflow;
    public CaptureEvents() {
        string filter = " WHERE ProcessName='node.exe' OR ProcessName='powershell.exe'";
        start = new ManagementEventWatcher("SELECT ProcessID,ParentProcessID,ProcessName,TIME_CREATED FROM Win32_ProcessStartTrace" + filter);
        stop = new ManagementEventWatcher("SELECT ProcessID,ParentProcessID,ProcessName,ExitStatus,TIME_CREATED FROM Win32_ProcessStopTrace" + filter);
        start.EventArrived += (s,e) => Record("start",e.NewEvent);
        stop.EventArrived += (s,e) => Record("stop",e.NewEvent);
    }
    void Record(string kind, ManagementBaseObject e) {
        lock(gate) {
            if (admitted >= 256) { Overflow=true; return; }
            try {
                var record = new Dictionary<string,object>();
                record["kind"]=kind;
                record["pid"]=Convert.ToInt64(e["ProcessID"]);
                record["parentPid"]=Convert.ToInt64(e["ParentProcessID"]);
                record["name"]=Convert.ToString(e["ProcessName"]).ToLowerInvariant();
                record["utcMs"]=(DateTime.FromFileTimeUtc(Convert.ToInt64(e["TIME_CREATED"]))-new DateTime(1970,1,1)).TotalMilliseconds;
                if(kind=="stop") record["code"]=Convert.ToInt64(e["ExitStatus"]);
                queue.Enqueue(record); admitted++;
            } catch { Overflow=true; }
        }
    }
    public void Arm() {
        Console.Out.WriteLine("{\"kind\":\"startup\",\"stage\":\"arm-stop\"}");
        stop.Start();
        Console.Out.WriteLine("{\"kind\":\"startup\",\"stage\":\"arm-start\"}");
        start.Start();
    }
    public Dictionary<string,object> Take() {
        lock(gate) { return queue.Count==0 ? null : queue.Dequeue(); }
    }
    public void Dispose() { stop.Stop(); start.Stop(); stop.Dispose(); start.Dispose(); }
}
public static class CaptureDebugger {
    public static Dictionary<string,object> Run(string exe,string arguments) {
        var result = new Dictionary<string,object>();
        var text = new StringBuilder();
        var gate = new object();
        bool overflow=false;
        var drained=new CountdownEvent(2);
        var timer=Stopwatch.StartNew();
        using(var process=new Process()) {
            process.StartInfo=new ProcessStartInfo(exe,arguments) { UseShellExecute=false, CreateNoWindow=true,
                RedirectStandardOutput=true, RedirectStandardError=true };
            DataReceivedEventHandler collect=(s,e)=> {
                if(e.Data==null) { drained.Signal(); return; }
                lock(gate) {
                    if(text.Length+e.Data.Length+1>65536) { overflow=true; return; }
                    text.AppendLine(e.Data);
                }
            };
            process.OutputDataReceived+=collect; process.ErrorDataReceived+=collect;
            process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
            // No tree termination: this process is CDB -pvr -pd, not the target.
            if(!process.WaitForExit(5000)) { result["status"]="timed-out"; process.Kill(); }
            else { result["status"]="exited"; result["code"]=process.ExitCode; }
            int remaining=(int)Math.Max(0,5000-timer.ElapsedMilliseconds);
            if(!drained.Wait(remaining) && !result.ContainsKey("code")) result["status"]="timed-out";
            else if(drained.CurrentCount!=0) result["status"]="output-incomplete";
            lock(gate) { result["text"]=text.ToString(); if(overflow) result["status"]="output-exceeded"; }
        }
        result["durationMs"]=timer.ElapsedMilliseconds;
        return result;
    }
}
'@
function UnknownSnapshot($targetId,$reason) {
    Emit @{ kind='snapshot'; pid=$targetId; utcMs=UtcMs; identity='unknown';
            status='unknown'; reason=$reason; text=''; durationMs=0 }
}
function Inspect($request) {
    $starts = @($request.events | Where-Object { $_.kind -eq 'start' })
    if ($starts.Count -ne 2) { Emit @{ kind='unknown'; reason='identity-count' }; return }
    foreach ($start in $starts) {
        # Stop evidence prohibits a PID attach, even if Windows has reused it.
        if (@($request.events | Where-Object { $_.kind -eq 'stop' -and $_.pid -eq $start.pid }).Count -gt 0) { continue }
        $observed = Get-CimInstance Win32_Process -Filter "ProcessId=$($start.pid)" -Property ProcessId,ParentProcessId,CreationDate,Name -OperationTimeoutSec 1
        if (-not $observed -or $observed.ParentProcessId -ne $start.parentPid -or $observed.Name -ine $start.name) {
            UnknownSnapshot $start.pid 'identity-race'; continue
        }
        $created = ([DateTimeOffset]$observed.CreationDate).ToUnixTimeMilliseconds()
        $lower = if ($start.name -eq 'powershell.exe') { $request.target.beforeUtcMs } else { $starts[0].utcMs }
        if ($created -lt $lower -or $created -gt $start.utcMs) { UnknownSnapshot $start.pid 'creation-race'; continue }
        $commands = '.time;~*k 20;!handle 0 f File;!handle 0 b Process;!handle 0 b Thread;'
        if ($start.name -eq 'powershell.exe') { $commands += '.loadby sos clr;~*e !clrstack -n;' }
        $commands += 'qd'
        $arguments = '-pvr -pd -sins -noshell -netsyms no -y "' + $SymbolCache + '" -p ' + $start.pid + ' -c "' + $commands + '"'
        $snapshot = [CaptureDebugger]::Run($Cdb,$arguments)
        $snapshot.kind='snapshot'; $snapshot.pid=$start.pid; $snapshot.utcMs=UtcMs
        $after = Get-CimInstance Win32_Process -Filter "ProcessId=$($start.pid)" -Property CreationDate -OperationTimeoutSec 1
        $snapshot.identity = if ($after -and $after.CreationDate -eq $observed.CreationDate) { 'verified' } else { 'unknown' }
        if ($snapshot.identity -eq 'unknown') { $snapshot.text='' }
        Emit $snapshot
    }
}
Emit @{ kind='startup'; stage='create-watchers' }
$watch = New-Object CaptureEvents
$clock = [Diagnostics.Stopwatch]::StartNew()
try {
    $watch.Arm()
    Emit @{ kind='ready'; utcMs=UtcMs }
    $inputTask = [CaptureInput]::Read()
    $rounds=0
    while ($clock.ElapsedMilliseconds -lt 120000) {
        if ($watch.Overflow) { Emit @{ kind='overflow' }; break }
        for ($index=0; $index -lt 256; $index++) {
            $record=$watch.Take()
            if ($null -eq $record) { break }
            Emit $record
        }
        if ($inputTask.IsCompleted) {
            $line=$inputTask.Result
            if ($null -eq $line -or $line.Length -gt 65536) { break }
            $request=$line | ConvertFrom-Json
            if ($request.kind -eq 'stop') { break }
            if ($request.kind -eq 'sample' -and $rounds -lt 2) { $rounds++; Inspect $request }
            $inputTask = [CaptureInput]::Read()
        }
        [Threading.Thread]::Sleep(20)
    }
} catch { Emit @{ kind='unknown'; reason='native-observer-failed' } }
finally { $watch.Dispose() }
