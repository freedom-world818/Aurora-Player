/**
 * Cloudflare Pages Functions - 网易云音乐 API 代理
 *
 * 功能：
 *   将 /api 请求转发到实际的网易云音乐后端
 *   支持 Meting-API-Serverless 和 NeteaseCloudMusicApi 两种后端
 *   自动处理 CORS、鉴权
 *
 * 部署方式：
 *   将本文件放在项目根目录的 functions/ 文件夹下
 *   推送到 GitHub 后，Cloudflare Pages 会自动识别并部署
 *
 * 环境变量配置（在 Cloudflare Pages Settings -> Environment Variables 中添加）：
 *   NCM_API_UPSTREAM    - 上游 API 地址，默认为公共 Meting 实例
 *                        示例: https://your-worker.you.workers.dev
 *   NCM_AUTH_MODE       - 'hmac' (默认) 或 'none'
 *   NCM_METING_TOKEN    - Meting HMAC 密钥，默认 'token'
 *   NCM_ALLOW_ORIGINS   - 允许的来源域名，逗号分隔，默认 '*'
 *                        示例: your-domain.com,*.your-domain.com
 */

// —— 公共兜底上游列表（按优先级）——
const FALLBACK_UPSTREAMS = [
    // 用户自定义（通过环境变量覆盖）
    // 以下为公共实例，不保证稳定
    // 2026-07 实测可用：api.7boe.top（~600ms，/search /song/url /lyric）
    {
        base: 'https://api.7boe.top',
        adapter: 'ncmapi',
        authMode: 'none',
    },
    {
        base: 'https://netease-cloud-music-api-five-roan.vercel.app',
        adapter: 'ncmapi',
        authMode: 'none',
    },
    {
        base: 'https://netease-cloud-music-api-demo.vercel.app',
        adapter: 'ncmapi',
        authMode: 'none',
    },
];

// —— 工具函数 ——

function getEnv(env, key, fallback) {
    const v = env && env[key];
    return (v !== undefined && v !== null && v !== '') ? v : fallback;
}

function isOriginAllowed(origin, allowList) {
    if (!origin) return false;
    if (allowList === '*') return true;
    const allowed = allowList.split(',').map(s => s.trim()).filter(Boolean);
    try {
        const url = new URL(origin);
        const host = url.hostname;
        return allowed.some(pattern => {
            if (pattern === '*') return true;
            // 通配符子域名匹配：例如 *.example.com → 匹配 sub.example.com / nested.sub.example.com
            // 同时也允许匹配根域名 example.com（白名单场景常用）
            if (pattern.startsWith('*.')) {
                const baseDomain = pattern.slice(2); // 去掉 "*.", 得到 "example.com"
                // 注意：必须匹配 ".example.com"（带点）结尾，否则会错误匹配 fake-example.com
                return host.endsWith('.' + baseDomain) || host === baseDomain;
            }
            return host === pattern;
        });
    } catch {
        return false;
    }
}

function makeCorsHeaders(requestOrigin, allowOrigins) {
    const headers = {
        'Access-Control-Allow-Methods': 'GET,OPTIONS,HEAD',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Max-Age': '86400',
    };
    if (isOriginAllowed(requestOrigin, allowOrigins)) {
        headers['Access-Control-Allow-Origin'] = requestOrigin;
        headers['Vary'] = 'Origin';
    } else {
        headers['Access-Control-Allow-Origin'] = 'null';
    }
    return headers;
}

// HMAC-SHA1（Cloudflare Workers / Pages 环境下用 Web Crypto）
async function hmacSha1Hex(secret, message) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * 将 Meting 风格参数转换为对上游的请求
 */
