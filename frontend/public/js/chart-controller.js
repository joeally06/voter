/**
 * Chart Controller
 * Manages Chart.js visualizations for analytics dashboard
 */
class ChartController {
  constructor(voterService, stateManager) {
    this.voterService = voterService;
    this.stateManager = stateManager;
    this.charts = {};
  }

  /**
   * Initialize all charts
   */
  async init() {
    if (!window.Chart) {
      Logger.error('Chart.js library not loaded');
      return;
    }

    // Set default Chart.js options with Phase 4 enhancements
    Chart.defaults.font.family = "'Inter', 'Segoe UI', system-ui, sans-serif";
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation.duration = 750;
    Chart.defaults.animation.easing = 'easeInOutQuart';
    
    // Enhanced tooltip defaults
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15, 23, 42, 0.9)';
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.titleFont = { size: 13, weight: 'bold' };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
    Chart.defaults.plugins.tooltip.displayColors = true;
    Chart.defaults.plugins.tooltip.boxPadding = 6;

    // Apply dark mode colors if needed
    this.applyThemeColors();

    await this.createAllCharts();

    // Subscribe to state changes
    this.stateManager.subscribe((state, prevState) => {
      if (state.analytics !== prevState.analytics) {
        this.updateCharts(state.analytics);
      }
    });

    // Listen for theme changes to update chart colors
    document.addEventListener('themechange', (e) => {
      this.applyThemeColors();
      Object.values(this.charts).forEach(function(chart) { chart.update(); });
    });

