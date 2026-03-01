# 核心业务逻辑（伪代码）

## 1) 会话创建与读循环
```text
createSession(request):
  sessionType = resolve(request)
  params = normalize(request)
  runtime = createRuntime(local pty or ssh shell)
  session = new TerminalSession(..., ringBuffer, contextTracker, screenTracker)
  sessions.put(sessionId, session)
  startReadLoop(session)
  return {sessionId, wsUrl, startedAt}

startReadLoop(session):
  while runtime still alive:
    chunk = runtime.readOutput()
    if chunk exists:
      seq++
      ringBuffer.append(seq, chunk)
      contextTracker.onOutput(seq, chunk)
      screenTracker.onOutput(seq, chunk)
      broadcastToAttachedClients({type:"output", seq, data})
  on exit/error:
    contextTracker.onSessionClosed(exitCode)
    broadcast({type:"exit" or "error"})
    close session
```

## 2) 断线重连补发
```text
attachWebSocket(sessionId, clientId, ws, lastSeenSeq):
  cancelDetachedKillTask(session)
  bind clientId -> ws
  replay ringBuffer where seq > lastSeenSeq
  if requested seq too old:
    send {type:"truncated", requestedAfterSeq, firstAvailableSeq, latestSeq}
```

## 3) 文件下载 ticket
```text
createDownloadTicket(mode, sessionId, actor, path/paths, ttl):
  validate mode and payload
  ticket = random
  save in memory with expiresAt and actor/session binding
  return {ticket, downloadUrl, expiresAt}

consume(ticket, expectedSessionId, expectedMode, actor):
  payload = remove(ticket)
  validate exists, not expired, session/mode/actor match
  return payload
```

## 4) SSH exec
```text
execute(request):
  validate credentialId and command
  credential = credentialStore.resolveCredential(...)
  lease = connectionPool.acquire(credential)
  wrapped = bash -lc "cd cwd && ENV=... command"
  run channel exec with timeout
  collect stdout/stderr with maxOutputBytes truncation
  return {stdout, stderr, exitCode, durationMs, timedOut, ...}
```

## 5) Agent run 审批执行
```text
createRun(sessionId, request):
  reject if another active run exists
  plannedSteps = planner.plan(instruction, sessionContext)
  append workspace.context_pack step if selectedPaths provided
  first step -> WAITING_APPROVAL
  run status -> WAITING_APPROVAL

approveNextStep(runId, confirmRisk):
  find WAITING_APPROVAL step
  if step.highRisk and !confirmRisk: reject
  mark EXECUTING and execute tool with timeout
  if success: step COMPLETED and next step WAITING_APPROVAL or run COMPLETED
  if timeout/error: step FAILED and run FAILED
```

## 6) Workspace context-pack
```text
pack(paths, includeGitDiff, maxBytes):
  workspaceRoot = nearest .git from current cwd
  normalize and validate all paths under workspaceRoot
  read files (single file capped) until byte budget used
  optional git diff (also budget constrained)
  return {entries, gitDiff, truncated}
```
