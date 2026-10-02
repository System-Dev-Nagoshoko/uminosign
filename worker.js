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
      // 1. タスク管理 API [/api/tasks]
      if (url.pathname === '/api/tasks') {
        if (request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM tasks ORDER BY id DESC').all();
          return Response.json(results, { headers: corsHeaders });
        }
        if (request.method === 'POST') {
          const body = await request.json();
          await env.DB.prepare('INSERT INTO tasks (title, team, due, status) VALUES (?, ?, ?, ?)').bind(body.title, body.team, body.due, body.status).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
        if (request.method === 'PUT') {
          const body = await request.json();
          await env.DB.prepare('UPDATE tasks SET title = ?, team = ?, due = ?, status = ? WHERE id = ?').bind(body.title, body.team, body.due, body.status, body.id).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
        if (request.method === 'DELETE') {
          const body = await request.json();
          await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(body.id).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
      }

      // 2. ホテル/交渉先管理 API [/api/hotels]
      if (url.pathname === '/api/hotels') {
        if (request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM hotels ORDER BY id DESC').all();
          return Response.json(results, { headers: corsHeaders });
        }
        if (request.method === 'POST') {
          const body = await request.json();
          await env.DB.prepare('INSERT INTO hotels (name, date, status, location, material, memo) VALUES (?, ?, ?, ?, ?, ?)').bind(body.name, body.date, body.status, body.location, body.material, body.memo).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
        if (request.method === 'PUT') {
          const body = await request.json();
          await env.DB.prepare('UPDATE hotels SET name = ?, date = ?, status = ?, location = ?, material = ?, memo = ? WHERE id = ?').bind(body.name, body.date, body.status, body.location, body.material, body.memo, body.id).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
        if (request.method === 'DELETE') {
          const body = await request.json();
          await env.DB.prepare('DELETE FROM hotels WHERE id = ?').bind(body.id).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
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
    if (!env.DB) {
      console.error("DB バインドが設定されていません。");
      return;
    }

    // 💡 DISCORD_WEBHOOK_URL が設定されていない場合はログを出して安全にスキップ
    if (!env.DISCORD_WEBHOOK_URL) {
      console.log("DISCORD_WEBHOOK_URL が設定されていないため、Discord通知処理をスキップします。");
      return;
    }

    try {
      // D1 データベースから「未完了」かつ「期限切れ、または期限まで2日以内」のタスクを全自動抽出
      const { results } = await env.DB.prepare(`
        SELECT title, team, due, status 
        FROM tasks 
        WHERE status != '完了' 
          AND due != '未定' 
          AND due != ''
          AND julianday(due) - julianday('now', '+9 hours') <= 2
        ORDER BY due ASC
      `).all();

      if (!results || results.length === 0) {
        console.log("通知対象の未完了タスクはありません。");
        return;
      }

      const taskListText = results.map(t => {
        const isOverdue = new Date(t.due) < new Date();
        const alertMark = isOverdue ? '🚨 【期限切れ】' : '⚠️️ 【直近期限】';
        return `${alertMark} **${t.title}**\n・担当: ${t.team} | 状態: ${t.status} | 期限: **${t.due}**`;
      }).join('\n\n');

      const payload = {
        username: "海のサインプロジェクト 期限リマインドBot",
        avatar_url: "https://i.imgur.com/4M34hi2.png",
        embeds: [{
          title: "🌊 【自動通知】未完了・期限間近のタスクがあります",
          description: `海のサインプロジェクトの定期実行により自動検出されたタスク一覧です。\n早めの対応・確認をお願いします！\n\n${taskListText}`,
          color: 16738657,
          footer: { text: "Cloudflare Workers Cron Engine | 海のサインプロジェクト" },
          timestamp: new Date().toISOString()
        }]
      };

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
