import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=process.argv.indexOf('--port'),port=arg>=0?Number(process.argv[arg+1]):8766;
const rootArg=process.argv.indexOf('--root');
const root=path.resolve(rootArg>=0?String(process.argv[rootArg+1]||projectRoot):projectRoot);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid port');
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp3':'audio/mpeg'};
http.createServer((request,response)=>{
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end();return;}
  let pathname;try{pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);}catch{response.writeHead(400);response.end();return;}
  const file=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  const relative=path.relative(root,file);
  if(relative.startsWith('..')||path.isAbsolute(relative)||relative.split(path.sep).some(segment=>segment.startsWith('.'))){response.writeHead(403);response.end();return;}
  fs.stat(file,(error,stat)=>{if(error||!stat.isFile()){response.writeHead(404);response.end('Not found');return;}
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store'});
    if(request.method==='HEAD'){response.end();return;}fs.createReadStream(file).pipe(response);
  });
}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}/ (root: ${root})`)).on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already running. Open http://127.0.0.1:${port}/ or choose --port.`:error);process.exitCode=1;});
