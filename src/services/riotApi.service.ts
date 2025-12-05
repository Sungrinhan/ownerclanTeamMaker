import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';
import Bottleneck from 'bottleneck';
import { RiotAccount, Summoner, MatchDto, PlayerStats } from '../types/riot.types';

dotenv.config();

const RIOT_API_KEY = process.env.RIOT_API_KEY;
const REGIONS = {
  asia: 'https://asia.api.riotgames.com',
  kr: 'https://kr.api.riotgames.com'
};

class RiotApiService {
  private asiaClient: AxiosInstance;
  private krClient: AxiosInstance;
  private limiter: Bottleneck;
  private matchCache: Map<string, Promise<MatchDto>>;

  constructor() {
    this.matchCache = new Map();
    this.asiaClient = axios.create({
      baseURL: REGIONS.asia,
      headers: {
        'X-Riot-Token': RIOT_API_KEY
      }
    });

    this.krClient = axios.create({
      baseURL: REGIONS.kr,
      headers: {
        'X-Riot-Token': RIOT_API_KEY
      }
    });

    // Rate Limiter 설정
    // 1초에 20회 (minTime: 50ms)
    // 2분에 100회 (reservoir: 100, refresh: 2분)
    this.limiter = new Bottleneck({
      minTime: 1200, // 안전하게 1.2초마다 1번 호출로 변경 (2분 100회 준수: 120초/100회 = 1.2초)
                     // Burst(1초 20회)보다 Long-term(2분 100회)이 훨씬 빡빡하므로
                     // Long-term에 맞춰서 호출 속도를 조절하는 것이 가장 안전함.
                     // 20명 * 20경기 = 400회 요청 -> 약 8분 소요 예상 (매우 느림)
                     // 하지만 429를 피하려면 어쩔 수 없음.
                     // 개발자 키 한계를 고려해 minTime을 100ms 정도로 하고 reservoir로 조절 시도
      reservoir: 100,
      reservoirRefreshAmount: 100,
      reservoirRefreshInterval: 120 * 1000,
      maxConcurrent: 1
    });

    // 429 에러 발생 시 자동 재시도 설정
    this.limiter.on('failed', async (error: any, jobInfo) => {
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers['retry-after']
          ? parseInt(error.response.headers['retry-after']) * 1000
          : 10000; // 기본 10초 대기
        console.log(`Rate limit exceeded. Retrying after ${retryAfter}ms...`);
        return retryAfter;
      }
    });

