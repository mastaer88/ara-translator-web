#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const logDir = path.join(__dirname, 'logs');
const pidFile = path.join(__dirname, '.server.pid');
const logFile = path.join(logDir, `server-${new Date().toISOString().slice(0, 10)}.log`);

// 로그 디렉토리 생성
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(logFile, logMessage + '\n');
}

function getRunningPid() {
  try {
    if (fs.existsSync(pidFile)) {
      return parseInt(fs.readFileSync(pidFile, 'utf8').trim());
    }
  } catch (e) {
    // 파일 읽기 실패
  }
  return null;
}

function isServerRunning(pid) {
  try {
    // 시그널 0으로 프로세스 체크 (실제로 신호를 보내지 않음)
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function startServer() {
  const existingPid = getRunningPid();
  if (existingPid && isServerRunning(existingPid)) {
    log(`❌ 서버가 이미 실행 중입니다 (PID: ${existingPid})`);
    return;
  }

  log(`🚀 서버 시작 중...`);

  const server = spawn('npm', ['run', 'dev'], {
    cwd: __dirname,
    stdio: ['inherit', 'pipe', 'pipe'],
    detached: false
  });

  // PID 저장
  fs.writeFileSync(pidFile, server.pid.toString());
  log(`✅ 서버 시작됨 (PID: ${server.pid})`);

  // stdout/stderr 로깅
  server.stdout.on('data', (data) => {
    const message = data.toString().trim();
    if (message) {
      log(`[STDOUT] ${message}`);
      process.stdout.write(data);
    }
  });

  server.stderr.on('data', (data) => {
    const message = data.toString().trim();
    if (message) {
      log(`[STDERR] ${message}`);
      process.stderr.write(data);
    }
  });

  server.on('close', (code) => {
    log(`⚠️  서버 종료됨 (코드: ${code})`);
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  });

  server.on('error', (err) => {
    log(`❌ 서버 실행 오류: ${err.message}`);
  });
}

function stopServer() {
  const pid = getRunningPid();
  if (!pid || !isServerRunning(pid)) {
    log(`❌ 실행 중인 서버가 없습니다`);
    return;
  }

  log(`🛑 서버 중지 중... (PID: ${pid})`);
  try {
    process.kill(pid, 'SIGTERM');
    setTimeout(() => {
      if (isServerRunning(pid)) {
        log(`⚠️  SIGTERM이 먹지 않아 SIGKILL 시도 중...`);
        process.kill(pid, 'SIGKILL');
      }
    }, 3000);
    log(`✅ 서버 중지 신호 전송됨`);
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch (err) {
    log(`❌ 서버 중지 오류: ${err.message}`);
  }
}

function restartServer() {
  log(`🔄 서버 재시작 중...`);
  stopServer();
  setTimeout(() => {
    startServer();
  }, 2000);
}

function viewLogs() {
  console.clear();
  console.log('\n📋 === 서버 로그 ===\n');

  if (!fs.existsSync(logFile)) {
    console.log('아직 로그가 없습니다.');
    showMenu();
    return;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(logFile),
    crlfDelay: Infinity
  });

  let lineCount = 0;
  rl.on('line', (line) => {
    console.log(line);
    lineCount++;
  });

  rl.on('close', () => {
    console.log(`\n(총 ${lineCount}줄)\n`);
    setTimeout(() => showMenu(), 1000);
  });
}

function showStatus() {
  console.clear();
  console.log('\n📊 === 서버 상태 ===\n');

  const pid = getRunningPid();
  if (pid && isServerRunning(pid)) {
    console.log(`✅ 서버 실행 중`);
    console.log(`   PID: ${pid}`);
  } else {
    console.log(`⚫ 서버 중지됨`);
  }

  if (fs.existsSync(logFile)) {
    const stats = fs.statSync(logFile);
    console.log(`   로그 파일: ${logFile}`);
    console.log(`   크기: ${(stats.size / 1024).toFixed(2)} KB`);
  }

  console.log('\n');
  setTimeout(() => showMenu(), 1000);
}

function showMenu() {
  console.clear();
  console.log('\n🌐 === Ara Translator Web Server Manager ===\n');

  const pid = getRunningPid();
  const isRunning = pid && isServerRunning(pid);
  console.log(`상태: ${isRunning ? '✅ 실행 중' : '⚫ 중지됨'}\n`);

  console.log('옵션:');
  console.log('  1. 🚀 서버 시작');
  console.log('  2. 🛑 서버 중지');
  console.log('  3. 🔄 서버 재시작');
  console.log('  4. 📋 로그 보기');
  console.log('  5. 📊 상태 확인');
  console.log('  0. 🚪 종료\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('선택: ', (choice) => {
    rl.close();

    switch (choice.trim()) {
      case '1':
        startServer();
        setTimeout(() => showMenu(), 2000);
        break;
      case '2':
        stopServer();
        setTimeout(() => showMenu(), 1500);
        break;
      case '3':
        restartServer();
        setTimeout(() => showMenu(), 4000);
        break;
      case '4':
        viewLogs();
        break;
      case '5':
        showStatus();
        break;
      case '0':
        console.log('\n👋 종료합니다.\n');
        process.exit(0);
        break;
      default:
        console.log('\n❌ 잘못된 선택입니다.\n');
        setTimeout(() => showMenu(), 1000);
    }
  });
}

// 명령줄 인자 처리
const args = process.argv.slice(2);
if (args.length > 0) {
  const command = args[0].toLowerCase();
  switch (command) {
    case 'start':
      startServer();
      break;
    case 'stop':
      stopServer();
      process.exit(0);
      break;
    case 'restart':
      restartServer();
      break;
    case 'logs':
      viewLogs();
      break;
    case 'status':
      showStatus();
      break;
    default:
      console.log('알 수 없는 명령: ' + command);
      console.log('\n사용법:');
      console.log('  node server-manager.js          # 대화형 메뉴');
      console.log('  node server-manager.js start    # 서버 시작');
      console.log('  node server-manager.js stop     # 서버 중지');
      console.log('  node server-manager.js restart  # 서버 재시작');
      console.log('  node server-manager.js logs     # 로그 보기');
      console.log('  node server-manager.js status   # 상태 확인\n');
  }
} else {
  // 대화형 메뉴
  showMenu();
}
