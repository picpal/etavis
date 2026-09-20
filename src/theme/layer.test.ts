import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { layer } from './tokens.ts';

test('시트는 헤더보다 위에 그린다 — 모달이 화면 크롬에 가리면 안 된다', () => {
  assert.ok(layer.sheet > layer.header, `sheet(${layer.sheet}) > header(${layer.header}) 여야 한다`);
});

test('안내 스포트라이트는 시트보다도 위다 — 시트 안을 가리킬 때가 있다', () => {
  assert.ok(layer.spotlight > layer.sheet, `spotlight(${layer.spotlight}) > sheet(${layer.sheet}) 여야 한다`);
});

/** src 아래 .ts/.tsx 전부 */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/* 이 버그는 '헤더는 10, 시트는 무지정(=0)' 이라는 어긋남이었고, 두 숫자가 서로
   다른 파일에 흩어져 있어서 눈으로만 찾을 수 있었다. 날숫자를 막아 두면
   다음 층이 생겨도 tokens.ts 한 곳에서 순서를 보게 된다 */
test('zIndex 를 날숫자로 쓰지 않는다 — 층 순서는 tokens.ts 한 곳에서 본다', () => {
  const bad: string[] = [];
  for (const f of sources('src')) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      // 주석은 건너뛴다 — 이 규칙을 설명하는 문서가 스스로에게 걸린다
      if (/^\s*(\/\/|\/?\*)/.test(line)) return;
      if (/zIndex:\s*-?\d/.test(line)) bad.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], `layer.* 를 쓰세요:\n${bad.join('\n')}`);
});
