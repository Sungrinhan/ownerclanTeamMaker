# 🎮 LOL 팀 메이커

League of Legends API를 활용하여 소환사들의 실력을 분석하고, **최적의 밸런스**로 팀을 분배해주는 웹 애플리케이션입니다.

## 🌟 주요 기능

### 📊 정교한 플레이어 분석
- Riot API 기반 실시간 전적 검색
- 최근 **20게임** 랭크 데이터 심층 분석
- **팀 기여도(MMR) 산출**: KDA, 승률, **분당 CS(CSPM)** 를 종합적으로 고려
- 주/부 포지션 자동 감지 및 최적 라인 배정

### ⚖️ 스마트한 팀 밸런싱
- **유동적 인원 지원**: 10명(2팀), 15명(3팀), 20명(4팀) 등 5명 단위로 자유롭게 구성 가능
- **스네이크 드래프트**: 실력 순으로 1→2→3→3→2→1 방식으로 공정하게 분배
- **포지션 최적화**: 각 팀 내에서 플레이어들의 선호 라인이 겹치지 않도록 자동 조정

### ⚡ 향상된 사용자 경험
- **실시간 진행 상황(SSE)**: 분석 진행률을 실시간 게이지로 확인
- **API 제한 자동 관리**: Riot API의 호출 제한(Rate Limit)을 준수하며, 대기 시 자동 재시도 및 알림
- **재미 요소(Easter Egg)**:
  - 로딩 중 롤 관련 드립(밈) 출력
  - 결과 화면에 랜덤 팀 별명 부여 (예: '즐겜러들의 향우회')
  - 특정 닉네임(Faker 등) 입력 시 히든 메시지

## 🚀 시작하기

### 사전 요구사항
- Node.js (v14 이상)
- Riot Games Developer API Key

### Riot API Key 발급
1. [Riot Developer Portal](https://developer.riotgames.com/)에 접속
2. 로그인 후 "REGENERATE API KEY" 클릭
3. 발급받은 API Key를 복사 (24시간마다 갱신 필요)

### 설치 및 실행

1. 패키지 설치
```bash
npm install
```

2. 환경변수 설정
프로젝트 루트에 `.env` 파일을 생성하고 키를 입력하세요:
```env
RIOT_API_KEY=RGAPI-YOUR-KEY-HERE
PORT=3010
```

3. 서버 실행
```bash
npm run start
# 또는 개발 모드: npm run dev
```

4. 사용하기
- 브라우저에서 `http://localhost:3010` 접속
- 참여할 소환사들의 `게임명#태그` 입력 (최소 10명)
- "팀 분배하기" 클릭

## 📁 프로젝트 구조

```
lol-team-maker/
├── src/
│   ├── services/
│   │   ├── riotApi.service.ts  # Riot API 연동 (Rate Limit, Caching)
│   │   └── teamMaker.service.ts # 팀 분배 및 밸런싱 알고리즘
│   ├── routes/
│   │   └── api.routes.ts       # SSE 스트리밍 API
│   └── types/
│       └── riot.types.ts       # 타입 정의
├── public/
│   └── index.html              # UI (실시간 프로그레스바, 이스터에그)
└── ...
```

## 📊 팀 기여도 공식
단순 KDA나 승률만 보지 않고, **분당 CS(CSPM)** 를 포함하여 더 정확한 실력을 측정합니다.

```typescript
TeamContribution = (KDA × 20) + (승률 × 1) + (분당CS × 10)
```
*예: KDA 3.0, 승률 50%, 분당CS 7.0 인 경우 → 60 + 50 + 70 = 180점*

## ⚠️ 주의사항
- **API 속도 제한**: Riot 개발자 키는 **2분에 100회** 요청 제한이 있습니다. 20명 분석 시 약 400회 이상의 요청이 필요하므로, 분석 속도가 자동으로 조절됩니다. (429 에러 방지)
- 최근 랭크 게임 기록이 없는 플레이어는 분석에서 제외될 수 있습니다.

## 📝 라이선스
ISC

---
Made with ❤️ using Riot Games API
