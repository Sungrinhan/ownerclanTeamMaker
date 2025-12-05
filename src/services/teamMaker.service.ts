import { PlayerStats, Team } from '../types/riot.types';

class TeamMakerService {
  /**
   * 20명의 플레이어를 4개 팀으로 균등하게 분배
   * - 각 팀은 5명으로 구성
   * - 팀 기여도를 기준으로 균등 분배
   * - 선호 라인을 고려하여 포지션 배치
   */
  divideIntoTeams(players: PlayerStats[]): Team[] {
    if (players.length < 10 || players.length % 5 !== 0) {
      throw new Error('플레이어 수는 10명 이상이어야 하며, 5명 단위여야 합니다.');
    }

    const teamCount = players.length / 5;

    // 1. 플레이어를 팀 기여도 순으로 정렬 (높은 순)
    const sortedPlayers = [...players].sort((a, b) => b.teamContribution - a.teamContribution);

    // 2. 빈 팀 생성
    const teams: Team[] = Array.from({ length: teamCount }, (_, i) => ({
      teamNumber: i + 1,
      players: [],
      avgTeamScore: 0,
      laneDistribution: {}
    }));

    // 3. 스네이크 드래프트 방식으로 분배
    // 예: 3팀인 경우 0->1->2 -> 2->1->0 -> 0->1->2 ...
    const draftOrder: number[] = [];
    for (let i = 0; i < teamCount; i++) draftOrder.push(i);
    for (let i = teamCount - 1; i >= 0; i--) draftOrder.push(i);
    
    let draftIndex = 0;

    for (const player of sortedPlayers) {
      const teamIndex = draftOrder[draftIndex % draftOrder.length];
      teams[teamIndex].players.push(player);
      draftIndex++;
    }

    // 4. 각 팀의 라인 배치 최적화
    teams.forEach(team => {
      this.optimizeLaneDistribution(team);
    });

    // 5. 팀 평균 점수 계산
    teams.forEach(team => {
      const totalScore = team.players.reduce((sum, p) => sum + p.teamContribution, 0);
      team.avgTeamScore = Math.round((totalScore / team.players.length) * 100) / 100;
    });

    return teams;
  }

  /**
   * 팀 내에서 선호 라인을 고려하여 포지션 배치 최적화
   */
  private optimizeLaneDistribution(team: Team): void {
    const lanes: Array<'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY'> = 
      ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
    
    const assignments: Record<string, PlayerStats | null> = {
      TOP: null,
      JUNGLE: null,
      MIDDLE: null,
      BOTTOM: null,
      UTILITY: null
    };

    const unassignedPlayers = [...team.players];

    // 1차: 가장 많이 플레이한 라인에 우선 배치
    for (const lane of lanes) {
      const bestPlayer = this.findBestPlayerForLane(unassignedPlayers, lane);
      if (bestPlayer) {
        assignments[lane] = bestPlayer;
        const index = unassignedPlayers.indexOf(bestPlayer);
        unassignedPlayers.splice(index, 1);
      }
    }

    // 2차: 남은 플레이어를 빈 포지션에 배치
    for (const lane of lanes) {
      if (!assignments[lane] && unassignedPlayers.length > 0) {
        assignments[lane] = unassignedPlayers.shift()!;
      }
    }

    team.laneDistribution = {
      TOP: assignments.TOP!,
      JUNGLE: assignments.JUNGLE!,
      MIDDLE: assignments.MIDDLE!,
      BOTTOM: assignments.BOTTOM!,
      UTILITY: assignments.UTILITY!
    };
  }

  /**
   * 특정 라인에 가장 적합한 플레이어 찾기
   */
  private findBestPlayerForLane(
    players: PlayerStats[],
    lane: 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY'
  ): PlayerStats | null {
    if (players.length === 0) return null;

    // 해당 라인을 가장 많이 플레이한 플레이어 찾기
    let bestPlayer = players[0];
    let maxLaneCount = players[0].laneDistribution[lane];

    for (const player of players) {
      const laneCount = player.laneDistribution[lane];
      if (laneCount > maxLaneCount) {
        maxLaneCount = laneCount;
        bestPlayer = player;
      }
    }

    // 해당 라인을 한 번도 플레이하지 않았다면 null 반환
    return maxLaneCount > 0 ? bestPlayer : null;
  }

  /**
   * 팀 밸런스 점수 계산 (낮을수록 균등)
   */
  calculateTeamBalance(teams: Team[]): number {
    const avgScores = teams.map(t => t.avgTeamScore);
    const mean = avgScores.reduce((sum, score) => sum + score, 0) / avgScores.length;
    const variance = avgScores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / avgScores.length;
    return Math.sqrt(variance);
  }
}

export default new TeamMakerService();

