const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- 설정 영역 ---
const CONFIG = {
    // n8n 외부 접속 주소가 결정되면 아래에 입력하세요 (예: 'https://n8n.yourdomain.com')
    WEBHOOK_URL: 'https://n8n.git3827.store',
    LOG_DIR: path.join(__dirname, 'logs')
};

if (!fs.existsSync(CONFIG.LOG_DIR)) {
    fs.mkdirSync(CONFIG.LOG_DIR);
}

const activeProcesses = new Map();
const logStreams = new Map(); // [수정 1] 스트림 캐싱용 Map 추가

function getLogStream(name) {
    // [수정 1] 매번 파일을 열지 않고 캐시된 스트림을 재사용
    if (!logStreams.has(name)) {
        const stream = fs.createWriteStream(path.join(CONFIG.LOG_DIR, `${name}.log`), { flags: 'a' });
        logStreams.set(name, stream);
    }
    return logStreams.get(name);
}

function log(name, message) {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${name}] ${message}\n`;
    process.stdout.write(formattedMessage);
    getLogStream(name).write(formattedMessage);
}

let isShuttingDown = false; // [수정 3] 중복 종료 방지용 플래그
let hasBrowserOpened = false; // 브라우저 자동 실행 중복 방지용 플래그

function startProcess(name, command, args) {
    log(name, `Starting ${name}...`);

    const env = { ...process.env };
    if (name === 'n8n') {
        if (CONFIG.WEBHOOK_URL) {
            env.WEBHOOK_URL = CONFIG.WEBHOOK_URL;
        }
        // OAuth 인증 시 발생하는 Header Too Large (431) 에러 방지 (기본 8KB -> 32KB)
        env.NODE_OPTIONS = '--max-http-header-size=32768';
    }

    const child = spawn(command, args, { 

        shell: true,
        env: env
    });

    activeProcesses.set(name, child);
    const stream = getLogStream(name);

    child.stdout.on('data', (data) => {
        stream.write(data);
        // n8n이 구동 완료 메시지를 뱉으면 브라우저를 한 번만 자동 실행
        // (주의: 'ready'로 잡으면 UI 라우트가 맵핑되기 전이라 Cannot GET / 이 뜨므로 'accessible'을 사용)
        if (name === 'n8n' && !hasBrowserOpened && data.toString().toLowerCase().includes('accessible')) {
            hasBrowserOpened = true;
            log('SYSTEM', 'n8n is fully ready! Automatically opening browser...');
            const startCmd = process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
            const openUrl = CONFIG.WEBHOOK_URL || 'http://localhost:5678';
            exec(`${startCmd} ${openUrl}`);
        }
    });
    child.stderr.on('data', (data) => stream.write(data));

    child.on('error', (err) => {
        log(name, `Failed to start: ${err.message}`);
    });

    child.on('close', (code) => {
        activeProcesses.delete(name);
        // [수정 3] 시스템 종료 중일 때는 재시작을 시도하지 않음
        if (code !== null && !isShuttingDown) {
            log(name, `Process exited with code ${code}. Restarting in 5 seconds...`);
            setTimeout(() => startProcess(name, command, args), 5000);
        }
    });

    return child;
}

// [수정 2] Windows 환경에서의 좀비 프로세스 방지를 위한 프로세스 트리 강제 종료 함수
function killProcessTree(pid) {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            // /T (Tree kill: 자식 프로세스까지 모두 종료), /F (Force kill: 강제 종료)
            exec(`taskkill /PID ${pid} /T /F`, (err) => {
                resolve();
            });
        } else {
            // Linux/Mac 호환성 (Process Group Kill)
            try { process.kill(-pid, 'SIGKILL'); } catch (e) { }
            resolve();
        }
    });
}

// 종료 신호 처리 (Ctrl+C 등)
async function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true; // 중복 실행 방지

    log('SYSTEM', 'Shutting down all processes...');

    const killPromises = [];
    for (const [name, child] of activeProcesses) {
        log('SYSTEM', `Stopping ${name} (PID: ${child.pid})...`);
        killPromises.push(killProcessTree(child.pid)); // [수정 2] taskkill 적용
    }

    await Promise.all(killPromises);

    // [수정 1] 사용이 끝난 파일 스트림 안전하게 닫기
    for (const stream of logStreams.values()) {
        stream.end();
    }

    log('SYSTEM', 'All processes stopped safely.');
    setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 1. n8n 실행
startProcess('n8n', 'n8n', ['start']);

// 2. cloudflared 터널 실행
startProcess('cloudflared', 'cloudflared', ['tunnel', 'run', 'n8n-tunnel']);

log('SYSTEM', 'Manager started. Monitoring n8n and cloudflared...');
