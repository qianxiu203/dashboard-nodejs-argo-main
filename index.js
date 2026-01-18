const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { execSync } = require('child_process');

// --- 环境变量配置 (保持外部接口不变) ---
const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;
const WORK_DIR = process.env.FILE_PATH || './app';   // 内部变量名改为 WORK_DIR
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const UUID = process.env.UUID || '9afd1229-b893-40c1-84dd-51e7ce204913';

// --- Nezha 监控变量 (严禁修改) ---
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';

// --- Argo 隧道变量 (严禁修改) ---
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = process.env.ARGO_PORT || 8010;

// --- 其他配置 ---
const CFIP = process.env.CFIP || 'cf.877774.xyz';
const CFPORT = process.env.CFPORT || 443;
const NODE_TAG = process.env.NAME || 'dashboard';

// 创建运行目录
if (!fs.existsSync(WORK_DIR)) {
  fs.mkdirSync(WORK_DIR);
  console.log(`Working directory created`);
}

// 随机字串生成器
function genID() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let res = '';
  for (let i = 0; i < 6; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

// --- 变量名特征消除 ---
// 将原 npm/web/bot/php 映射为无意义的 sys_X 命名
const sys_c1 = genID(); // 对应原 npmName (agent)
const sys_c2 = genID(); // 对应原 webName (xray)
const sys_c3 = genID(); // 对应原 botName (argo)
const sys_c4 = genID(); // 对应原 phpName (agent v1)

let p_c1 = path.join(WORK_DIR, sys_c1);
let p_c4 = path.join(WORK_DIR, sys_c4);
let p_c2 = path.join(WORK_DIR, sys_c2);
let p_c3 = path.join(WORK_DIR, sys_c3);

let f_sub = path.join(WORK_DIR, 'sub.txt');
let f_list = path.join(WORK_DIR, 'list.txt');
let f_log = path.join(WORK_DIR, 'boot.log');
let f_conf = path.join(WORK_DIR, 'config.json');

// 清理旧节点逻辑
function cleanOldNodes() {
  try {
    if (!UPLOAD_URL || !fs.existsSync(f_sub)) return;
    let content;
    try { content = fs.readFileSync(f_sub, 'utf-8'); } catch { return null; }
    const dec = Buffer.from(content, 'base64').toString('utf-8');
    const nList = dec.split('\n').filter(l => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(l));
    if (nList.length === 0) return;
    axios.post(`${UPLOAD_URL}/api/delete-nodes`, JSON.stringify({ nodes: nList }), { headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  } catch (e) {}
}

// 清理旧文件
function fsClean() {
  try {
    fs.readdirSync(WORK_DIR).forEach(f => {
      try {
        const fp = path.join(WORK_DIR, f);
        if (fs.statSync(fp).isFile()) fs.unlinkSync(fp);
      } catch (e) {}
    });
  } catch (e) {}
}

// --- 根路由伪装 (Welcome Page) ---
const FAKE_PAGE = `
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
    body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }
    h1 { color: #333; }
    p { color: #666; font-size: 0.9em; line-height: 1.6em; }
    .footer { font-size: 0.8em; color: #999; margin-top: 2em; border-top: 1px solid #eee; padding-top: 1em; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
<p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p>
<p><em>Thank you for using nginx.</em></p>
<div class="footer">Server ID: ${genID()}-${Date.now()}</div>
</body>
</html>
`;

app.get("/", function(req, res) {
  res.send(FAKE_PAGE);
});

// 生成核心配置文件
async function initSysConfig() {
  const conf = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      { port: ARGO_PORT, protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
      { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
      { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
    ],
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [ { protocol: "freedom", tag: "direct" }, {protocol: "blackhole", tag: "block"} ]
  };
  fs.writeFileSync(path.join(WORK_DIR, 'config.json'), JSON.stringify(conf, null, 2));
}

function getArch() {
  const a = os.arch();
  return (a === 'arm' || a === 'arm64' || a === 'aarch64') ? 'arm' : 'amd';
}

function fetchBin(fName, fUrl, cb) {
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });
  const w = fs.createWriteStream(fName);
  axios({ method: 'get', url: fUrl, responseType: 'stream' })
    .then(r => {
      r.data.pipe(w);
      w.on('finish', () => { w.close(); cb(null, fName); });
      w.on('error', e => { fs.unlink(fName, () => {}); cb(e.message); });
    })
    .catch(e => cb(e.message));
}

// 核心下载与启动逻辑
async function coreInit() {  
  const arch = getArch();
  const resList = getResForArch(arch);

  if (resList.length === 0) return;

  const dProms = resList.map(info => new Promise((res, rej) => {
    fetchBin(info.fileName, info.fileUrl, (e, fp) => e ? rej(e) : res(fp));
  }));

  try {
    await Promise.all(dProms);
  } catch (e) {
    console.error('Init failed:', e);
    return;
  }

  function setPerm(list) {
    list.forEach(p => {
      if (fs.existsSync(p)) fs.chmod(p, 0o775, () => {});
    });
  }
  
  const permList = NEZHA_PORT ? [p_c1, p_c2, p_c3] : [p_c4, p_c2, p_c3];
  setPerm(permList);

  // 启动 Nezha 逻辑
  if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
      // V1 模式
      const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
      const tlsSet = new Set(['443', '8443', '2096', '2087', '2083', '2053']);
      const isTls = tlsSet.has(port) ? 'true' : 'false';
      const cYaml = `
client_secret: ${NEZHA_KEY}
debug: false
disable_auto_update: true
disable_command_execute: false
disable_force_update: true
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: true
ip_report_period: 1800
report_delay: 4
server: ${NEZHA_SERVER}
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: ${isTls}
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${UUID}`;
      
      fs.writeFileSync(path.join(WORK_DIR, 'config.yaml'), cYaml);
      try {
        await exec(`nohup ${p_c4} -c "${WORK_DIR}/config.yaml" >/dev/null 2>&1 &`);
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {}
    } else {
      // V0 模式
      let nTls = '';
      if (['443', '8443', '2096', '2087', '2083', '2053'].includes(NEZHA_PORT)) nTls = '--tls';
      try {
        await exec(`nohup ${p_c1} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${nTls} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`);
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {}
    }
  }

  // 启动 Xray 逻辑 (sys_c2)
  try {
    await exec(`nohup ${p_c2} -c ${WORK_DIR}/config.json >/dev/null 2>&1 &`);
    await new Promise(r => setTimeout(r, 1000));
  } catch (e) {}

  // 启动 Argo 逻辑 (sys_c3)
  if (fs.existsSync(p_c3)) {
    let args;
    if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    } else if (ARGO_AUTH.match(/TunnelSecret/)) {
      args = `tunnel --edge-ip-version auto --config ${WORK_DIR}/tunnel.yml run`;
    } else {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${WORK_DIR}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
    }
    try {
      await exec(`nohup ${p_c3} ${args} >/dev/null 2>&1 &`);
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {}
  }
  await new Promise(r => setTimeout(r, 5000));
}

function getResForArch(a) {
  let bList;
  // 保持下载源不变，但文件保存名已混淆
  if (a === 'arm') {
    bList = [ { fileName: p_c2, fileUrl: "https://arm64.ssss.nyc.mn/web" }, { fileName: p_c3, fileUrl: "https://arm64.ssss.nyc.mn/bot" } ];
  } else {
    bList = [ { fileName: p_c2, fileUrl: "https://amd64.ssss.nyc.mn/web" }, { fileName: p_c3, fileUrl: "https://amd64.ssss.nyc.mn/bot" } ];
  }

  if (NEZHA_SERVER && NEZHA_KEY) {
    if (NEZHA_PORT) {
      const u = a === 'arm' ? "https://arm64.ssss.nyc.mn/agent" : "https://amd64.ssss.nyc.mn/agent";
      bList.unshift({ fileName: p_c1, fileUrl: u });
    } else {
      const u = a === 'arm' ? "https://arm64.ssss.nyc.mn/v1" : "https://amd64.ssss.nyc.mn/v1";
      bList.unshift({ fileName: p_c4, fileUrl: u });
    }
  }
  return bList;
}

function setupArgo() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) return;
  if (ARGO_AUTH.includes('TunnelSecret')) {
    fs.writeFileSync(path.join(WORK_DIR, 'tunnel.json'), ARGO_AUTH);
    const yml = `
  tunnel: ${ARGO_AUTH.split('"')[11]}
  credentials-file: ${path.join(WORK_DIR, 'tunnel.json')}
  protocol: http2
  ingress:
    - hostname: ${ARGO_DOMAIN}
      service: http://localhost:${ARGO_PORT}
      originRequest:
        noTLSVerify: true
    - service: http_status:404
  `;
    fs.writeFileSync(path.join(WORK_DIR, 'tunnel.yml'), yml);
  }
}

