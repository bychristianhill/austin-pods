/****************************************************************************
 * Pods Win Tracker — Dallas
 * Google Apps Script: reads the "Dallas" tab verbatim, builds a JSON mirror
 * (NO calculations of scores), and publishes it to GitHub so GitHub Pages
 * can display it.
 *
 * SETUP (see README.md for the full walkthrough):
 *   1. Tools > Script editor on the spreadsheet (or script.google.com, bound).
 *   2. Paste this file. Fill in the GITHUB_* values in CONFIG below.
 *   3. Project Settings > Script Properties: add  GITHUB_TOKEN  = your PAT.
 *   4. Run installTrigger() once (authorize when prompted).
 *   5. Run refreshAndPublish() once to push the first data file.
 *   Optional: run debugDumpDallas() to print the tab layout if parsing looks off.
 ****************************************************************************/

var CONFIG = {
  SHEET_ID:    '1Pss8qMjs7sPqcDcmkWZXkLsYxisOdYaRlR7g-x4La00',
  DALLAS_TAB:  'Austin PODS',        // exact name of the tab to mirror
  TIMEZONE:    'America/Chicago',    // Austin = Central
  METRIC_LABEL:'SRA',
  WEEK1_MONDAY:'2026-06-29',         // first day of operation (a Monday)
  QUARTER_WEEKS: 13,

  // --- GitHub publishing target ---
  GITHUB_OWNER:  'bychristianhill',
  GITHUB_REPO:   'austin-pods',
  GITHUB_BRANCH: 'main',
  GITHUB_PATH:   'data/austin.json',
  // The PAT is read from Script Properties key 'GITHUB_TOKEN' (do NOT paste it here).

  // --- Parser anchors (only change if the tab layout differs) ---
  // Header labels that identify a pod's metric columns. The script finds these
  // to locate the metric block automatically; order defines the JSON keys.
  METRIC_HEADERS: [
    ['Self Gen/SRA',           'selfGenSRA'],
    ['Self Gen/CAP',           'selfGenCAP'],
    ['With Assist/SRA',        'withAssistSRA'],
    ['With Assist/CAP',        'withAssistCAP'],
    ['As Assist/SRA',          'asAssistSRA'],
    ['As Assist/CAP',          'asAssistCAP'],
    ['As Assist/Total points', 'totalPoints']
  ],
  DEFAULT_TARGET: 5,                // used when a pod block has no Target row
  INCLUDE_RAW_GRID: true           // also embed the raw tab grid as a safety net
};

/** Time-driven entry point + manual run target. */
function refreshAndPublish() {
  var data = readDallasTab();
  publishToGitHub(data);
  return data;
}

/** Optional web endpoint: visiting the deployment URL triggers a refresh. */
function doGet() {
  try {
    refreshAndPublish();
    return ContentService.createTextOutput('OK: published at ' + new Date());
  } catch (e) {
    return ContentService.createTextOutput('ERROR: ' + e);
  }
}

/* ------------------------------------------------------------------ *
 *  READ + STRUCTURE (no score math — pure mirror of the tab)
 * ------------------------------------------------------------------ */
