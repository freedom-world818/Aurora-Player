/**
 * Aurora Player — 统一启动服务器
 * 一条命令启动：node server.js
 * - 网易云 API   → 后端代理 (内部端口 3000)
 * - 播放器前端   → http://localhost:8080
 *
 * 浏览器打开 http://localhost:8080 即可使用完整功能。
 */

const http = require('http');
const path = require('path');
const { spawn, exec } = require('child_process');

// ── 加载 Express（复用 api-server 中已有的依赖） ──
const express = require('./api-server/node_modules/express');
const serveStatic = require('./api-server/node_modules/serve-static');

const API_PORT = 3000;
const WEB_PORT = 8080;

// ═══════════════════════════════════════
//  自动打开浏览器
// ═══════════════════════════════════════
function openBrowser(url) {
    const platform = process.platform;
    let cmd;
    if (platform === 'win32') {
        cmd = `start "" "${url}"`;
    } else if (platform === 'darwin') {
        cmd = `open "${url}"`;
    } else {
        cmd = `xdg-open "${url}"`;
    }
    exec(cmd, (err) => {
        if (err) console.log('💡 请手动打开浏览器访问: ' + url);
    });
}

// ═══════════════════════════════════════
//  启动网易云 API（内部端口 3000）
// ═══════════════════════════════════════
const apiProcess = spawn('node', ['api-server/start.js'], {
    cwd: __dirname,
    stdio: 'inherit',
});

apiProcess.on('error', (err) => {
    console.error('❌ 无法启动网易云 API 服务:', err.message);
});

apiProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
        console.error(`❌ 网易云 API 服务异常退出 (code: ${code})`);
    }
});

// ═══════════════════════════════════════
//  需要代理到 API 的路径前缀
// ═══════════════════════════════════════
const API_ROUTES = [
    '/search',
    '/song',
    '/lyric',
    '/cloudsearch',
    '/login',
    '/user',
    '/playlist',
    '/album',
    '/artist',
    '/mv',
    '/dj',
    '/top',
    '/toplist',
    '/banner',
    '/personalized',
    '/recommend',
    '/comment',
    '/daily_signin',
    '/logout',
    '/cloud',
    '/check',
    '/voice',
    '/yunbei',
    '/login',
    '/captcha',
    '/register',
    '/verify',
    '/cellphone',
    '/nickname',
];

/**
 * 将请求代理到本地 NCM API
 */
function proxyToApi(req, res) {
    const options = {
        hostname: '127.0.0.1',
        port: API_PORT,
        path: req.originalUrl,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` },
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
            res.status(503).json({
                code: -1,
                message: 'API 服务正在启动中，请稍后重试…',
            });
        } else {
            res.status(502).json({
                code: -1,
                message: 'API 代理错误: ' + err.message,
            });
        }
    });

    // 设置超时
    proxyReq.setTimeout(15000, () => {
        proxyReq.destroy();
        res.status(504).json({ code: -1, message: 'API 请求超时' });
    });

    req.pipe(proxyReq);
}

// ═══════════════════════════════════════
//  等待 API 服务就绪（最多 15 秒）
// ═══════════════════════════════════════
function waitForApi(maxRetries = 30, interval = 500) {
    return new Promise((resolve) => {
        let tries = 0;
        const check = () => {
            const req = http.get(`http://127.0.0.1:${API_PORT}/search?keywords=test&limit=1`, (res) => {
                if (res.statusCode === 200) return resolve(true);
                retry();
            });
            req.on('error', retry);
            req.setTimeout(2000, () => { req.destroy(); retry(); });

            function retry() {
                tries++;
                if (tries >= maxRetries) return resolve(false);
                setTimeout(check, interval);
            }
        };
        setTimeout(check, 500); // 给 API 子进程 500ms 启动缓冲
    });
}

// ═══════════════════════════════════════
//  创建前端 + 代理服务器
// ═══════════════════════════════════════
const app = express();

// API 路由代理（需要在静态文件之前）
API_ROUTES.forEach(route => {
    app.use(route, proxyToApi);
});

// 静态文件服务
const staticDir = path.join(__dirname);
app.use(serveStatic(staticDir, {
    index: ['index.html'],
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache');
    },
}));

// 启动（等待 API 就绪后再启动前端服务）
(async () => {
    console.log('⏳ 等待网易云 API 服务就绪…');
    const apiReady = await waitForApi();
    if (apiReady) {
        console.log('✅ 网易云 API 已就绪');
    } else {
        console.log('⚠️  网易云 API 启动较慢，将继续启动前端（稍后可重试）');
    }

    const server = app.listen(WEB_PORT, '0.0.0.0', () => {
        const url = `http://localhost:${WEB_PORT}`;
        console.log('');
        console.log('  ╔══════════════════════════════════════╗');
        console.log('  ║   🎵  Aurora Player 已启动          ║');
        console.log('  ║                                      ║');
        console.log(`  ║   播放器    ${url}            ║`);
        console.log(`  ║   网易云API  http://localhost:${API_PORT}      ║`);
        console.log('  ║                                      ║');
        console.log('  ║   正在自动打开浏览器…              ║');
        console.log('  ╚══════════════════════════════════════╝');
        console.log('');
        // 自动打开浏览器
        setTimeout(() => openBrowser(url), 500);
    });

    // 优雅关闭
    function shutdown() {
        console.log('\n正在关闭服务…');
        server.close();
        apiProcess.kill('SIGTERM');
        setTimeout(() => {
            apiProcess.kill('SIGKILL');
            process.exit(0);
        }, 2000);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
})();