async function buildUpstreamRequest(params, env) {
    const customUpstream = getEnv(env, 'NCM_API_UPSTREAM', '').trim();
    const authMode = getEnv(env, 'NCM_AUTH_MODE', 'hmac');
    const metingToken = getEnv(env, 'NCM_METING_TOKEN', 'token');

    const server = params.get('server') || 'netease';
    const type = params.get('type') || '';
    const id = params.get('id') || '';
    const keywords = params.get('keywords') || '';
    const limit = params.get('limit') || '20';

    // —— 构建候选上游列表 ——
    const candidates = [];

    if (customUpstream) {
        candidates.push({
            base: customUpstream.replace(/\/$/, ''),
            adapter: 'meting',
            authMode: authMode,
            token: metingToken,
        });
    }

    // 加上公共兜底
    FALLBACK_UPSTREAMS.forEach(fb => candidates.push(fb));

    // —— 逐个尝试上游 ——
    let lastErr = null;
    for (const up of candidates) {
        try {
            let targetUrl;
            const upParams = new URLSearchParams();

            if (up.adapter === 'meting') {
                upParams.set('server', server);
                upParams.set('type', type);
                if (id) upParams.set('id', id);
                if (keywords) upParams.set('keywords', keywords);
                if (limit) upParams.set('limit', limit);

                if (up.authMode === 'hmac') {
                    const idForAuth = (type === 'song' && keywords) ? '' : id;
                    const auth = await hmacSha1Hex(up.token, server + type + idForAuth);
                    upParams.set('auth', auth);
                }

                targetUrl = `${up.base}/api?${upParams}`;

            } else {
                // NeteaseCloudMusicApi 原生
                if (keywords) upParams.set('keywords', keywords);
                if (limit) upParams.set('limit', limit);

                switch (type) {
                    case 'song':
                        targetUrl = `${up.base}/search?${upParams}`;
                        break;
                    case 'url':
                        targetUrl = `${up.base}/song/url?id=${encodeURIComponent(id)}`;
                        break;
                    case 'lrc':
                        targetUrl = `${up.base}/lyric?id=${encodeURIComponent(id)}`;
                        break;
                    case 'detail':
                        const ids = (params.get('ids') || id || '').toString();
                        targetUrl = `${up.base}/song/detail?ids=${encodeURIComponent(ids)}`;
                        break;
                    default:
                        continue; // 不支持的类型跳过
                }
            }

            const res = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Aurora-Player/1.0 (Cloudflare Pages Function)',
                    'Accept': 'application/json, text/plain, */*',
                },
                cf: { cacheTtl: type === 'url' ? 600 : 3600 }, // 缓存：url=10分钟，其余=1小时
            });

            if (res.ok) {
                // 透传响应
                const respHeaders = new Headers(res.headers);
                // 覆盖 CORS
                respHeaders.set('Access-Control-Allow-Origin', '*');
                respHeaders.delete('content-security-policy');
                respHeaders.delete('content-security-policy-report-only');

                return new Response(res.body, {
                    status: res.status,
                    headers: respHeaders,
                });
            }

            lastErr = new Error(`上游 ${up.base} 返回 ${res.status}`);

        } catch (err) {
            lastErr = err;
        }
    }

    throw lastErr || new Error('所有上游 API 均不可用');
}

// —— 主处理函数 ——

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const allowOrigins = getEnv(env, 'NCM_ALLOW_ORIGINS', '*');
    const requestOrigin = request.headers.get('Origin') || '';

    // OPTIONS 预检
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: makeCorsHeaders(requestOrigin, allowOrigins),
        });
    }

    // 只允许 GET / HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ code: -1, message: 'Method Not Allowed' }), {
            status: 405,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                ...makeCorsHeaders(requestOrigin, allowOrigins),
            },
        });
    }

    try {
        const params = url.searchParams;
        const type = params.get('type');

        // 基础参数校验
        if (!type) {
            return new Response(JSON.stringify({
                code: -1,
                message: '缺少 type 参数。支持: song(搜索), url(播放地址), lrc(歌词), detail(歌曲详情)',
                usage: {
                    search: '/api?server=netease&type=song&keywords=关键词',
                    url:    '/api?server=netease&type=url&id=歌曲ID',
                    lrc:    '/api?server=netease&type=lrc&id=歌曲ID',
                    detail: '/api?server=netease&type=detail&ids=歌曲ID1,ID2',
                },
            }), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    ...makeCorsHeaders(requestOrigin, allowOrigins),
                },
            });
        }

        const response = await buildUpstreamRequest(params, env);
        // 追加 CORS 头
        const cors = makeCorsHeaders(requestOrigin, allowOrigins);
        Object.entries(cors).forEach(([k, v]) => response.headers.set(k, v));
        return response;

    } catch (err) {
        return new Response(JSON.stringify({
            code: -1,
            message: 'API 代理失败: ' + (err.message || String(err)),
        }), {
            status: 502,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                ...makeCorsHeaders(requestOrigin, allowOrigins),
            },
        });
    }
}
