const CONFIG = {
  SHEET_NAME: 'Posts',      // A:投稿日, B:予約チェック, C:投稿内容, G:投稿者名
  MAP_SHEET_NAME: 'Members',// A:名前, B:DiscordユーザーID
  TIMEZONE: 'Asia/Tokyo',
  DATE_FMT: 'yyyy/MM/dd',
};

function getEnv(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error(`Missing secret: ${key}（env.jsでseedSecretsOnce()を実行してください）`);
  return v;
}

// ここでトリガーを設定
// アラート(前日)
function alertForNotReadyPosts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error(`シート '${CONFIG.SHEET_NAME}' が見つかりません`);

  const alertWebhook = getEnv('DISCORD_ALERT_WEBHOOK');
  const roleId = getEnv('MENTION_ROLE_ID');

  const tz = CONFIG.TIMEZONE;
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24*60*60*1000);
  const tStr = Utilities.formatDate(tomorrow, tz, CONFIG.DATE_FMT);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // A:投稿日, B:予約チェック, C:投稿内容, G:投稿者名（=7列まで取得）
  const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();

  // 投稿者名→Discord ID
  const map = ss.getSheetByName(CONFIG.MAP_SHEET_NAME);
  if (!map) throw new Error(`'${CONFIG.MAP_SHEET_NAME}' が見つかりません`);
  const m = map.getDataRange().getValues();
  const nameToId = {};
  for (let i = 1; i < m.length; i++) {
    const name = String(m[i][0] || '').trim();
    const id   = String(m[i][1] || '').trim();
    if (name && id) nameToId[name] = id;
  }

  const targets = [];
  values.forEach((row, i) => {
    const [postDate, reserved, content,,,, authorName] = row;
    const rowIndex = i + 2;
    const dStr = dateToString(postDate, tz, CONFIG.DATE_FMT);
    if (dStr !== tStr) return;

    const hasContent = String(content || '').trim().length > 0;
    const isChecked  = boolify(reserved);

    if (!hasContent || (hasContent && !isChecked)) {
      targets.push({
        rowIndex,
        dateStr: dStr,
        authorMention: mentionFromName(authorName, nameToId),
        reason: !hasContent ? '**C列の投稿内容が空**' : '**B列の予約チェックが未**',
      });
    }
  });

  if (targets.length === 0) return;

  const sheetUrl = ss.getUrl();

  // 送信
  targets.forEach(t => {
    const rowLink = `${sheetUrl}#gid=${sheet.getSheetId()}&range=${t.rowIndex}:${t.rowIndex}`;
    const message = [
      `# 【明日の投稿アラート(${t.dateStr})】`,
      `<@&${roleId}>`,
      `${t.dateStr}に投稿する内容が準備できていません`,
      `出題者：${t.authorMention}`,
      `理由：${t.reason}`,
      `記入行リンク：${rowLink}`
    ].join('\n');

    const payload = { content: message, allowed_mentions: { parse: ['roles','users'] } };

    const res = UrlFetchApp.fetch(alertWebhook, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (!(code >= 200 && code < 300)) {
      console.error('送信失敗', code, res.getContentText());
    }
    Utilities.sleep(1200);
  });
}

/***** utils *****/
function boolify(v){ if(v===true) return true; if(typeof v==='string') return v.toLowerCase()==='true'||v==='✓'; return false; }
function dateToString(v,tz,fmt){
  if(!v) return '';
  if(Object.prototype.toString.call(v)==='[object Date]') return Utilities.formatDate(v,tz,fmt);
  try{ const d=new Date(v); if(!isNaN(d)) return Utilities.formatDate(d,tz,fmt);}catch(e){}
  return String(v);
}
function mentionFromName(authorName, nameToId){
  const name = String(authorName||'').trim();
  if(!name) return '不明';
  const id = nameToId[name];
  return id ? `<@${id}>` : name;
}
