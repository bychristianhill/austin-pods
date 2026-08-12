/****************************************************************************
 * Pods Win Tracker — Austin
 * Reads the "Austin PODS" tab, builds a JSON mirror, publishes to GitHub.
 * Weekly targets only — Austin has no monthly tracking.
 ****************************************************************************/

var CONFIG = {
  SHEET_ID:    '1Pss8qMjs7sPqcDcmkWZXkLsYxisOdYaRlR7g-x4La00',
  DALLAS_TAB:  'Austin PODS',
  TIMEZONE:    'America/Chicago',
  METRIC_LABEL:'SRA',
  WEEK1_MONDAY:'2026-06-29',
  QUARTER_WEEKS: 13,

  GITHUB_OWNER:  'bychristianhill',
  GITHUB_REPO:   'austin-pods',
  GITHUB_BRANCH: 'main',
  GITHUB_PATH:   'data/austin.json',

  ID_COL:        0,
  POD_MARKER:    'POD NAME',
  NAME_COL:      1,
  COL_SELF_SRA:  2,
  WEEK_REST_BASE: 7,
  MAX_WEEKS:     14,
  TARGET_COL:    2,
  DEFAULT_TARGET: 5
};

function refreshAndPublish() {
  var data = readDallasTab();
  publishToGitHub(data);
  return data;
}

function doGet() {
  try { refreshAndPublish(); return ContentService.createTextOutput('OK: published at ' + new Date()); }
  catch (e) { return ContentService.createTextOutput('ERROR: ' + e); }
}

function readDallasTab() {
  var sh = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.DALLAS_TAB);
  if (!sh) throw new Error('Tab "' + CONFIG.DALLAS_TAB + '" not found. Check CONFIG.DALLAS_TAB.');
  var grid = sh.getDataRange().getValues();

  var pods = parsePods_(grid);
  var currentWeekNo = Math.max(1, Math.min(weeksSinceLaunch_(), CONFIG.QUARTER_WEEKS));

  var weeks = [];
  for (var w = 1; w <= currentWeekNo; w++) {
    var start = addDays_(parseISO_(CONFIG.WEEK1_MONDAY), (w - 1) * 7);
    weeks.push({ weekNo: w, label: 'Week ' + w, start: fmtISO_(start), end: fmtISO_(addDays_(start, 6)) });
  }

  return {
    generatedAt: new Date().toISOString(),
    timezone: CONFIG.TIMEZONE,
    metricLabel: CONFIG.METRIC_LABEL,
    week1Monday: CONFIG.WEEK1_MONDAY,
    currentWeekNo: currentWeekNo,
    demo: false,
    weeks: weeks,
    pods: pods
  };
}

function weekCol_(w) { return w === 1 ? CONFIG.COL_SELF_SRA : CONFIG.WEEK_REST_BASE + w; }
function isNum_(v) { return v !== '' && v !== null && v !== undefined && !isNaN(v); }
function n_(v) { return isNum_(v) ? Number(v) : 0; }

function parsePods_(grid) {
  var pods = [], cur = null, collecting = false;

  for (var r = 0; r < grid.length; r++) {
    var row = grid[r];
    var marker = String(row[CONFIG.ID_COL] == null ? '' : row[CONFIG.ID_COL]).trim().toUpperCase();
    var label = String(row[CONFIG.NAME_COL] == null ? '' : row[CONFIG.NAME_COL]).trim();

    if (marker === CONFIG.POD_MARKER) {
      cur = { name: label, target: CONFIG.DEFAULT_TARGET,
              weeklyTargets: {}, weekly: {}, reps: [] };
      pods.push(cur);
      collecting = true;
      continue;
    }
    if (!label) continue;
    var low = label.toLowerCase();

    // Weekly target row — targets can differ per week, so capture all of them.
    // Only apply while still inside the pod's block (before its Total row), so a
    // trailing section with no "POD NAME" marker can't overwrite this pod's targets.
    if (low === 'weekly target' || low === 'target') {
      if (cur && collecting) {
        for (var wt = 1; wt <= CONFIG.MAX_WEEKS; wt++) {
          var tv = row[weekCol_(wt)];
          if (isNum_(tv)) cur.weeklyTargets[String(wt)] = Number(tv);
        }
        if (isNum_(row[CONFIG.TARGET_COL])) cur.target = Number(row[CONFIG.TARGET_COL]);
      }
      continue;
    }
    if (low === 'total') { collecting = false; continue; }
    if (low.indexOf('week total') === 0 || low.indexOf('week target') === 0 ||
        low.indexOf('weeks') === 0 || low.indexOf('metric') === 0 ||
        low.indexOf('% of target') === 0) continue;

    if (collecting && cur) cur.reps.push(makeRep_(row));
  }

  pods.forEach(function (p) {
    for (var w = 1; w <= CONFIG.MAX_WEEKS; w++) {
      var sum = 0;
      p.reps.forEach(function (rep) { sum += rep.weekly[String(w)] || 0; });
      p.weekly[String(w)] = sum;
    }
    p.seasonTotal = p.reps.reduce(function (s, rep) { return s + rep.totalSRA; }, 0);
  });

  return pods.filter(function (p) { return p.reps.length; });
}

function makeRep_(row) {
  var weekly = {};
  for (var w = 1; w <= CONFIG.MAX_WEEKS; w++) weekly[String(w)] = n_(row[weekCol_(w)]);
  var totalSRA = 0;
  for (var k in weekly) totalSRA += weekly[k];
  var idCell = row[CONFIG.ID_COL];
  return {
    name: String(row[CONFIG.NAME_COL]).trim(),
    id: (idCell === '' || idCell == null) ? null : String(idCell).trim(),
    totalSRA: totalSRA,
    weekly: weekly
  };
}

function publishToGitHub(dataObj) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Missing Script Property GITHUB_TOKEN (your GitHub PAT).');
  var url = 'https://api.github.com/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO + '/contents/' + CONFIG.GITHUB_PATH;
  var headers = { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' };
  var sha = null;
  var getRes = UrlFetchApp.fetch(url + '?ref=' + encodeURIComponent(CONFIG.GITHUB_BRANCH),
    { method: 'get', headers: headers, muteHttpExceptions: true });
  if (getRes.getResponseCode() === 200) sha = JSON.parse(getRes.getContentText()).sha;
  var json = JSON.stringify(dataObj, null, 2);
  var payload = {
    message: 'Refresh Austin pods data ' + new Date().toISOString(),
    content: Utilities.base64Encode(json, Utilities.Charset.UTF_8),
    branch: CONFIG.GITHUB_BRANCH
  };
  if (sha) payload.sha = sha;
  var putRes = UrlFetchApp.fetch(url, {
    method: 'put', headers: headers, contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var code = putRes.getResponseCode();
  if (code !== 200 && code !== 201) throw new Error('GitHub publish failed (' + code + '): ' + putRes.getContentText());
  Logger.log('Published OK (' + code + ').');
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshAndPublish') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshAndPublish').timeBased().everyMinutes(60).create();
  Logger.log('Trigger installed: refreshAndPublish every hour.');
}

function debugDumpDallas() {
  var sh = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.DALLAS_TAB);
  var grid = sh.getDataRange().getValues();
  for (var r = 0; r < Math.min(grid.length, 200); r++) {
    var cells = grid[r].map(function (v, c) { return c + ':' + stringifyCell_(v); });
    Logger.log('R' + r + ' | ' + cells.join(' | '));
  }
}

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
  return Math.max(1, Math.floor(diff / (7 * 86400000)) + 1);
}