async function scanLogs() {
  let dom;
  if (ARGO_AUTH && ARGO_DOMAIN) {
    dom = ARGO_DOMAIN;
    await genLinks(dom);
  } else {
    try {
      const c = fs.readFileSync(path.join(WORK_DIR, 'boot.log'), 'utf-8');
      const m = c.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
      if (m) {
        dom = m[1];
        await genLinks(dom);
      } else {
        // 重试逻辑
        fs.unlinkSync(path.join(WORK_DIR, 'boot.log'));
        const kCmd = process.platform === 'win32' ? `taskkill /f /im ${sys_c3}.exe > nul 2>&1` : `pkill -f "[${sys_c3.charAt(0)}]${sys_c3.substring(1)}" > /dev/null 2>&1`;
        await exec(kCmd).catch(()=>{});
        await new Promise(r => setTimeout(r, 3000));
        
        const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${WORK_DIR}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
        try {
          await exec(`nohup ${p_c3} ${args} >/dev/null 2>&1 &`);
          await new Promise(r => setTimeout(r, 3000));
          await scanLogs();
        } catch (e) {}
      }
    } catch (e) {}
  }
}

async function getIsp() {
  try {
    const r1 = await axios.get('https://ipapi.co/json/', { timeout: 3000 });
    if (r1.data?.country_code && r1.data?.org) return `${r1.data.country_code}_${r1.data.org}`;
  } catch (e) {
      try {
        const r2 = await axios.get('http://ip-api.com/json/', { timeout: 3000 });
        if (r2.data?.status === 'success') return `${r2.data.countryCode}_${r2.data.org}`;
      } catch (e) {}
  }
  return 'Unknown';
}

