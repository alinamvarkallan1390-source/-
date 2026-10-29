import { mkdir, copyFile, rm } from 'node:fs/promises';
await rm('public', { recursive: true, force: true });
await mkdir('public/docs', { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'docs/bots.html']) await copyFile(file, `public/${file}`);
