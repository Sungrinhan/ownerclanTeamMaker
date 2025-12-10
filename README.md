# 🎮 오너클랜 롤 대회 팀 메이커 (LOL Team Maker)

리그 오브 레전드(League of Legends) 내전 및 대회를 위한 **자동 팀 밸런싱 시스템**입니다.  
플레이어들의 최근 전적과 티어를 실시간으로 분석하여, 가장 공정하고 재미있는 경기가 될 수 있도록 팀을 구성해줍니다.

## ✨ 주요 기능

### 1. 소환사 정보 입력
- **다양한 입력 방식**: 
  - 20명의 플레이어를 개별적으로 입력할 수 있는 폼 제공
  - 엑셀이나 카카오톡 등에서 복사한 명단을 한 번에 넣을 수 있는 **일괄 입력** 지원
- **형식**: `게임명#태그` (예: `Hide on bush#KR1`)

### 2. 정밀한 전적 분석 (Riot API)
Riot Games 공식 API를 활용하여 실시간 데이터를 분석합니다.
- **계정 및 랭크 조회**: 최신 API(PUUID 기반)를 사용하여 정확한 티어(솔로/자유) 정보를 가져옵니다.
- **매치 데이터 분석**: 최근 **20경기 랭크 게임**을 분석하여 상세 지표를 산출합니다.
  - KDA (Kill/Death/Assist)
  - 승률
  - 분당 CS (CSPM) 및 시야 점수 (VSPM)
- **선호 포지션 파악**: 플레이어가 주로 가는 라인을 자동으로 파악하여 팀 배정에 활용합니다.

### 3. 지능형 팀 밸런싱
단순 티어 합산이 아닌, 복합적인 요소를 고려한 자체 MMR 알고리즘을 사용합니다.
- **점수 산출 방식**: `티어 기본 점수` + `랭크 포인트(LP)` + `최근 실력 보정(KDA/승률)`
- **예외 처리**:
  - **언랭크(Unranked)**: 기본 1200점 (실버/골드 구간) 부여
  - **계정 조회 실패**: 500점 부여 (패널티)
- **알고리즘**:
  1. 전체 플레이어를 기여도(MMR) 순으로 정렬
  2. **스네이크 드래프트(Snake Draft)** 방식으로 팀 균등 분배
  3. 팀 내부에서 선호 포지션이 겹치지 않도록 **라인 최적화 배치**

### 4. 사용자 친화적 UI
- **실시간 진행률**: 분석 중인 플레이어와 진행 상황을 %로 표시
- **재미 요소**: 
  - 로딩 중 "야스오가 과학을 증명하는 중..." 같은 롤 관련 밈(Meme) 출력
  - "즐겜러들의 향우회" 등 랜덤 팀 이름 생성
- **결과 리포트**: 
  - 팀별 평균 점수 비교
  - 밸런스 평가 (황금 밸런스 / 좋음 / 보통 / 나쁨)
  - 조회 실패한 계정 시각적 표시

## 💡 서버 운영 및 안정성 (Traffic Control)

이 서비스는 **다수의 사용자가 동시에 접속하는 환경**에서도 Riot API 정책(Rate Limit)을 준수하며 안정적으로 동작하도록 설계되었습니다.

### 1. 전역 대기열 (Global Request Queue)
- **Node.js 싱글톤 패턴**을 활용하여 서버 내 모든 API 요청을 하나의 **Token Bucket**으로 관리합니다.
- 여러 사용자가 동시에 버튼을 눌러도, 서버는 내부적으로 정해진 속도(예: 2분에 100회)에 맞춰 순차적으로 요청을 처리합니다.
- **Smart Retry**: 만약 API 한도 초과(429 Error)가 발생하면, Riot 서버가 지정한 대기 시간(`Retry-After`)만큼 정확히 기다렸다가 자동으로 재시도합니다.

### 2. 사용자 피드백 (Waiting UX)
- 대기열이 길어져 분석이 지연될 경우, 화면에 **"현재 접속자가 많아 대기 중입니다 (대기열: N건)..."** 메시지를 표시하여 사용자 경험(UX)을 개선했습니다.

## 🛠 기술 스택

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: HTML5, CSS3, Vanilla JS
- **API Communication**: Axios, Bottleneck (Rate Limiting 준수), Server-Sent Events (SSE)
- **Deployment**: Local Environment (Windows/Mac/Linux)

## 🚀 설치 및 실행 방법

### 1. 환경 설정
Node.js가 설치되어 있어야 합니다.

1. 프로젝트 클론 또는 다운로드
2. 의존성 설치
   ```bash
   npm install
   # 또는
   yarn install
   ```
3. 환경 변수 설정
   프로젝트 루트에 `.env` 파일을 생성하고 Riot API 키를 입력합니다.
   ([Riot Developer Portal](https://developer.riotgames.com/)에서 발급 가능)
   ```env
   RIOT_API_KEY=RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   PORT=3000
   ```

### 2. 실행
개발 모드 (실시간 수정 반영):
```bash
npm run dev
# 또는
yarn dev
```

프로덕션 빌드 및 실행:
```bash
npm run build
npm start
```

### 3. 사용
브라우저에서 `http://localhost:3000`으로 접속하여 사용합니다.

## ⚠️ 주의사항 및 팁

### 1. API Rate Limit (속도 제한)
Riot Games API는 키 종류에 따라 요청 제한이 다릅니다.
- **App Key (기본)**: 1초에 20회, 2분에 100회
- **Personal Key**: 더 높은 제한량 제공

이 프로젝트는 `Bottleneck` 라이브러리를 통해 **Token Bucket 알고리즘**을 구현하여, 버스트(Burst) 트래픽은 빠르게 처리하되 전체 한도는 넘지 않도록 최적화되어 있습니다.

```typescript
// src/services/riotApi.service.ts

this.limiter = new Bottleneck({
  minTime: 50,      // 최소 50ms 간격 (최대 초당 20회 버스트 가능)
  reservoir: 100,   // 2분당 최대 100회 토큰
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 120 * 1000, // 2분마다 리필
  maxConcurrent: 5  // 동시 처리 개수
});
```

### 2. 계정 형식
반드시 태그(TagLine)까지 포함된 `닉네임#태그` 형식을 사용해야 합니다.
- O: `Hide on bush#KR1`
- X: `Hide on bush`

### 3. 분석 시간
플레이어 1명당 약 20~25회의 API 호출이 발생합니다.
많은 인원을 한 번에 분석할 경우 시간이 다소 소요될 수 있습니다. (20명 기준 약 3~5분)
중복된 매치는 캐싱되어 두 번째 분석부터는 더 빠르게 진행됩니다.

## 📝 라이선스
This project is for educational and non-commercial use.
Riot Games API Terms of Use를 준수합니다.
