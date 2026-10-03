// ============================================================
// 时空跃动 · Supabase 反向代理 Worker（免费方案）
// 用途：治理部分运营商/校园网对 supabase.co 的 DNS 污染 / SNI 阻断
//        导致的玩家登录失败（游戏能打开 = GitHub Pages 正常，但 supabase.co 连不上）。
// 路由：
//   /sb/rest/v1/*  -> {SUPABASE_HOST}/rest/v1/*
//   /sb/auth/v1/*  -> {SUPABASE_HOST}/auth/v1/*
// 特性：
//   - apikey / Authorization / Prefer / Content-Type 等请求头原样转发
//   - CORS 全放行（预检 200，响应带 Access-Control-Allow-*）
//   - 纯透传，不缓存、不改写业务数据；anon key 本就公开，无需轮换
// 部署方式：Cloudflare Dashboard 粘贴 / GitHub 仓库直连（本文件 + wrangler.toml）
// ============================================================

const SUPABASE_HOST = 'https://cfwkkexvbxpbtxnrgzqg.supabase.co';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS),
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 健康检查：浏览器/验收直接访问 /sb 或 /sb/
    if (url.pathname === '/sb' || url.pathname === '/sb/') {
      return jsonResponse({ ok: true, service: 'st-sb-proxy', upstream: SUPABASE_HOST, ts: Date.now() }, 200);
    }

    let upstream = null;
    if (url.pathname.startsWith('/sb/rest/')) {
      upstream = SUPABASE_HOST + url.pathname.slice(3) + url.search;
    } else if (url.pathname.startsWith('/sb/auth/')) {
      upstream = SUPABASE_HOST + url.pathname.slice(3) + url.search;
    } else {
      return jsonResponse({ error: 'not found, expect /sb/rest/* or /sb/auth/*' }, 404);
    }

    // 预检：直接 200 放行（验收标准之一）
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: CORS_HEADERS });
    }

    // 原样转发：保留 apikey / Authorization 等全部头，仅删除由网络层管理的 host
    const headers = new Headers(request.headers);
    headers.delete('host');
    const init = {
      method: request.method,
      headers: headers,
      redirect: 'follow',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    try {
      const resp = await fetch(upstream, init);
      const outHeaders = new Headers(resp.headers);
      for (const k in CORS_HEADERS) outHeaders.set(k, CORS_HEADERS[k]);
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: outHeaders,
      });
    } catch (e) {
      return jsonResponse({ error: 'upstream fetch failed', detail: String(e && e.message || e) }, 502);
    }
  },
};
