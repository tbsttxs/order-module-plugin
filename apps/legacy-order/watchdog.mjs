import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
let child;
function start(){child=spawn(process.execPath,['server.mjs'],{cwd:root,stdio:'ignore',windowsHide:true});child.on('exit',()=>setTimeout(start,1500));}
start();
