// Riot API 타입 정의

export interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface Summoner {
  id: string;
  accountId: string;
  puuid: string;
  profileIconId: number;
  revisionDate: number;
  summonerLevel: number;
}

export interface MatchDto {
  metadata: {
    matchId: string;
    participants: string[];
  };
  info: {
    gameCreation: number;
    gameDuration: number;
    gameEndTimestamp: number;
    gameId: number;
    gameMode: string;
    participants: ParticipantDto[];
  };
}

export interface ParticipantDto {
  puuid: string;
  summonerId: string;
  summonerName: string;
  championName: string;
  teamPosition: string;
  individualPosition: string;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  goldEarned: number;
  totalDamageDealtToChampions: number;
  visionScore: number;
  win: boolean;
}

export interface PlayerStats {
  gameName: string;
  tagLine: string;
  puuid: string;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgCS: number;
  kda: number;
  winRate: number;
  preferredLane: string;
  laneDistribution: {
    TOP: number;
    JUNGLE: number;
    MIDDLE: number;
    BOTTOM: number;
    UTILITY: number;
  };
  totalGames: number;
  teamContribution: number; // 팀 기여도 점수
}

export interface Team {
  teamNumber: number;
  players: PlayerStats[];
  avgTeamScore: number;
  laneDistribution: {
    TOP?: PlayerStats;
    JUNGLE?: PlayerStats;
    MIDDLE?: PlayerStats;
    BOTTOM?: PlayerStats;
    UTILITY?: PlayerStats;
  };
}