    // 클라이언트의 get 메서드를 래핑하지 않고, 호출할 때 limiter.schedule 사용
  }

  // 계정 정보 가져오기 (gameName#tagLine)
  async getAccountByRiotId(gameName: string, tagLine: string): Promise<RiotAccount> {
    return this.limiter.schedule(async () => {
      try {
        const response = await this.asiaClient.get<RiotAccount>(
          `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
        );
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 429) {
          throw new Error('API 요청 한도 초과 (잠시 후 다시 시도해주세요)');
        }
        throw new Error(`계정을 찾을 수 없습니다: ${gameName}#${tagLine}`);
      }
    });
  }

  // PUUID로 소환사 정보 가져오기
  async getSummonerByPuuid(puuid: string): Promise<Summoner> {
    return this.limiter.schedule(async () => {
      try {
        const response = await this.krClient.get<Summoner>(
          `/lol/summoner/v4/summoners/by-puuid/${puuid}`
        );
        return response.data;
      } catch (error: any) {
        throw new Error(`소환사 정보를 가져올 수 없습니다: ${error.message}`);
      }
    });
  }

  // 매치 이력 가져오기
  async getMatchHistory(puuid: string, count: number = 20): Promise<string[]> {
    return this.limiter.schedule(async () => {
      try {
        const response = await this.asiaClient.get<string[]>(
          `/lol/match/v5/matches/by-puuid/${puuid}/ids`,
          {
            params: {
              start: 0,
              count: count,
              type: 'ranked' // 랭크 게임만
            }
          }
        );
        return response.data;
      } catch (error: any) {
        throw new Error(`매치 이력을 가져올 수 없습니다: ${error.message}`);
      }
    });
  }

  // 매치 상세 정보 가져오기 (캐싱 적용)
  async getMatchDetails(matchId: string): Promise<MatchDto> {
    // 이미 요청 중이거나 완료된 매치인지 확인
    if (this.matchCache.has(matchId)) {
      return this.matchCache.get(matchId)!;
    }

    // 새로운 요청 생성 및 캐시에 저장
    const matchPromise = this.limiter.schedule(async () => {
      try {
        const response = await this.asiaClient.get<MatchDto>(
          `/lol/match/v5/matches/${matchId}`
        );
        return response.data;
      } catch (error: any) {
        // 에러 발생 시 캐시에서 제거하여 재시도 가능하게 함
        this.matchCache.delete(matchId);
        throw new Error(`매치 정보를 가져올 수 없습니다: ${error.message}`);
      }
    });

    this.matchCache.set(matchId, matchPromise);
    return matchPromise;
  }

  // 플레이어 통계 분석
  async analyzePlayerStats(
    gameName: string, 
    tagLine: string,
    onProgress?: (message: string) => void
  ): Promise<PlayerStats> {
    try {
      // 1. 계정 정보 가져오기
      const account = await this.getAccountByRiotId(gameName, tagLine);
      
      // 2. 매치 이력 가져오기 (20경기)
      if (onProgress) onProgress('매치 기록 조회 중...');
      const matchIds = await this.getMatchHistory(account.puuid, 20);
      
      if (matchIds.length === 0) {
        throw new Error('최근 랭크 게임 이력이 없습니다');
      }

      // 3. 각 매치의 상세 정보 가져오기
      // 병렬 처리하되 진행 상황 알림
      let completedMatches = 0;
      const matchPromises = matchIds.map(async (matchId) => {
        try {
          const match = await this.getMatchDetails(matchId);
          completedMatches++;
          if (onProgress) {
            onProgress(`매치 데이터 분석 중... (${completedMatches}/${matchIds.length})`);
          }
          return match;
        } catch (error: any) {
          console.error(`매치 ${matchId} 조회 실패:`, error.message);
          return null;
        }
      });

      const matches = (await Promise.all(matchPromises)).filter(m => m !== null) as MatchDto[];

      // 4. 통계 계산
      let totalKills = 0;
      let totalDeaths = 0;
      let totalAssists = 0;
      let totalCS = 0;
      let wins = 0;
      const laneCount: Record<string, number> = {
        TOP: 0,
        JUNGLE: 0,
        MIDDLE: 0,
        BOTTOM: 0,
        UTILITY: 0
      };

      matches.forEach(match => {
        const participant = match.info.participants.find(
          p => p.puuid === account.puuid
        );

        if (participant) {
          totalKills += participant.kills;
          totalDeaths += participant.deaths;
          totalAssists += participant.assists;
          totalCS += participant.totalMinionsKilled + participant.neutralMinionsKilled;
          
          if (participant.win) wins++;

          // 포지션 카운트 (개인 포지션 우선, 없으면 팀 포지션)
          const position = participant.individualPosition || participant.teamPosition;
          if (position && laneCount.hasOwnProperty(position)) {
            laneCount[position]++;
          }
        }
      });

      const gamesPlayed = matches.length;
      const avgKills = totalKills / gamesPlayed;
      const avgDeaths = totalDeaths / gamesPlayed;
      const avgAssists = totalAssists / gamesPlayed;
      
      // 분당 CS 계산을 위한 총 게임 시간 합계가 필요하지만, 
      // 간단하게 매치별 분당 CS의 평균을 구하거나, 전체 CS / 전체 시간으로 구할 수 있음.
      // 여기서는 정확도를 위해 매치별 분당 CS를 구해서 평균내는 방식으로 개선이 필요하나
      // 기존 구조상 totalCS만 있으므로, 매치 루프에서 게임 시간도 수집했어야 함.
      // 아래 로직을 수정하여 게임 시간도 수집하도록 변경.
      
      let totalCSPM = 0;
      matches.forEach(match => {
        const participant = match.info.participants.find(p => p.puuid === account.puuid);
        if (participant) {
          const gameDurationMinutes = match.info.gameDuration / 60;
          const cs = participant.totalMinionsKilled + participant.neutralMinionsKilled;
          if (gameDurationMinutes > 0) {
            totalCSPM += (cs / gameDurationMinutes);
          }
        }
      });
      
      const avgCSPM = totalCSPM / gamesPlayed; // 평균 분당 CS
      const avgCS = totalCS / gamesPlayed; // (참고용) 평균 총 CS

      const kda = avgDeaths > 0 ? (avgKills + avgAssists) / avgDeaths : avgKills + avgAssists;
      const winRate = (wins / gamesPlayed) * 100;

      // 선호 라인 찾기
      const preferredLane = Object.entries(laneCount).reduce((a, b) => 
        laneCount[a[0]] > laneCount[b[0]] ? a : b
      )[0];

      // 팀 기여도 계산 (개선된 공식)
      // KDA: 보통 3.0 정도가 평균. 3.0 -> 60점
      // 승률: 50% -> 50점
      // 분당 CS: 6.0 -> 60점
      const teamContribution = (kda * 20) + (winRate * 1) + (avgCSPM * 10);

      return {
        gameName,
        tagLine,
        puuid: account.puuid,
        avgKills: Math.round(avgKills * 100) / 100,
        avgDeaths: Math.round(avgDeaths * 100) / 100,
        avgAssists: Math.round(avgAssists * 100) / 100,
        avgCS: Math.round(avgCSPM * 10) / 10, // 분당 CS로 변경하여 반환 (소수점 1자리)
        kda: Math.round(kda * 100) / 100,
        winRate: Math.round(winRate * 100) / 100,
        preferredLane,
        laneDistribution: {
          TOP: laneCount.TOP,
          JUNGLE: laneCount.JUNGLE,
          MIDDLE: laneCount.MIDDLE,
          BOTTOM: laneCount.BOTTOM,
          UTILITY: laneCount.UTILITY
        },
        totalGames: gamesPlayed,
        teamContribution: Math.round(teamContribution * 100) / 100
      };
    } catch (error: any) {
      throw new Error(`플레이어 통계 분석 실패: ${error.message}`);
    }
  }
}

export default new RiotApiService();