async function genLinks(dom) {
  const isp = await getIsp();
  const nName = NODE_TAG ? `${NODE_TAG}-${isp}` : isp;
  return new Promise((resolve) => {
    setTimeout(() => {
      const vmConf = { v: '2', ps: `${nName}`, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'none', net: 'ws', type: 'none', host: dom, path: '/vmess-argo?ed=2560', tls: 'tls', sni: dom, alpn: '', fp: 'firefox'};
      const sTxt = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${dom}&fp=firefox&type=ws&host=${dom}&path=%2Fvless-argo%3Fed%3D2560#${nName}

vmess://${Buffer.from(JSON.stringify(vmConf)).toString('base64')}

trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${dom}&fp=firefox&type=ws&host=${dom}&path=%2Ftrojan-argo%3Fed%3D2560#${nName}
    `;
      console.log(Buffer.from(sTxt).toString('base64'));
      fs.writeFileSync(f_sub, Buffer.from(sTxt).toString('base64'));
      
      syncNodes();

      app.get(`/${SUB_PATH}`, (req, res) => {
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(Buffer.from(sTxt).toString('base64'));
      });
      resolve(sTxt);
      }, 2000);
    });
}

async function syncNodes() {
  if (UPLOAD_URL && PROJECT_URL) {
    const url = `${PROJECT_URL}/${SUB_PATH}`;
    try {
        await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, { subscription: [url] }, { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {}
  } else if (UPLOAD_URL) {
      if (!fs.existsSync(f_list)) return;
      const c = fs.readFileSync(f_list, 'utf-8');
      const nodes = c.split('\n').filter(l => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(l));
      if (nodes.length === 0) return;
      try {
          await axios.post(`${UPLOAD_URL}/api/add-nodes`, JSON.stringify({ nodes }), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {}
  }
}

function autoCleanup() {
  setTimeout(() => {
    const dels = [f_log, f_conf, p_c2, p_c3];  
    if (NEZHA_PORT) dels.push(p_c1);
    else if (NEZHA_SERVER && NEZHA_KEY) dels.push(p_c4);

    const cmd = process.platform === 'win32' ? `del /f /q ${dels.join(' ')} > nul 2>&1` : `rm -rf ${dels.join(' ')} >/dev/null 2>&1`;
    exec(cmd, () => {
      console.clear();
      console.log('Service started');
    });
  }, 90000);
}
autoCleanup();

async function keepAlive() {
  if (!AUTO_ACCESS || !PROJECT_URL) return;
  try {
    await axios.post('https://oooo.serv00.net/add-url', { url: PROJECT_URL }, { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {}
}

async function main() {
  try {
    setupArgo();
    cleanOldNodes();
    fsClean();
    await initSysConfig();
    await coreInit();
    await scanLogs();
    await keepAlive();
  } catch (e) { console.error(e); }
}

main().catch(() => {});
app.listen(PORT, () => console.log(`Server running on port:${PORT}`));
