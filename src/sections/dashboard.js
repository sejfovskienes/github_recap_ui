import React, { useState, useEffect } from 'react';
import { Github, GitBranch, GitCommit, Star, Code, TrendingUp, Award, Zap } from 'lucide-react';

// GitHub OAuth Configuration
const GITHUB_CLIENT_ID = process.env.REACT_APP_GITHUB_CLIENT_ID;
const REDIRECT_URI = "https://agenta-github-wrapped.vercel.app/";

export default function GitHubRecap() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [accessToken, setAccessToken] = useState(null);

  useEffect(() => {
    // Check if we have a stored token
    const storedToken = localStorage.getItem('gh_access_token');
    if (storedToken) {
      setAccessToken(storedToken);
      fetchUserData(storedToken);
    }

    // Check for OAuth callback code
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    
    if (code && !storedToken) {
      // Exchange code for access token
      exchangeCodeForToken(code);
    }
  }, []);

  const exchangeCodeForToken = async (code) => {
    setLoading(true);
    setError(null);

    try {
      console.log('Exchanging code for token...', code);
      
      // Backend endpoint that exchanges the code for a token using your CLIENT_SECRET
      const response = await fetch('https://github-recap-api.onrender.com/api/github/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      console.log('Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Response error:', errorText);
        throw new Error(`Failed to exchange code for token: ${response.status}`);
      }

      const data = await response.json();
      console.log('Token exchange response:', data);

      if (data.error) {
        throw new Error(`GitHub error: ${data.error} - ${data.error_description || ''}`);
      }

      if (!data.access_token) {
        throw new Error('No access token received from GitHub');
      }

      const token = data.access_token;

      // Store the token
      localStorage.setItem('gh_access_token', token);
      setAccessToken(token);

      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);

      // Fetch user data
      await fetchUserData(token);
    } catch (err) {
      setError(`Authentication failed: ${err.message}`);
      console.error('Auth error:', err);
      setLoading(false);
    }
  };

  const handleLogin = () => {
    // Redirect to GitHub OAuth
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=repo read:user`;
    window.location.href = githubAuthUrl;
  };

  const fetchUserData = async (token) => {
    setLoading(true);
    setError(null);

    try {
      const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      };

      // Fetch user info
      const userRes = await fetch('https://api.github.com/user', { headers });
      if (!userRes.ok) {
        if (userRes.status === 401) {
          // Token is invalid, clear it
          localStorage.removeItem('gh_access_token');
          setAccessToken(null);
          throw new Error('Invalid token. Please login again.');
        }
        throw new Error('Failed to fetch user data');
      }
      const userData = await userRes.json();
      setUser(userData);

      // Fetch ALL repositories (handle pagination)
      let repos = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const reposRes = await fetch(
          `https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated`,
          { headers }
        );
        if (!reposRes.ok) throw new Error('Failed to fetch repositories');
        const pageRepos = await reposRes.json();
        
        if (pageRepos.length === 0) {
          hasMore = false;
        } else {
          repos = [...repos, ...pageRepos];
          page++;
        }
        
        // Safety limit to avoid infinite loops
        if (page > 10) break;
      }

      // Calculate statistics for current year
      const currentYear = new Date().getFullYear();
      const yearStart = new Date(`${currentYear}-01-01`);
      
      const reposThisYear = repos.filter(repo => 
        new Date(repo.created_at) >= yearStart
      );

      let totalCommits = 0;
      let totalStars = 0;
      let totalForks = 0;
      let languageCount = {};
      const repoCommits = {};

      // Method 1: Try to get contributions from GitHub Events API (more accurate)
      console.log('Fetching user events...');
      try {
        let eventPage = 1;
        let eventCommits = 0;
        
        // GitHub Events API only shows last 90 days and max 300 events
        // So we'll use both methods
        while (eventPage <= 10) {
          const eventsRes = await fetch(
            `https://api.github.com/users/${userData.login}/events?per_page=100&page=${eventPage}`,
            { headers }
          );
          
          if (eventsRes.ok) {
            const events = await eventsRes.json();
            if (events.length === 0) break;
            
            events.forEach(event => {
              if (event.type === 'PushEvent' && event.created_at >= yearStart.toISOString()) {
                eventCommits += event.payload.commits ? event.payload.commits.length : 0;
              }
            });
            
            eventPage++;
          } else {
            break;
          }
        }
        console.log(`Events API found: ${eventCommits} commits in recent events`);
      } catch (err) {
        console.error('Error fetching events:', err);
      }

      // Method 2: Fetch commits from all repos
      console.log(`Fetching commits from ${repos.length} repositories...`);
      
      const repoPromises = repos.map(async (repo) => {
        try {
          // Fetch ALL commits with pagination
          let repoTotalCommits = 0;
          let commitPage = 1;
          let hasMoreCommits = true;

          while (hasMoreCommits && commitPage <= 30) {
            const commitsRes = await fetch(
              `https://api.github.com/repos/${repo.owner.login}/${repo.name}/commits?author=${userData.login}&since=${yearStart.toISOString()}&per_page=100&page=${commitPage}`,
              { headers }
            );
            
            if (commitsRes.ok) {
              const commits = await commitsRes.json();
              
              if (commits.length === 0) {
                hasMoreCommits = false;
              } else {
                repoTotalCommits += commits.length;
                commitPage++;
              }
            } else if (commitsRes.status === 409) {
              // Empty repository
              hasMoreCommits = false;
            } else {
              hasMoreCommits = false;
            }
            
            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          if (repoTotalCommits > 0) {
            totalCommits += repoTotalCommits;
            repoCommits[repo.name] = repoTotalCommits;
            console.log(`${repo.name}: ${repoTotalCommits} commits`);
          }
        } catch (err) {
          console.error(`Error fetching commits for ${repo.name}:`, err);
        }

        totalStars += repo.stargazers_count || 0;
        totalForks += repo.forks_count || 0;
        
        if (repo.language) {
          languageCount[repo.language] = (languageCount[repo.language] || 0) + 1;
        }
      });

      await Promise.all(repoPromises);
      console.log(`Total commits found from all repos: ${totalCommits}`);

      const topLanguage = Object.keys(languageCount).reduce((a, b) => 
        languageCount[a] > languageCount[b] ? a : b, 
        Object.keys(languageCount)[0] || 'None'
      );

      // Get top 3 languages
      const top3Languages = Object.entries(languageCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([lang, count]) => ({ language: lang, count }));

      const mostCommittedRepo = Object.keys(repoCommits).reduce((a, b) => 
        repoCommits[a] > repoCommits[b] ? a : b,
        Object.keys(repoCommits)[0] || 'None'
      );

      setStats({
        totalRepos: repos.length,
        reposThisYear: reposThisYear.length,
        totalCommits,
        totalStars,
        totalForks,
        topLanguage,
        top3Languages,
        mostCommittedRepo,
        mostCommittedRepoCount: repoCommits[mostCommittedRepo] || 0,
        languageCount: Object.keys(languageCount).length,
        year: currentYear
      });

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('gh_access_token');
    setAccessToken(null);
    setUser(null);
    setStats(null);
    window.history.replaceState({}, document.title, "/");
  };

  if (!user && !loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="mb-8 inline-block p-6 bg-white/10 rounded-full backdrop-blur-sm">
            <Github className="w-24 h-24 text-white" />
          </div>
          <h1 className="text-6xl font-bold text-white mb-4 tracking-tight">
            GitHub Recap <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-yellow-400">2025</span>
          </h1>
          <p className="text-xl text-gray-300 mb-8 max-w-md mx-auto">
            Discover your coding journey this year with stunning statistics and insights
          </p>
          <button
            onClick={handleLogin}
            className="px-8 py-4 bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-full text-lg font-semibold hover:scale-105 transform transition shadow-2xl hover:shadow-pink-500/50"
          >
            <Github className="inline-block mr-2 w-6 h-6" />
            Connect with GitHub
          </button>
          {error && (
            <div className="mt-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg max-w-md mx-auto">
              <p className="text-red-300">{error}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-t-4 border-b-4 border-pink-400 mx-auto mb-4"></div>
          <p className="text-2xl text-white font-semibold">Analyzing your year...</p>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12 pt-8">
          <img 
            src={user.avatar_url} 
            alt={user.name}
            className="w-32 h-32 rounded-full mx-auto mb-6 border-4 border-pink-400 shadow-2xl"
          />
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-4">
            {user.name}'s <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-yellow-400">{stats.year}</span>
          </h1>
          <p className="text-2xl text-gray-300 mb-6">Year in Code</p>
          <button
            onClick={handleLogout}
            className="px-6 py-2 bg-white/10 text-white rounded-full hover:bg-white/20 transition backdrop-blur-sm"
          >
            Logout
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {/* Total Repos */}
          <div className="bg-gradient-to-br from-pink-500 to-rose-600 rounded-3xl p-8 shadow-2xl transform hover:scale-105 transition">
            <Code className="w-12 h-12 text-white mb-4" />
            <h3 className="text-white/80 text-lg mb-2">Total Repositories</h3>
            <p className="text-5xl font-bold text-white">{stats.totalRepos}</p>
          </div>

          {/* New Repos This Year */}
          <div className="bg-gradient-to-br from-purple-500 to-indigo-600 rounded-3xl p-8 shadow-2xl transform hover:scale-105 transition">
            <Zap className="w-12 h-12 text-white mb-4" />
            <h3 className="text-white/80 text-lg mb-2">New in {stats.year}</h3>
            <p className="text-5xl font-bold text-white">{stats.reposThisYear}</p>
          </div>

          {/* Total Commits */}
          <div className="bg-gradient-to-br from-blue-500 to-cyan-600 rounded-3xl p-8 shadow-2xl transform hover:scale-105 transition">
            <GitCommit className="w-12 h-12 text-white mb-4" />
            <h3 className="text-white/80 text-lg mb-2">Commits in {stats.year}</h3>
            <p className="text-5xl font-bold text-white">{stats.totalCommits}</p>
          </div>

          {/* Stars */}
          <div className="bg-gradient-to-br from-yellow-500 to-orange-600 rounded-3xl p-8 shadow-2xl transform hover:scale-105 transition">
            <Star className="w-12 h-12 text-white mb-4" />
            <h3 className="text-white/80 text-lg mb-2">Total Stars</h3>
            <p className="text-5xl font-bold text-white">{stats.totalStars}</p>
          </div>

          {/* Top Language */}
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-3xl p-8 shadow-2xl transform hover:scale-105 transition">
            <Award className="w-12 h-12 text-white mb-4" />
            <h3 className="text-white/80 text-lg mb-2">Top Language</h3>
            <p className="text-4xl font-bold text-white">{stats.topLanguage}</p>
          </div>

          {/* Languages Used */}
          <div className="bg-gradient-to-br from-red-500 to-pink-600 rounded-3xl p-8 shadow-2xl transform hover:scale-105 transition">
            <GitBranch className="w-12 h-12 text-white mb-4" />
            <h3 className="text-white/80 text-lg mb-2">Languages Used</h3>
            <p className="text-5xl font-bold text-white">{stats.languageCount}</p>
          </div>
        </div>

        {/* Most Committed Repo */}
        <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 rounded-3xl p-12 shadow-2xl mb-12">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <TrendingUp className="w-16 h-16 text-white mb-4" />
              <h3 className="text-2xl text-white/90 mb-2">Most Active Repository</h3>
              <p className="text-5xl font-bold text-white mb-2">{stats.mostCommittedRepo}</p>
              <p className="text-2xl text-white/80">{stats.mostCommittedRepoCount} commits in {stats.year}</p>
            </div>
            <div className="text-right">
              <p className="text-white/60 text-lg">You're on fire! 🔥</p>
            </div>
          </div>
        </div>

        {/* Top 3 Languages */}
        {stats.top3Languages.length > 0 && (
          <div className="bg-white/10 backdrop-blur-md rounded-3xl p-12 shadow-2xl mb-12 border border-white/20">
            <h3 className="text-4xl font-bold text-white mb-8 text-center">Top 3 Programming Languages</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {stats.top3Languages.map((lang, idx) => (
                <div 
                  key={lang.language}
                  className={`relative rounded-2xl p-8 transform hover:scale-105 transition ${
                    idx === 0 ? 'bg-gradient-to-br from-yellow-400 to-orange-500' :
                    idx === 1 ? 'bg-gradient-to-br from-gray-300 to-gray-500' :
                    'bg-gradient-to-br from-amber-600 to-amber-800'
                  }`}
                >
                  <div className="absolute top-4 right-4 text-6xl font-bold text-white/20">
                    #{idx + 1}
                  </div>
                  <div className="flex items-center mb-4">
                    {idx === 0 && <span className="text-4xl mr-2">🥇</span>}
                    {idx === 1 && <span className="text-4xl mr-2">🥈</span>}
                    {idx === 2 && <span className="text-4xl mr-2">🥉</span>}
                  </div>
                  <h4 className="text-3xl font-bold text-white mb-2">{lang.language}</h4>
                  <p className="text-white/90 text-xl">{lang.count} {lang.count === 1 ? 'repository' : 'repositories'}</p>
                  <div className="mt-4 bg-white/20 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-white h-full rounded-full transition-all"
                      style={{ width: `${(lang.count / stats.top3Languages[0].count) * 100}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer Message */}
        <div className="text-center text-white/60 pb-8">
          <p className="text-lg">Keep coding and making amazing things! 🚀</p>
          <p className="text-sm mt-2">Product of Agenta Group. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}