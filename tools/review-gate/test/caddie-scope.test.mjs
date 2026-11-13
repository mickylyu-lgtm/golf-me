import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caddieEditAllowed } from "../lib/caddie-scope.mjs";
const root = mkdtempSync(join(tmpdir(), "caddie-scope-"));
for (const d of ["src", "docs", "test", "src/web/static"]) mkdirSync(join(root,d),{recursive:true});
const check=(path, tool="Edit")=>caddieEditAllowed(tool,{file_path:join(root,path)},root);
test("approved routine paths",()=> {
  for(const p of ["docs/SETUP.md","test/foo.test.ts","src/web/static/app.css"]) assert.equal(check(p),true,p);
});
test("security and external controls remain gated",()=> {
  for(const p of ["src/flow.ts","src/log.ts","src/service.ts","src/store.ts","src/config.ts","src/approval.ts","src/policy.ts","src/links.ts","src/discord/handler.ts","src/web/server.ts","scripts/deploy.sh",".env","config.json","package.json","docs/CLAUDE.md","test/.env","../other.ts"]) assert.equal(check(p),false,p);
  assert.equal(check("docs/SETUP.md","Bash"),false);
  assert.equal(caddieEditAllowed("Edit",{file_path:"docs/SETUP.md"},root),false);
});
test("symlink and hardlink escapes rejected",()=> {
  const outside=mkdtempSync(join(tmpdir(),"caddie-out-"));
  writeFileSync(join(outside,"file.ts"),"");
  symlinkSync(outside,join(root,"test/link"));
  assert.equal(check("test/link/file.ts"),false);
  assert.equal(caddieEditAllowed("Edit",{file_path:root+"/test/link/../file.ts"},root),false);
  assert.equal(caddieEditAllowed("Edit",{file_path:root+"/docs/../test/new.ts"},root),false);
  symlinkSync(join(outside,"file.ts"),join(root,"test/file.ts"));
  assert.equal(check("test/file.ts"),false);
  linkSync(join(outside,"file.ts"),join(root,"test/hard.ts"));
  assert.equal(check("test/hard.ts"),false);
  const alias=root+"-alias"; symlinkSync(root,alias);
  assert.equal(caddieEditAllowed("Edit",{file_path:join(alias,"src/flow.ts")},alias),false);
});
