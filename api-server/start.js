/**
 * 启动网易云音乐 API 服务
 * 端口 3000
 */

const { serveNcmApi } = require('NeteaseCloudMusicApi');

serveNcmApi({ port: 3000, host: '0.0.0.0' }).then(() => {
    console.log('网易云音乐 API 服务已启动: http://localhost:3000');
}).catch(err => {
    console.error('启动失败:', err);
    process.exit(1);
});
