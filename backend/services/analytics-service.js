/**
 * Analytics Service
 * Handles all analytics calculations and aggregations
 * 
 * Features:
 * - Dashboard metrics aggregation
 * - Voting pattern analysis
 * - Turnout calculations
 * - Super voter identification
 * - Party affiliation distribution
 * - In-memory caching for performance
 */

const database = require('../config/database');

class AnalyticsService {
  constructor() {
    this.db = database;
    this.cache = new Map();
    this.cacheTTL = {
      dashboard: 5 * 60 * 1000,  // 5 minutes
      analytics: 15 * 60 * 1000  // 15 minutes
    };
  }

  /**
   * Get cache key for a method and parameters
   * @private
   */
  _getCacheKey(method, params = {}) {
    return `${method}_${JSON.stringify(params)}`;
  }

  /**
   * Retrieve value from cache
   * @private
   */
  _getFromCache(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  /**
   * Store value in cache with TTL
   * @private
   */
  _setCache(key, value, ttl) {
    this.cache.set(key, {
      value,
      expires: Date.now() + ttl
    });
  }

  /**
   * Clear all cached data
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get comprehensive dashboard metrics
   * 
   * @returns {Promise<Object>} Dashboard metrics including totals, percentages, and precinct summary
   */
  async getDashboardMetrics() {
    const cacheKey = 'dashboard_metrics';
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const startTime = Date.now();

    try {
      // Parallel queries for better performance
      const [totals, precinctSummary, recentImport] = await Promise.all([
        // Total counts
        this.db.get(`
          SELECT 
            COUNT(*) as voters,
            SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
            SUM(CASE WHEN latitude IS NOT NULL THEN 1 ELSE 0 END) as geocoded
          FROM voters
        `),
        
        // Precinct summary
        this.db.all(`
          SELECT 
            p.precinct_number as precinctNumber,
            p.name,
            COUNT(v.id) as totalVoters,
            SUM(CASE WHEN v.super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
            CAST(SUM(CASE WHEN v.super_voter = 1 THEN 1 ELSE 0 END) AS REAL) / 
              NULLIF(COUNT(v.id), 0) * 100 as superVoterRate
          FROM precincts p
          INNER JOIN voters v ON p.precinct_number = v.precinct_number
          GROUP BY p.precinct_number, p.name
          HAVING COUNT(v.id) > 0
          ORDER BY p.precinct_number
        `),
        
      // Recent activity (scope to current cycle only)
        this.db.get(`
          SELECT 
            end_time as lastImport,
            records_successful as recordsImported
          FROM import_logs
          WHERE status = 'completed'
            AND cycle_id IS NULL
          ORDER BY end_time DESC
          LIMIT 1
        `)
      ]);

      const precinctCount = precinctSummary.length;
      
      const metrics = {
        totals: {
          voters: totals?.voters || 0,
          superVoters: totals?.superVoters || 0,
          precincts: precinctCount,
          geocoded: totals?.geocoded || 0
        },
        percentages: {
          superVoterRate: totals?.voters > 0 
            ? parseFloat((totals.superVoters / totals.voters * 100).toFixed(2))
            : 0,
          geocodingProgress: totals?.voters > 0 
            ? parseFloat((totals.geocoded / totals.voters * 100).toFixed(2))
            : 0
        },
        recentActivity: recentImport ? {
          lastImport: recentImport.lastImport,
          recordsImported: recentImport.recordsImported
        } : null,
        precinctSummary: precinctSummary.map(p => ({
          precinctNumber: p.precinctNumber,
          name: p.name,
          totalVoters: p.totalVoters,
          superVoters: p.superVoters,
          superVoterRate: parseFloat((p.superVoterRate || 0).toFixed(2))
        })),
        queryTime: Date.now() - startTime
      };

      this._setCache(cacheKey, metrics, this.cacheTTL.dashboard);
      return metrics;
      
    } catch (error) {
      console.error('Dashboard metrics error:', error);
      throw new Error('Failed to calculate dashboard metrics');
    }
  }

  /**
   * Analyze voting patterns across elections
   * 
   * @param {Object} filters - Query filters
   * @param {string} filters.precinct - Precinct number to filter by
   * @param {Array<string>} filters.electionCodes - Election codes to analyze
   * @param {string} filters.partyCode - Party code filter (R, D, I)
   * @param {number} filters.minElections - Minimum elections voted
   * @returns {Promise<Object>} Voting pattern analysis
   */
  async getVotingPatterns(filters = {}) {
    const cacheKey = this._getCacheKey('voting_patterns', filters);
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const startTime = Date.now();

    try {
      // Build WHERE clauses based on filters
      let whereClause = 'WHERE e.voted = 1 AND e.cycle_id IS NULL';
      const params = [];
      
      if (filters.precinct) {
        whereClause += ' AND v.precinct_number = ?';
        params.push(filters.precinct);
      }
      
      if (filters.electionCodes && filters.electionCodes.length > 0) {
        const placeholders = filters.electionCodes.map(() => '?').join(',');
        whereClause += ` AND e.election_code IN (${placeholders})`;
        params.push(...filters.electionCodes);
      }
      
      if (filters.partyCode) {
        whereClause += ' AND e.party_code = ?';
        params.push(filters.partyCode);
      }

      // Run queries in parallel
      const [votingFrequency, partyTrends, earlyVotingStats, turnoutByPrecinct] = await Promise.all([
        // Voting frequency distribution
        this.db.all(`
          SELECT 
            election_count,
            COUNT(*) as voter_count
          FROM (
            SELECT 
              v.id,
              COUNT(DISTINCT e.election_code) as election_count
            FROM voters v
            LEFT JOIN election_history e ON v.voter_id = e.voter_id
            ${whereClause.replace('e.voted = 1', 'e.voted = 1')}
            GROUP BY v.id
          )
          WHERE election_count >= ?
          GROUP BY election_count
          ORDER BY election_count
        `, [...params, filters.minElections || 1]),
        
        // Party trends over elections
        this.db.all(`
          SELECT 
            e.election_code as electionCode,
            e.party_code as partyCode,
            COUNT(*) as votes
          FROM election_history e
          JOIN voters v ON e.voter_id = v.voter_id
          ${whereClause}
            AND e.party_code IS NOT NULL
          ${filters.precinct ? 'AND v.precinct_number = ?' : ''}
          GROUP BY e.election_code, e.party_code
          ORDER BY e.election_code
        `, filters.precinct ? [filters.precinct] : []),
        
        // Early voting statistics
        this.db.all(`
          SELECT 
            e.election_code as electionCode,
            SUM(CASE WHEN e.early_voted = 1 THEN 1 ELSE 0 END) as earlyVotes,
            COUNT(*) as totalVotes
          FROM election_history e
          JOIN voters v ON e.voter_id = v.voter_id
          ${whereClause}
          ${filters.precinct ? 'AND v.precinct_number = ?' : ''}
          GROUP BY e.election_code
          ORDER BY e.election_code
        `, filters.precinct ? [filters.precinct] : []),
        
        // Turnout by precinct
        this.db.all(`
          SELECT 
            v.precinct_number as precinctNumber,
            COUNT(DISTINCT e.election_code) as elections,
            COUNT(DISTINCT e.id) as totalVotes,
            COUNT(DISTINCT v.id) as totalVoters,
            CAST(COUNT(DISTINCT e.id) AS REAL) / 
              NULLIF(COUNT(DISTINCT v.id) * COUNT(DISTINCT e.election_code), 0) * 100 as averageTurnout
          FROM voters v
          LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.voted = 1 AND e.cycle_id IS NULL
          ${filters.precinct ? 'WHERE v.precinct_number = ?' : ''}
          GROUP BY v.precinct_number
          ORDER BY v.precinct_number
        `, filters.precinct ? [filters.precinct] : [])
      ]);

      // Format voting frequency
      const votingFrequencyObj = {};
      votingFrequency.forEach(row => {
        const key = `${row.election_count}_election${row.election_count > 1 ? 's' : ''}`;
        votingFrequencyObj[key] = row.voter_count;
      });

      // Format party trends
      const partyTrendsFormatted = [];
      const electionMap = new Map();
      
      partyTrends.forEach(row => {
        if (!electionMap.has(row.electionCode)) {
          electionMap.set(row.electionCode, {
            electionCode: row.electionCode,
            democrat: 0,
            republican: 0,
            independent: 0
          });
        }
        const election = electionMap.get(row.electionCode);
        if (row.partyCode === 'D') election.democrat = row.votes;
        else if (row.partyCode === 'R') election.republican = row.votes;
        else if (row.partyCode === 'I') election.independent = row.votes;
      });
      
      electionMap.forEach(value => partyTrendsFormatted.push(value));

      // Calculate overall early voting stats
      const totalEarlyVotes = earlyVotingStats.reduce((sum, e) => sum + e.earlyVotes, 0);
      const totalVotes = earlyVotingStats.reduce((sum, e) => sum + e.totalVotes, 0);

      const result = {
        votingFrequency: votingFrequencyObj,
        partyTrends: partyTrendsFormatted,
        earlyVotingStats: {
          totalEarlyVotes,
          percentageEarly: totalVotes > 0 
            ? parseFloat((totalEarlyVotes / totalVotes * 100).toFixed(2))
            : 0,
          byElection: earlyVotingStats.map(e => ({
            electionCode: e.electionCode,
            earlyVotes: e.earlyVotes,
            totalVotes: e.totalVotes,
            percentage: e.totalVotes > 0 
              ? parseFloat((e.earlyVotes / e.totalVotes * 100).toFixed(2))
              : 0
          }))
        },
        turnoutByPrecinct: turnoutByPrecinct.map(p => ({
          precinctNumber: p.precinctNumber,
          averageTurnout: parseFloat((p.averageTurnout || 0).toFixed(2)),
          elections: p.elections
        })),
        queryTime: Date.now() - startTime
      };

      this._setCache(cacheKey, result, this.cacheTTL.analytics);
      return result;
      
    } catch (error) {
      console.error('Voting patterns error:', error);
      throw new Error('Failed to analyze voting patterns');
    }
  }

  /**
   * Calculate turnout statistics with comparative analysis
   * 
   * @param {Object} filters - Query filters
   * @param {string} filters.electionCode - Specific election to analyze
   * @param {string} filters.precinct - Precinct filter
   * @param {string} filters.groupBy - Group by 'precinct' or 'party'
   * @param {string} filters.compareWith - Election code to compare with
   * @returns {Promise<Object>} Turnout analysis
   */
  async getTurnoutAnalysis(filters = {}) {
    const cacheKey = this._getCacheKey('turnout', filters);
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const startTime = Date.now();

    try {
      let whereClause = '';
      const params = [];
      
      if (filters.electionCode) {
        whereClause = 'WHERE e.election_code = ?';
        params.push(filters.electionCode);
      }
      
      if (filters.precinct) {
        whereClause += (whereClause ? ' AND ' : 'WHERE ') + 'v.precinct_number = ?';
        params.push(filters.precinct);
      }

      // Always scope to current (unarchived) cycle in live data paths
      whereClause += (whereClause ? ' AND ' : 'WHERE ') + 'e.cycle_id IS NULL';

      // Overall turnout
      const overall = await this.db.get(`
        SELECT 
          COUNT(DISTINCT v.id) as registeredVoters,
          COUNT(DISTINCT CASE WHEN e.voted = 1 THEN e.id END) as totalVotes,
          SUM(CASE WHEN e.early_voted = 1 AND e.voted = 1 THEN 1 ELSE 0 END) as earlyVotes,
          COUNT(DISTINCT CASE WHEN e.voted = 1 AND e.early_voted = 0 THEN e.id END) as electionDayVotes,
          CAST(COUNT(DISTINCT CASE WHEN e.voted = 1 THEN e.id END) AS REAL) / 
            NULLIF(COUNT(DISTINCT v.id), 0) * 100 as turnoutRate
        FROM voters v
        LEFT JOIN election_history e ON v.voter_id = e.voter_id
        ${whereClause}
      `, params);

      // By precinct
      const byPrecinct = await this.db.all(`
        SELECT 
          v.precinct_number as precinctNumber,
          COUNT(DISTINCT v.id) as registeredVoters,
          COUNT(DISTINCT CASE WHEN e.voted = 1 THEN e.id END) as votes,
          CAST(COUNT(DISTINCT CASE WHEN e.voted = 1 THEN e.id END) AS REAL) / 
            NULLIF(COUNT(DISTINCT v.id), 0) * 100 as turnoutRate,
          CAST(SUM(CASE WHEN e.early_voted = 1 AND e.voted = 1 THEN 1 ELSE 0 END) AS REAL) /
            NULLIF(COUNT(DISTINCT CASE WHEN e.voted = 1 THEN e.id END), 0) * 100 as earlyVoteRate
        FROM voters v
        LEFT JOIN election_history e ON v.voter_id = e.voter_id
        ${whereClause}
        GROUP BY v.precinct_number
        ORDER BY v.precinct_number
      `, params);

      // Comparison with previous election if requested
      let comparison = null;
      if (filters.compareWith && filters.electionCode) {
        const previousTurnout = await this.db.get(`
          SELECT 
            CAST(COUNT(DISTINCT CASE WHEN e.voted = 1 THEN e.id END) AS REAL) / 
              NULLIF(COUNT(DISTINCT v.id), 0) * 100 as turnoutRate
          FROM voters v
          LEFT JOIN election_history e ON v.voter_id = e.voter_id
          WHERE e.election_code = ?
        `, [filters.compareWith]);

        if (previousTurnout && overall) {
          const turnoutChange = parseFloat((overall.turnoutRate - previousTurnout.turnoutRate).toFixed(2));
          comparison = {
            previousElection: filters.compareWith,
            turnoutChange: Math.abs(turnoutChange),
            direction: turnoutChange >= 0 ? 'increase' : 'decrease'
          };
        }
      }

      const result = {
        overall: {
          registeredVoters: overall?.registeredVoters || 0,
          totalVotes: overall?.totalVotes || 0,
          turnoutRate: parseFloat((overall?.turnoutRate || 0).toFixed(2)),
          earlyVotes: overall?.earlyVotes || 0,
          electionDayVotes: overall?.electionDayVotes || 0
        },
        byPrecinct: byPrecinct.map(p => ({
          precinctNumber: p.precinctNumber,
          registeredVoters: p.registeredVoters,
          votes: p.votes,
          turnoutRate: parseFloat((p.turnoutRate || 0).toFixed(2)),
          earlyVoteRate: parseFloat((p.earlyVoteRate || 0).toFixed(2))
        })),
        comparison,
        timeAnalysis: overall ? {
          earlyVotingPeriod: {
            votes: overall.earlyVotes,
            percentage: overall.totalVotes > 0 
              ? parseFloat((overall.earlyVotes / overall.totalVotes * 100).toFixed(2))
              : 0
          },
          electionDay: {
            votes: overall.electionDayVotes,
            percentage: overall.totalVotes > 0 
              ? parseFloat((overall.electionDayVotes / overall.totalVotes * 100).toFixed(2))
              : 0
          }
        } : null,
        queryTime: Date.now() - startTime
      };

      this._setCache(cacheKey, result, this.cacheTTL.analytics);
      return result;
      
    } catch (error) {
      console.error('Turnout analysis error:', error);
      throw new Error('Failed to calculate turnout statistics');
    }
  }

  /**
   * Analyze super voters (high-frequency voters)
   * 
   * @param {Object} filters - Query filters
   * @param {number} filters.threshold - Minimum elections to qualify as super voter
   * @param {string} filters.precinct - Precinct filter
   * @param {boolean} filters.includeHistory - Include detailed voting history
   * @returns {Promise<Object>} Super voter analysis
   */
  async getSuperVoterAnalysis(filters = {}) {
    const threshold = filters.threshold || 4;
    const cacheKey = this._getCacheKey('super_voters', { ...filters, threshold });
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const startTime = Date.now();

    try {
      let whereClause = '';
      const params = [];
      
      if (filters.precinct) {
        whereClause = 'WHERE v.precinct_number = ?';
        params.push(filters.precinct);
      }

      // Summary statistics
      const summary = await this.db.get(`
        SELECT 
          COUNT(DISTINCT v.id) as totalVoters,
          SUM(CASE WHEN v.super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
          CAST(SUM(CASE WHEN v.super_voter = 1 THEN 1 ELSE 0 END) AS REAL) / 
            NULLIF(COUNT(DISTINCT v.id), 0) * 100 as superVoterRate
        FROM voters v
        ${whereClause}
      `, params);

      // Average elections voted (for super voters)
      const avgElections = await this.db.get(`
        SELECT 
          AVG(election_count) as averageElectionsVoted
        FROM (
          SELECT 
            v.id,
            COUNT(DISTINCT e.election_code) as election_count
          FROM voters v
          LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.voted = 1 AND e.cycle_id IS NULL
          WHERE v.super_voter = 1
          ${filters.precinct ? 'AND v.precinct_number = ?' : ''}
          GROUP BY v.id
        )
      `, filters.precinct ? [filters.precinct] : []);

      // Geographic distribution
      const geographicDistribution = await this.db.all(`
        SELECT 
          v.precinct_number as precinctNumber,
          COUNT(*) as totalVoters,
          SUM(CASE WHEN v.super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
          CAST(SUM(CASE WHEN v.super_voter = 1 THEN 1 ELSE 0 END) AS REAL) / 
            NULLIF(COUNT(*), 0) * 100 as percentage
        FROM voters v
        ${whereClause}
        GROUP BY v.precinct_number
        ORDER BY v.precinct_number
      `, params);

      // Party affiliation of super voters
      const partyAffiliation = await this.db.get(`
        SELECT 
          SUM(CASE WHEN latest_party = 'D' THEN 1 ELSE 0 END) as democrat,
          SUM(CASE WHEN latest_party = 'R' THEN 1 ELSE 0 END) as republican,
          SUM(CASE WHEN latest_party = 'I' THEN 1 ELSE 0 END) as independent,
          SUM(CASE WHEN latest_party IS NULL OR latest_party = '' THEN 1 ELSE 0 END) as unknown
        FROM (
          SELECT 
            v.id,
            (
              SELECT e.party_code 
              FROM election_history e 
              WHERE e.voter_id = v.voter_id 
                AND e.party_code IS NOT NULL 
                AND e.cycle_id IS NULL
              ORDER BY e.election_code DESC 
              LIMIT 1
            ) as latest_party
          FROM voters v
          WHERE v.super_voter = 1
          ${filters.precinct ? 'AND v.precinct_number = ?' : ''}
        )
      `, filters.precinct ? [filters.precinct] : []);

      // Participation patterns
      const participationPatterns = await this.db.get(`
        SELECT 
          COUNT(DISTINCT id) as consistentVoters,
          SUM(CASE WHEN early_pref > 0.5 THEN 1 ELSE 0 END) as earlyVoterPreference,
          SUM(CASE WHEN early_pref <= 0.5 THEN 1 ELSE 0 END) as electionDayPreference
        FROM (
          SELECT 
            v.id,
            CAST(SUM(CASE WHEN e.early_voted = 1 THEN 1 ELSE 0 END) AS REAL) / 
              NULLIF(COUNT(e.id), 0) as early_pref
          FROM voters v
          JOIN election_history e ON v.voter_id = e.voter_id AND e.voted = 1 AND e.cycle_id IS NULL
          WHERE v.super_voter = 1
          ${filters.precinct ? 'AND v.precinct_number = ?' : ''}
          GROUP BY v.id
        )
      `, filters.precinct ? [filters.precinct] : []);

      const result = {
        summary: {
          totalVoters: summary?.totalVoters || 0,
          superVoters: summary?.superVoters || 0,
          superVoterRate: parseFloat((summary?.superVoterRate || 0).toFixed(2)),
          averageElectionsVoted: parseFloat((avgElections?.averageElectionsVoted || 0).toFixed(1))
        },
        geographicDistribution: geographicDistribution.map(g => ({
          precinctNumber: g.precinctNumber,
          totalVoters: g.totalVoters,
          superVoters: g.superVoters,
          percentage: parseFloat((g.percentage || 0).toFixed(2))
        })),
        partyAffiliation: {
          democrat: partyAffiliation?.democrat || 0,
          republican: partyAffiliation?.republican || 0,
          independent: partyAffiliation?.independent || 0,
          unknown: partyAffiliation?.unknown || 0
        },
        participationPatterns: {
          consistentVoters: participationPatterns?.consistentVoters || 0,
          earlyVoterPreference: participationPatterns?.earlyVoterPreference || 0,
          electionDayPreference: participationPatterns?.electionDayPreference || 0
        },
        queryTime: Date.now() - startTime
      };

      this._setCache(cacheKey, result, this.cacheTTL.analytics);
      return result;
      
    } catch (error) {
      console.error('Super voter analysis error:', error);
      throw new Error('Failed to analyze super voters');
    }
  }

  /**
   * Analyze party affiliation distribution and trends
   * 
   * @param {Object} filters - Query filters
   * @param {string} filters.precinct - Precinct filter
   * @param {Array<string>} filters.electionCodes - Election codes for trend analysis
   * @param {boolean} filters.trendAnalysis - Include historical trends
   * @returns {Promise<Object>} Party affiliation analysis
   */
  async getPartyAffiliation(filters = {}) {
    const cacheKey = this._getCacheKey('party_affiliation', filters);
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const startTime = Date.now();

    try {
      let whereClause = '';
      const params = [];
      
      if (filters.precinct) {
        whereClause = 'WHERE v.precinct_number = ?';
        params.push(filters.precinct);
      }

      // Current distribution (latest party code per voter)
      const currentDistribution = await this.db.get(`
        SELECT 
          SUM(CASE WHEN latest_party = 'D' THEN 1 ELSE 0 END) as democrat,
          SUM(CASE WHEN latest_party = 'R' THEN 1 ELSE 0 END) as republican,
          SUM(CASE WHEN latest_party = 'I' THEN 1 ELSE 0 END) as independent,
          SUM(CASE WHEN latest_party IS NULL OR latest_party = '' THEN 1 ELSE 0 END) as unaffiliated,
          COUNT(*) as total
        FROM (
          SELECT 
            v.id,
            (
              SELECT e.party_code 
              FROM election_history e 
              WHERE e.voter_id = v.voter_id 
                AND e.party_code IS NOT NULL 
                AND e.cycle_id IS NULL
              ORDER BY e.election_code DESC 
              LIMIT 1
            ) as latest_party
          FROM voters v
          ${whereClause}
        )
      `, params);

      const total = currentDistribution?.total || 1; // Avoid division by zero

      // Geographic concentration
      const geographicConcentration = await this.db.all(`
        SELECT 
          precinct_number as precinctNumber,
          SUM(CASE WHEN latest_party = 'D' THEN 1 ELSE 0 END) as democrat,
          SUM(CASE WHEN latest_party = 'R' THEN 1 ELSE 0 END) as republican,
          SUM(CASE WHEN latest_party = 'I' THEN 1 ELSE 0 END) as independent,
          COUNT(*) as total
        FROM (
          SELECT 
            v.id,
            v.precinct_number,
            (
              SELECT e.party_code 
              FROM election_history e 
              WHERE e.voter_id = v.voter_id 
                AND e.party_code IS NOT NULL 
                AND e.cycle_id IS NULL
              ORDER BY e.election_code DESC 
              LIMIT 1
            ) as latest_party
          FROM voters v
          ${whereClause}
        )
        GROUP BY precinctNumber
        ORDER BY precinctNumber
      `, params);

      // Format geographic concentration with strongest party
      const geographicData = geographicConcentration.map(g => {
        const parties = [
          { name: 'democrat', count: g.democrat },
          { name: 'republican', count: g.republican },
          { name: 'independent', count: g.independent }
        ];
        const strongest = parties.reduce((max, p) => p.count > max.count ? p : max);
        
        return {
          precinctNumber: g.precinctNumber,
          strongestParty: strongest.name,
          percentage: g.total > 0 ? parseFloat((strongest.count / g.total * 100).toFixed(2)) : 0,
          distribution: {
            democrat: g.democrat,
            republican: g.republican,
            independent: g.independent
          }
        };
      });

      // Trends over elections if requested
      let trends = [];
      if (filters.trendAnalysis && filters.electionCodes && filters.electionCodes.length > 0) {
        const placeholders = filters.electionCodes.map(() => '?').join(',');
        const trendData = await this.db.all(`
          SELECT 
            e.election_code as electionCode,
            SUM(CASE WHEN e.party_code = 'D' THEN 1 ELSE 0 END) as democrat,
            SUM(CASE WHEN e.party_code = 'R' THEN 1 ELSE 0 END) as republican,
            SUM(CASE WHEN e.party_code = 'I' THEN 1 ELSE 0 END) as independent
          FROM election_history e
          JOIN voters v ON e.voter_id = v.voter_id
          WHERE e.election_code IN (${placeholders})
            AND e.voted = 1
            ${filters.precinct ? 'AND v.precinct_number = ?' : ''}
          GROUP BY e.election_code
          ORDER BY e.election_code
        `, filters.precinct ? [...filters.electionCodes, filters.precinct] : filters.electionCodes);

        trends = trendData.map(t => ({
          electionCode: t.electionCode,
          distribution: {
            democrat: t.democrat,
            republican: t.republican,
            independent: t.independent
          }
        }));
      }

      const result = {
        currentDistribution: {
          democrat: currentDistribution?.democrat || 0,
          republican: currentDistribution?.republican || 0,
          independent: currentDistribution?.independent || 0,
          unaffiliated: currentDistribution?.unaffiliated || 0
        },
        percentages: {
          democrat: parseFloat((((currentDistribution?.democrat || 0) / total) * 100).toFixed(2)),
          republican: parseFloat((((currentDistribution?.republican || 0) / total) * 100).toFixed(2)),
          independent: parseFloat((((currentDistribution?.independent || 0) / total) * 100).toFixed(2)),
          unaffiliated: parseFloat((((currentDistribution?.unaffiliated || 0) / total) * 100).toFixed(2))
        },
        trends,
        geographicConcentration: geographicData,
        queryTime: Date.now() - startTime
      };

      this._setCache(cacheKey, result, this.cacheTTL.analytics);
      return result;
      
    } catch (error) {
      console.error('Party affiliation analysis error:', error);
      throw new Error('Failed to analyze party affiliation');
    }
  }

  /**
   * Analyze demographic distribution of voters
   * 
   * @param {Object} filters - Query filters
   * @param {string} filters.precinct - Precinct filter
   * @param {string} filters.groupBy - Group by 'city', 'zip', or 'precinct'
   * @returns {Promise<Object>} Demographics analysis
   */
  async getDemographics(filters = {}) {
    const cacheKey = this._getCacheKey('demographics', filters);
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const startTime = Date.now();

    try {
      let whereClause = '';
      const params = [];
      
      if (filters.precinct) {
        whereClause = 'WHERE precinct_number = ?';
        params.push(filters.precinct);
      }

      // Run queries in parallel
      const [byCity, byZipCode, registrationStats, ageDistribution] = await Promise.all([
        // Distribution by city
        this.db.all(`
          SELECT 
            city,
            COUNT(*) as totalVoters,
            SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
            CAST(SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) AS REAL) / 
              NULLIF(COUNT(*), 0) * 100 as superVoterRate,
            CAST(COUNT(*) AS REAL) / 
              (SELECT COUNT(*) FROM voters ${whereClause}) * 100 as percentage
          FROM voters
          ${whereClause}
          GROUP BY city
          ORDER BY totalVoters DESC
        `, params),
        
        // Distribution by zip code
        this.db.all(`
          SELECT 
            zip_code as zipCode,
            COUNT(*) as totalVoters,
            SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
            CAST(SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) AS REAL) / 
              NULLIF(COUNT(*), 0) * 100 as superVoterRate,
            CAST(COUNT(*) AS REAL) / 
              (SELECT COUNT(*) FROM voters ${whereClause}) * 100 as percentage
          FROM voters
          ${whereClause}
          GROUP BY zip_code
          ORDER BY totalVoters DESC
        `, params),
        
        // Registration statistics
        this.db.get(`
          SELECT 
            COUNT(*) as totalRegistered,
            SUM(CASE WHEN created_at >= datetime('now', '-90 days') THEN 1 ELSE 0 END) as recentRegistrations
          FROM voters
          ${whereClause}
        `, params),
        
        // Age distribution analysis (dynamic grouping based on date_of_birth)
        this.db.all(`
          SELECT 
            CASE 
              WHEN date_of_birth IS NULL THEN 'Unknown'
              WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) < 18 THEN 'Under 18'
              WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) BETWEEN 18 AND 24 THEN '18-24'
              WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) BETWEEN 25 AND 34 THEN '25-34'
              WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) BETWEEN 35 AND 44 THEN '35-44'
              WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) BETWEEN 45 AND 54 THEN '45-54'
              WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) BETWEEN 55 AND 64 THEN '55-64'
              WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) BETWEEN 65 AND 74 THEN '65-74'
              WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) >= 75 THEN '75+'
              ELSE 'Unknown'
            END AS ageGroup,
            COUNT(*) as count,
            SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
            CAST(SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) AS REAL) / 
              NULLIF(COUNT(*), 0) * 100 as superVoterRate,
            CAST(COUNT(*) AS REAL) / 
              (SELECT COUNT(*) FROM voters ${whereClause}) * 100 as percentage,
            ROUND(AVG(CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER)), 1) as avgAge
          FROM voters
          ${whereClause}
          GROUP BY ageGroup
          ORDER BY 
            CASE ageGroup
              WHEN 'Under 18' THEN 1
              WHEN '18-24' THEN 2
              WHEN '25-34' THEN 3
              WHEN '35-44' THEN 4
              WHEN '45-54' THEN 5
              WHEN '55-64' THEN 6
              WHEN '65-74' THEN 7
              WHEN '75+' THEN 8
              WHEN 'Unknown' THEN 9
            END
        `, params)
      ]);

      // Calculate average registrations per month (last 3 months)
      const averagePerMonth = registrationStats?.recentRegistrations 
        ? Math.round(registrationStats.recentRegistrations / 3)
        : 0;

      const result = {
        byCity: byCity.map(c => ({
          city: c.city || 'Unknown',
          totalVoters: c.totalVoters,
          superVoters: c.superVoters,
          superVoterRate: parseFloat((c.superVoterRate || 0).toFixed(2)),
          percentage: parseFloat((c.percentage || 0).toFixed(2))
        })),
        byZipCode: byZipCode.map(z => ({
          zipCode: z.zipCode || 'Unknown',
          totalVoters: z.totalVoters,
          superVoters: z.superVoters,
          superVoterRate: parseFloat((z.superVoterRate || 0).toFixed(2)),
          percentage: parseFloat((z.percentage || 0).toFixed(2))
        })),
        byAgeGroup: ageDistribution.map(a => ({
          ageGroup: a.ageGroup,
          count: a.count,
          superVoters: a.superVoters,
          superVoterRate: parseFloat((a.superVoterRate || 0).toFixed(2)),
          percentage: parseFloat((a.percentage || 0).toFixed(2)),
          avgAge: a.avgAge || null
        })),
        registrationTrends: {
          totalRegistered: registrationStats?.totalRegistered || 0,
          recentRegistrations: registrationStats?.recentRegistrations || 0,
          averagePerMonth: averagePerMonth
        },
        queryTime: Date.now() - startTime
      };

      this._setCache(cacheKey, result, this.cacheTTL.analytics);
      return result;
      
    } catch (error) {
      console.error('Demographics analysis error:', error);
      throw new Error('Failed to analyze demographics');
    }
  }

  /**
   * Get voter engagement level breakdown
   * Categorizes voters as: never voted, occasional (1-3 elections), or super voters (4+)
   * 
   * @param {Object} filters - Query filters
   * @param {string} filters.precinct - Precinct filter
   * @returns {Promise<Object>} Engagement level counts and percentages
   */
  async getEngagementLevels(filters = {}) {
    const cacheKey = this._getCacheKey('engagement_levels', filters);
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const startTime = Date.now();

    try {
      let whereClause = '';
      const params = [];
      
      if (filters.precinct) {
        whereClause = 'WHERE precinct_number = ?';
        params.push(filters.precinct);
      }

      const result = await this.db.get(`
        SELECT 
          SUM(CASE 
            WHEN (SELECT COUNT(*) FROM election_history 
                  WHERE voter_id = voters.voter_id AND voted = 1 AND cycle_id IS NULL) = 0 
            THEN 1 ELSE 0 
          END) as neverVoted,
          SUM(CASE 
            WHEN (SELECT COUNT(*) FROM election_history 
                  WHERE voter_id = voters.voter_id AND voted = 1 AND cycle_id IS NULL) BETWEEN 1 AND 3 
            THEN 1 ELSE 0 
          END) as occasionalVoters,
          SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
          COUNT(*) as totalVoters
        FROM voters
        ${whereClause}
      `, params);

      const total = result?.totalVoters || 1;

      const data = {
        neverVoted: result?.neverVoted || 0,
        occasionalVoters: result?.occasionalVoters || 0,
        superVoters: result?.superVoters || 0,
        totalVoters: total,
        percentages: {
          neverVoted: parseFloat(((result?.neverVoted || 0) / total * 100).toFixed(2)),
          occasionalVoters: parseFloat(((result?.occasionalVoters || 0) / total * 100).toFixed(2)),
          superVoters: parseFloat(((result?.superVoters || 0) / total * 100).toFixed(2))
        },
        queryTime: Date.now() - startTime
      };

      this._setCache(cacheKey, data, this.cacheTTL.analytics);
      return data;
      
    } catch (error) {
      console.error('Engagement levels error:', error);
      throw new Error('Failed to calculate engagement levels');
    }
  }

  /**
   * Get non-voter demographics by age group
   * Analyzes never-voted voters by age to identify mobilization opportunities
   * 
   * @param {Object} filters - Query filters
   * @param {string} filters.precinct - Precinct filter
   * @returns {Promise<Object>} Non-voter counts and percentages by age group
   */
  async getNonVoterDemographics(filters = {}) {
    const cacheKey = this._getCacheKey('non_voter_demographics', filters);
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const startTime = Date.now();

    try {
      let whereClause = '';
      const params = [];
      
      if (filters.precinct) {
        whereClause = 'WHERE precinct_number = ?';
        params.push(filters.precinct);
      }

      const byAgeGroup = await this.db.all(`
        SELECT 
          CASE 
            WHEN date_of_birth IS NULL THEN 'Unknown'
            WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) < 18 THEN 'Under 18'
            WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) BETWEEN 18 AND 24 THEN '18-24'
            WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) BETWEEN 25 AND 34 THEN '25-34'
            WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) BETWEEN 35 AND 44 THEN '35-44'
            WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) BETWEEN 45 AND 54 THEN '45-54'
            WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) BETWEEN 55 AND 64 THEN '55-64'
            WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) BETWEEN 65 AND 74 THEN '65-74'
            WHEN CAST((julianday('now') - julianday(date_of_birth)) / 365.25 AS INTEGER) >= 75 THEN '75+'
          END AS ageGroup,
          COUNT(*) as totalInAgeGroup,
          SUM(CASE 
            WHEN (SELECT COUNT(*) FROM election_history 
                  WHERE voter_id = voters.voter_id AND voted = 1 AND cycle_id IS NULL) = 0 
            THEN 1 ELSE 0 
          END) as neverVotedCount,
          SUM(CASE 
            WHEN (SELECT COUNT(*) FROM election_history 
                  WHERE voter_id = voters.voter_id AND voted = 1 AND cycle_id IS NULL) BETWEEN 1 AND 3 
            THEN 1 ELSE 0 
          END) as occasionalVoters,
          SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
          CAST(SUM(CASE 
            WHEN (SELECT COUNT(*) FROM election_history 
                  WHERE voter_id = voters.voter_id AND voted = 1 AND cycle_id IS NULL) = 0 
            THEN 1 ELSE 0 
          END) AS REAL) / NULLIF(COUNT(*), 0) * 100 as neverVotedPercentage
        FROM voters
        ${whereClause}
        GROUP BY ageGroup
        ORDER BY 
          CASE ageGroup
            WHEN 'Under 18' THEN 1
            WHEN '18-24' THEN 2
            WHEN '25-34' THEN 3
            WHEN '35-44' THEN 4
            WHEN '45-54' THEN 5
            WHEN '55-64' THEN 6
            WHEN '65-74' THEN 7
            WHEN '75+' THEN 8
            WHEN 'Unknown' THEN 9
          END
      `, params);

      // Find highest and lowest rate age groups (excluding Unknown)
      const knownAgeGroups = byAgeGroup.filter(g => g.ageGroup !== 'Unknown');
      const highestRate = knownAgeGroups.reduce((max, g) => 
        g.neverVotedPercentage > (max?.neverVotedPercentage || 0) ? g : max, null);
      const lowestRate = knownAgeGroups.reduce((min, g) => 
        g.neverVotedPercentage < (min?.neverVotedPercentage || 100) ? g : min, null);

      const data = {
        byAgeGroup: byAgeGroup.map(g => ({
          ageGroup: g.ageGroup,
          totalInAgeGroup: g.totalInAgeGroup,
          neverVotedCount: g.neverVotedCount,
          occasionalVoters: g.occasionalVoters,
          superVoters: g.superVoters,
          neverVotedPercentage: parseFloat((g.neverVotedPercentage || 0).toFixed(2))
        })),
        summary: {
          totalNeverVoted: byAgeGroup.reduce((sum, g) => sum + g.neverVotedCount, 0),
          highestRateAgeGroup: highestRate?.ageGroup || null,
          highestRate: highestRate ? parseFloat(highestRate.neverVotedPercentage.toFixed(2)) : null,
          lowestRateAgeGroup: lowestRate?.ageGroup || null,
          lowestRate: lowestRate ? parseFloat(lowestRate.neverVotedPercentage.toFixed(2)) : null
        },
        queryTime: Date.now() - startTime
      };

      this._setCache(cacheKey, data, this.cacheTTL.analytics);
      return data;
      
    } catch (error) {
      console.error('Non-voter demographics error:', error);
      throw new Error('Failed to analyze non-voter demographics');
    }
  }

  /**
   * Get non-voters by precinct with severity levels
   * Identifies precincts with highest non-voter concentrations for field operations
   * 
   * @returns {Promise<Object>} Precinct-level non-voter analysis with severity indicators
   */
  async getNonVotersByPrecinct() {
    const cacheKey = 'non_voters_by_precinct';
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const startTime = Date.now();

    try {
      const precincts = await this.db.all(`
        SELECT 
          v.precinct_number as precinctNumber,
          p.name as precinctName,
          COUNT(v.id) as totalVoters,
          SUM(CASE 
            WHEN (SELECT COUNT(*) FROM election_history 
                  WHERE voter_id = v.voter_id AND voted = 1 AND cycle_id IS NULL) = 0 
            THEN 1 ELSE 0 
          END) as neverVotedCount,
          CAST(SUM(CASE 
            WHEN (SELECT COUNT(*) FROM election_history 
                  WHERE voter_id = v.voter_id AND voted = 1 AND cycle_id IS NULL) = 0 
            THEN 1 ELSE 0 
          END) AS REAL) / NULLIF(COUNT(v.id), 0) * 100 as neverVotedPercentage,
          CASE 
            WHEN CAST(SUM(CASE 
              WHEN (SELECT COUNT(*) FROM election_history 
                    WHERE voter_id = v.voter_id AND voted = 1 AND cycle_id IS NULL) = 0 
              THEN 1 ELSE 0 
            END) AS REAL) / NULLIF(COUNT(v.id), 0) * 100 >= 80 THEN 'critical'
            WHEN CAST(SUM(CASE 
              WHEN (SELECT COUNT(*) FROM election_history 
                    WHERE voter_id = v.voter_id AND voted = 1 AND cycle_id IS NULL) = 0 
              THEN 1 ELSE 0 
            END) AS REAL) / NULLIF(COUNT(v.id), 0) * 100 >= 60 THEN 'high'
            WHEN CAST(SUM(CASE 
              WHEN (SELECT COUNT(*) FROM election_history 
                    WHERE voter_id = v.voter_id AND voted = 1 AND cycle_id IS NULL) = 0 
              THEN 1 ELSE 0 
            END) AS REAL) / NULLIF(COUNT(v.id), 0) * 100 >= 40 THEN 'medium'
            ELSE 'low'
          END as severity
        FROM voters v
        LEFT JOIN precincts p ON v.precinct_number = p.precinct_number
        GROUP BY v.precinct_number, p.name
        ORDER BY neverVotedPercentage DESC
      `);

      const summary = {
        criticalPrecincts: precincts.filter(p => p.severity === 'critical').length,
        highNeedPrecincts: precincts.filter(p => p.severity === 'high').length,
        mediumNeedPrecincts: precincts.filter(p => p.severity === 'medium').length,
        lowNeedPrecincts: precincts.filter(p => p.severity === 'low').length
      };

      const data = {
        precincts: precincts.map(p => ({
          precinctNumber: p.precinctNumber,
          precinctName: p.precinctName || `Precinct ${p.precinctNumber}`,
          totalVoters: p.totalVoters,
          neverVotedCount: p.neverVotedCount,
          neverVotedPercentage: parseFloat((p.neverVotedPercentage || 0).toFixed(2)),
          severity: p.severity
        })),
        summary,
        queryTime: Date.now() - startTime
      };

      this._setCache(cacheKey, data, this.cacheTTL.analytics);
      return data;
      
    } catch (error) {
      console.error('Non-voters by precinct error:', error);
      throw new Error('Failed to analyze non-voters by precinct');
    }
  }

  /**
   * Return all distinct election codes that have at least one voted record.
   * Ordered newest-first using the same E_* numeric-suffix logic.
   * @returns {Promise<string[]>} e.g. ['E_5', 'E_4', 'E_3', 'E_2', 'E_1']
   */
  async getElectionCodes() {
    const cacheKey = 'election_codes';
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const rows = await this.db.all(`
      SELECT election_code
      FROM election_history
      WHERE voted = 1
        AND cycle_id IS NULL
      GROUP BY election_code
      ORDER BY
        CASE
          WHEN election_code LIKE 'E_%'
          THEN CAST(SUBSTR(election_code, 3) AS INTEGER)
          ELSE 0
        END DESC,
        election_code DESC
    `);

    const codes = rows.map(r => r.election_code);
    this._setCache(cacheKey, codes, this.cacheTTL.analytics);
    return codes;
  }

  /**
   * Get breakdown of the last (most recent) election
   * Shows who voted, their age distribution, and precinct distribution
   * 
   * @param {Object} filters - Query filters
   * @param {string} [filters.precinct] - Optional precinct filter
   * @param {string} [filters.electionCode] - Optional specific election code (skips auto-detect)
   * @returns {Promise<Object>} Last election breakdown data
   */
  async getLastElectionBreakdown(filters = {}) {
    const cacheKey = this._getCacheKey('last_election_breakdown', filters);
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const startTime = Date.now();

    try {
      let electionCode;

      // If caller supplied a specific election code, use it directly
      if (filters.electionCode) {
        electionCode = filters.electionCode;
      } else {
        // Step 1: Determine the most recent election code (existing behaviour)
        const lastElection = await this.db.get(`
          SELECT election_code 
          FROM election_history 
          WHERE voted = 1
            AND cycle_id IS NULL
          GROUP BY election_code 
          ORDER BY 
            CASE 
              WHEN election_code LIKE 'E_%' 
              THEN CAST(SUBSTR(election_code, 3) AS INTEGER) 
              ELSE 0 
            END DESC,
            election_code DESC
          LIMIT 1
        `);

        if (!lastElection) {
          return { election: null, ageBreakdown: [], precinctBreakdown: [], summary: null, queryTime: Date.now() - startTime };
        }
        electionCode = lastElection.election_code;
      }
      let precinctFilter = '';
      const params = [electionCode];

      if (filters.precinct) {
        precinctFilter = 'AND v.precinct_number = ?';
        params.push(filters.precinct);
      }

      // Step 2: Run all breakdown queries in parallel
      const [electionStats, ageBreakdown, precinctBreakdown] = await Promise.all([
        // Overall election stats (use COUNT(DISTINCT) to handle duplicate election_history rows)
        this.db.get(`
          SELECT 
            COUNT(DISTINCT v.id) as totalRegistered,
            COUNT(DISTINCT CASE WHEN e.voted = 1 THEN v.id END) as totalVoted,
            COUNT(DISTINCT CASE WHEN e.voted = 1 AND e.early_voted = 1 THEN v.id END) as earlyVoted,
            COUNT(DISTINCT CASE WHEN e.voted = 1 AND (e.early_voted = 0 OR e.early_voted IS NULL) THEN v.id END) as electionDayVoted
          FROM voters v
          LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.election_code = ?
          WHERE 1=1 ${precinctFilter}
        `, params),

        // Age breakdown of voters in this election
        this.db.all(`
          SELECT 
            CASE 
              WHEN v.date_of_birth IS NULL THEN 'Unknown'
              WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) < 18 THEN 'Under 18'
              WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 18 AND 24 THEN '18-24'
              WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 25 AND 34 THEN '25-34'
              WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 35 AND 44 THEN '35-44'
              WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 45 AND 54 THEN '45-54'
              WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 55 AND 64 THEN '55-64'
              WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 65 AND 74 THEN '65-74'
              WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) >= 75 THEN '75+'
              ELSE 'Unknown'
            END AS ageGroup,
            COUNT(DISTINCT v.id) as count,
            COUNT(DISTINCT CASE WHEN e.early_voted = 1 THEN v.id END) as earlyVoted
          FROM voters v
          JOIN election_history e ON v.voter_id = e.voter_id
          WHERE e.election_code = ? AND e.voted = 1 ${precinctFilter}
          GROUP BY ageGroup
          ORDER BY 
            CASE ageGroup
              WHEN 'Under 18' THEN 1
              WHEN '18-24' THEN 2
              WHEN '25-34' THEN 3
              WHEN '35-44' THEN 4
              WHEN '45-54' THEN 5
              WHEN '55-64' THEN 6
              WHEN '65-74' THEN 7
              WHEN '75+' THEN 8
              WHEN 'Unknown' THEN 9
            END
        `, params),

        // Precinct breakdown (JOIN-based approach instead of correlated subquery)
        // NOTE: Alias must NOT be 'voted' — SQLite resolves HAVING 'voted' to the
        //       e.voted column instead of the aggregate alias, filtering out all rows.
        this.db.all(`
          SELECT 
            v.precinct_number as precinctNumber,
            p.name as precinctName,
            COUNT(DISTINCT CASE WHEN e.voted = 1 THEN v.id END) as votedCount,
            reg.cnt as registered,
            COUNT(DISTINCT CASE WHEN e.voted = 1 AND e.early_voted = 1 THEN v.id END) as earlyVotedCount,
            COUNT(DISTINCT CASE WHEN e.voted = 1 AND e.party_code = 'D' THEN v.id END) as democrat,
            COUNT(DISTINCT CASE WHEN e.voted = 1 AND e.party_code = 'R' THEN v.id END) as republican,
            COUNT(DISTINCT CASE WHEN e.voted = 1 AND e.party_code = 'I' THEN v.id END) as independent,
            COUNT(DISTINCT CASE WHEN e.voted = 1 AND (e.party_code IS NULL OR e.party_code = '') THEN v.id END) as unknownParty
          FROM voters v
          LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.election_code = ?
          LEFT JOIN precincts p ON v.precinct_number = p.precinct_number
          LEFT JOIN (SELECT precinct_number, COUNT(*) as cnt FROM voters GROUP BY precinct_number) reg
            ON v.precinct_number = reg.precinct_number
          WHERE 1=1 ${precinctFilter}
          GROUP BY v.precinct_number, p.name
          HAVING votedCount > 0
          ORDER BY v.precinct_number
        `, params)
      ]);

      // Format results
      const totalVoted = electionStats?.totalVoted || 0;
      const totalRegistered = electionStats?.totalRegistered || 0;

      // Find summary stats
      const sortedPrecincts = [...precinctBreakdown].sort((a, b) => {
        const rateA = a.registered > 0 ? a.votedCount / a.registered : 0;
        const rateB = b.registered > 0 ? b.votedCount / b.registered : 0;
        return rateB - rateA;
      });
      const knownAgeGroups = ageBreakdown.filter(a => a.ageGroup !== 'Unknown');
      const largestAgeGroup = knownAgeGroups.reduce((max, g) => g.count > (max?.count || 0) ? g : max, null);

      // Compute median age group: the age bracket containing the median voter by count
      let medianAgeGroup = null;
      if (knownAgeGroups.length > 0) {
        const totalKnown = knownAgeGroups.reduce((sum, g) => sum + g.count, 0);
        const medianTarget = Math.ceil(totalKnown / 2);
        let cumulative = 0;
        for (const g of knownAgeGroups) {
          cumulative += g.count;
          if (cumulative >= medianTarget) {
            medianAgeGroup = g.ageGroup;
            break;
          }
        }
      }

      const result = {
        election: {
          electionCode,
          totalRegistered,
          totalVoted,
          turnoutRate: totalRegistered > 0 ? parseFloat((totalVoted / totalRegistered * 100).toFixed(2)) : 0,
          earlyVoted: electionStats?.earlyVoted || 0,
          electionDayVoted: electionStats?.electionDayVoted || 0,
          earlyVoteRate: totalVoted > 0 ? parseFloat(((electionStats?.earlyVoted || 0) / totalVoted * 100).toFixed(2)) : 0
        },
        ageBreakdown: ageBreakdown.map(a => ({
          ageGroup: a.ageGroup,
          count: a.count,
          percentage: totalVoted > 0 ? parseFloat((a.count / totalVoted * 100).toFixed(2)) : 0,
          earlyVoteRate: a.count > 0 ? parseFloat((a.earlyVoted / a.count * 100).toFixed(2)) : 0
        })),
        precinctBreakdown: precinctBreakdown.map(p => ({
          precinctNumber: p.precinctNumber,
          precinctName: p.precinctName || `Precinct ${p.precinctNumber}`,
          voted: p.votedCount,
          registered: p.registered,
          turnoutRate: p.registered > 0 ? parseFloat((p.votedCount / p.registered * 100).toFixed(2)) : 0,
          earlyVoteRate: p.votedCount > 0 ? parseFloat((p.earlyVotedCount / p.votedCount * 100).toFixed(2)) : 0,
          partyBreakdown: {
            democrat: p.democrat,
            republican: p.republican,
            independent: p.independent,
            unknown: p.unknownParty
          }
        })),
        summary: {
          highestTurnoutPrecinct: sortedPrecincts.length > 0 ? sortedPrecincts[0].precinctNumber : null,
          lowestTurnoutPrecinct: sortedPrecincts.length > 0 ? sortedPrecincts[sortedPrecincts.length - 1].precinctNumber : null,
          largestAgeGroup: largestAgeGroup?.ageGroup || null,
          medianAgeGroup: medianAgeGroup
        },
        queryTime: Date.now() - startTime
      };

      this._setCache(cacheKey, result, this.cacheTTL.analytics);
      return result;

    } catch (error) {
      console.error('Last election breakdown error:', error);
      throw new Error('Failed to analyze last election breakdown');
    }
  }
}

module.exports = AnalyticsService;
