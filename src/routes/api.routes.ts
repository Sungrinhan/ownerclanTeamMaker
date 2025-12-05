import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import riotApiService from '../services/riotApi.service';
import teamMakerService from '../services/teamMaker.service';
import { PlayerStats } from '../types/riot.types';

const router = Router();

// Rate Limiter 설정 (2분에 1회 요청)
const teamMakerLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2분
  max: 1, // 허용 횟수
  message: {
    success: false,
    error: '너무 많은 요청이 발생했습니다. 2분 후에 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 단일 플레이어 정보 조회
router.get('/player/:gameName/:tagLine', async (req: Request, res: Response) => {
  try {
    const { gameName, tagLine } = req.params;
    const playerStats = await riotApiService.analyzePlayerStats(gameName, tagLine);
    res.json({
      success: true,
      data: playerStats
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// 여러 플레이어 정보 조회
router.post('/players', async (req: Request, res: Response) => {
  try {
    const { players } = req.body;
    
    if (!Array.isArray(players) || players.length === 0) {
      return res.status(400).json({
        success: false,
        error: '플레이어 목록이 필요합니다'
      });
    }

    // 각 플레이어의 통계 분석 (병렬 처리)
    const playerStatsPromises = players.map(({ gameName, tagLine }: { gameName: string; tagLine: string }) =>
      riotApiService.analyzePlayerStats(gameName, tagLine)
        .catch(error => ({
          error: true,
          gameName,
          tagLine,
          message: error.message
        }))
    );

    const results = await Promise.all(playerStatsPromises);
    
    // 성공한 것과 실패한 것 분리
    const successful = results.filter(r => !('error' in r)) as PlayerStats[];
    const failed = results.filter(r => 'error' in r);

    res.json({
      success: true,
      data: {
        successful,
        failed,
        totalRequested: players.length,
        totalSuccessful: successful.length,
        totalFailed: failed.length
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 팀 분배 API (SSE 적용)
router.post('/divide-teams', teamMakerLimiter, async (req: Request, res: Response) => {
  try {
    const { players } = req.body;
    
    if (!Array.isArray(players) || players.length < 10 || players.length % 5 !== 0) {
      return res.status(400).json({
        success: false,
        error: '플레이어 수는 10명 이상이어야 하며, 5명 단위여야 합니다 (현재: ' + players.length + '명)'
      });
    }

    // SSE 헤더 설정
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // 초기 상태 전송
    sendEvent({ type: 'progress', message: '플레이어 분석 시작...', percent: 0 });

    const playerStats: PlayerStats[] = [];
    let completedCount = 0;
    const totalPlayers = players.length;

    // 각 플레이어 순차적으로 처리 (병렬 처리 시 진행률 표기가 어려울 수 있어 순차 혹은 배치 처리)
    // 하지만 병렬로 하되 완료 시마다 이벤트를 보내면 됨.
    const promises = players.map(async ({ gameName, tagLine }, index) => {
      try {
        const stats = await riotApiService.analyzePlayerStats(
          gameName, 
          tagLine,
          (progressMsg) => {
            // 너무 잦은 업데이트 방지 (선택적)
            // 개별 플레이어의 상세 진행 상황은 전체 진행률 계산에 반영하지 않고 메시지만 업데이트하거나
            // 현재 분석 중인 플레이어의 상세 상태를 보냄
            sendEvent({
              type: 'progress',
              message: `${gameName}: ${progressMsg}`,
              percent: Math.round((completedCount / totalPlayers) * 90)
            });
          }
        );
        
        playerStats.push(stats);
        completedCount++;
        
        const percent = Math.round((completedCount / totalPlayers) * 90); // 90%까지는 분석 단계
        sendEvent({ 
          type: 'progress', 
          message: `${gameName} 분석 완료 (${completedCount}/${totalPlayers})`, 
          percent 
        });
        return stats;
      } catch (error: any) {
        // 실패 시 에러 메시지 전송하지만 전체 프로세스는 계속 진행
        sendEvent({
          type: 'progress', // 에러도 진행의 일부로 처리
          message: `⚠️ ${gameName} 분석 실패: ${error.message}`,
          percent: Math.round((completedCount / totalPlayers) * 90)
        });
        // 실패 카운트도 증가시켜야 무한 대기 방지
        completedCount++;
        return null; 
      }
    });

    await Promise.all(promises);

    // 성공한 데이터만 필터링
    const validStats = playerStats.filter(s => s !== null);
    
    if (validStats.length < 10) {
      throw new Error(`분석 성공한 플레이어가 부족합니다. (성공: ${validStats.length}명)`);
    }

    // 팀 분배 단계
    sendEvent({ type: 'progress', message: '팀 밸런스 조정 중...', percent: 95 });
    
    const teams = teamMakerService.divideIntoTeams(validStats);
    const balance = teamMakerService.calculateTeamBalance(teams);

    // 최종 결과 전송
    sendEvent({
      type: 'complete',
      data: {
        teams,
        balance: Math.round(balance * 100) / 100,
        message: balance < 5 ? '매우 균등한 팀 분배' : balance < 10 ? '균등한 팀 분배' : '팀 분배 완료'
      }
    });

    res.end();
  } catch (error: any) {
    // SSE 도중 에러 발생 시
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    }
  }
});

// 헬스 체크
router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString()
  });
});

export default router;

