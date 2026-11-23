// Token Launch Radar dashboard — radar-3. Static only: reads window.RADAR
// from data.js, no fetch, no network. Recomputes every row in the page
// from the fitted curve and the fitted odds, so the page must agree with
// board.json exactly. The recompute below mirrors lib/model.ts step for
// step: log-log fit, category log-adjustment, growth multiplier, age
// odds (non-increasing), TVL and growth factors, then the farm verdict.
(function () {
  var D = window.RADAR;
  if (!D) { document.getElementById('rows').innerHTML = '<tr><td colspan="8">No data loaded.</td></tr>'; return; }
  var F = D.fit, O = D.odds, M = D.model;

  var fmtMoney = function (n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  };
  var fmtPct = function (v) { return v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; };
  var fmtAge = function (d) { return d === null || d === undefined ? 'unknown' : d + 'd'; };
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };

  function ageBucket(age) { if (age === null || age === undefined) return -1; if (age < 180) return 0; if (age < 365) return 1; if (age < 730) return 2; return 3; }
  function tvlBucket(tvl) { if (tvl < 5e7) return 0; if (tvl < 2e8) return 1; if (tvl < 1e9) return 2; return 3; }
  function growthBucket(g) { if (g === null || g === undefined) return -1; if (g < -10) return 0; if (g < 0) return 1; if (g < 10) return 2; if (g < 50) return 3; return 4; }
  function capitalFor(tvl) { if (tvl >= 5e9) return 250; if (tvl >= 1e9) return 150; if (tvl >= 1e8) return 100; return 50; }
  function holdFor(age) { if (age === null || age === undefined) return 30; if (age < 180) return 60; if (age < 365) return 45; return 30; }

  function recompute(row) {
    var catAdj = D.category_log_adj[row.category || 'Uncategorised'];
    if (catAdj === undefined) catAdj = 0;
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    g = clamp(g, M.growth_floor, M.growth_cap);
    var growthMult = 1 + (g / 100) * M.growth_weight;
    var launch = Math.exp(F.intercept + F.slope * Math.log(row.tvl_usd) + catAdj) * growthMult;
    var ab = ageBucket(row.age_days);
    var ageOdds = ab < 0 ? O.overall_pre_token_share : O.age_odds[ab];
    // Mirror lib/model.ts oddsFor exactly: the TVL and growth factors are
    // NOT rounded before multiplying; only the final odds are rounded to
    // 4 decimals after clamping. (Rounding the factors first shifts the
    // implied value by a few dollars on some rows.)
    var tvlF = clamp(O.tvl_buckets[tvlBucket(row.tvl_usd)].pre_token_share / O.overall_pre_token_share, M.factor_floor, M.factor_cap);
    var gb = growthBucket(row.change_7d);
    var growthF = gb < 0 ? 1 : clamp(O.growth_buckets[gb].pre_token_share / O.overall_pre_token_share, M.factor_floor, M.factor_cap);
    var odds = Math.round(clamp(ageOdds * tvlF * growthF, M.odds_floor, M.odds_cap) * 1e4) / 1e4;
    var implied = Math.max(1, Math.round(launch * odds));
    return { catAdj: catAdj, growthPct: g, growthMult: growthMult, launch: launch, ageOdds: ageOdds, tvlF: tvlF, growthF: growthF, odds: odds, implied: implied };
  }

  function farmFor(row, implied) {
    var capital = capitalFor(row.tvl_usd);
    var hold = holdFor(row.age_days);
    var weeks = Math.ceil(hold / 7);
    var gas = (capital >= 150 ? 8 : 4) + 2 * weeks;
    var hours = r2(0.25 + (10 / 60) * weeks + 10 / 60 + 5 / 60);
    var cost = r2(capital + gas + hours * M.hourly_rate_usd);
    var farmers = M.farmers_base + M.farmers_per_rank * row.rank;
    var value = r2(implied * M.farmer_share / farmers);
    var net = r2(value - cost);
    var vph = r2(value / hours);
    var verdict = net <= 0 ? 'SKIP' : net <= M.thin_net_max_usd ? 'THIN' : 'FARM';
    var breakEven = cost > 0 ? Math.floor(implied * M.farmer_share / cost) : 0;
    return { capital: capital, hold: hold, weeks: weeks, gas: gas, hours: hours, cost: cost, farmers: farmers, value: value, net: net, vph: vph, verdict: verdict, breakEven: breakEven };
  }

  // KPI strip.
  document.getElementById('asof').textContent = D.as_of;
  var vc = D.verdict_counts;
  var kpis = [
    'Watchlist <b>' + D.watchlist_size + ' / ' + D.watchlist_size + '</b>',
    '<b>' + D.census_total + '</b> protocols accounted for: ' + D.board_size + ' ranked + ' + D.live_total + ' live + ' + D.excluded_size + ' excluded',
    'Fit R² <b>' + F.r_squared + '</b> (n=' + F.n + ')',
    'LOO error <b>' + F.loo_median_abs_log_err + '</b> vs flat ' + F.flat_median_abs_log_err + ' (' + F.loo_factor_vs_flat + '×)',
    'Verdicts <b>FARM ' + vc.FARM + ' · THIN ' + vc.THIN + ' · SKIP ' + vc.SKIP + '</b>'
  ];
  document.getElementById('kpis').innerHTML = kpis.map(function (s) { return '<span class="kpi">' + s + '</span>'; }).join('');

  // Model panel.
  document.getElementById('fit-text').innerHTML =
    '<p><strong>Fitted size curve.</strong> log(market cap) = <strong>' + F.intercept + ' + ' + F.slope + ' × log(TVL)</strong>, fitted by least squares on ' + F.n +
    ' live-token protocols with a usable market cap (mcap &gt; 0; the snapshot also carries −1 and 0 sentinels, left out). R² = ' + F.r_squared +
    '. A flat median mcap/TVL multiple of ' + F.flat_median_ratio + ' is the baseline the fit is tested against.</p>' +
    '<p><strong>Category adjustment.</strong> Each category’s median residual from that curve, shrunk toward 0 with 5 pseudo-counts and clamped to ±1 in log units — e.g. Lending ' +
    (D.category_log_adj.Lending !== undefined ? D.category_log_adj.Lending.toFixed(3) : 'n/a') + ', Dexs ' +
    (D.category_log_adj.Dexs !== undefined ? D.category_log_adj.Dexs.toFixed(3) : 'n/a') + ', RWA ' +
    (D.category_log_adj.RWA !== undefined ? D.category_log_adj.RWA.toFixed(3) : 'n/a') + '. Full list below.</p>';
  document.getElementById('oos-table').innerHTML =
    '<thead><tr><th>Test</th><th>Fitted curve</th><th>Flat multiple</th><th>Factor</th></tr></thead><tbody>' +
    '<tr><td>Leave-one-out (n=' + F.n + ')</td><td>' + F.loo_median_abs_log_err + '</td><td>' + F.flat_median_abs_log_err + '</td><td>' + F.loo_factor_vs_flat + '×</td></tr>' +
    '<tr><td>5-fold, by slug hash</td><td>' + F.five_fold_median_abs_log_err + '</td><td>' + F.flat_median_abs_log_err + '</td><td>' + (F.five_fold_median_abs_log_err > 0 ? (F.flat_median_abs_log_err / F.five_fold_median_abs_log_err).toFixed(2) : '—') + '×</td></tr>' +
    '<tr><td>Walk-forward (train ' + F.walk_forward_train_n + ' before 2024-06-01, test ' + F.walk_forward_test_n + ' after)</td><td>' + F.walk_forward_median_abs_log_err + '</td><td>' + F.walk_forward_flat_median_abs_log_err + '</td><td>' + F.walk_forward_factor + '×</td></tr>' +
    '</tbody>';
  document.getElementById('odds-table').innerHTML =
    '<thead><tr><th>No-token age</th><th>Protocols</th><th>Still pre-token</th><th>Smoothed</th><th>Launch odds used</th></tr></thead><tbody>' +
    O.age_buckets.map(function (b, i) {
      return '<tr><td>' + esc(b.label) + '</td><td>' + b.n + '</td><td>' + (b.pre_token_share * 100).toFixed(1) + '%</td><td>' + (b.smoothed_odds * 100).toFixed(1) + '%</td><td><strong>' + (O.age_odds[i] * 100).toFixed(1) + '%</strong></td></tr>';
    }).join('') + '</tbody>';
  document.getElementById('cat-adj').innerHTML = Object.keys(D.category_log_adj).sort().map(function (c) {
    var adj = D.category_log_adj[c];
    return '<li>' + esc(c) + ' (n=' + (D.category_n[c] || 0) + '): <strong>' + adj.toFixed(3) + '</strong> → ×' + Math.exp(adj).toFixed(3) + '</li>';
  }).join('');
  document.getElementById('coverage').textContent =
    'Census: ' + D.census_total + ' protocols in the snapshot — ' + D.board_size + ' ranked (' + D.watchlist_size + ' watchlist, ' + D.early_size +
    ' early), ' + D.live_total + ' record a token, ' + D.excluded_size + ' pre-token protocols excluded with a reason each. Board: ' + D.board_size +
    ' rows, snapshot ' + D.as_of + ', floor ' + fmtMoney(D.floor_usd) + '.';

  // Category filter.
  var cats = [];
  D.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var sel = document.getElementById('category');
  cats.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });

  var state = { tab: 'pre', q: '', category: '', sort: 'rank', dir: 1 };
  var maxImplied = Math.max.apply(null, D.rows.map(function (r) { return r.implied_value_usd; }));

  function filtered() {
    var q = state.q.toLowerCase();
    return D.rows.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (!q) return true;
      return (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort, dir = state.dir;
    var val = function (r) {
      if (key === 'rank') return r.rank;
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null ? -9999 : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'odds') return r.launch_odds;
      if (key === 'verdict') return r.farm.verdict === 'FARM' ? 0 : r.farm.verdict === 'THIN' ? 1 : 2;
      return r.implied_value_usd;
    };
    return list.slice().sort(function (a, b) {
      var x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * dir;
    });
  }
  function render() {
    var list = sorted(filtered());
    var tb = document.getElementById('rows');
    tb.innerHTML = list.map(function (r) {
      var check = recompute(r);
      var mismatch = check.implied !== r.implied_value_usd ? ' ⚠ recomputed ' + fmtMoney(check.implied) : '';
      return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td><td><strong>' + esc(r.name) + '</strong><br><span class="cat">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + '</span></td>' +
        '<td class="num">' + fmtMoney(r.tvl_usd) + '</td><td class="num">' + fmtPct(r.change_7d) + '</td><td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + (r.launch_odds * 100).toFixed(0) + '%</td>' +
        '<td class="num"><strong>' + fmtMoney(r.implied_value_usd) + '</strong>' + mismatch +
        '<span class="bar"><i style="width:' + Math.max(2, Math.round(100 * r.implied_value_usd / maxImplied)) + '%"></i></span></td>' +
        '<td><span class="verdict ' + r.farm.verdict + '">' + r.farm.verdict + '</span><br><span class="cat">net $' + r.farm.net_usd.toLocaleString('en-US') + '</span></td></tr>';
    }).join('');
    document.getElementById('count').textContent = list.length + ' of ' + D.rows.length + ' pre-token rows shown.';
    tb.querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }
  function renderLive() {
    document.getElementById('live-rows').innerHTML = D.live.map(function (r) {
      return '<tr><td><strong>' + esc(r.name) + '</strong><br><span class="cat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="num">' + fmtMoney(r.tvl_usd) + '</td><td class="num">' + fmtMoney(r.mcap_usd || 0) + '</td><td class="num">' + fmtPct(r.change_7d) + '</td></tr>';
    }).join('');
  }
  function renderCensus() {
    document.getElementById('census-summary').textContent =
      D.census_total + ' protocols accounted for: ' + D.board_size + ' ranked pre-token, ' + D.live_total + ' record a token, ' + D.excluded_size + ' pre-token excluded — ' +
      Object.keys(D.excluded_by_reason || {}).map(function (k) { return D.excluded_by_reason[k] + ' ' + k; }).join(', ') + '.';
    document.getElementById('census-rows').innerHTML = D.excluded.map(function (e) {
      return '<tr><td><strong>' + esc(e.name) + '</strong><br><span class="cat">' + esc(e.slug) + '</span></td><td>' + esc(e.reason) + '</td></tr>';
    }).join('');
  }

  function openDetail(slug) {
    var row = null;
    D.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    var c = recompute(row);
    var farm = farmFor(row, c.implied);
    var match = c.implied === row.implied_value_usd && farm.verdict === row.farm.verdict && farm.net === row.farm.net_usd;
    var body = document.getElementById('detail-body');
    body.innerHTML =
      '<h2>' + esc(row.name) + '</h2><p class="cat">Rank #' + row.rank + ' · ' + esc(row.category || 'Uncategorised') + ' · ' + esc(row.chains.join(', ')) + ' · slug ' + esc(row.slug) + '</p>' +
      '<dl><dt>TVL</dt><dd>' + fmtMoney(row.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + fmtPct(row.change_7d) + ' (clamped to ' + c.growthPct.toFixed(1) + '%, multiplier ' + c.growthMult.toFixed(3) + ')</dd>' +
      '<dt>Age with no token</dt><dd>' + fmtAge(row.age_days) + (row.listed_at ? ' · first tracked ' + esc(row.listed_at) : '') + '</dd>' +
      '<dt>Fitted curve</dt><dd>exp(' + F.intercept + ' + ' + F.slope + ' × ln(TVL) + ' + c.catAdj.toFixed(3) + ') = ' + fmtMoney(c.launch / c.growthMult) + ' before growth; × ' + c.growthMult.toFixed(3) + ' growth = ' + fmtMoney(c.launch) + ' launch value</dd>' +
      '<dt>Category adjustment</dt><dd>' + c.catAdj.toFixed(3) + ' in log units (×' + Math.exp(c.catAdj).toFixed(3) + ')</dd>' +
      '<dt>Launch odds</dt><dd>' + (c.odds * 100).toFixed(1) + '% — age ' + (c.ageOdds * 100).toFixed(1) + '% × TVL ' + c.tvlF.toFixed(2) + ' × growth ' + c.growthF.toFixed(2) + '</dd>' +
      '<dt>Implied value</dt><dd><strong>' + fmtMoney(c.implied) + '</strong> — recomputed in this page from the fitted curve × growth × odds; ' + (match ? 'it matches the board.' : 'it does NOT match the board.') + ' This is an estimate, not a price.</dd>' +
      '<dt>Farm verdict</dt><dd><span class="verdict ' + farm.verdict + '">' + farm.verdict + '</span> — expected value $' + farm.value.toLocaleString('en-US') + ' (implied × 10% ÷ ' + farm.farmers.toLocaleString('en-US') + ' farmers), cost $' + farm.cost.toLocaleString('en-US') + ' (capital $' + farm.capital + ' + gas $' + farm.gas + ' + ' + farm.hours + 'h × $25), net <strong>$' + farm.net.toLocaleString('en-US') + '</strong>, $' + farm.vph.toLocaleString('en-US') + '/hour.</dd>' +
      '<dt>What would change it</dt><dd>' + esc(row.farm.change_line) + '</dd></dl>' +
      '<p class="note">Implied value is a model estimate, not a price. ' + esc(row.name) + ' records no token in this snapshot; that is not proof it has none, or that it will issue one.</p>' +
      '<h3>Farm plan</h3><ol>' + row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    var dlg = document.getElementById('detail');
    if (!dlg.open) dlg.showModal();
    if (location.hash !== '#p=' + slug) history.replaceState(null, '', '#p=' + slug);
  }

  function setTab(tab) {
    state.tab = tab;
    document.getElementById('tab-pre').classList.toggle('active', tab === 'pre');
    document.getElementById('tab-live').classList.toggle('active', tab === 'live');
    document.getElementById('tab-census').classList.toggle('active', tab === 'census');
    document.getElementById('board-wrap').hidden = tab !== 'pre';
    document.getElementById('live-wrap').hidden = tab !== 'live';
    document.getElementById('census-wrap').hidden = tab !== 'census';
    if (tab === 'live') renderLive();
    if (tab === 'census') renderCensus();
  }
  document.getElementById('tab-pre').addEventListener('click', function () { setTab('pre'); });
  document.getElementById('tab-live').addEventListener('click', function () { setTab('live'); });
  document.getElementById('tab-census').addEventListener('click', function () { setTab('census'); });

  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
  sel.addEventListener('change', function (e) { state.category = e.target.value; render(); });
  document.querySelectorAll('#board th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      render();
    });
  });
  document.getElementById('detail').addEventListener('close', function () {
    if (location.hash.indexOf('#p=') === 0) history.replaceState(null, '', location.pathname + location.search);
  });

  function fromHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      var k = kv[0], v = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
      if (k === 'p' && v) { setTimeout(function () { openDetail(v); }, 0); }
      if (k === 'category' && v) { state.category = v; sel.value = v; }
      if (k === 'q' && v) { state.q = v; document.getElementById('q').value = v; }
    });
  }
  render();
  fromHash();
  render();
})();
