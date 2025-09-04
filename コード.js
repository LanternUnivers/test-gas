/***** 設定 *****/
const CONFIG = {
  SHEET_NAME: 'Post',         // A:投稿日, B:予約チェック, C:投稿内容, G:投稿者名
  MAP_SHEET_NAME: 'Member',   // A:名前, B:DiscordユーザーID
  TIMEZONE: 'Asia/Tokyo',
  DATE_FMT: 'yyyy/MM/dd',

  // 固定でメンションしたいロールID
  LI_MENTION_ROLE_ID: '1354676515761029151',
};

/***** 初回のみ：アラート用Webhook保存 *****/
function setAlertWebhookUrlOnce() {
  const url = Browser.inputBox('アラート用 Discord Webhook URL を入力してください');
  PropertiesService.getScriptProperties().setProperty('DISCORD_ALERT_WEBHOOK_URL', (url || '').trim());
  SpreadsheetApp.getUi().alert('保存しました');
}

/***** 前日アラート（トリガーを回す） *****/
function alertForNotReadyPosts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error(`シート '${CONFIG.SHEET_NAME}' が見つかりません`);

  const props = PropertiesService.getScriptProperties();
  const alertWebhook = props.getProperty('DISCORD_ALERT_WEBHOOK_URL');
  if (!alertWebhook) throw new Error('アラート用Webhook URLが未設定です。setAlertWebhookUrlOnce() を実行してください');

  const tz = CONFIG.TIMEZONE;
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = Utilities.formatDate(tomorrow, tz, CONFIG.DATE_FMT);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // A:投稿日, B:予約チェック, C:投稿内容, G:投稿者
  const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();

  // 投稿者名→Discord ID マップ
  const mapSheet = ss.getSheetByName(CONFIG.MAP_SHEET_NAME);
  if (!mapSheet) throw new Error(`メンバー対応表シート '${CONFIG.MAP_SHEET_NAME}' が見つかりません`);
  const mapValues = mapSheet.getDataRange().getValues();
  const nameToId = {};
  for (let i = 1; i < mapValues.length; i++) {
    const name = String(mapValues[i][0] || '').trim();
    const id = String(mapValues[i][1] || '').trim();
    if (name && id) nameToId[name] = id;
  }

  const targets = [];
  values.forEach((row, i) => {
    const [postDate, reserved, content,,,, authorName] = row;
    const rowIndex = i + 2;
    const dateStr = dateToString(postDate, tz, CONFIG.DATE_FMT);
    if (dateStr !== tomorrowStr) return;

    const hasContent = String(content || '').trim().length > 0;
    const isChecked = boolify(reserved);

    if (!hasContent || (hasContent && !isChecked)) {
      targets.push({
        rowIndex,
        dateStr,
        authorMention: mentionFromName(authorName, nameToId),
        reason: !hasContent ? '**投稿内容が空**' : '**予約チェックが未**',
      });
    }
  });

  if (targets.length === 0) return;

  const sheetUrl = ss.getUrl();

  // 複数あればまとめて通知
  const messages = targets.map(t => {
    const rowLink = `${sheetUrl}#gid=${sheet.getSheetId()}&range=${t.rowIndex}:${t.rowIndex}`;
    return [
      `# 【明日の投稿アラート(${t.dateStr})】`,
      `<@&${CONFIG.LI_MENTION_ROLE_ID}>`,
      `${t.dateStr}に投稿する内容が準備できていません`,
      `記入者：${t.authorMention}`,
      `理由：${t.reason}`,
      `記入行リンク：${rowLink}`
    ].join('\n');
  });

  messages.forEach(msg => {
    const payload = {
      content: msg,
      allowed_mentions: { parse: ['roles', 'users'] },
    };

    const res = UrlFetchApp.fetch(alertWebhook, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const code = res.getResponseCode();
    if (!(code >= 200 && code < 300)) {
      console.error('アラート送信失敗', code, res.getContentText());
    }
    Utilities.sleep(1200); // 複数送信時のレート制限回避
  });
}

/***** ユーティリティ *****/
function boolify(v) {
  if (v === true) return true;
  if (typeof v === 'string') return v.toLowerCase() === 'true' || v === '✓';
  return false;
}
function dateToString(v, tz, fmt) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz, fmt);
  }
  try {
    const d = new Date(v);
    if (!isNaN(d)) return Utilities.formatDate(d, tz, fmt);
  } catch (e) {}
  return String(v);
}
function mentionFromName(authorName, nameToId) {
  const name = String(authorName || '').trim();
  if (!name) return '不明';
  const id = nameToId[name];
  return id ? `<@${id}>` : name;
}
