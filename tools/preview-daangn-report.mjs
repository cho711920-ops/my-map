// Local-only visual fixture. No browser storage, provider traffic or DB mutation.
import http from 'node:http';
import { read, fixture } from '../tests/fixtures/daangn-report-fixture.mjs';
const state = fixture();
const mock = `window.chrome={runtime:{getManifest:()=>({version:'1.1.4'}),sendMessage:(_message,callback)=>callback(${JSON.stringify(state)})},storage:{onChanged:{addListener(){}}}};`;
http.createServer((req, res) => {
  const name = req.url.split('?')[0];
  if (name === '/mock.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(mock); }
  if (name === '/options.js' || name === '/options.css') {
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'text/css');
    return res.end(read('edge-automation/extension' + name));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(read('edge-automation/extension/options.html').replace('<script src="options.js">', '<script src="mock.js"></script><script src="options.js">'));
}).listen(8789, '127.0.0.1', () => console.log('Read-only UI fixture: http://127.0.0.1:8789'));
