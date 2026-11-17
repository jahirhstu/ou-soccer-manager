import { build } from 'esbuild';
await build({ entryPoints: ['src/main.ts','src/cli.ts'], outdir:'dist', bundle:true, platform:'node', target:'node22', format:'esm', external:['whatsapp-web.js','qrcode','@supabase/supabase-js'], sourcemap:true });
