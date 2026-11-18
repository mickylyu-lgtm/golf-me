import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { previewHtml, roundSvg, safeImageUrl, renderImage, TOKEN } from "../api/share-preview.ts";
const base="https://example.supabase.co";
test("preview accepts only opaque high-entropy tokens",()=>{assert.equal(TOKEN.test("a".repeat(64)),true);for(const s of ["uuid","../settings","a".repeat(63)])assert.equal(TOKEN.test(s),false);});
test("media renderer accepts only this backend public community media",()=>{
 assert.ok(safeImageUrl(base+"/storage/v1/object/public/community-media/a/cover.jpg",base));
 for(const s of ["https://evil.test/x",base+"/storage/v1/object/sign/community-media/a",base+"/storage/v1/object/public/caddie/a","http://example.supabase.co/storage/v1/object/public/community-media/a"])assert.equal(safeImageUrl(s,base),null);
});
test("post HTML serves unique branded image and auth protected deep link",()=>{
 const h=previewHtml({kind:"post",id:"abc",image_url:"unused"},"a".repeat(64));
 assert.ok(h.includes('/api/share-preview?image=1&amp;token='));
 assert.ok(h.includes('/community/abc'));assert.ok(h.includes("noindex,nofollow"));
 assert.ok(!h.includes('content="https://golfme.app/og.png"'));
});
test("round card includes course, location, host calendar date and time with escaped user input",()=>{
 const d={kind:"round" as const,id:"x",course:"Pine & <script>",place:"New York, NY",date_iso:"2026-11-20T00:00:00Z",time:"12:30 PM"};
 const svg=roundSvg(d);assert.ok(svg.includes("Pine &amp; &lt;script&gt;"));assert.ok(svg.includes("New York, NY"));assert.ok(svg.includes("Nov 20"));assert.ok(svg.includes("12:30 PM"));
 const html=previewHtml(d,"a".repeat(64));assert.ok(html.includes("/golf-calls/x"));assert.ok(!html.includes("<script>\""));
});
test("revoked/missing previews contain no target or target-specific image",()=>{
 const h=previewHtml(null,"a".repeat(64));assert.ok(h.includes("/og.png"));assert.ok(!h.includes("/community/"));assert.ok(!h.includes("/golf-calls/"));
});
test("round raster has social preview dimensions",async()=>{
 const b=await renderImage({kind:"round",id:"x",course:"Pine Valley Golf Club",place:"New Jersey",date_iso:"2026-11-20",time:"12:30 PM"},base);
 const meta=await sharp(b).metadata();assert.equal(meta.width,1200);assert.equal(meta.height,630);assert.equal(meta.format,"jpeg");
});

test("post image preserves media with corner branding",async()=>{
 const source=await sharp({create:{width:1200,height:630,channels:3,background:"#e64a19"}}).jpeg().toBuffer();
 const previous=globalThis.fetch;
 globalThis.fetch=(async()=>new Response(source,{headers:{"Content-Type":"image/jpeg"}})) as typeof fetch;
 try{
  const image=await renderImage({kind:"post",id:"x",image_url:base+"/storage/v1/object/public/community-media/a/post.jpg"},base);
  const {data,info}=await sharp(image).raw().toBuffer({resolveWithObject:true});
  const center=(315*info.width+600)*info.channels;
  assert.ok(data[center]>200);assert.ok(data[center+1]<100);
  const corner=(60*info.width+1110)*info.channels;assert.ok(data[corner]<100);
 }finally{globalThis.fetch=previous;}
});

test("native share handlers never await network preparation before invoking share",()=>{
 for(const file of ["../src/components/community/PostShareButton.tsx","../src/lib/useShareActions.ts"]){
  const s=readFileSync(new URL(file,import.meta.url),"utf8");
  assert.ok(s.includes("usePreparedShare"));
  assert.ok(!s.includes("await createSharePreview"));
  assert.ok(s.includes('share.preparingToast'));
 }
 const h=readFileSync(new URL("../src/lib/usePreparedShare.ts",import.meta.url),"utf8");
 assert.ok(h.includes('authUser.id + ":" + kind + ":" + id'));
 assert.ok(h.includes("current.current === key"));
 assert.ok(h.includes("prepared?.key === key"));
 assert.ok(h.includes("25 * 60_000"));
 assert.ok(h.includes('visibilitychange'));
 assert.ok(h.includes("!isDemo"));
});
