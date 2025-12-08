import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';
import Bottleneck from 'bottleneck';
import { RiotAccount, Summoner, MatchDto, PlayerStats, LeagueEntry } from '../types/riot.types';

dotenv.config();

const RIOT_API_KEY = process.env.RIOT_API_KEY;
const REGIONS = {
  asia: 'https://asia.api.riotgames.com',
  kr: 'https://kr.api.riotgames.com'
};

const TIER_SCORES: Record<string, number> = {
  IRON: 0,
  BRONZE: 400,
  SILVER: 800,
  GOLD: 1200,
  PLATINUM: 1600,
  EMERALD: 2000,
  DIAMOND: 2400,
  MASTER: 2800,
  GRANDMASTER: 2800, // LP로 구분
  CHALLENGER: 2800   // LP로 구분
};

const RANK_SCORES: Record<string, number> = {
  IV: 0,
  III: 100,
  II: 200,
  I: 300
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
    this.limiter = new Bottleneck({
      minTime: 1200, 
      reservoir: 100,
      reservoirRefreshAmount: 100,
      reservoirRefreshInterval: 120 * 1000,
      maxConcurrent: 1
    });

    this.limiter.on('failed', async (error: any, jobInfo) => {
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers['retry-after']
          ? parseInt(error.response.headers['retry-after']) * 1000
          : 10000;
        console.log(`Rate limit exceeded. Retrying after ${retryAfter}ms...`);
        return retryAfter;
      }
    });
  }

  // 계정 정보 가져오기 (gameName#tagLine)
  // 실패 시 null 반환 (throw 안 함)
  async getAccountByRiotId(gameName: string, tagLine: string): Promise<RiotAccount | null> {
    return this.limiter.schedule(async () => {
      try {
        const response = await this.asiaClient.get<RiotAccount>(
          `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
        );
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 429) throw error; 
        
        // 403, 404 등 모든 에러에 대해 null 반환하여 "조회 실패" 처리
        console.warn(`계정 조회 실패 (무시됨): ${gameName}#${tagLine}, ${error.message}`);
        return null;
      }
    });
  }

  // PUUID로 소환사 정보 가져오기
  async getSummonerByPuuid(puuid: string): Promise<Summoner | null> {
    return this.limiter.schedule(async () => {
      try {
        const response = await this.krClient.get<Summoner>(
          `/lol/summoner/v4/summoners/by-puuid/${puuid}`
        );
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 429) throw error;
        // 실패 시 null
        return null;
      }
    });
  }

  // 랭크 정보 가져오기 (Summoner ID 기반 - 구버전)
  async getLeagueEntries(summonerId: string): Promise<LeagueEntry[]> {
    return this.limiter.schedule(async () => {
      try {
        const response = await this.krClient.get<LeagueEntry[]>(
          `/lol/league/v4/entries/by-summoner/${summonerId}`
        );
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 429) throw error;
        // 실패 시 빈 배열
        console.warn(`랭크 정보 조회 실패 (무시됨): ${error.message}`);
        return [];
      }
    });
  }

  // 랭크 정보 가져오기 (PUUID 기반 - 신규)
  async getLeagueEntriesByPuuid(puuid: string): Promise<LeagueEntry[]> {
    return this.limiter.schedule(async () => {
      try {
        const response = await this.krClient.get<LeagueEntry[]>(
          `/lol/league/v4/entries/by-puuid/${puuid}`
        );
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 429) throw error;
        console.warn(`랭크 정보 조회 실패 (PUUID): ${error.message}`);
        return [];
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
        if (error.response?.status === 429) throw error;
        // 실패 시 빈 배열
        console.warn(`매치 이력 조회 실패 (무시됨): ${error.message}`);
        return [];
      }
    });
  }

  // 매치 상세 정보 가져오기 (캐싱 적용)
  async getMatchDetails(matchId: string): Promise<MatchDto | null> {
    if (this.matchCache.has(matchId)) {
      return this.matchCache.get(matchId)!;
    }

    const matchPromise = this.limiter.schedule(async () => {
      try {
        const response = await this.asiaClient.get<MatchDto>(
          `/lol/match/v5/matches/${matchId}`
        );
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 429) throw error;
        
        // 실패 시 null
        console.warn(`매치 상세 조회 실패 (무시됨): ${matchId}`);
        return null; // 타입 호환을 위해 any 대신 명시적 null 반환
      }
    });

    // Promise<MatchDto | null> 형태로 저장
    this.matchCache.set(matchId, matchPromise as Promise<MatchDto>);
    return matchPromise;
  }

  // 플레이어 통계 분석 및 점수 산출
  async analyzePlayerStats(
    gameName: string, 
    tagLine: string,
    onProgress?: (message: string) => void
  ): Promise<PlayerStats> {
    
    // 1. 계정 정보 조회 (실패 시 즉시 더미 데이터 반환)
    let account: RiotAccount | null = null;
    try {
      account = await this.getAccountByRiotId(gameName, tagLine);
    } catch (e) {
      // 혹시 모를 throw 방어
    }

    if (!account) {
      console.warn(`[분석 실패] 계정을 찾을 수 없음: ${gameName}#${tagLine}`);
      return {
        gameName,
        tagLine,
        puuid: 'unknown',
        avgKills: 0, avgDeaths: 0, avgAssists: 0, avgCS: 0, kda: 0, winRate: 0,
        preferredLane: 'TOP',
        laneDistribution: { TOP: 0, JUNGLE: 0, MIDDLE: 0, BOTTOM: 0, UTILITY: 0 },
        totalGames: 0,
        teamContribution: 0, // 0점 처리
        tierInfo: undefined
      };
    }

    try {
      // 2. 랭크 정보 조회 (PUUID로 직접 조회)
      // 기존: getSummonerByPuuid -> getLeagueEntries (Deprecated flow)
      // 변경: getLeagueEntriesByPuuid
      
      let rankInfo: LeagueEntry | undefined;
      
      try {
        const leagues = await this.getLeagueEntriesByPuuid(account.puuid);
        const soloRank = leagues.find(l => l.queueType === 'RANKED_SOLO_5x5');
        const flexRank = leagues.find(l => l.queueType === 'RANKED_FLEX_SR');
        rankInfo = soloRank || flexRank;
      } catch (e) {
        console.warn(`랭크 조회 중 에러: ${e}`);
      }

      // 3. 매치 이력 가져오기 (20경기)
      if (onProgress) onProgress('매치 기록 조회 중...');
      let matchIds: string[] = [];
      try {
        matchIds = await this.getMatchHistory(account.puuid, 20);
      } catch (error) {
        matchIds = [];
      }
      
      // 기본값 설정 (성공한 계정 기반)
      const baseStats = {
        gameName,
        tagLine,
        puuid: account.puuid,
        avgKills: 0,
        avgDeaths: 0,
        avgAssists: 0,
        avgCS: 0,
        kda: 0,
        winRate: 0,
        preferredLane: 'TOP',
        laneDistribution: { TOP: 0, JUNGLE: 0, MIDDLE: 0, BOTTOM: 0, UTILITY: 0 },
        totalGames: 0,
        teamContribution: 0,
        tierInfo: rankInfo ? {
          tier: rankInfo.tier,
          rank: rankInfo.rank,
          leaguePoints: rankInfo.leaguePoints
        } : undefined
      };

      // 전적이 없는 경우 티어 점수만 반영하여 반환
      if (matchIds.length === 0) {
        baseStats.teamContribution = this.calculateTierScore(rankInfo);
        return baseStats;
      }

      // 4. 각 매치의 상세 정보 가져오기
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

      // 5. 통계 계산
      let totalKills = 0, totalDeaths = 0, totalAssists = 0;
      let totalVSPM = 0; 
      let wins = 0;
      let totalCSPM = 0;
      const laneCount: Record<string, number> = {
        TOP: 0, JUNGLE: 0, MIDDLE: 0, BOTTOM: 0, UTILITY: 0
      };

      matches.forEach(match => {
        const participant = match.info.participants.find(p => p.puuid === account!.puuid);

        if (participant) {
          totalKills += participant.kills;
          totalDeaths += participant.deaths;
          totalAssists += participant.assists;
          
          const gameDurationMinutes = match.info.gameDuration / 60;
          if (gameDurationMinutes > 0) {
            totalVSPM += (participant.visionScore / gameDurationMinutes);
            const cs = participant.totalMinionsKilled + participant.neutralMinionsKilled;
            totalCSPM += (cs / gameDurationMinutes);
          }

          if (participant.win) wins++;

          const position = participant.individualPosition || participant.teamPosition;
          if (position && laneCount.hasOwnProperty(position)) {
            laneCount[position]++;
          }
        }
      });

      const gamesPlayed = matches.length;
      if (gamesPlayed === 0) {
         baseStats.teamContribution = this.calculateTierScore(rankInfo);
         return baseStats;
      }

      const avgKills = totalKills / gamesPlayed;
      const avgDeaths = totalDeaths / gamesPlayed;
      const avgAssists = totalAssists / gamesPlayed;
      const avgCSPM = totalCSPM / gamesPlayed;
      const avgVSPM = totalVSPM / gamesPlayed;
      const kda = avgDeaths > 0 ? (avgKills + avgAssists) / avgDeaths : avgKills + avgAssists;
      const recentWinRate = (wins / gamesPlayed) * 100;

      const preferredLane = Object.entries(laneCount).reduce((a, b) => 
        laneCount[a[0]] >= laneCount[b[0]] ? a : b
      )[0];

      // 6. 점수 계산 (티어 점수 + 최근 전적 보정)
      const tierScore = this.calculateTierScore(rankInfo);
      
      // 보정치 계산
      let kdaBonus = (kda - 3.0) * 30;
      kdaBonus = Math.max(-150, Math.min(150, kdaBonus));
      let winRateBonus = (recentWinRate - 50) * 5;
      const totalSeasonGames = rankInfo ? (rankInfo.wins + rankInfo.losses) : 0;
      const activityBonus = totalSeasonGames > 0 ? Math.min(50, Math.log10(totalSeasonGames) * 15) : 0;

      let statsBonus = 0;
      if (preferredLane === 'UTILITY') {
        statsBonus = (avgVSPM - 2.0) * 20;
      } else {
        statsBonus = (avgCSPM - 6.5) * 10;
      }

      const finalScore = tierScore + kdaBonus + winRateBonus + activityBonus + statsBonus;

      return {
        gameName,
        tagLine,
        puuid: account.puuid,
        avgKills: Math.round(avgKills * 100) / 100,
        avgDeaths: Math.round(avgDeaths * 100) / 100,
        avgAssists: Math.round(avgAssists * 100) / 100,
        avgCS: Math.round(avgCSPM * 10) / 10,
        kda: Math.round(kda * 100) / 100,
        winRate: Math.round(recentWinRate * 100) / 100,
        preferredLane,
        laneDistribution: {
          TOP: laneCount.TOP,
          JUNGLE: laneCount.JUNGLE,
          MIDDLE: laneCount.MIDDLE,
          BOTTOM: laneCount.BOTTOM,
          UTILITY: laneCount.UTILITY
        },
        totalGames: totalSeasonGames,
        teamContribution: Math.round(finalScore * 100) / 100,
        tierInfo: rankInfo ? {
          tier: rankInfo.tier,
          rank: rankInfo.rank,
          leaguePoints: rankInfo.leaguePoints
        } : undefined
      };
    } catch (error: any) {
      console.error(`플레이어 통계 분석 중 예외 발생: ${gameName}#${tagLine}`, error);
      // 분석 실패 시에도 계정 정보는 있으므로 최하점 반환
      return {
        gameName,
        tagLine,
        puuid: account ? account.puuid : 'unknown',
        avgKills: 0, avgDeaths: 0, avgAssists: 0, avgCS: 0, kda: 0, winRate: 0,
        preferredLane: 'TOP',
        laneDistribution: { TOP: 0, JUNGLE: 0, MIDDLE: 0, BOTTOM: 0, UTILITY: 0 },
        totalGames: 0,
        teamContribution: 0,
        tierInfo: undefined
      };
    }
  }

  // 티어 기반 점수 계산
  private calculateTierScore(rankInfo?: LeagueEntry): number {
    if (!rankInfo) return 1200; // 언랭은 실버/골드 사이 기본값 (1200)

    const baseScore = TIER_SCORES[rankInfo.tier] || 1200;
    
    if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankInfo.tier)) {
      return baseScore + rankInfo.leaguePoints;
    }

    const rankScore = RANK_SCORES[rankInfo.rank] || 0;
    return baseScore + rankScore + rankInfo.leaguePoints;
  }
}

export default new RiotApiService();
