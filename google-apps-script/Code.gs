/** Ahoy's Workspace -> Google Sheets full snapshot receiver.
 * Script Properties required:
 *   SPREADSHEET_ID = target Google Spreadsheet ID
 *   AHOY_SYNC_SECRET = same value as Cloudflare Worker secret GOOGLE_SHEETS_SECRET
 */
function doPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var props = PropertiesService.getScriptProperties();
    var expected = props.getProperty("AHOY_SYNC_SECRET");
    var spreadsheetId = props.getProperty("SPREADSHEET_ID");
    if (!expected || !spreadsheetId || payload.secret !== expected) {
      return output({ ok: false, error: "UNAUTHORIZED_OR_NOT_CONFIGURED" });
    }
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var definitions = {
      Overview: ["metric", "value"],
      Members: ["id", "username", "role", "status", "created_at", "division"],
      Divisions: ["id", "name", "description", "status", "created_at", "member_count"],
      Tasks: ["id", "title", "description", "target", "deadline", "priority", "created_at"],
      Progress: ["assignment_id", "task", "member", "division", "status", "member_note", "reviewer_note", "submitted_at", "reviewed_at", "updated_at"],
      Submissions: ["id", "task", "member", "original_name", "content_type", "size_bytes", "created_at"],
      Activity_Logs: ["id", "actor", "action", "target_type", "target_id", "details", "created_at"]
    };
    Object.keys(definitions).forEach(function(name) {
      var headers = definitions[name];
      var rows = (payload.sheets && payload.sheets[name]) || [];
      var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
      sheet.clearContents();
      var values = [headers].concat(rows.map(function(row) {
        return headers.map(function(key) { return safeCell(row[key]); });
      }));
      sheet.getRange(1, 1, values.length, headers.length).setValues(values);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
      sheet.autoResizeColumns(1, headers.length);
    });
    return output({ ok: true, reason: payload.reason || "sync", generatedAt: payload.generatedAt || new Date().toISOString() });
  } catch (err) {
    return output({ ok: false, error: String(err && err.message || err) });
  }
}
function safeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).slice(0, 45000);
}
function output(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