function readDallasTab() {
  var sh = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.DALLAS_TAB);
  if (!sh) throw new Error('Tab "' + CONFIG.DALLAS_TAB + '" not found. Check CONFIG.DALLAS_TAB.');
  var grid = sh.getDataRange().getValues();

  // Locate the metric header row/columns once (from the first block that has labels).
  var loc = locateMetricColumns_(grid);   // { headerRow, nameCol, metricCols:{key:colIndex}, firstMetricCol, lastMetricCol }
  var pods = parsePods_(grid, loc);

  var weeksElapsed = weeksSinceLaunch_();
  var maxWeekCols = pods.reduce(function (m, p) { return Math.max(m, Object.keys(p.weekly).length); }, 0);
  var currentWeekNo = Math.max(1, Math.min(weeksElapsed, maxWeekCols || weeksElapsed, CONFIG.QUARTER_WEEKS));

  var weeks = [];
  for (var w = 1; w <= Math.min(currentWeekNo, CONFIG.QUARTER_WEEKS); w++) {
    var start = addDays_(parseISO_(CONFIG.WEEK1_MONDAY), (w - 1) * 7);
    weeks.push({
      weekNo: w, label: 'Week ' + w,
      start: fmtISO_(start), end: fmtISO_(addDays_(start, 6))
    });
  }

  var out = {
    generatedAt: new Date().toISOString(),
    timezone: CONFIG.TIMEZONE,
    metricLabel: CONFIG.METRIC_LABEL,
    week1Monday: CONFIG.WEEK1_MONDAY,
    currentWeekNo: currentWeekNo,
    demo: false,
    weeks: weeks,
    pods: pods
  };
  if (CONFIG.INCLUDE_RAW_GRID) out.raw = grid.map(function (r) { return r.map(stringifyCell_); });
  return out;
}

/** Find the row that contains the metric header labels and map label -> column. */
function locateMetricColumns_(grid) {
  var wanted = CONFIG.METRIC_HEADERS.map(function (h) { return h[0]; });
  for (var r = 0; r < grid.length; r++) {
    var row = grid[r];
    var found = {};
    for (var c = 0; c < row.length; c++) {
      var v = String(row[c]).trim();
      var idx = wanted.indexOf(v);
      if (idx >= 0) found[CONFIG.METRIC_HEADERS[idx][1]] = c;
    }
    if (Object.keys(found).length >= 4) {  // enough labels on this row -> it's the header
      var cols = Object.keys(found).map(function (k) { return found[k]; });
      var firstMetricCol = Math.min.apply(null, cols);
      return {
        headerRow: r,
        nameCol: firstMetricCol - 1,      // pod/rep name sits just left of the metrics
        metricCols: found,
        firstMetricCol: firstMetricCol,
        lastMetricCol: Math.max.apply(null, cols)
      };
    }
  }
  throw new Error('Could not find metric header labels (e.g. "Self Gen/SRA") on the Dallas tab. ' +
                  'Run debugDumpDallas() and adjust CONFIG.METRIC_HEADERS.');
}

/** Walk the grid block-by-block: pod header -> rep rows -> Total/Target. */
function parsePods_(grid, loc) {
  var nameCol = loc.nameCol, mcols = loc.metricCols, weekStart = loc.lastMetricCol + 1;
  var pods = [], cur = null;

  function isNumeric(v) { return v !== '' && v !== null && !isNaN(v); }
  function metricsNumeric(row) {
    for (var k in mcols) if (isNumeric(row[mcols[k]])) return true;
    return false;
  }
  function readMetrics(row) {
    var m = {};
    CONFIG.METRIC_HEADERS.forEach(function (h) {
      var col = mcols[h[1]];
      m[h[1]] = isNumeric(row[col]) ? Number(row[col]) : 0;
    });
    return m;
  }

  for (var r = loc.headerRow; r < grid.length; r++) {
    var row = grid[r];
    var label = String(row[nameCol] == null ? '' : row[nameCol]).trim();
    if (!label) continue;
    var low = label.toLowerCase();

    if (low === 'total') {
      if (cur) {
        // Weekly values live to the right of the metrics on the Total row.
        var nums = [];
        for (var c = weekStart; c < row.length; c++) {
          if (isNumeric(row[c])) nums.push(Number(row[c]));
        }
        if (nums.length > 1) { cur.seasonTotal = nums.pop(); }
        else if (nums.length === 1) { cur.seasonTotal = nums[0]; }
        nums.forEach(function (v, i) { cur.weekly[String(i + 1)] = v; });
      }
      continue;
    }
    if (low === 'target') {
      if (cur) {
        var t = row[loc.firstMetricCol];
        if (isNumeric(t)) cur.target = Number(t);
      }
      continue;
    }

    if (metricsNumeric(row)) {
      // rep row
      if (cur) cur.reps.push(mergeRep_(row, nameCol, readMetrics(row)));
    } else {
      // pod header row (metric cells are blank or contain header labels)
      cur = { name: label, target: CONFIG.DEFAULT_TARGET, weekly: {}, seasonTotal: 0, reps: [] };
      pods.push(cur);
    }
  }
  // Drop accidental empty blocks (e.g. a stray label with no reps and no weekly data)
  return pods.filter(function (p) { return p.reps.length || Object.keys(p.weekly).length; });
}

