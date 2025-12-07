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

  // 랭크 정보 가져오기
  async getLeagueEntries(summonerId: string): Promise<LeagueEntry[]> {
    return this.limiter.schedule(async () => {
      try {
        const response = await this.krClient.get<LeagueEntry[]>(
          `/lol/league/v4/entries/by-summoner/${summonerId}`
        );
        return response.data;
      } catch (error: any) {
        console.log(`랭크 정보 조회 실패: ${error.message}`);
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
        throw new Error(`매치 이력을 가져올 수 없습니다: ${error.message}`);
      }
    });
  }

  // 매치 상세 정보 가져오기 (캐싱 적용)
  async getMatchDetails(matchId: string): Promise<MatchDto> {
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
        this.matchCache.delete(matchId);
        throw new Error(`매치 정보를 가져올 수 없습니다: ${error.message}`);
      }
    });

    this.matchCache.set(matchId, matchPromise);
    return matchPromise;
  }

  // 플레이어 통계 분석 및 점수 산출
  async analyzePlayerStats(
    gameName: string, 
    tagLine: string,
    onProgress?: (message: string) => void
  ): Promise<PlayerStats> {
    try {
      // 1. 계정 정보 및 소환사 정보(Rank 조회를 위해) 가져오기
      const account = await this.getAccountByRiotId(gameName, tagLine);
      const summoner = await this.getSummonerByPuuid(account.puuid);
      
      // 2. 랭크 정보 조회 (솔로 랭크 우선)
      const leagues = await this.getLeagueEntries(summoner.id);
      const soloRank = leagues.find(l => l.queueType === 'RANKED_SOLO_5x5');
      const flexRank = leagues.find(l => l.queueType === 'RANKED_FLEX_SR');
      
      // 솔랭 정보가 없으면 자랭 정보 사용
      const rankInfo = soloRank || flexRank;

      // 3. 매치 이력 가져오기 (20경기)
      if (onProgress) onProgress('매치 기록 조회 중...');
      let matchIds: string[] = [];
      try {
        matchIds = await this.getMatchHistory(account.puuid, 20);
      } catch (error) {
        console.log(`매치 기록 조회 실패 (전적 없음 가능성): ${gameName}#${tagLine}`);
        matchIds = [];
      }
      
      // 기본값 설정
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
        const participant = match.info.participants.find(p => p.puuid === account.puuid);

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
      // KDA 보정: 평균 3.0 기준. (내 KDA - 3) * 30점. (최대 +/- 150점 제한)
      let kdaBonus = (kda - 3.0) * 30;
      kdaBonus = Math.max(-150, Math.min(150, kdaBonus));

      // 승률 보정: 50% 기준. (승률 - 50) * 5점. (60% -> +50점, 40% -> -50점)
      let winRateBonus = (recentWinRate - 50) * 5;

      // 활동량(판수) 보정: 시즌 총 판수가 많을수록 실력이 안정적임 (최대 50점)
      // 시즌 판수는 리그 정보에서 가져옴
      const totalSeasonGames = rankInfo ? (rankInfo.wins + rankInfo.losses) : 0;
      // 로그 스케일 적용: 100판 -> 20점, 500판 -> 35점, 1000판 -> 50점 근사
      const activityBonus = totalSeasonGames > 0 ? Math.min(50, Math.log10(totalSeasonGames) * 15) : 0;

      // 포지션별 추가 보정 (서포터는 시야 점수, 그 외는 CS)
      let statsBonus = 0;
      if (preferredLane === 'UTILITY') {
        // VSPM 2.0 기준. (내 VSPM - 2.0) * 20
        statsBonus = (avgVSPM - 2.0) * 20;
      } else {
        // CSPM 6.5 기준. (내 CSPM - 6.5) * 10
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
        totalGames: totalSeasonGames, // 최근 20게임이 아닌 시즌 전체 게임 수 반환
        teamContribution: Math.round(finalScore * 100) / 100,
        tierInfo: rankInfo ? {
          tier: rankInfo.tier,
          rank: rankInfo.rank,
          leaguePoints: rankInfo.leaguePoints
        } : undefined
      };
    } catch (error: any) {
      throw new Error(`플레이어 통계 분석 실패: ${error.message}`);
    }
  }

  // 티어 기반 점수 계산
  private calculateTierScore(rankInfo?: LeagueEntry): number {
    if (!rankInfo) return 1200; // 언랭은 실버/골드 사이 기본값 (1200)

    const baseScore = TIER_SCORES[rankInfo.tier] || 1200;
    
    // 마스터 이상은 LP를 그대로 더함
    if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankInfo.tier)) {
      return baseScore + rankInfo.leaguePoints;
    }

    // 다이아 이하에서는 랭크(I, II, III, IV)와 LP 반영
    const rankScore = RANK_SCORES[rankInfo.rank] || 0;
    // LP는 0~100 사이
    return baseScore + rankScore + rankInfo.leaguePoints;
  }
}

export default new RiotApiService();
