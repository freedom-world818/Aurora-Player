/**
 * Vercel Serverless Function — 网易云音乐 API 代理
 * （替代 Cloudflare Pages Functions）
 *
 * 路由映射： 项目根/api/index.js   →   线上 https://你的域名.vercel.app/api
 *
 * 功能：
 *   将 /api 请求转发到实际的网易云音乐后端
 *   支持 Meting-API-Serverless 和 NeteaseCloudMusicApi 两种后端
 *   自动处理 CORS、鉴权、多级上游 fallback
 *
 * 部署方式：
 *   将本文件放在项目根目录的 api/ 文件夹下，推送到 GitHub 后
 *   在 Vercel -> Add New -> Project -> Import Git Repository
 *   Vercel 会自动识别 api/ 目录为 Serverless Functions，无需额外配置
 *
 * 环境变量配置（Vercel Dashboard -> Project Settings -> Environment Variables）：
 *   NCM_API_UPSTREAM    - 自定义上游地址（Meting Worker），默认空 → 走公共兜底
 *                          示例: https://your-worker.you.workers.dev
 *   NCM_AUTH_MODE       - 'hmac' (默认) 或 'none'
 *   NCM_METING_TOKEN    - Meting HMAC 密钥，默认 'token'
 *   NCM_ALLOW_ORIGINS   - 允许的来源域名，逗号分隔，默认 '*'
 *                          示例: your-domain.com,*.your-domain.com
 */

const url = require('url');
const crypto = require('crypto');

// —— 公共兜底上游列表（按优先级）——
const FALLBACK_UPSTREAMS = [
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

function getEnv(key, fallback) {
    const v = process.env[key];
    return (v !== undefined && v !== null && v !== '') ? v : fallback;
}

function isOriginAllowed(origin, allowList) {
    if (!origin) return false;
    if (allowList === '*') return true;
    const allowed = allowList.split(',').map(s => s.trim()).filter(Boolean);
    try {
        const u = new URL(origin);
        const host = u.hostname;
        return allowed.some(pattern => {
            if (pattern === '*') return true;
            if (pattern.startsWith('*.')) {
                const baseDomain = pattern.slice(2);
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

// HMAC-SHA1（Node 原生 crypto，无需 Web Crypto）
function hmacSha1Hex(secret, message) {
    return crypto.createHmac('sha1', secret).update(message).digest('hex');
}

function sendJson(res, status, obj, extraHeaders = {}) {
    const body = JSON.stringify(obj);
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
    };
    res.writeHead(status, headers);
    res.end(body);
}

/**
 * 将 Meting 风格参数转换为对上游的请求并执行
 */
async function fetchFromUpstream(params) {
    const customUpstream = getEnv('NCM_API_UPSTREAM', '').trim();
    const authMode = getEnv('NCM_AUTH_MODE', 'hmac');
    const metingToken = getEnv('NCM_METING_TOKEN', 'token');

    const server = params.server || 'netease';
    const type = params.type || '';
    const id = params.id || '';
    const keywords = params.keywords || '';
    const limit = params.limit || '20';

    const candidates = [];
    if (customUpstream) {
        candidates.push({
            base: customUpstream.replace(/\/$/, ''),
            adapter: 'meting',
            authMode: authMode,
            token: metingToken,
        });
    }
    FALLBACK_UPSTREAMS.forEach(fb => candidates.push(fb));

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
                    const auth = hmacSha1Hex(up.token, server + type + idForAuth);
                    upParams.set('auth', auth);
                }

                targetUrl = `${up.base}/api?${upParams}`;

            } else {
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
                    default:
                        continue;
                }
            }

            // fetch 在 Node 18+ 全局可用
            const res = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Aurora-Player/1.0 (Vercel Serverless Function)',
                    'Accept': 'application/json, text/plain, */*',
                },
                signal: AbortSignal.timeout(8000),
            });

            if (res.ok) {
                const body = await res.arrayBuffer();
                const headers = {};
                // 过滤一些可能有问题的响应头
                const skip = new Set([
                    'content-encoding', 'content-length', 'transfer-encoding',
                    'connection', 'content-security-policy', 'content-security-policy-report-only',
                    'strict-transport-security', // 交给 Vercel 处理
                ]);
                for (const [k, v] of res.headers.entries()) {
                    if (skip.has(k.toLowerCase())) continue;
                    headers[k] = v;
                }
                headers['Access-Control-Allow-Origin'] = '*';
                headers['Cache-Control'] = (type === 'url')
                    ? 'public, max-age=600, s-maxage=600'   // 播放地址缓存 10 分钟
                    : 'public, max-age=3600, s-maxage=3600'; // 其他 1 小时

                return { status: res.status, headers, body: Buffer.from(body) };
            }

            lastErr = new Error(`上游 ${up.base} 返回 ${res.status}`);

        } catch (err) {
            lastErr = err;
        }
    }

    throw lastErr || new Error('所有上游 API 均不可用');
}

// —— Vercel Serverless Function 入口 ——
// 注意：Vercel 要求 CommonJS 风格导出（如果 package.json 无 type:module）
//       为兼容起见，同时导出 default 和 module.exports

async function handler(req, res) {
    const parsed = url.parse(req.url, true);
    const allowOrigins = getEnv('NCM_ALLOW_ORIGINS', '*');
    const requestOrigin = req.headers['origin'] || '';
    const cors = makeCorsHeaders(requestOrigin, allowOrigins);

    // OPTIONS 预检
    if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
    }

    // 只允许 GET / HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { code: -1, message: 'Method Not Allowed' }, cors);
        return;
    }

    try {
        const params = parsed.query || {};
        const type = params.type;

        if (!type) {
            sendJson(res, 400, {
                code: -1,
                message: '缺少 type 参数。支持: song(搜索), url(播放地址), lrc(歌词)',
                usage: {
                    search: '/api?server=netease&type=song&keywords=关键词',
                    url:    '/api?server=netease&type=url&id=歌曲ID',
                    lrc:    '/api?server=netease&type=lrc&id=歌曲ID',
                },
            }, cors);
            return;
        }

        const result = await fetchFromUpstream(params);
        const finalHeaders = { ...result.headers, ...cors };
        res.writeHead(result.status, finalHeaders);
        if (req.method === 'HEAD') {
            res.end();
        } else {
            res.end(result.body);
        }

    } catch (err) {
        sendJson(res, 502, {
            code: -1,
            message: 'API 代理失败: ' + (err.message || String(err)),
        }, cors);
    }
}

module.exports = handler;
module.exports.default = handler;