function mergeRep_(row, nameCol, metrics) {
  var idCell = nameCol > 0 ? row[nameCol - 1] : '';
  var id = (idCell === '' || idCell == null) ? null : String(idCell).trim();
  // Total SRA = the tab's own SRA columns summed (not a score recomputation).
  metrics.totalSRA = (metrics.selfGenSRA || 0) + (metrics.withAssistSRA || 0) + (metrics.asAssistSRA || 0);
  return Object.assign({ name: String(row[nameCol]).trim(), id: id }, metrics);
}

/* ------------------------------------------------------------------ *
 *  PUBLISH TO GITHUB (Contents API)
 * ------------------------------------------------------------------ */
function publishToGitHub(dataObj) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Missing Script Property GITHUB_TOKEN (your GitHub PAT).');
  if (CONFIG.GITHUB_OWNER.indexOf('YOUR_GITHUB') === 0) throw new Error('Set CONFIG.GITHUB_OWNER.');

  var url = 'https://api.github.com/repos/' + CONFIG.GITHUB_OWNER + '/' +
            CONFIG.GITHUB_REPO + '/contents/' + CONFIG.GITHUB_PATH;
  var headers = { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' };

  // Get current sha (needed to update an existing file).
  var sha = null;
  var getRes = UrlFetchApp.fetch(url + '?ref=' + encodeURIComponent(CONFIG.GITHUB_BRANCH),
    { method: 'get', headers: headers, muteHttpExceptions: true });
  if (getRes.getResponseCode() === 200) sha = JSON.parse(getRes.getContentText()).sha;

  var json = JSON.stringify(dataObj, null, 2);
  var payload = {
    message: 'Refresh Dallas pods data ' + new Date().toISOString(),
    content: Utilities.base64Encode(json, Utilities.Charset.UTF_8),
    branch: CONFIG.GITHUB_BRANCH
  };
  if (sha) payload.sha = sha;

  var putRes = UrlFetchApp.fetch(url, {
    method: 'put', headers: headers, contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var code = putRes.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('GitHub publish failed (' + code + '): ' + putRes.getContentText());
  }
  Logger.log('Published OK (' + code + ').');
}

/* ------------------------------------------------------------------ *
 *  TRIGGER + DEBUG
 * ------------------------------------------------------------------ */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshAndPublish') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshAndPublish').timeBased().everyMinutes(30).create();
  Logger.log('Trigger installed: refreshAndPublish every 30 minutes.');
}

/** Run this once if parsing looks wrong — prints the first 45 rows with column indices. */
function debugDumpDallas() {
  var sh = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.DALLAS_TAB);
  var grid = sh.getDataRange().getValues();
  for (var r = 0; r < Math.min(grid.length, 45); r++) {
    var cells = grid[r].map(function (v, c) { return c + ':' + stringifyCell_(v); });
    Logger.log('R' + r + ' | ' + cells.join(' | '));
  }
}

/* ------------------------------------------------------------------ *
 *  small helpers
 * ------------------------------------------------------------------ */
function stringifyCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  return v == null ? '' : String(v);
}
function parseISO_(s) { var p = s.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function fmtISO_(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd'); }
function addDays_(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
function weeksSinceLaunch_() {
  var todayStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  var diff = (parseISO_(todayStr).getTime() - parseISO_(CONFIG.WEEK1_MONDAY).getTime());
  var w = Math.floor(diff / (7 * 86400000)) + 1;
  return Math.max(1, w);
}
