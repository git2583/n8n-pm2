# n8n & Cloudflare Tunnel 통합 프로세스 트러블슈팅 리포트 (추가)

## 1. 작업 개요
- **작업 일시**: 2026-05-07
- **핵심 목표**: Google Sheets Trigger OAuth2 인증 설정 및 인증 과정에서 발생한 431 에러(Request Header Fields Too Large) 해결

## 2. 주요 작업 내용 및 트러블슈팅

### 2.1. OAuth Redirect URL 변경 및 설정
- **문제**: Google Sheets Trigger OAuth2 인증을 위한 Redirect URL 주소 확인 및 변경 필요.
- **해결**: 
  - n8n의 Redirect URL은 환경 변수 `WEBHOOK_URL`을 기반으로 생성됨을 확인.
  - `manager.js`의 `CONFIG.WEBHOOK_URL` 값을 `https://n8n.git3827.store.com` (또는 사용자 지정 도메인)으로 수정하여 반영.
  - 해당 주소가 Google Cloud Console의 OAuth 동의 화면 및 사용자 인증 정보에 등록되어야 함을 안내.

### 2.2. OAuth 인증 시 431 에러 (Request Header Fields Too Large) 해결
- **문제 원인**:
  OAuth 인증 과정에서 브라우저와 서버 간에 교환되는 HTTP 헤더(URL, 쿠키 포함)의 크기가 Node.js의 기본 제한 수치(8KB)를 초과하여 발생.
- **해결 방법 (manager.js 패치)**:
  - n8n 자식 프로세스를 생성하는 `startProcess` 함수 내에 `NODE_OPTIONS` 환경 변수를 추가.
  - `--max-http-header-size=32768` 옵션을 주입하여 헤더 허용 크기를 32KB로 확장.
  - **수정된 코드 일부**:
    ```javascript
    if (name === 'n8n') {
        if (CONFIG.WEBHOOK_URL) {
            env.WEBHOOK_URL = CONFIG.WEBHOOK_URL;
        }
        // Header Too Large (431) 에러 방지 (32KB로 확장)
        env.NODE_OPTIONS = '--max-http-header-size=32768';
    }
    ```

### 2.4. 브라우저 자동 실행 시 로컬호스트(localhost) 연결 문제
- **문제**: `node manager.js` 실행 시 n8n 구동 완료 후 브라우저가 외부 접속 주소가 아닌 `http://localhost:5678`로 자동 연결됨.
- **문제 원인**:
  - `manager.js`의 브라우저 실행 코드(`exec`) 내 주소값이 `http://localhost:5678`로 하드코딩되어 있었음.
- **해결 방법**:
  - `CONFIG.WEBHOOK_URL` 변수를 참조하여, 설정된 외부 주소가 있을 경우 해당 주소로 브라우저를 열도록 수정.
  - **수정된 코드 일부**:
    ```javascript
    const openUrl = CONFIG.WEBHOOK_URL || 'http://localhost:5678';
    exec(`${startCmd} ${openUrl}`);
    ```

## 3. 작업 일시: 2026-05-19
- **핵심 목표**: Google Gemini 노드 서비스 가용성 문제 및 Gmail 노드 데이터 타입 오류 해결

## 4. 주요 작업 내용 및 트러블슈팅

### 4.1. Google Gemini 'Service unavailable' (503) 에러 해결
- **문제**: Google Gemini 노드 실행 중 `Service unavailable - try again later` 에러 발생하며 워크플로우 중단.
- **원인**: Google API 서버의 일시적 과부하 또는 무료 티어 할당량 제한으로 인한 응답 거부.
- **해결 방법**:
  - Gemini 노드의 **Settings > On Fail** 설정을 `Retry`로 변경.
  - **Maximum Retries**: 3~5회, **Wait Between Retries**: 5000ms 설정.
  - **Exponential Backoff**를 활성화하여 재시도 간격을 점진적으로 늘려 서버 부하 대응.

### 4.2. Gmail 노드 'trim is not a function' 에러 해결
- **문제**: Gmail 노드에서 메시지 전송 시 `this.getNodeParameter(...).trim is not a function` 에러 발생.
- **원인**: `To`(수신자) 또는 `Message`(본문) 필드에 문자열이 아닌 값(숫자, null, 객체 등)이 전달되어 내부 `.trim()` 함수 호출 실패.
- **해결 방법**:
  - 에러가 발생하는 필드의 표현식을 강제 문자열 변환 방식으로 수정.
  - **수정 예시**: `{{ String($json.variable) }}` 또는 `{{ $json.variable.toString() }}`
  - 데이터가 비어있을 경우를 대비하여 기본값 처리 추가: `{{ $json.variable || "" }}`

## 5. 검증 및 결과
- Gemini 노드에 재시도 로직을 적용하여 일시적인 API 장애 시에도 워크플로우가 자동으로 복구됨을 확인.
- Gmail 노드의 입력값을 문자열로 강제 변환하여 데이터 타입 불일치로 인한 중단 현상 해결.

---
*본 문서는 n8n-pm2 프로젝트의 유지보수 및 향후 유사 에러 대응을 위해 작성되었습니다.*
