export default {
  // -------------------------------------------------------------
  // ① HTTP リクエスト処理 (フロントエンドからの API 呼び出し用)
  // -------------------------------------------------------------
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // CORS ヘッダー設定
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // プリフライトリクエスト (OPTIONS) の処理
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 1. タスク一覧の取得 [GET /api/tasks]
      if (url.pathname === '/api/tasks' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM tasks ORDER BY id DESC').all();
        return Response.json(results, { headers: corsHeaders });
      }

      // 2. ホテル/交渉先一覧の取得 [GET /api/hotels]
      if (url.pathname === '/api/hotels' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM hotels ORDER BY id DESC').all();
        return Response.json(results, { headers: corsHeaders });
      }

      // 404 Not Found
      return Response.json({ error: 'Endpoint not found' }, { status: 404, headers: corsHeaders });

    } catch (error) {
      return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
    }
  },

  // -------------------------------------------------------------
  // ② Cloudflare Cron Trigger (定期自動実行エンジン)
  // -------------------------------------------------------------
  async scheduled(event, env, ctx) {
    // 必須の環境変数がセットされていない場合は処理を中断
    if (!env.DISCORD_WEBHOOK_URL || !env.DB) {
      console.error("DISCORD_WEBHOOK_URL または DB バインドが設定されていません。");
      return;
    }

    try {
      // D1 データベースから「未完了」かつ「期限切れ、または期限まで2日以内」のタスクを全自動抽出
      // (JST/日本時間を基準にするため、+9 hours を指定しています)
      const { results } = await env.DB.prepare(`
        SELECT title, team, due, status 
        FROM tasks 
        WHERE status != '完了' 
          AND due != '未定' 
          AND due != ''
          AND julianday(due) - julianday('now', '+9 hours') <= 2
        ORDER BY due ASC
      `).all();

      // 対象となるタスクがなければ通知を送らず正常終了
      if (!results || results.length === 0) {
        console.log("通知対象の未完了タスクはありません。");
        return;
      }

      // Discordに読みやすく整えて掲載するテキストを整形
      const taskListText = results.map(t => {
        const isOverdue = new Date(t.due) < new Date();
        const alertMark = isOverdue ? '🚨 【期限切れ】' : '⚠️ 【直近期限】';
        return `${alertMark} **${t.title}**\n・担当: ${t.team} | 状態: ${t.status} | 期限: **${t.due}**`;
      }).join('\n\n');

      // Discord Webhook ペイロードの組み立て
      const payload = {
        username: "海のサイン 期限リマインドBot",
        avatar_url: "https://i.imgur.com/4M34hi2.png",
        embeds: [{
          title: "🌊 【自動通知】未完了・期限間近のタスクがあります",
          description: `Cloudflare 定期実行により自動検出されたタスク一覧です。\n早めの対応・確認をお願いします！\n\n${taskListText}`,
          color: 16738657, // 警告用のアバー/オレンジ色
          footer: { text: "Cloudflare Workers Cron Engine | うみぽす甲子園プロジェクト" },
          timestamp: new Date().toISOString()
        }]
      };

      // Discord に Webhook を送信
      const response = await fetch(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        console.log("Discord への定期通知が正常に送信されました。");
      } else {
        console.error(`Discord 送信エラー: ${response.status} ${response.statusText}`);
      }

    } catch (error) {
      console.error(`Cron 実行エラー: ${error.message}`);
    }
  }
};