    Logger.info('✅ Charts initialized with Phase 4 enhancements');
  }

  /**
   * Apply theme-appropriate colors to Chart.js defaults
   */
  applyThemeColors() {
    var isDark = document.documentElement.classList.contains('dark');
    Chart.defaults.color = isDark ? '#e2e8f0' : '#1e293b';
    Chart.defaults.borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  }

  /**
   * Create all dashboard charts with loading states
   */
  async createAllCharts() {
    try {
      // Show skeleton loading for all charts
      this.showChartLoadingStates();

      // Load initial analytics data
      await this.loadAnalyticsData();

      // Create existing charts
      this.createPrecinctChart();
      this.createSuperVoterChart();
      this.createAgeDemographicsChart();

      // Create new analytics charts
      await this.createPartyAffiliationChart();
      await this.createEarlyVotingChart();
      await this.createTurnoutByPrecinctChart();

      // Create non-voter analytics charts
      await this.createVoterEngagementChart();
      await this.createNonVotersByAgeChart();
      await this.createNonVotersByPrecinctChart();

      // Create new trend/comparison charts
      await this.createTurnoutTrendChart();
      await this.createElectionComparisonChart();

      // Remove loading states
      this.hideChartLoadingStates();

    } catch (error) {
      Logger.error('Error creating charts:', error);
      if (window.Toast) {
        window.Toast.error('Failed to load analytics', { title: 'Chart Error' });
      }
    }
  }

  /**
   * Show skeleton loading states for charts
   */
  showChartLoadingStates() {
    const chartIds = [
      'precinctChart', 'superVoterChart', 'ageDemographicsChart',
      'partyAffiliationChart', 'earlyVotingChart', 'turnoutByPrecinctChart',
      'voterEngagementChart', 'nonVotersByAgeChart', 'nonVotersByPrecinctChart'
    ];

    chartIds.forEach(id => {
      const canvas = document.getElementById(id);
      if (canvas && canvas.parentElement) {
        canvas.parentElement.classList.add('vp-chart-loading');
        canvas.style.opacity = '0';
      }
    });
  }

  /**
   * Hide skeleton loading states for charts
   */
  hideChartLoadingStates() {
    const chartIds = [
      'precinctChart', 'superVoterChart', 'ageDemographicsChart',
      'partyAffiliationChart', 'earlyVotingChart', 'turnoutByPrecinctChart',
      'voterEngagementChart', 'nonVotersByAgeChart', 'nonVotersByPrecinctChart'
    ];

    chartIds.forEach(id => {
      const canvas = document.getElementById(id);
      if (canvas && canvas.parentElement) {
        canvas.parentElement.classList.remove('vp-chart-loading');
        canvas.style.opacity = '1';
        canvas.style.transition = 'opacity 300ms ease-out';
      }
    });
  }

  /**
   * Load analytics data from API
   */
  async loadAnalyticsData() {
    try {
      // Fetch dashboard metrics (includes precinct data)
      const dashboardResponse = await this.voterService.fetchAnalytics('dashboard');
      
      // Load demographics data
      const demographicsResponse = await this.voterService.getDemographics();

      // Load non-voter analytics data
      const engagementResponse = await this.voterService.getVoterEngagement();
      const nonVoterDemographicsResponse = await this.voterService.getNonVotersByAge();
      const nonVoterPrecinctResponse = await this.voterService.getNonVotersByPrecinct();

      // Store analytics data in state
      this.stateManager.setState({
        analytics: {
          dashboard: dashboardResponse.data || {},
          precincts: dashboardResponse.data?.precinctSummary || [],
          totals: dashboardResponse.data?.totals || {},
          demographics: demographicsResponse.data,
          engagement: engagementResponse.data || {},
          nonVoterDemographics: nonVoterDemographicsResponse.data || {},
          nonVoterPrecincts: nonVoterPrecinctResponse.data || {},
          loaded: true
        }
      });

      // Update the dashboard stats cards
      this.updateDashboardStatsCards(dashboardResponse.data?.totals || {}, dashboardResponse.data?.percentages || {});

    } catch (error) {
      Logger.error('Failed to load analytics:', error);
      Utils.showToast('Failed to load analytics data', 'error');
    }
  }

  /**
   * Update the dashboard stats cards with current data
   * @param {Object} totals - Total counts (voters, superVoters, precincts, geocoded)
   * @param {Object} percentages - Percentage values (geocodingProgress, superVoterRate)
   */
  updateDashboardStatsCards(totals, percentages) {
    // Update Total Voters card
    const totalVotersEl = document.getElementById('statTotalVoters');
    if (totalVotersEl) {
      totalVotersEl.textContent = (totals.voters || 0).toLocaleString();
    }

    // Update Super Voters card
    const superVotersEl = document.getElementById('statSuperVoters');
    if (superVotersEl) {
      superVotersEl.textContent = (totals.superVoters || 0).toLocaleString();
    }

    // Update Precincts card
    const precinctsEl = document.getElementById('statPrecincts');
    if (precinctsEl) {
      precinctsEl.textContent = (totals.precincts || 0).toLocaleString();
    }

    // Update Geocoded card (show percentage)
    const geocodedEl = document.getElementById('statGeocoded');
    if (geocodedEl) {
      const geocodingProgress = percentages.geocodingProgress || 0;
      geocodedEl.textContent = `${geocodingProgress}%`;
    }

    Logger.info('✅ Dashboard stats cards updated:', totals);
  }

  /**
   * Create precinct distribution chart
   */
  createPrecinctChart() {
    const canvas = document.getElementById('precinctChart');
    if (!canvas) {
      Logger.warn('Precinct chart canvas not found');
      return;
    }

    const ctx = canvas.getContext('2d');
    const state = this.stateManager.getState();
    const precincts = state.analytics.precincts || [];

    // Prepare data
    const labels = precincts.map(p => `Precinct ${p.precinctNumber}`);
    const data = precincts.map(p => p.totalVoters || 0);
    const colors = this.generateColors(precincts.length);

    // Destroy existing chart if any
    if (this.charts.precinct) {
      this.charts.precinct.destroy();
    }

    this.charts.precinct = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          label: 'Voters by Precinct',
          data: data,
          backgroundColor: colors,
          borderColor: '#ffffff',
          borderWidth: 2
        }]
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: 'Voter Distribution by Precinct',
            font: {
              size: 16,
              weight: 'bold'
            }
          },
          legend: {
            display: true,
            position: 'bottom',
            onClick: (e, legendItem, legend) => {
              // Enhanced legend interactivity
              const index = legendItem.index;
              const chart = legend.chart;
              const meta = chart.getDatasetMeta(0);
              meta.data[index].hidden = !meta.data[index].hidden;
              chart.update();
            },
            onHover: (e, legendItem) => {
              e.native.target.style.cursor = 'pointer';
            },
            onLeave: (e) => {
              e.native.target.style.cursor = 'default';
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            padding: 12,
            cornerRadius: 8,
            titleFont: { size: 14, weight: 'bold' },
            bodyFont: { size: 13 },
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.parsed || 0;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = ((value / total) * 100).toFixed(1);
                return `${label}: ${value.toLocaleString()} voters (${percentage}%)`;
              }
            }
          }
        },
        animation: {
          animateRotate: true,
          animateScale: true
        }
      }
    });

    Logger.info('✅ Precinct chart created');
  }

  /**
   * Create super voter comparison chart
   */
  createSuperVoterChart() {
    const canvas = document.getElementById('superVoterChart');
    if (!canvas) {
      Logger.warn('Super voter chart canvas not found');
      return;
    }

    const ctx = canvas.getContext('2d');
    const state = this.stateManager.getState();

    // Get super voter stats from dashboard totals
    const totals = state.analytics.totals || {};
    const superVoters = totals.superVoters || 0;
    const totalVoters = totals.voters || 0;
    const regularVoters = totalVoters - superVoters;

    // Destroy existing chart if any
    if (this.charts.superVoter) {
      this.charts.superVoter.destroy();
    }

    this.charts.superVoter = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ['Super Voters', 'Regular Voters'],
        datasets: [{
          label: 'Voter Types',
          data: [superVoters, regularVoters],
          backgroundColor: ['#198754', '#6c757d'],
          borderColor: '#ffffff',
          borderWidth: 2
        }]
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: 'Super Voters vs Regular Voters',
            font: {
              size: 16,
              weight: 'bold'
            }
          },
          legend: {
            display: true,
            position: 'bottom'
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.parsed || 0;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                return `${label}: ${value.toLocaleString()} (${percentage}%)`;
              }
            }
          }
        }
      }
    });

    Logger.info('✅ Super voter chart created');
  }

  /**
   * Update all charts with new data
   * @param {Object} analytics - Analytics data
   */
  updateCharts(analytics) {
    // Update precinct chart if data changed
    if (analytics.precincts && this.charts.precinct) {
      const labels = analytics.precincts.map(p => `Precinct ${p.precinct_number}`);
      const data = analytics.precincts.map(p => p.total_voters || 0);

      this.charts.precinct.data.labels = labels;
      this.charts.precinct.data.datasets[0].data = data;
      this.charts.precinct.update();
    }

    // Update super voter chart with current filtered data
    if (this.charts.superVoter) {
      const state = this.stateManager.getState();
      const voters = state.filteredVoters || [];
      const superVoters = voters.filter(v => v.is_super_voter).length;
      const regularVoters = voters.length - superVoters;

      this.charts.superVoter.data.datasets[0].data = [superVoters, regularVoters];
      this.charts.superVoter.update();
    }

    // Update age demographics chart
    if (analytics.demographics && this.charts.ageDemographics) {
      const ageData = analytics.demographics.byAgeGroup;
      if (ageData && ageData.length > 0) {
        const regularVoters = ageData.map(d => d.count - d.superVoters);
        const superVoters = ageData.map(d => d.superVoters);
        
        this.charts.ageDemographics.data.datasets[0].data = regularVoters;
        this.charts.ageDemographics.data.datasets[1].data = superVoters;
        this.charts.ageDemographics.update();
      }
    }
  }

  /**
   * Generate distinct colors for charts
   * @param {number} count - Number of colors needed
   * @returns {Array} Array of color strings
   */
  generateColors(count) {
    // Use configuration for chart colors with fallback to defaults
    const baseColors = window.APP_CONFIG?.chartColors || [
      '#0d6efd', // primary blue
      '#198754', // success green
      '#dc3545', // danger red
      '#ffc107', // warning yellow
      '#0dcaf0', // info cyan
      '#6c757d', // secondary gray
      '#6f42c1', // purple
      '#fd7e14', // orange
      '#20c997', // teal
      '#d63384'  // pink
    ];

    if (count <= baseColors.length) {
      return baseColors.slice(0, count);
    }

    // Generate additional colors if needed
    const colors = [...baseColors];
    for (let i = baseColors.length; i < count; i++) {
      const hue = (i * 137.5) % 360; // Golden angle for distribution
      colors.push(`hsl(${hue}, 70%, 50%)`);
    }

    return colors;
  }

  /**
   * Create age demographics horizontal bar chart
   */
  createAgeDemographicsChart() {
    const canvas = document.getElementById('ageDemographicsChart');
    if (!canvas) {
      Logger.warn('Age demographics chart canvas not found');
      return;
    }

    const ctx = canvas.getContext('2d');
    const state = this.stateManager.getState();
    const demographics = state.analytics.demographics;
    
    if (!demographics || !demographics.byAgeGroup) {
      Logger.warn('Age demographics data not available');
      return;
    }

    const ageData = demographics.byAgeGroup;

    // Prepare data
    const labels = ageData.map(d => d.ageGroup);
    const regularVoters = ageData.map(d => d.count - d.superVoters);
    const superVoters = ageData.map(d => d.superVoters);
    const avgAges = ageData.map(d => d.avgAge);
    
    // Color gradient from young (cyan) to old (gray)
    const ageGroupColors = [
      '#0dcaf0', // 18-24: Cyan - Youth
      '#0d6efd', // 25-34: Blue - Young professionals
      '#6f42c1', // 35-44: Purple - Mid-career
      '#fd7e14', // 45-54: Orange - Established
      '#dc3545', // 55-64: Red - Pre-retirement
      '#d63384', // 65-74: Pink - Young retirees
      '#6c757d'  // 75+: Gray - Senior
    ];

    // Destroy existing chart if any
    if (this.charts.ageDemographics) {
      this.charts.ageDemographics.destroy();
    }

    this.charts.ageDemographics = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Regular Voters',
            data: regularVoters,
            backgroundColor: ageGroupColors.map(c => c + 'CC'), // Add transparency
            borderColor: ageGroupColors,
            borderWidth: 1,
            stack: 'Stack 0'
          },
          {
            label: 'Super Voters',
            data: superVoters,
            backgroundColor: '#198754',
            borderColor: '#0f5132',
            borderWidth: 1,
            stack: 'Stack 0'
          }
        ]
      },
      options: {
        indexAxis: 'y', // Horizontal bars
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'nearest',
          axis: 'y',
          intersect: false
        },
        plugins: {
          title: {
            display: true,
            text: 'Voter Distribution by Age Group',
            font: {
              size: 16,
              weight: 'bold'
            }
          },
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              usePointStyle: true,
              padding: 15
            }
          },
          tooltip: {
            callbacks: {
              title: function(context) {
                return `Age Group: ${context[0].label}`;
              },
              label: function(context) {
                const label = context.dataset.label || '';
                const value = context.parsed.x || 0;
                const ageIndex = context.dataIndex;
                const totalVoters = regularVoters[ageIndex] + superVoters[ageIndex];
                const percentage = totalVoters > 0 ? ((value / totalVoters) * 100).toFixed(1) : '0.0';
                const avgAge = avgAges[ageIndex];
                
                let lines = [
                  `${label}: ${value.toLocaleString()} voters (${percentage}%)`
                ];
                
                if (context.datasetIndex === 0) { // First dataset
                  lines.push(`Average age: ${avgAge} years`);
                  lines.push(`Total voters: ${totalVoters.toLocaleString()}`);
                }
                
                return lines;
              },
              footer: function(context) {
                const ageIndex = context[0].dataIndex;
                const totalVoters = regularVoters[ageIndex] + superVoters[ageIndex];
                const superVoterRate = totalVoters > 0 ? ((superVoters[ageIndex] / totalVoters) * 100).toFixed(1) : '0.0';
                return `Super Voter Rate: ${superVoterRate}%`;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            title: {
              display: true,
              text: 'Number of Voters'
            },
            ticks: {
              callback: function(value) {
                return value.toLocaleString(); // Format numbers with commas
              }
            }
          },
          y: {
            stacked: true,
            title: {
              display: true,
              text: 'Age Group'
            }
          }
        },
        elements: {
          bar: {
            borderWidth: 2,
            borderRadius: 4
          }
        },
        onHover: (event, activeElements) => {
          event.native.target.style.cursor = activeElements.length > 0 ? 'pointer' : 'default';
        }
      }
    });

    Logger.info('✅ Age demographics chart created');
  }

  /**
   * Destroy all charts
   */
  destroy() {
    Object.values(this.charts).forEach(chart => {
      if (chart) {
        chart.destroy();
      }
    });
    this.charts = {};
    Logger.debug('🧹 Charts destroyed');
  }

  /**
   * Refresh all charts
   */
  async refresh() {
    await this.loadAnalyticsData();
    this.createAllCharts();
  }

  /**
   * Create party affiliation doughnut chart
   * Displays distribution of Democrat, Republican, Independent, and Unaffiliated voters
   */
  async createPartyAffiliationChart() {
    const canvas = document.getElementById('partyAffiliationChart');
    if (!canvas) {
      Logger.warn('Party affiliation chart canvas not found');
      return;
    }

    try {
      // Fetch data from API
      const response = await this.voterService.fetchAnalytics('party-affiliation');
      
      if (!response.success || !response.data) {
        Logger.error('Invalid party affiliation data');
        return;
      }

      const data = response.data.currentDistribution;

      // Prepare chart data
      const labels = ['Democrat', 'Republican', 'Independent', 'Unaffiliated'];
      const values = [
        data.democrat || 0,
        data.republican || 0,
        data.independent || 0,
        data.unaffiliated || 0
      ];
      
      // Political party colors using Bootstrap theme
      // Democrat (Blue), Republican (Red), Independent (Purple), Unaffiliated (Gray)
      const colors = ['#0d6efd', '#dc3545', '#6f42c1', '#6c757d'];

      // Destroy existing chart if any
      if (this.charts.partyAffiliation) {
        this.charts.partyAffiliation.destroy();
      }

      // Create chart
      const ctx = canvas.getContext('2d');
      this.charts.partyAffiliation = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            label: 'Party Affiliation',
            data: values,
            backgroundColor: colors,
            borderColor: '#ffffff',
            borderWidth: 2,
            hoverOffset: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: 'Party Affiliation Distribution',
              font: { size: 16, weight: 'bold' }
            },
            legend: {
              display: true,
              position: 'bottom',
              labels: {
                usePointStyle: true,
                padding: 15,
                font: { size: 12 }
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const label = context.label || '';
                  const value = context.parsed || 0;
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                  return `${label}: ${value.toLocaleString()} voters (${percentage}%)`;
                }
              }
            }
          },
          cutout: '60%'
        }
      });

      Logger.info('✅ Party affiliation chart created');

    } catch (error) {
      Logger.error('Error creating party affiliation chart:', error);
      Utils.showToast('Failed to load party affiliation chart', 'error');
    }
  }

  /**
   * Create early voting trends stacked bar chart
   * Shows early votes vs election day votes across elections
   */
  async createEarlyVotingChart() {
    const canvas = document.getElementById('earlyVotingChart');
    if (!canvas) {
      Logger.warn('Early voting chart canvas not found');
      return;
    }

    try {
      // Fetch data from API
      const response = await this.voterService.fetchAnalytics('voting-patterns');
      
      if (!response.success || !response.data || !response.data.earlyVotingStats) {
        Logger.error('Invalid early voting data');
        return;
      }

      const earlyStats = response.data.earlyVotingStats.byElection || [];
      
      // Prepare chart data
      const labels = earlyStats.map(e => `Election ${e.electionCode.replace('E_', '')}`);
      const earlyVotes = earlyStats.map(e => e.earlyVotes || 0);
      const electionDayVotes = earlyStats.map(e => (e.totalVotes || 0) - (e.earlyVotes || 0));

      // Destroy existing chart if any
      if (this.charts.earlyVoting) {
        this.charts.earlyVoting.destroy();
      }

      // Create chart
      const ctx = canvas.getContext('2d');
      this.charts.earlyVoting = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Early Votes',
              data: earlyVotes,
              backgroundColor: '#198754',  // Bootstrap success green
              borderColor: '#0f5132',      // Bootstrap success dark
              borderWidth: 1,
              stack: 'votes'
            },
            {
              label: 'Election Day Votes',
              data: electionDayVotes,
              backgroundColor: '#0d6efd',  // Bootstrap primary blue
              borderColor: '#0a58ca',      // Bootstrap primary dark
              borderWidth: 1,
              stack: 'votes'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            title: {
              display: true,
              text: 'Early Voting vs Election Day Voting',
              font: { size: 16, weight: 'bold' }
            },
            legend: {
              display: true,
              position: 'bottom',
              labels: {
                usePointStyle: true,
                padding: 15
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const label = context.dataset.label || '';
                  const value = context.parsed.y || 0;
                  const dataIndex = context.dataIndex;
                  const total = earlyVotes[dataIndex] + electionDayVotes[dataIndex];
                  const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                  return `${label}: ${value.toLocaleString()} (${percentage}%)`;
                },
                footer: function(context) {
                  const dataIndex = context[0].dataIndex;
                  const total = earlyVotes[dataIndex] + electionDayVotes[dataIndex];
                  return `Total Votes: ${total.toLocaleString()}`;
                }
              }
            }
          },
          scales: {
            x: {
              stacked: true,
              title: { display: true, text: 'Election' }
            },
            y: {
              stacked: true,
              title: { display: true, text: 'Number of Votes' },
              ticks: {
                callback: function(value) {
                  return value.toLocaleString();
                }
              }
            }
          },
          elements: {
            bar: { borderRadius: 4 }
          }
        }
      });

      Logger.info('✅ Early voting chart created');

    } catch (error) {
      Logger.error('Error creating early voting chart:', error);
      Utils.showToast('Failed to load early voting chart', 'error');
    }
  }

  /**
   * Create turnout by precinct horizontal bar chart
   * Color-coded by turnout performance (green=high, red=low)
   */
  async createTurnoutByPrecinctChart() {
    const canvas = document.getElementById('turnoutByPrecinctChart');
    if (!canvas) {
      Logger.warn('Turnout by precinct chart canvas not found');
      return;
    }

    try {
      // Fetch data from API (no specific election = overall data)
      const response = await this.voterService.fetchAnalytics('turnout');
      
      if (!response.success || !response.data || !response.data.byPrecinct) {
        Logger.error('Invalid turnout data');
        return;
      }

      const precinctData = response.data.byPrecinct;
      
      // Prepare chart data
      const labels = precinctData.map(p => `Precinct ${p.precinctNumber}`);
      const turnoutRates = precinctData.map(p => parseFloat((p.turnoutRate || 0).toFixed(2)));
      const registeredVoters = precinctData.map(p => p.registeredVoters || 0);
      const votes = precinctData.map(p => p.votes || 0);
      
      /**
       * Get color based on turnout rate
       * Bootstrap color scheme with 5 performance levels
       * @param {number} rate - Turnout rate percentage
       * @returns {string} Color hex code
       */
      const getTurnoutColor = (rate) => {
        if (rate >= 70) return '#198754';  // Bootstrap success - Green - Excellent (≥70%)
        if (rate >= 60) return '#20c997';  // Bootstrap teal - Good (60-69%)
        if (rate >= 50) return '#0dcaf0';  // Bootstrap info - Cyan - Average (50-59%)
        if (rate >= 40) return '#ffc107';  // Bootstrap warning - Yellow - Below Average (40-49%)
        return '#dc3545';                  // Bootstrap danger - Red - Low (<40%)
      };
      
      const backgroundColors = turnoutRates.map(rate => getTurnoutColor(rate));

      // Destroy existing chart if any
      if (this.charts.turnoutByPrecinct) {
        this.charts.turnoutByPrecinct.destroy();
      }

      // Create chart
      const ctx = canvas.getContext('2d');
      this.charts.turnoutByPrecinct = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Turnout Rate (%)',
            data: turnoutRates,
            backgroundColor: backgroundColors,
            borderColor: backgroundColors,
            borderWidth: 1,
            barThickness: 'flex',
            maxBarThickness: 40,
            // Store additional data for tooltip
            registeredVoters: registeredVoters,
            votes: votes
          }]
        },
        options: {
          indexAxis: 'y', // Horizontal bars
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'nearest',
            axis: 'y',
            intersect: false
          },
          plugins: {
            title: {
              display: true,
              text: 'Voter Turnout by Precinct',
              font: { size: 16, weight: 'bold' }
            },
            legend: {
              display: false // Single dataset doesn't need legend
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const rate = context.parsed.x;
                  const index = context.dataIndex;
                  const registered = context.chart.data.datasets[0].registeredVoters[index];
                  const voteCount = context.chart.data.datasets[0].votes[index];
                  
                  return [
                    `Turnout Rate: ${rate.toFixed(1)}%`,
                    `Votes Cast: ${voteCount.toLocaleString()}`,
                    `Registered Voters: ${registered.toLocaleString()}`
                  ];
                }
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Turnout Rate (%)' },
              min: 0,
              max: 100,
              ticks: {
                callback: function(value) {
                  return value + '%';
                }
              },
              grid: { drawBorder: false }
            },
            y: {
              title: { display: true, text: 'Precinct' },
              grid: { display: false }
            }
          },
          elements: {
            bar: { borderRadius: 4 }
          }
        }
      });

      Logger.info('✅ Turnout by precinct chart created');

    } catch (error) {
      Logger.error('Error creating turnout by precinct chart:', error);
      Utils.showToast('Failed to load turnout by precinct chart', 'error');
    }
  }

  /**
   * Create voter engagement levels chart (doughnut chart)
   * Shows breakdown of never-voted, occasional, and super voters
   */
  async createVoterEngagementChart() {
    const canvas = document.getElementById('voterEngagementChart');
    if (!canvas) {
      Logger.warn('Voter engagement chart canvas not found');
      return;
    }

    try {
      const ctx = canvas.getContext('2d');
      const state = this.stateManager.getState();
      const engagement = state.analytics?.engagement;

      if (!engagement || !engagement.neverVoted) {
        Logger.warn('Voter engagement data not available');
        return;
      }

      // Destroy existing chart if any
      if (this.charts.voterEngagement) {
        this.charts.voterEngagement.destroy();
      }

      this.charts.voterEngagement = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: [
            'Never Voted (0 elections)',
            'Occasional Voters (1-3 elections)',
            'Super Voters (4+ elections)'
          ],
          datasets: [{
            data: [
              engagement.neverVoted,
              engagement.occasionalVoters,
              engagement.superVoters
            ],
            backgroundColor: [
              '#dc3545', // Red for never voted
              '#ffc107', // Yellow for occasional
              '#198754'  // Green for super voters
            ],
            borderColor: [
              '#b02a37',
              '#d39e00',
              '#0f5132'
            ],
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: 'Voter Engagement Levels',
              font: { size: 16, weight: 'bold' }
            },
            legend: {
              display: true,
              position: 'bottom',
              labels: {
                usePointStyle: true,
                padding: 15
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const label = context.label || '';
                  const value = context.parsed || 0;
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                  return `${label}: ${value.toLocaleString()} (${percentage}%)`;
                }
              }
            }
          }
        }
      });

      Logger.info('✅ Voter engagement chart created');

    } catch (error) {
      Logger.error('Error creating voter engagement chart:', error);
      Utils.showToast('Failed to load voter engagement chart', 'error');
    }
  }

  /**
   * Create non-voters by age chart (dual-axis bar + line chart)
   * Shows never-voted count and percentage by age group
   */
  async createNonVotersByAgeChart() {
    const canvas = document.getElementById('nonVoterAgeChart');
    if (!canvas) {
      Logger.warn('Non-voter age chart canvas not found');
      return;
    }

    try {
      const ctx = canvas.getContext('2d');
      const state = this.stateManager.getState();
      const nonVoterData = state.analytics?.nonVoterDemographics;

      if (!nonVoterData || !nonVoterData.byAgeGroup) {
        Logger.warn('Non-voter demographics data not available');
        return;
      }

      const ageGroups = nonVoterData.byAgeGroup.filter(g => g.ageGroup !== 'Unknown');

      // Destroy existing chart if any
      if (this.charts.nonVoterAge) {
        this.charts.nonVoterAge.destroy();
      }

      this.charts.nonVoterAge = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ageGroups.map(g => g.ageGroup),
          datasets: [
            {
              label: 'Never Voted Count',
              data: ageGroups.map(g => g.neverVotedCount),
              backgroundColor: '#fd7e14',
              borderColor: '#dc6c00',
              borderWidth: 1,
              yAxisID: 'y'
            },
            {
              label: 'Never Voted %',
              data: ageGroups.map(g => g.neverVotedPercentage),
              type: 'line',
              borderColor: '#dc3545',
              backgroundColor: 'rgba(220, 53, 69, 0.1)',
              borderWidth: 3,
              fill: true,
              yAxisID: 'y1',
              pointRadius: 5,
              pointHoverRadius: 7,
              tension: 0.3
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            title: {
              display: true,
              text: 'Non-Voter Analysis by Age Group',
              font: { size: 16, weight: 'bold' }
            },
            legend: {
              display: true,
              position: 'bottom',
              labels: {
                usePointStyle: true,
                padding: 15
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const label = context.dataset.label || '';
                  const value = context.parsed.y;
                  if (label.includes('%')) {
                    return `${label}: ${value.toFixed(1)}%`;
                  } else {
                    return `${label}: ${value.toLocaleString()}`;
                  }
                }
              }
            }
          },
          scales: {
            y: {
              type: 'linear',
              position: 'left',
              title: { display: true, text: 'Number of Voters' },
              beginAtZero: true
            },
            y1: {
              type: 'linear',
              position: 'right',
              title: { display: true, text: 'Never Voted %' },
              min: 0,
              max: 100,
              grid: { drawOnChartArea: false },
              ticks: {
                callback: function(value) {
                  return value + '%';
                }
              }
            }
          }
        }
      });

      Logger.info('✅ Non-voter age chart created');

    } catch (error) {
      Logger.error('Error creating non-voter age chart:', error);
      Utils.showToast('Failed to load non-voter age chart', 'error');
    }
  }

  /**
   * Create non-voters by precinct chart (horizontal bar chart with severity colors)
   * Shows precincts sorted by never-voted percentage with color-coded severity
   */
  async createNonVotersByPrecinctChart() {
    const canvas = document.getElementById('nonVoterPrecinctChart');
    if (!canvas) {
      Logger.warn('Non-voter precinct chart canvas not found');
      return;
    }

    try {
      const ctx = canvas.getContext('2d');
      const state = this.stateManager.getState();
      const precinctData = state.analytics?.nonVoterPrecincts;

      if (!precinctData || !precinctData.precincts) {
        Logger.warn('Non-voter precinct data not available');
        return;
      }

      const precincts = precinctData.precincts;

      // Generate colors based on severity
      const colors = precincts.map(p => {
        switch (p.severity) {
          case 'critical': return '#dc3545'; // Red
          case 'high': return '#fd7e14';     // Orange
          case 'medium': return '#ffc107';   // Yellow
          default: return '#198754';         // Green
        }
      });

      const borderColors = precincts.map(p => {
        switch (p.severity) {
          case 'critical': return '#b02a37';
          case 'high': return '#dc6c00';
          case 'medium': return '#d39e00';
          default: return '#0f5132';
        }
      });

      // Destroy existing chart if any
      if (this.charts.nonVoterPrecinct) {
        this.charts.nonVoterPrecinct.destroy();
      }

      this.charts.nonVoterPrecinct = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: precincts.map(p => `${p.precinctName || 'Precinct ' + p.precinctNumber}`),
          datasets: [{
            label: 'Never Voted Voters',
            data: precincts.map(p => p.neverVotedCount),
            backgroundColor: colors,
            borderColor: borderColors,
            borderWidth: 1,
            // Store precinct data for tooltip
            precinctData: precincts
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: 'Non-Voters by Precinct (Sorted by Priority)',
              font: { size: 16, weight: 'bold' }
            },
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const index = context.dataIndex;
                  const precinct = context.dataset.precinctData[index];
                  return [
                    `Never Voted: ${precinct.neverVotedCount.toLocaleString()} voters`,
                    `Percentage: ${precinct.neverVotedPercentage.toFixed(1)}%`,
                    `Total Voters: ${precinct.totalVoters.toLocaleString()}`,
                    `Priority: ${precinct.severity.toUpperCase()}`
                  ];
                }
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Number of Non-Voters' },
              beginAtZero: true
            }
          },
          elements: {
            bar: { borderRadius: 4 }
          }
        }
      });

      Logger.info('✅ Non-voter precinct chart created');

    } catch (error) {
      Logger.error('Error creating non-voter precinct chart:', error);
      Utils.showToast('Failed to load non-voter precinct chart', 'error');
    }
  }

  /**
   * Create turnout trend line chart
   * Shows voter turnout percentage across elections
   */
  async createTurnoutTrendChart() {
    var canvas = document.getElementById('turnoutTrendChart');
    if (!canvas) {
      Logger.warn('Turnout trend chart canvas not found');
      return;
    }

    try {
      var ctx = canvas.getContext('2d');

      // Fetch turnout data from analytics API
      var turnoutResponse = await this.voterService.getTurnoutAnalysis();
      var turnoutData = turnoutResponse.data || turnoutResponse;

      // Extract election codes and turnout percentages
      var elections = [];
      var turnoutRates = [];

      if (turnoutData && turnoutData.turnoutByElection) {
        turnoutData.turnoutByElection.forEach(function(item) {
          elections.push(item.electionCode || item.election_code);
          turnoutRates.push(parseFloat(item.turnoutRate || item.turnout_rate || 0));
        });
      } else if (turnoutData && turnoutData.elections) {
        turnoutData.elections.forEach(function(item) {
          elections.push(item.code || item.electionCode);
          turnoutRates.push(parseFloat(item.turnoutPercentage || item.turnoutRate || 0));
        });
      }

      // Fallback: use precinct turnout data from state if no election-level data
      if (elections.length === 0) {
        var state = this.stateManager.getState();
        var precinctData = state.analytics?.dashboard?.precinctSummary || state.analytics?.precincts || [];
        precinctData.forEach(function(p) {
          elections.push(p.precinctName || 'Precinct ' + p.precinctNumber);
          turnoutRates.push(parseFloat(p.turnoutRate || p.superVoterRate || 0));
        });
      }

      if (elections.length === 0) {
        Logger.debug('No turnout trend data available');
        return;
      }

      var isDark = document.documentElement.classList.contains('dark');
      var lineColor = isDark ? '#818cf8' : '#4f46e5';
      var fillColor = isDark ? 'rgba(129,140,248,0.15)' : 'rgba(79,70,229,0.1)';

      // Destroy existing chart if any
      if (this.charts.turnoutTrend) {
        this.charts.turnoutTrend.destroy();
      }

      this.charts.turnoutTrend = new Chart(ctx, {
        type: 'line',
        data: {
          labels: elections,
          datasets: [{
            label: 'Turnout %',
            data: turnoutRates,
            borderColor: lineColor,
            backgroundColor: fillColor,
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            pointHoverRadius: 8,
            pointBackgroundColor: lineColor,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: 'Voter Turnout Trend',
              font: { size: 16, weight: 'bold' }
            },
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return 'Turnout: ' + context.parsed.y.toFixed(1) + '%';
                }
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Election' }
            },
            y: {
              title: { display: true, text: 'Turnout (%)' },
              min: 0,
              max: 100,
              ticks: {
                callback: function(value) { return value + '%'; }
              }
            }
          }
        }
      });

      Logger.info('✅ Turnout trend chart created');

    } catch (error) {
      Logger.error('Error creating turnout trend chart:', error);
    }
  }

  /**
   * Create election comparison grouped bar chart
   * Compares metrics between elections side by side
   */
  async createElectionComparisonChart() {
    var canvas = document.getElementById('electionComparisonChart');
    if (!canvas) {
      Logger.warn('Election comparison chart canvas not found');
      return;
    }

    try {
      var ctx = canvas.getContext('2d');

      // Fetch voting patterns data which contains per-election breakdowns
      var patternsResponse = await this.voterService.getVotingPatterns();
      var patternsData = patternsResponse.data || patternsResponse;

      var elections = [];
      var totalVoted = [];
      var earlyVoted = [];

      // Try to extract from earlyVotingStats.byElection (per-election array)
      if (patternsData && patternsData.earlyVotingStats && patternsData.earlyVotingStats.byElection) {
        patternsData.earlyVotingStats.byElection.forEach(function(item) {
          elections.push(item.electionCode || item.election_code);
          totalVoted.push(parseInt(item.totalVotes || item.total_voted || 0));
          earlyVoted.push(parseInt(item.earlyVotes || item.early_votes || 0));
        });
      } else if (patternsData && patternsData.elections) {
        patternsData.elections.forEach(function(item) {
          elections.push(item.code || item.electionCode);
          totalVoted.push(parseInt(item.totalVoted || 0));
          earlyVoted.push(parseInt(item.earlyVoted || 0));
        });
      }

      // Fallback: use precinct data as comparison items
      if (elections.length === 0) {
        var state = this.stateManager.getState();
        var precincts = state.analytics?.dashboard?.precinctSummary || state.analytics?.precincts || [];
        precincts.slice(0, 8).forEach(function(p) {
          elections.push(p.precinctName || 'Precinct ' + p.precinctNumber);
          totalVoted.push(parseInt(p.totalVoters || p.voterCount || 0));
          earlyVoted.push(parseInt(p.superVoterCount || p.superVoters || 0));
        });
      }

      if (elections.length === 0) {
        Logger.debug('No election comparison data available');
        return;
      }

      var isDark = document.documentElement.classList.contains('dark');

      // Destroy existing chart if any
      if (this.charts.electionComparison) {
        this.charts.electionComparison.destroy();
      }

      this.charts.electionComparison = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: elections,
          datasets: [
            {
              label: 'Total Voted',
              data: totalVoted,
              backgroundColor: isDark ? 'rgba(129,140,248,0.7)' : 'rgba(79,70,229,0.7)',
              borderColor: isDark ? '#818cf8' : '#4f46e5',
              borderWidth: 1,
              borderRadius: 4
            },
            {
              label: 'Early Voted',
              data: earlyVoted,
              backgroundColor: isDark ? 'rgba(52,211,153,0.7)' : 'rgba(16,185,129,0.7)',
              borderColor: isDark ? '#34d399' : '#10b981',
              borderWidth: 1,
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: 'Election Comparison',
              font: { size: 16, weight: 'bold' }
            },
            legend: {
              display: true,
              position: 'bottom',
              labels: {
                usePointStyle: true,
                padding: 15
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return context.dataset.label + ': ' + context.parsed.y.toLocaleString();
                }
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Election' }
            },
            y: {
              title: { display: true, text: 'Voters' },
              beginAtZero: true,
              ticks: {
                callback: function(value) { return value.toLocaleString(); }
              }
            }
          }
        }
      });

      Logger.info('✅ Election comparison chart created');

    } catch (error) {
      Logger.error('Error creating election comparison chart:', error);
    }
  }
}

// Make available globally
window.ChartController = ChartController;
